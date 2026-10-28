import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { lstat, readFile, readdir, mkdir, writeFile, link, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { crc32 } from "node:zlib"
import { readApplications, selectApplications, assertAppId } from "./lib/apps.mts"
import { checkExtension } from "./check-extension.mts"
import { ensureRealDirectory, fingerprint } from "./lib/workspace.mts"

interface ArchiveFile {
  name: string
  bytes: Uint8Array
}
const maxBytes = 128 * 1024 * 1024
export function extensionVersion(value: unknown): asserts value is string {
  assert(
    typeof value === "string" && /^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3}$/.test(value),
    "Extension version must have 1..4 numeric components without leading zeros",
  )
  const parts = value.split(".").map(Number)
  assert(
    parts.every((part) => part <= 65535) && parts.some((part) => part > 0),
    "Extension version components must be <=65535 and not all zero",
  )
}
function archiveName(name: string) {
  assert(
    name &&
      !name.includes("\\") &&
      [...name].every((character) => {
        const code = character.charCodeAt(0)
        return code >= 32 && code !== 127
      }) &&
      !name.startsWith("/"),
    "Invalid ZIP resource name",
  )
  const parts = name.split("/")
  assert(
    parts.every((part) => part && ![".", "..", ".git", "node_modules"].includes(part) && !part.startsWith(".env")),
    "Refusing private or ambiguous files in the production archive",
  )
  assert(Buffer.byteLength(name) <= 65535, "ZIP resource name is too long")
}

// A bounded, deterministic ZIP using the ZIP store method (no compression).
// Only Node built-ins are needed; CRC32 and central-directory offsets remain
// independent of platform zip utilities, filesystem timestamps and permissions.
export function extensionZip(files: ArchiveFile[]) {
  assert(files.length > 0 && files.length <= 10_000, "Extension archive must contain 1..10000 regular files")
  assert(new Set(files.map((file) => file.name)).size === files.length, "Duplicate ZIP resource")
  assert(files.reduce((sum, file) => sum + file.bytes.length, 0) <= maxBytes, "Extension ZIP exceeds the 128 MiB memory budget")
  const local: Buffer[] = [],
    central: Buffer[] = []
  let offset = 0
  for (const file of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    archiveName(file.name)
    const name = Buffer.from(file.name),
      bytes = Buffer.from(file.bytes),
      checksum = crc32(bytes)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(0x21, 12) // 1980-01-01, required DOS date; time is 00:00.
    header.writeUInt32LE(checksum, 14)
    header.writeUInt32LE(bytes.length, 18)
    header.writeUInt32LE(bytes.length, 22)
    header.writeUInt16LE(name.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(0x314, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x800, 8)
    entry.writeUInt16LE(0x21, 14)
    entry.writeUInt32LE(checksum, 16)
    entry.writeUInt32LE(bytes.length, 20)
    entry.writeUInt32LE(bytes.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE((0o100644 * 65536) >>> 0, 38)
    entry.writeUInt32LE(offset, 42)
    local.push(header, name, bytes)
    central.push(entry, name)
    offset += header.length + name.length + bytes.length
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

export async function packageExtension(root: string, id: string, dryRun = false) {
  assertAppId(id)
  const baseline = await fingerprint(root)
  const app = selectApplications(await readApplications(root), id)[0]
  assert(app?.type === "extension", "Choose one registered Extension instance")
  const dist = join(root, app.path, "dist"),
    info = await lstat(dist)
  assert(info.isDirectory() && !info.isSymbolicLink(), "Build the production dist directory before packaging")
  const sourcePath = join(root, app.path, "manifest.config.ts"),
    sourceUrl = pathToFileURL(sourcePath)
  sourceUrl.searchParams.set(
    "snapshot",
    createHash("sha256")
      .update(await readFile(sourcePath))
      .digest("hex"),
  )
  const source = (await import(sourceUrl.href)).default as chrome.runtime.ManifestV3
  const files: ArchiveFile[] = []
  let total = 0
  let verified = 0
  async function visit(directory: string, prefix = "", verify = false) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name),
        entry = prefix ? `${prefix}/${name}` : name,
        stat = await lstat(path)
      archiveName(entry)
      assert(!stat.isSymbolicLink(), "Production ZIP cannot include symbolic links")
      if (stat.isDirectory()) await visit(path, entry, verify)
      else {
        assert(stat.isFile(), "Production ZIP accepts regular files only")
        total += stat.size
        assert(
          total <= maxBytes && (verify ? verified : files.length) < 10_000,
          "Extension archive exceeds the packaging memory/file budget",
        )
        if (verify) {
          const expected = files[verified++]
          assert.equal(expected?.name, entry, "Production output changed during packaging")
          assert.deepEqual(await readFile(path), Buffer.from(expected.bytes), "Production output changed during validation")
        } else files.push({ name: entry, bytes: await readFile(path) })
      }
    }
  }
  await visit(dist)
  assert(
    files.some((file) => file.name === "manifest.json"),
    "ZIP root must contain manifest.json",
  )
  const manifest = JSON.parse(Buffer.from(files.find((file) => file.name === "manifest.json")!.bytes).toString("utf8"))
  extensionVersion(manifest.version)
  assert.equal(manifest.version, source.version, "Built manifest version is stale; build this instance again")
  await checkExtension(dist, source)
  total = 0
  await visit(dist, "", true)
  assert.equal(verified, files.length, "Production output changed during packaging")
  assert.equal(await fingerprint(root), baseline, "Source changed during packaging; rebuild and retry")
  const summary = {
    appId: id,
    instanceId: app.instanceId,
    version: manifest.version as string,
    files: files.length,
    uncompressedBytes: total,
  }
  if (dryRun) return { ...summary, dryRun: true }
  const archive = extensionZip(files)
  await ensureRealDirectory(join(root, ".reinit"))
  await ensureRealDirectory(join(root, ".reinit/releases"))
  const output = join(root, ".reinit/releases", `${id}-${Date.now()}-${randomUUID().slice(0, 8)}`)
  await mkdir(output, { mode: 0o700 })
  const artifact = join(output, `${id}-${manifest.version}.zip`),
    temporary = join(output, ".archive.partial")
  try {
    await writeFile(temporary, archive, { flag: "wx", mode: 0o600 })
    await link(temporary, artifact) // Atomic publication without replacing an existing file.
  } finally {
    await rm(temporary, { force: true })
  }
  assert.equal(await fingerprint(root), baseline, "Packaging changed the original source")
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        ...summary,
        status: "passed",
        artifact,
        sha256: createHash("sha256").update(archive).digest("hex"),
        sourceFingerprint: baseline,
        resources: files.map(({ name, bytes }) => ({ name, sha256: createHash("sha256").update(bytes).digest("hex") })),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  )
  return { ...summary, artifact }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [id, ...flags] = process.argv.slice(2)
  if (id === "--help")
    console.log(
      "Usage: pnpm extension:package INSTANCE [--dry-run]\nPackage a previously built production dist into .reinit/releases; never publishes to a store.",
    )
  else {
    assert(
      id && flags.length <= 1 && flags.every((flag) => flag === "--dry-run"),
      "Usage: pnpm extension:package INSTANCE [--dry-run]",
    )
    console.log(
      JSON.stringify(
        await packageExtension(fileURLToPath(new URL("../", import.meta.url)), id, flags.includes("--dry-run")),
        null,
        2,
      ),
    )
  }
}
