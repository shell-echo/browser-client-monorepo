import { required, offlineRegistry } from "./fixtures.mts"
import type { PackageManifest, RegistryMetadata, Registry } from "../lib/contracts.mts"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { parse, stringify } from "yaml"
import { updateDependencies } from "../lib/updates.mts"
import { fingerprint } from "../lib/workspace.mts"

async function fixture(
  t: import("node:test").TestContext,
  name: string,
  group: string,
  {
    compatible = false,
    selected = true,
    extraConsumer,
  }: { compatible?: boolean; selected?: boolean; extraConsumer?: string } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "browser-client-framework-catalog-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = ["next", "eslint-config-next"].includes(name) ? "web" : name === "vite" ? "admin" : "extension"
  const specifier = group === "default" ? "catalog:" : `catalog:${group}`
  const app = { name: target, dependencies: { plugin: "1.0.0" }, devDependencies: { [name]: specifier } }
  const manifests: Record<string, PackageManifest> = {
    ".": { name: "root" },
    "packages/ui": { name: "ui", dependencies: { helper: "1.0.0" } },
    [`apps/${target}`]: app,
    ...(extraConsumer ? { [`apps/${extraConsumer}`]: { name: "business", devDependencies: { [name]: specifier } } } : {}),
  }
  const lock = {
    catalogs: { [group]: { [name]: { specifier: "1.0.0", version: "1.0.0" } } },
    importers: Object.fromEntries(
      Object.entries(manifests).map(([path, manifest]) => [
        path,
        {
          dependencies: Object.fromEntries(Object.keys(manifest.dependencies ?? {}).map((key) => [key, { version: "1.0.0" }])),
          devDependencies: Object.fromEntries(
            Object.keys(manifest.devDependencies ?? {}).map((key) => [key, { version: "1.0.0" }]),
          ),
        },
      ]),
    ),
  }
  for (const [path, manifest] of Object.entries(manifests)) {
    await mkdir(join(root, path), { recursive: true })
    await writeFile(join(root, path, "package.json"), JSON.stringify(manifest))
  }
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    stringify({
      packages: ["apps/*", "packages/*"],
      ...(group === "default" ? { catalog: { [name]: "1.0.0" } } : { catalogs: { [group]: { [name]: "1.0.0" } } }),
    }),
  )
  await writeFile(join(root, "pnpm-lock.yaml"), stringify(lock))
  const integration: Record<string, RegistryMetadata> = {
    tailwindcss: { version: "4.3.3" },
    "@tailwindcss/vite": { version: "4.3.3" },
    "@types/chrome": { version: "0.3.5" },
    plugin: { version: "1.0.0", peerDependencies: { [name]: compatible ? "^2" : "^1" } },
  }
  const read = async (packageName: string, version: string) => {
    if (packageName === name) return { version }
    if (packageName === "helper") return { version, ...(version === "2.0.0" ? { engines: { node: ">=26" } } : {}) }
    assert(integration[packageName], `Unexpected registry query: ${packageName}`)
    return integration[packageName]
  }
  const registry: Registry = {
    read,
    latest: async (packageName: string) =>
      read(packageName, [name, "helper"].includes(packageName) ? "2.0.0" : integration[packageName]?.version),
    versions: async (packageName: string) =>
      [name, "helper"].includes(packageName) ? ["2.0.0", "1.0.0"] : [integration[packageName]?.version],
  }
  const template = { name: target, devDependencies: name === "@crxjs/vite-plugin" ? {} : { [name]: "^2.0.0" } }
  return { root, name, group, registry, templates: selected ? { [target]: template } : {}, previous: { [target]: app } }
}

test("catalog frameworks reject conflicts with their latest stable release before any writes", async (t) => {
  for (const name of ["next", "eslint-config-next", "vite", "@crxjs/vite-plugin"])
    for (const named of [false, true])
      await t.test(`${name}: ${named ? "named" : "default"} catalog`, async (t) => {
        const group = named ? (["next", "eslint-config-next"].includes(name) ? "next" : "vite") : "default"
        const f = await fixture(t, name, group)
        const before = await fingerprint(f.root)
        await assert.rejects(updateDependencies(f), /No stable compatible dependency combination/)
        assert.equal(await fingerprint(f.root), before)
      })
})

test("compatible catalog frameworks stay latest while shared packages can fall back and replay offline", async (t) => {
  for (const name of ["next", "vite", "@crxjs/vite-plugin"])
    await t.test(name, async (t) => {
      const f = await fixture(t, name, "default", { compatible: true })
      const receipt = await updateDependencies(f)
      const framework = required(receipt.entries.find((entry) => entry.name === name))
      assert.equal(framework.version, "2.0.0")
      assert.equal(framework.strictLatest, true)
      const shared = required(receipt.entries.find((entry) => entry.name === "helper"))
      assert.equal(shared.version, "1.0.0")
      assert(shared.reasons!.some((reason) => reason.includes("Requires Node")))
      assert.equal(parse(await readFile(join(f.root, "pnpm-workspace.yaml"), "utf8")).catalog[name], "2.0.0")
      const registry = offlineRegistry
      const replay = await updateDependencies({ ...f, registry, offline: true, saved: receipt })
      assert.equal(required(replay.entries.find((entry) => entry.name === name)).version, "2.0.0")
    })
})

test("an unrebuilt consumer cannot clear another consumer's strict framework policy", async (t) => {
  for (const extraConsumer of ["aaa-business", "zzz-business"])
    await t.test(extraConsumer, async (t) => {
      const f = await fixture(t, "next", "default", { extraConsumer })
      const before = await fingerprint(f.root)
      await assert.rejects(updateDependencies(f), /No stable compatible dependency combination/)
      assert.equal(await fingerprint(f.root), before)
    })
})

test("catalog consumers outside the rebuild retain the existing partial-upgrade policy", async (t) => {
  const f = await fixture(t, "next", "default", { selected: false })
  const receipt = await updateDependencies(f)
  const framework = required(receipt.entries.find((entry) => entry.name === "next"))
  assert.equal(framework.strictLatest, false)
  assert.equal(framework.version, "1.0.0")
  assert.equal(framework.latest, "2.0.0")
})

test("offline framework receipts cannot replay the old catalog fallback or hide its latest version", async (t) => {
  for (const name of ["next", "eslint-config-next", "vite", "@crxjs/vite-plugin"])
    for (const missingLatest of [false, true])
      await t.test(`${name}: ${missingLatest ? "missing latest" : "old fallback"}`, async (t) => {
        const f = await fixture(t, name, "default", { compatible: true })
        const saved = await updateDependencies(f)
        const entry = required(saved.entries.find((entry) => entry.name === name))
        entry.strictLatest = false
        if (missingLatest) delete entry.latest
        else entry.version = "1.0.0"
        const before = await fingerprint(f.root)
        await assert.rejects(
          updateDependencies({
            ...f,
            offline: true,
            saved,
            registry: offlineRegistry,
          }),
          /Offline framework receipt/,
        )
        assert.equal(await fingerprint(f.root), before)
      })
})
