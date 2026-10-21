import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { stringify } from "yaml"
import { updateDependencies, verifyResolvedUpdates } from "../lib/updates.mjs"
import { fingerprint } from "../lib/workspace.mjs"

const versions = { react: "19.3.0", tool: "2.0.0", helper: "2.1.0", next: "16.4.1" }
const registry = {
  latest: async (name) => {
    assert(Object.hasOwn(versions, name), `Unexpected registry query: ${name}`)
    return { version: versions[name] }
  },
  read: async (name, version) => {
    assert(Object.hasOwn(versions, name), `Unexpected registry query: ${name}`)
    return { version }
  },
}
const offlineRegistry = new Proxy({}, { get: () => assert.fail("Offline replay queried the registry") })
const locked = (version) => ({ specifier: version, version })
const ids = (receipt) => receipt.entries.map(({ id }) => id).sort()

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "browser-client-receipts-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const path of ["apps", "packages/ui"]) await mkdir(join(root, path), { recursive: true })
  const manifests = {
    ".": { name: "receipt-root", private: true, devDependencies: { tool: "2.0.0" } },
    "packages/ui": { name: "ui", dependencies: { react: "catalog:", helper: "2.1.0" } },
  }
  const workspace = { packages: ["apps/*", "packages/*"], catalog: { react: "19.3.0" } }
  const lock = {
    catalogs: { default: { react: locked("19.3.0") } },
    importers: {
      ".": { devDependencies: { tool: locked("2.0.0") } },
      "packages/ui": { dependencies: { react: { specifier: "catalog:", version: "19.3.0" }, helper: locked("2.1.0") } },
    },
  }
  const save = async () => {
    for (const [path, manifest] of Object.entries(manifests)) {
      await mkdir(join(root, path), { recursive: true })
      await writeFile(join(root, path, "package.json"), JSON.stringify(manifest))
    }
    await writeFile(join(root, "pnpm-workspace.yaml"), stringify(workspace))
    await writeFile(join(root, "pnpm-lock.yaml"), stringify(lock))
  }
  await save()
  await writeFile(join(root, "business.txt"), "preserved business data\n")
  const saved = await updateDependencies({ root, templates: {}, previous: {}, registry })
  await verifyResolvedUpdates(root, saved)
  return { root, manifests, workspace, lock, save, saved }
}

test("deleted dependency and workspace receipts are retired during online and offline planning", async (t) => {
  for (const offline of [false, true]) {
    for (const removed of ["root dependency", "shared dependency", "workspace", "catalog"])
      await t.test(`${offline ? "offline" : "online"}: ${removed}`, async (t) => {
        const f = await fixture(t)
        let expected = ids(f.saved)
        if (removed === "root dependency") {
          delete f.manifests["."].devDependencies.tool
          delete f.lock.importers["."].devDependencies.tool
          expected = expected.filter((id) => id !== ".:devDependencies:tool")
        } else if (removed === "shared dependency") {
          delete f.manifests["packages/ui"].dependencies.helper
          delete f.lock.importers["packages/ui"].dependencies.helper
          expected = expected.filter((id) => id !== "packages/ui:dependencies:helper")
        } else if (removed === "workspace") {
          delete f.manifests["packages/ui"]
          delete f.lock.importers["packages/ui"]
          await rm(join(f.root, "packages/ui"), { recursive: true })
          expected = expected.filter((id) => !id.startsWith("packages/ui:"))
        } else {
          delete f.workspace.catalog.react
          delete f.manifests["packages/ui"].dependencies.react
          delete f.lock.catalogs.default.react
          delete f.lock.importers["packages/ui"].dependencies.react
          expected = expected.filter((id) => id !== "catalog:default:react")
        }
        await f.save()
        const args = { root: f.root, templates: {}, previous: {}, offline, registry: offline ? offlineRegistry : registry }
        const receipt = await updateDependencies({ ...args, saved: f.saved })
        assert.deepEqual(ids(receipt), expected)
        await verifyResolvedUpdates(f.root, receipt)
        const replay = await updateDependencies({ ...args, offline: true, registry: offlineRegistry, saved: receipt })
        assert.deepEqual(ids(replay), expected, "An offline replay resurrected a removed dependency")
        await verifyResolvedUpdates(f.root, replay)
        assert.equal(await readFile(join(f.root, "business.txt"), "utf8"), "preserved business data\n")
      })
  }
})

