import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { mkdir, mkdtemp, readFile, rm, writeFile, realpath, symlink, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32 } from "node:zlib"
import { extensionVersion, extensionZip, packageExtension } from "../package-extension.mts"
import { exists, fingerprint } from "../lib/workspace.mts"

function readZip(zip: Buffer) {
  const end = zip.length - 22
  assert.equal(zip.readUInt32LE(end), 0x06054b50)
  const count = zip.readUInt16LE(end + 10),
    directory = zip.readUInt32LE(end + 16)
  const files = new Map<string, Buffer>()
  let position = directory
  for (let index = 0; index < count; index++) {
    assert.equal(zip.readUInt32LE(position), 0x02014b50)
    const method = zip.readUInt16LE(position + 10),
      crc = zip.readUInt32LE(position + 16)
    const size = zip.readUInt32LE(position + 24),
      length = zip.readUInt16LE(position + 28),
      offset = zip.readUInt32LE(position + 42)
    const name = zip.subarray(position + 46, position + 46 + length).toString("utf8")
    assert.equal(method, 0)
    assert.equal(zip.readUInt32LE(offset), 0x04034b50)
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28)
    const bytes = zip.subarray(start, start + size)
    assert.equal(crc32(bytes), crc)
    files.set(name, bytes)
    position += 46 + length + zip.readUInt16LE(position + 30) + zip.readUInt16LE(position + 32)
  }
  assert.equal(position, end)
  return files
}

test("production ZIP is deterministic, UTF-8 and CRC-valid with manifest at its root", () => {
  const files = [
    { name: "manifest.json", bytes: Buffer.from('{"version":"1.0"}') },
    { name: "assets/é.js", bytes: Buffer.from("export const value = 1") },
  ]
  const archive = extensionZip(files)
  assert.deepEqual(extensionZip([...files].reverse()), archive)
  const entries = readZip(archive)
  assert.equal(entries.get("manifest.json")?.toString(), '{"version":"1.0"}')
  assert.equal(entries.get("assets/é.js")?.toString(), "export const value = 1")
  for (const name of ["../private", "/absolute", "assets\\bad.js", ".env", "assets/.env.local", "node_modules/file"])
    assert.throws(() => extensionZip([{ name, bytes: Buffer.from("private") }]))
  assert.throws(() => extensionZip([files[0], files[0]]), /Duplicate/)
  assert.throws(() => extensionZip([{ name: "huge", bytes: { length: 129 * 1024 * 1024 } as Uint8Array }]), /memory budget/)
})

test("Chrome manifest versions reject prereleases, leading zeros and overflowing components", () => {
  for (const version of ["0.1.0", "1", "1.2.3.65535"]) assert.doesNotThrow(() => extensionVersion(version))
  for (const version of ["0", "0.0.0", "01.2", "1.2-beta", "1.2.3.4.5", "1.65536", "", undefined])
    assert.throws(() => extensionVersion(version))
})

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "browser-client-package-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "apps/addon/dist/assets"), { recursive: true })
  await mkdir(join(root, "packages"))
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", type: "module" }))
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n")
  await writeFile(
    join(root, "apps.config.json"),
    JSON.stringify({ schemaVersion: 1, apps: { addon: { type: "extension", port: 5174 } } }),
  )
  const identity = { instanceId: "fixture-addon", type: "extension", legacy: false, integrationVersion: 1 }
  await writeFile(join(root, "template-versions.json"), JSON.stringify({ schemaVersion: 2, applications: { addon: identity } }))
  await writeFile(join(root, "apps/addon/app-identity.json"), JSON.stringify(identity))
  await writeFile(join(root, "apps/addon/package.json"), JSON.stringify({ name: "@browser-client/addon", type: "module" }))
  const manifest = {
    manifest_version: 3,
    name: "Fixture",
    version: "0.1.0",
    permissions: ["storage"],
    action: { default_popup: "index.html" },
    options_page: "options.html",
    background: { type: "module", service_worker: "assets/background.js" },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  }
  await writeFile(join(root, "apps/addon/manifest.config.ts"), `export default ${JSON.stringify(manifest)}`)
  await writeFile(join(root, "apps/addon/dist/manifest.json"), JSON.stringify(manifest))
  for (const name of ["index.html", "options.html"])
    await writeFile(join(root, "apps/addon/dist", name), '<html><script type="module" src="/assets/page.js"></script></html>')
  for (const name of ["page.js", "background.js"])
    await writeFile(join(root, "apps/addon/dist/assets", name), "export const value = 1")
  return root
}

test("packaging selects a named instance, previews without writes and records a verified archive", async (t) => {
  const root = await fixture(t),
    baseline = await fingerprint(root)
  const preview = await packageExtension(root, "addon", true)
  assert.equal(preview.appId, "addon")
  assert.equal(await exists(join(root, ".reinit")), false)
  const result = await packageExtension(root, "addon")
  assert("artifact" in result)
  const entries = readZip(await readFile(result.artifact))
  assert.equal(JSON.parse(entries.get("manifest.json")!.toString()).version, "0.1.0")
  assert.equal(await fingerprint(root), baseline)
  const output = (await readdir(join(root, ".reinit/releases")))[0]
  const report = JSON.parse(await readFile(join(root, ".reinit/releases", output, "report.json"), "utf8"))
  assert.equal(report.instanceId, "fixture-addon")
  assert.equal(report.resources.length, entries.size)
  await assert.rejects(packageExtension(root, "missing"))
})

test("stale versions, development output, private files and symlinks fail before producing an archive", async (t) => {
  for (const variant of ["version", "development", "private", "symlink"])
    await t.test(variant, async (t) => {
      const root = await fixture(t)
      await packageExtension(root, "addon", true)
      if (variant === "version") {
        const file = join(root, "apps/addon/dist/manifest.json"),
          manifest = JSON.parse(await readFile(file, "utf8"))
        manifest.version = "0.2.0"
        await writeFile(file, JSON.stringify(manifest))
      } else if (variant === "development")
        await writeFile(join(root, "apps/addon/dist/assets/page.js"), 'import "http://localhost:5174/@vite/client"')
      else if (variant === "private") await writeFile(join(root, "apps/addon/dist/.env.production"), "PRIVATE=value")
      else {
        await writeFile(join(root, "outside.js"), "export const privateValue = 1")
        await symlink(join(root, "outside.js"), join(root, "apps/addon/dist/linked.js"))
      }
      const expected = {
        version: /version is stale/,
        development: /development client/,
        private: /private or ambiguous/,
        symlink: /symbolic links/,
      }
      await assert.rejects(packageExtension(root, "addon"), expected[variant as keyof typeof expected])
      assert.equal(await exists(join(root, ".reinit/releases")), false)
    })
})
