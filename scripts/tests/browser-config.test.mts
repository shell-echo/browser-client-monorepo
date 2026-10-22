import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { browserUrl, loadBrowserConfig, prepareHmrUpdate, validateBrowserConfig } from "../lib/browser-config.mts"

const config = (): {
  web: Record<string, unknown>
  admin: Record<string, unknown>
  extension: Record<string, unknown> & { hmr: { file: string; update(source: string): string; verify(): void } }
} => ({
  web: { path: "/workspace", verify() {} },
  admin: { path: "/console", verify() {}, verifyRoutes() {} },
  extension: {
    verifyPage() {},
    verifyBackground() {},
    hmr: { file: "apps/extension/src/workspace.tsx", update: (source: string) => source + "\n// HMR\n", verify() {} },
  },
})

async function fixture(t: import("node:test").TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "browser-client-hooks-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "apps/extension/src"), { recursive: true })
  return root
}

test("custom business routes and assertions load from the candidate instead of starter literals", async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, "browser-tests.config.mts"), `export default ${JSON.stringify({})}\n`)
  await assert.rejects(loadBrowserConfig(root), /Browser paths/)
  // A different project avoids the module cache and simulates a custom app.
  const custom = await fixture(t)
  await writeFile(
    join(custom, "browser-tests.config.mts"),
    `
    export default {
      web: { path: "/workspace?view=active", verify: ({ heading }) => { if (heading !== "Projects") throw Error("wrong business page") } },
      admin: { path: "/console", verify() {}, verifyRoutes() {} },
      extension: { verifyPage() {}, verifyBackground() {}, hmr: { file: "apps/extension/src/workspace.tsx", update: s => s + "!", verify() {} } }
    }
  `,
  )
  const loaded = await loadBrowserConfig(custom)
  assert.equal(browserUrl("http://127.0.0.1:3150", loaded.web.path), "http://127.0.0.1:3150/workspace?view=active")
  const verify = loaded.web.verify as unknown as (value: { heading: string }) => void
  verify({ heading: "Projects" })
  assert.throws(() => verify({ heading: "Welcome" }), /wrong business page/)
})

test("missing business hooks, external routes and unsafe HMR paths fail closed", () => {
  for (const [target, field] of [
    ["web", "verify"],
    ["admin", "verifyRoutes"],
    ["extension", "verifyPage"],
    ["extension", "verifyBackground"],
  ] as const) {
    const value = config()
    delete value[target][field]
    assert.throws(() => validateBrowserConfig(value), /assertions/)
  }
  for (const path of ["https://example.com/", "//example.com/", "/\\example.com/"])
    assert.throws(() => browserUrl("http://127.0.0.1:3150", path))
  for (const hook of ["verifyInteractions", "verifyPreview"]) {
    const value = config()
    value.extension[hook] = true
    assert.throws(() => validateBrowserConfig(value), /must be a function/)
    value.extension[hook] = () => {}
    assert.doesNotThrow(() => validateBrowserConfig(value))
  }
  for (const file of [
    "/tmp/outside.tsx",
    "apps/extension/../other.tsx",
    "apps/extension/node_modules/probe.tsx",
    "apps/extension/dist/app.js",
  ] as const) {
    const value = config()
    value.extension.hmr.file = file
    assert.throws(() => validateBrowserConfig(value))
  }
})

test("custom HMR edits and restores the configured module; no-op updates are rejected before writes", async (t) => {
  const root = await fixture(t)
  const path = join(root, config().extension.hmr.file)
  await writeFile(path, "export default function Workspace() { return 'Projects' }\n")
  const original = await readFile(path, "utf8")
  const update = await prepareHmrUpdate(root, config().extension.hmr)
  assert.equal(await readFile(path, "utf8"), original)
  await update.apply()
  assert.match(await readFile(path, "utf8"), /HMR/)
  await update.restore()
  assert.equal(await readFile(path, "utf8"), original)
  await assert.rejects(prepareHmrUpdate(root, { ...config().extension.hmr, update: (source) => source }), /must change/)
  assert.equal(await readFile(path, "utf8"), original)
})

test("HMR refuses symbolic links outside its source ownership", async (t) => {
  const root = await fixture(t)
  const outside = join(root, "outside.tsx")
  await writeFile(outside, "preserved")
  await symlink(outside, join(root, config().extension.hmr.file))
  await assert.rejects(prepareHmrUpdate(root, config().extension.hmr), /extension source/)
  assert.equal(await readFile(outside, "utf8"), "preserved")
})