test("online declaration moves replace old receipts and remain replayable offline", async (t) => {
  for (const moved of ["dependency field", "direct to catalog", "catalog to direct", "catalog group", "workspace dependency"])
    await t.test(moved, async (t) => {
      const f = await fixture(t)
      const ui = f.manifests["packages/ui"]
      const importer = f.lock.importers["packages/ui"]
      let removedId, replacementId
      if (moved === "dependency field") {
        delete ui.dependencies.helper
        ui.devDependencies = { helper: "2.1.0" }
        delete importer.dependencies.helper
        importer.devDependencies = { helper: locked("2.1.0") }
        removedId = "packages/ui:dependencies:helper"
        replacementId = "packages/ui:devDependencies:helper"
      } else if (moved === "direct to catalog") {
        ui.dependencies.helper = "catalog:"
        f.workspace.catalog.helper = "2.1.0"
        f.lock.catalogs.default.helper = locked("2.1.0")
        importer.dependencies.helper.specifier = "catalog:"
        removedId = "packages/ui:dependencies:helper"
        replacementId = "catalog:default:helper"
      } else if (moved === "catalog to direct") {
        ui.dependencies.react = "19.3.0"
        delete f.workspace.catalog.react
        delete f.lock.catalogs.default.react
        importer.dependencies.react.specifier = "19.3.0"
        removedId = "catalog:default:react"
        replacementId = "packages/ui:dependencies:react"
      } else if (moved === "catalog group") {
        ui.dependencies.react = "catalog:runtime"
        delete f.workspace.catalog.react
        f.workspace.catalogs = { runtime: { react: "19.3.0" } }
        delete f.lock.catalogs.default.react
        f.lock.catalogs.runtime = { react: locked("19.3.0") }
        importer.dependencies.react.specifier = "catalog:runtime"
        removedId = "catalog:default:react"
        replacementId = "catalog:runtime:react"
      } else {
        ui.dependencies.helper = "workspace:*"
        f.manifests["packages/helper"] = { name: "helper", version: "2.1.0" }
        f.lock.importers["packages/helper"] = {}
        importer.dependencies.helper = { specifier: "workspace:*", version: "link:../helper" }
        removedId = "packages/ui:dependencies:helper"
      }
      await f.save()
      const receipt = await updateDependencies({ root: f.root, templates: {}, previous: {}, registry, saved: f.saved })
      const expected = ids(f.saved)
        .filter((id) => id !== removedId)
        .concat(replacementId ? [replacementId] : [])
        .sort()
      assert.deepEqual(ids(receipt), expected)
      await verifyResolvedUpdates(f.root, receipt)
      const replay = await updateDependencies({
        root: f.root,
        templates: {},
        previous: {},
        saved: receipt,
        offline: true,
        registry: offlineRegistry,
      })
      assert.deepEqual(ids(replay), expected)
      await verifyResolvedUpdates(f.root, replay)
    })
})

test("moving a managed dependency offline without a new receipt stops before writes", async (t) => {
  const f = await fixture(t)
  delete f.manifests["packages/ui"].dependencies.helper
  f.manifests["packages/ui"].devDependencies = { helper: "2.1.0" }
  delete f.lock.importers["packages/ui"].dependencies.helper
  f.lock.importers["packages/ui"].devDependencies = { helper: locked("2.1.0") }
  await f.save()
  const before = await fingerprint(f.root)
  await assert.rejects(
    updateDependencies({ root: f.root, templates: {}, previous: {}, saved: f.saved, offline: true, registry: offlineRegistry }),
    /Offline receipt is missing packages\/ui:devDependencies:helper/,
  )
  assert.equal(await fingerprint(f.root), before)
})

test("offline moves can reuse an existing shared catalog receipt", async (t) => {
  const f = await fixture(t)
  const saved = structuredClone(f.saved)
  saved.entries.push({
    ...saved.entries.find(({ id }) => id === "catalog:default:react"),
    id: "packages/ui:dependencies:react",
    location: { path: "packages/ui", field: "dependencies", name: "react" },
  })
  const receipt = await updateDependencies({
    root: f.root,
    templates: {},
    previous: {},
    saved,
    offline: true,
    registry: offlineRegistry,
  })
  assert.deepEqual(ids(receipt), ids(f.saved))
  await verifyResolvedUpdates(f.root, receipt)
})

