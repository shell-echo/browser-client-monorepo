import assert from "node:assert/strict"
import { test } from "node:test"
import { applyCatalogs, catalogRange, readCatalogs } from "../lib/catalogs.mjs"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import semver from "semver"

const workspace = {
  catalog: { react: "19.3.0", tailwindcss: "^4.1.0" },
  catalogs: { next: { typescript: "^5" }, vite: { typescript: "~6.0.2" } },
}

test("common catalogs are reused while framework toolchains and custom dependencies stay distinct", () => {
  for (const [target, version, group] of [
    ["web", "^5", "next"],
    ["extension", "~6.0.2", "vite"],
    ["ui", "~6.0.2", "vite"],
  ]) {
    const manifest = {
      dependencies: { react: "^19.2.8", custom: "^1" },
      devDependencies: { typescript: version, tailwindcss: "^4" },
    }
    applyCatalogs(manifest, workspace, target)
    assert.equal(manifest.dependencies.react, "catalog:")
    assert.equal(manifest.dependencies.custom, "^1")
    assert.equal(manifest.devDependencies.typescript, `catalog:${group}`)
    assert.equal(manifest.devDependencies.tailwindcss, "catalog:")
    assert.deepEqual(applyCatalogs(structuredClone(manifest), workspace, target), manifest)
  }
})

test("incompatible upstream upgrades and missing catalogs fail closed", () => {
  assert.throws(() => applyCatalogs({ dependencies: { react: "^20" } }, workspace, "web"), /incompatible/)
  assert.throws(() => applyCatalogs({ devDependencies: { typescript: "^7" } }, workspace, "extension"), /incompatible/)
  assert.throws(() => catalogRange(workspace, "react", "catalog:missing"), /has no valid version/)
})

test("overlapping ranges cannot lower the official template's requirements", () => {
  const broad = { catalog: { react: "^19.0.0" } }
  assert.throws(
    () => applyCatalogs({ dependencies: { react: "^19.3.0" } }, broad, "web"),
    /full catalog range must satisfy template requirements/,
  )
  const narrowed = { catalog: { react: "^19.3.0" } }
  assert.equal(applyCatalogs({ dependencies: { react: "^19.0.0" } }, narrowed, "web").dependencies.react, "catalog:")
})

test("real workspace manifests resolve their catalogs without freezing policy versions", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  const actual = await readCatalogs(root)
  for (const path of ["apps/web", "apps/admin", "apps/extension", "packages/ui"]) {
    const manifest = JSON.parse(await readFile(join(root, path, "package.json"), "utf8"))
    let count = 0
    for (const field of ["dependencies", "devDependencies"]) {
      for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
        if (!specifier.startsWith("catalog:")) continue
        assert.ok(semver.validRange(catalogRange(actual, name, specifier)), `${path}: ${name}`)
        count++
      }
    }
    assert.ok(count > 0, `${path} must reuse shared dependency policy`)
    assert.equal(manifest.devDependencies.typescript, path === "apps/web" ? "catalog:next" : "catalog:vite")
  }
  assert.equal(catalogRange(actual, "react", "catalog:"), catalogRange(actual, "react-dom", "catalog:"))
})
