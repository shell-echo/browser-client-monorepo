import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  assertEslintFloorRejection,
  dependencyVersions,
  generatorVersions,
  preservedSnapshot,
  seedReinitAcceptance,
} from "../lib/reinit-acceptance.mjs"

test("acceptance snapshots retain business bytes, permissions and custom browser hooks while excluding regenerated tooling", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "browser-client-acceptance-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  async function put(path, value) {
    await mkdir(join(root, path, ".."), { recursive: true })
    await writeFile(join(root, path), value)
  }
  await put("browser-tests.config.mjs", "custom business assertions")
  await put("packages/ui/src/button.tsx", "custom component")
  await put("apps/admin/src/workspace.tsx", "custom business page")
  await put("apps/admin/vite.config.ts", "regenerated adapter")
  await put("packages/ui/package.json", "updated dependency")
  await put("pnpm-lock.yaml", "updated lockfile")
  await put(".vscode/settings.json", "editor settings")
  await seedReinitAcceptance(root)
  const before = await preservedSnapshot(root)
  assert(before.some(([path]) => path === "apps/web/public/dist/reinit-business.txt"))
  assert(before.some(([path]) => path === "browser-tests.config.mjs"))
  assert(before.some(([path]) => path === "apps/admin/.env.reinit-verification"))
  assert(!before.some(([path]) => path === "pnpm-lock.yaml" || path.endsWith("/package.json")))
  assert.equal(await readFile(join(root, "apps/admin/src/workspace.tsx"), "utf8"), "custom business page")
  await put("apps/admin/vite.config.ts", "new adapter")
  await put("pnpm-lock.yaml", "new lockfile")
  assert.deepEqual(await preservedSnapshot(root), before)
  await put("packages/ui/src/button.tsx", "changed component")
  assert.notDeepEqual(await preservedSnapshot(root), before)
})

test("offline acceptance compares actual generator and dependency decisions independently of timestamps", () => {
  const a = {
    web: { generator: "create-next-app", version: "16.4.1", generatedAt: "before" },
    admin: { generator: "create-vite", version: "9.1.1" },
    extension: { generator: "create-vite", version: "9.1.1" },
    dependencies: {
      entries: [
        { id: "b", version: "2.0.0", previous: "^1" },
        { id: "a", version: "10.0.0" },
      ],
    },
  }
  const b = structuredClone(a)
  b.web.generatedAt = "after"
  b.dependencies.entries.reverse()
  assert.deepEqual(generatorVersions(a), generatorVersions(b))
  assert.deepEqual(dependencyVersions(a), dependencyVersions(b))
  b.dependencies.entries[0].version = "9.0.0"
  assert.notDeepEqual(dependencyVersions(a), dependencyVersions(b))
})

test("ESLint rejection acceptance cannot pass because help text mentions the minimum version", () => {
  const help = "ESLint must be 10 or newer for online candidates, offline receipts and installed dependencies."
  assert.throws(() => assertEslintFloorRejection({ code: 1 }, help + "\nGenerator cache is missing"))
  const cause = "Project minimum version policy requires eslint >=10.0.0, actual version is 9.39.0; Stopping rebuild"
  assertEslintFloorRejection({ code: 1 }, help + "\n" + cause)
  assert.throws(() => assertEslintFloorRejection({ code: 0 }, cause))
  assert.throws(() => assertEslintFloorRejection({ code: 1, reason: new Error("timed out") }, cause))
})