test("partial rebuilds keep current locked application receipts for later full offline replay", async (t) => {
  for (const version of ["16.4.1", "16.4.2"])
    await t.test(version, async (t) => {
      const f = await fixture(t)
      const path = "apps/web"
      const template = { dependencies: { next: "16.4.1" } }
      const previous = { name: "web", dependencies: { next: "16.4.1" } }
      f.manifests[path] = previous
      f.lock.importers[path] = { dependencies: { next: locked("16.4.1") } }
      await f.save()
      const saved = await updateDependencies({
        root: f.root,
        templates: { web: template },
        previous: { web: previous },
        registry,
      })
      await verifyResolvedUpdates(f.root, saved)
      f.manifests[path] = JSON.parse(await readFile(join(f.root, path, "package.json"), "utf8"))
      f.manifests[path].dependencies.next = `^${version}`
      f.lock.importers[path].dependencies.next = { specifier: `^${version}`, version }
      await f.save()
      for (const offline of [false, true]) {
        await f.save()
        const partial = await updateDependencies({
          root: f.root,
          templates: {},
          previous: {},
          saved,
          offline,
          registry: offline ? offlineRegistry : registry,
        })
        const entry = partial.entries.find(({ id }) => id === "apps/web:dependencies:next")
        assert.equal(entry?.version, version)
        if (version === "16.4.1")
          assert.deepEqual(
            entry,
            saved.entries.find(({ id }) => id === entry.id),
            "An unchanged receipt was lost or rewritten",
          )
        assert.equal(
          JSON.parse(await readFile(join(f.root, path, "package.json"), "utf8")).dependencies.next,
          `^${version}`,
          "A partial rebuild rewrote an unrebuilt application's dependency declaration",
        )
        await verifyResolvedUpdates(f.root, partial)
        const messages = []
        const log = console.log
        let full
        try {
          console.log = (...args) => messages.push(args.join(" "))
          full = await updateDependencies({
            root: f.root,
            templates: { web: { dependencies: { next: version } } },
            previous: { web: f.manifests[path] },
            saved: partial,
            offline: true,
            registry: offlineRegistry,
          })
        } finally {
          console.log = log
        }
        assert(
          !messages.some((message) => message.includes(`latest ${version} not selected`)),
          "The retained locked version was incorrectly reported as a rejected latest release",
        )
        assert.equal(full.entries.find(({ id }) => id === entry.id)?.version, version)
        await verifyResolvedUpdates(f.root, full)
      }
    })
})

test("retiring receipts cannot hide an ESLint 9 offline record or installed dependency", async (t) => {
  const f = await fixture(t)
  const saved = structuredClone(f.saved)
  saved.entries.push({ id: "deleted:eslint", name: "eslint", version: "9.39.5", location: { path: "deleted" } })
  const before = await fingerprint(f.root)
  await assert.rejects(
    updateDependencies({ root: f.root, templates: {}, previous: {}, saved, offline: true, registry: offlineRegistry }),
    /minimum version.*eslint.*>=10\.0\.0/,
  )
  assert.equal(await fingerprint(f.root), before)
  f.lock.packages = { "eslint@9.39.5": {} }
  await f.save()
  await assert.rejects(verifyResolvedUpdates(f.root, f.saved), /minimum version.*eslint.*>=10\.0\.0/)
})

test("a retained application receipt cannot be refreshed to a prerelease offline", async (t) => {
  const f = await fixture(t)
  f.manifests["apps/web"] = { name: "web", dependencies: { next: "16.5.0-beta.1" } }
  f.lock.importers["apps/web"] = { dependencies: { next: locked("16.5.0-beta.1") } }
  await f.save()
  const saved = structuredClone(f.saved)
  saved.entries.push({
    id: "apps/web:dependencies:next",
    name: "next",
    version: "16.4.1",
    location: { path: "apps/web", field: "dependencies", name: "next" },
  })
  const before = await fingerprint(f.root)
  await assert.rejects(
    updateDependencies({ root: f.root, templates: {}, previous: {}, saved, offline: true, registry: offlineRegistry }),
    /next must retain a stable locked version/,
  )
  assert.equal(await fingerprint(f.root), before)
})
