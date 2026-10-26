import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { syncThemeAssets } from "../sync-theme-assets.mts"
import type { AppsConfig } from "../lib/apps.mts"
import { preserveApp } from "../lib/workspace.mts"

const updated = "// browser-client theme bootstrap.\n// Updated shared source.\n"
const previous = "// browser-client theme bootstrap.\n// Previous shared source.\n"

async function fixture(t: TestContext, apps: AppsConfig["apps"] = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "browser-client-theme-sync-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "apps"))
  await mkdir(join(root, "packages/ui/src/lib"), { recursive: true })
  await writeFile(join(root, "packages/ui/src/lib/theme-init.js"), updated)
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-root" }))
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n")
  await writeFile(join(root, "apps.config.json"), JSON.stringify({ schemaVersion: 1, apps }))
  const applications: Record<string, unknown> = {}
  for (const [id, definition] of Object.entries(apps)) {
    const identity = { instanceId: `fixture-${id}`, type: definition.type, legacy: false, integrationVersion: 1 }
    applications[id] = identity
    await mkdir(join(root, "apps", id, "public"), { recursive: true })
    await writeFile(join(root, "apps", id, "package.json"), JSON.stringify({ name: `@browser-client/${id}` }))
    await writeFile(join(root, "apps", id, "app-identity.json"), JSON.stringify(identity))
    await writeFile(join(root, "apps", id, "public/theme-init.js"), definition.type === "web" ? "web-owned asset" : previous)
  }
  await writeFile(join(root, "template-versions.json"), JSON.stringify({ schemaVersion: 2, applications }))
  for (const type of ["admin", "extension"]) {
    await mkdir(join(root, "templates", type, "public"), { recursive: true })
    await writeFile(join(root, "templates", type, "public/theme-init.js"), previous)
    await writeFile(join(root, "templates", type, "public/business.txt"), "keep seed business asset", { mode: 0o600 })
  }
  return root
}

test("theme sync updates both seeds with empty, Web-only and multiple Vite instance combinations", async (t) => {
  for (const apps of [
    {},
    { website: { type: "web", port: 3000 } },
    {
      website: { type: "web", port: 3000 },
      console: { type: "admin", port: 5173 },
      studio: { type: "admin", port: 5175 },
      addon: { type: "extension", port: 5174 },
      companion: { type: "extension", port: 5176 },
    },
  ] as AppsConfig["apps"][]) {
    await t.test(Object.keys(apps).join(",") || "empty", async (t) => {
      const root = await fixture(t, apps)
      await syncThemeAssets(root)
      await syncThemeAssets(root)
      for (const type of ["admin", "extension"]) {
        assert.equal(await readFile(join(root, "templates", type, "public/theme-init.js"), "utf8"), updated)
        const candidate = join(root, `new-${type}`)
        await mkdir(join(candidate, "public"), { recursive: true })
        await writeFile(join(candidate, "public/theme-init.js"), "official default")
        await preserveApp(join(root, "templates", type), candidate)
        assert.equal(await readFile(join(candidate, "public/theme-init.js"), "utf8"), updated)
        assert.equal(await readFile(join(candidate, "public/business.txt"), "utf8"), "keep seed business asset")
      }
      for (const [id, { type }] of Object.entries(apps))
        assert.equal(
          await readFile(join(root, "apps", id, "public/theme-init.js"), "utf8"),
          type === "web" ? "web-owned asset" : updated,
        )
    })
  }
})

test("theme sync creates missing seed assets even without any registered application", async (t) => {
  const root = await fixture(t)
  await rm(join(root, "templates"), { recursive: true })
  await syncThemeAssets(root)
  for (const type of ["admin", "extension"])
    assert.equal(await readFile(join(root, "templates", type, "public/theme-init.js"), "utf8"), updated)
})

test("theme sync rejects custom seed or instance assets before updating any destination", async (t) => {
  for (const path of ["templates/extension/public/theme-init.js", "apps/console/public/theme-init.js"]) {
    await t.test(path, async (t) => {
      const root = await fixture(t, { console: { type: "admin", port: 5173 } })
      await writeFile(join(root, path), "custom application asset")
      await assert.rejects(syncThemeAssets(root), /Refusing to overwrite/)
      assert.equal(await readFile(join(root, path), "utf8"), "custom application asset")
      assert.equal(await readFile(join(root, "templates/admin/public/theme-init.js"), "utf8"), previous)
      if (!path.startsWith("apps/"))
        assert.equal(await readFile(join(root, "apps/console/public/theme-init.js"), "utf8"), previous)
    })
  }
})

test("theme sync refuses linked seed directories and asset files without touching their targets", async (t) => {
  for (const path of ["templates/extension/public", "templates/extension/public/theme-init.js"]) {
    await t.test(path, async (t) => {
      const root = await fixture(t)
      const directory = path.endsWith("public")
      const outside = join(root, directory ? "outside" : "outside.js")
      if (directory) await mkdir(outside)
      const file = directory ? join(outside, "theme-init.js") : outside
      await writeFile(file, previous)
      await rm(join(root, path), { recursive: true })
      await symlink(outside, join(root, path), directory ? "dir" : "file")
      await assert.rejects(syncThemeAssets(root), /symbolic link/)
      assert.equal(await readFile(file, "utf8"), previous)
      assert.equal(await readFile(join(root, "templates/admin/public/theme-init.js"), "utf8"), previous)
    })
  }
})
