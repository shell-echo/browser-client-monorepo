import { readApplications, application } from "../lib/apps.mts"
import { required, offlineRegistry } from "./fixtures.mts"
import type { RegistryMetadata, DependencyVariable, DependencyReceipt } from "../lib/contracts.mts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { createRegistry, solveUpdates, stableVersions, updateDependencies, verifyResolvedUpdates } from "../lib/updates.mts"
import { fingerprint, promote } from "../lib/workspace.mts"

function registryFixture(
  packages: Record<string, { latest: string; releases: Record<string, Omit<RegistryMetadata, "version">> }>,
) {
  return createRegistry(async (name, fields) => {
    if (fields.includes("versions"))
      return { versions: Object.keys(packages[name].releases), "dist-tags": { latest: packages[name].latest } }
    const separator = name.lastIndexOf("@"),
      packageName = name.slice(0, separator),
      selector = name.slice(separator + 1)
    const data = packages[packageName]
    const version = selector === "latest" ? data.latest : selector
    assert(data.releases[version], `${packageName}@${version}`)
    return { version, ...data.releases[version] }
  })
}
const releases = (versions: Record<string, Omit<RegistryMetadata, "version">>, latest = Object.keys(versions)[0]) => ({
  latest,
  releases: versions,
})
const variable = (name: string, extra: Partial<DependencyVariable> = {}): DependencyVariable => ({ id: name, name, ...extra })

test("the engineering compiler respects shared lint peers before trying historical parser versions", async () => {
  const registry = registryFixture({
    typescript: releases({ "7.0.2": {}, "6.0.3": {} }),
    "typescript-eslint": releases({
      "8.72.0": { peerDependencies: { typescript: ">=4.8.4 <6.1.0" } },
      "8.71.1": { peerDependencies: { typescript: ">=4.8.4 <6.1.0" } },
    }),
  })
  const versions = registry.versions
  registry.versions = async (name) => {
    assert.equal(name, "typescript", "The compatible latest parser must not trigger a historical plugin search")
    return versions(name)
  }
  const decisions = await solveUpdates({
    variables: [variable("typescript"), variable("typescript-eslint")],
    scopes: [
      { path: ".", dependencies: { typescript: "typescript" } },
      {
        path: "packages/eslint-config",
        name: "shared-lint",
        peers: { typescript: ">=5.8 <6.1" },
        dependencies: { "typescript-eslint": "typescript-eslint" },
      },
    ],
    registry,
  })
  assert.equal(required(decisions.find((entry) => entry.name === "typescript")).version, "6.0.3")
  assert.equal(required(decisions.find((entry) => entry.name === "typescript-eslint")).version, "8.72.0")
  assert(
    required(decisions.find((entry) => entry.name === "typescript")).reasons.some((reason) =>
      reason.includes("shared-lint requires typescript"),
    ),
  )
})

test("stable selection rejects prereleases and does not follow next channels", async () => {
  assert.deepEqual(stableVersions(["3.0.0-beta.1", "2.1.0", "2.0.0", "4.0.0"], "3.0.0-beta.1"), ["2.1.0", "2.0.0"])
  const registry = registryFixture({ tool: releases({ "3.0.0-rc.1": {}, "2.1.0": { deprecated: "retired" }, "2.0.0": {} }) })
  assert.equal((await registry.latest("tool")).version, "2.0.0")
  const invalid = createRegistry(async () => ({ version: "not-semver" }))
  await assert.rejects(invalid.latest("tool"), /response is invalid/)
})

test("frameworks stay latest while shared dependencies choose highest compatible stable versions", async () => {
  const registry = registryFixture({
    vite: releases({ "8.0.0": { peerDependencies: { typescript: ">=5" } } }),
    crx: releases({ "3.0.0": { peerDependencies: { vite: "^8" } } }),
    typescript: releases({ "7.0.0": {}, "6.1.0": {}, "6.0.0": {}, "5.9.0": {} }),
    eslint: releases({ "11.0.0": {}, "10.9.0": {}, "10.8.0": {} }),
    js: releases({
      "11.0.0": { peerDependencies: { eslint: "^11" }, peerDependenciesMeta: { eslint: { optional: true } } },
      "10.9.0": {},
    }),
    helper: releases({ "3.0.0": { engines: { node: ">=26" } }, "2.0.0": {} }),
  })
  const entries = await solveUpdates({
    registry,
    nodeVersion: "24.21.0",
    variables: [
      variable("vite", { strictLatest: true }),
      variable("crx", { strictLatest: true }),
      variable("typescript", { required: [{ range: "~6.0.0", from: "template" }] }),
      variable("eslint"),
      variable("js"),
      variable("helper"),
    ],
    scopes: [
      {
        path: ".",
        dependencies: { vite: "vite", crx: "crx", typescript: "typescript", eslint: "eslint", js: "js", helper: "helper" },
      },
      { path: "packages/lint", name: "local-config", dependencies: {}, peers: { eslint: "^10" } },
    ],
  })
  assert.deepEqual(Object.fromEntries(entries.map((entry) => [entry.name, entry.version])), {
    vite: "8.0.0",
    crx: "3.0.0",
    typescript: "6.0.0",
    eslint: "10.9.0",
    js: "10.9.0",
    helper: "2.0.0",
  })
  for (const name of ["typescript", "eslint", "js", "helper"])
    assert(required(entries.find((entry) => entry.name === name)).reasons.length)
})

test("incompatible latest CRXJS/Vite stops instead of silently downgrading a framework", async () => {
  const registry = registryFixture({
    vite: releases({ "9.0.0": {}, "8.0.0": {} }),
    crx: releases({ "3.0.0": { peerDependencies: { vite: "^8" } } }),
  })
  await assert.rejects(
    solveUpdates({
      registry,
      variables: [variable("vite", { strictLatest: true }), variable("crx", { strictLatest: true })],
      scopes: [{ path: ".", dependencies: { vite: "vite", crx: "crx" } }],
    }),
    /crx@3.0.0 requires vite \^8/,
  )
})

test("a deprecated compatibility release is explicit rather than a silent downgrade", async () => {
  const registry = registryFixture({
    tool: releases({ "10.0.0": {}, "9.9.0": { deprecated: "unsupported by upstream" }, "9.8.0": {} }),
  })
  const [entry] = await solveUpdates({
    registry,
    variables: [variable("tool", { current: "9.9.0", required: [{ from: "official template", range: "^9" }] })],
    scopes: [{ path: ".", dependencies: { tool: "tool" } }],
  })
  assert.equal(entry.version, "9.9.0")
  assert(entry.reasons!.some((reason) => reason.includes("deprecated")))
})

test("withdrawn releases with missing peer metadata cannot be introduced during fallback", async () => {
  const registry = registryFixture({
    eslint: releases({ "10.12.0": {} }),
    js: releases({
      "11.0.1": { peerDependencies: { eslint: "^11" } },
      "11.0.0": { deprecated: "This version should not be used." },
      "10.0.1": { peerDependencies: { eslint: "^10" } },
    }),
  })
  const entries = await solveUpdates({
    registry,
    variables: [variable("eslint"), variable("js", { current: "10.0.1" })],
    scopes: [{ path: ".", dependencies: { eslint: "eslint", js: "js" } }],
  })
  assert.equal(required(entries.find((entry) => entry.name === "js")).version, "10.0.1")
})

test("peer providers are checked per workspace, not by a global package-name match", async () => {
  const registry = registryFixture({
    typescript: releases({ "6.0.0": {}, "5.9.0": {} }),
    checker: releases({ "1.0.0": { peerDependencies: { typescript: "^5" } } }),
  })
  const entries = await solveUpdates({
    registry,
    variables: [
      variable("typescript", { id: "next-ts", required: [{ range: "^5", from: "Next" }] }),
      variable("typescript", { id: "vite-ts" }),
      variable("checker"),
    ],
    scopes: [
      { path: "apps/web", dependencies: { typescript: "next-ts", checker: "checker" } },
      { path: "apps/admin", dependencies: { typescript: "vite-ts" } },
    ],
  })
  assert.equal(required(entries.find((entry) => entry.id === "next-ts")).version, "5.9.0")
  assert.equal(required(entries.find((entry) => entry.id === "vite-ts")).version, "6.0.0")
})

test("React and React DOM align even when their loose peer range would permit a mismatch", async () => {
  const registry = registryFixture({
    react: releases({ "19.3.1": {}, "19.3.0": {} }),
    "react-dom": releases({ "19.3.0": { peerDependencies: { react: "^19" } } }),
  })
  const entries = await solveUpdates({
    registry,
    variables: [variable("react"), variable("react-dom")],
    scopes: [{ path: ".", dependencies: { react: "react", "react-dom": "react-dom" } }],
  })
  assert.equal(entries[0].version, "19.3.0")
  assert.equal(entries[1].version, "19.3.0")
  assert(entries[0].reasons!.some((reason) => reason.includes("runtime versions must match")))
})

async function fixture(t: import("node:test").TestContext) {
  const root = await mkdtemp(join(tmpdir(), "browser-client-updates-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "apps"))
  await mkdir(join(root, "packages/ui"), { recursive: true })
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "root", scripts: { custom: "preserved" }, devDependencies: { tool: "^1" } }),
  )
  await writeFile(
    join(root, "packages/ui/package.json"),
    JSON.stringify({
      name: "ui",
      exports: { "./*": "./src/*" },
      dependencies: { helper: "^1" },
      peerDependencies: { react: "^19" },
    }),
  )
  await writeFile(join(root, "packages/ui/component.tsx"), "// custom shared shadcn component\n")
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "# keep policy comment\ncatalog:\n  react: ^19.0.0\nallowBuilds:\n  esbuild: true\n",
  )
  await writeFile(join(root, "pnpm-lock.yaml"), "importers: {}\n")
  return root
}

test("the current workspace replays its font, shared icons and managed Admin router offline without registry access", async (t) => {
  const root = await fixture(t)
  const source = fileURLToPath(new URL("../../", import.meta.url))
  for (const path of ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"])
    await writeFile(join(root, path), await readFile(join(source, path)))
  for (const parent of ["apps", "packages"]) {
    for (const entry of await readdir(join(source, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(parent, entry.name)
      await mkdir(join(root, path), { recursive: true })
      await writeFile(join(root, path, "package.json"), await readFile(join(source, path, "package.json")))
    }
  }
  const applications = await readApplications(source)
  const saved = JSON.parse(await readFile(join(source, "template-versions.json"), "utf8")).dependencies
  const receipt = await updateDependencies({
    root,
    applications,
    templates: {},
    previous: {},
    saved,
    offline: true,
    registry: offlineRegistry,
  })
  await verifyResolvedUpdates(root, receipt)
  const font = required(receipt.entries.find((entry) => entry.id === "packages/ui:dependencies:@fontsource-variable/inter"))
  assert(font, "The shared font needs an offline dependency receipt")
  const ui = JSON.parse(await readFile(join(root, "packages/ui/package.json"), "utf8"))
  assert.equal(ui.dependencies["@fontsource-variable/inter"], font.version)
  assert.equal(
    parse(await readFile(join(root, "pnpm-lock.yaml"), "utf8")).importers["packages/ui"].dependencies[
      "@fontsource-variable/inter"
    ].version,
    font.version,
  )
  const icons = required(receipt.entries.find((entry) => entry.id === "catalog:default:lucide-react"))
  assert(icons, "Shared icons need a catalog dependency receipt")
  assert.equal(ui.dependencies["lucide-react"], "catalog:")
  for (const app of applications.filter((entry) => entry.type === "admin")) {
    const router = required(receipt.entries.find((entry) => entry.id === `${app.path}:dependencies:react-router`))
    const admin = JSON.parse(await readFile(join(root, app.path, "package.json"), "utf8"))
    assert.equal(admin.dependencies["lucide-react"], "catalog:")
    assert.equal(admin.dependencies["react-router"], router.version)
  }
  assert.equal(
    receipt.entries.some((entry) => entry.id === "packages/ui:dependencies:lucide-react"),
    false,
  )
})

test("managed dependency policies follow registered types while unmanaged explicit dependencies remain locked", async (t) => {
  for (const registered of [false, true])
    await t.test(registered ? "custom Admin instance" : "unmanaged apps/admin", async (t) => {
      const root = await fixture(t)
      const id = registered ? "console" : "admin",
        path = `apps/${id}`
      const original = {
        name: `external-${id}`,
        dependencies: { react: registered ? "catalog:" : "^18.0.0", "react-router": registered ? "8.4.0" : "^7.0.0" },
      }
      await mkdir(join(root, path))
      await writeFile(join(root, path, "package.json"), JSON.stringify(original))
      await writeFile(
        join(root, "pnpm-lock.yaml"),
        `catalogs:\n  default:\n    react:\n      version: 19.3.0\nimporters:\n  ${path}:\n    dependencies:\n      react:\n        version: ${registered ? "19.3.0" : "18.3.1"}\n      react-router:\n        version: ${registered ? "8.4.0" : "7.2.0"}\n`,
      )
      const registry = registryFixture({
        react: releases({ "19.3.0": {}, "18.3.1": {} }),
        tool: releases({ "2.0.0": {} }),
        helper: releases({ "2.1.0": {} }),
        "react-router": releases({
          "8.4.1": { peerDependencies: { react: "^19" } },
          "7.2.0": { peerDependencies: { react: "^18" } },
        }),
      })
      const applications = registered
        ? [
            application(
              id,
              { type: "admin", port: 5210 },
              { type: "admin", legacy: false, instanceId: "test-console", integrationVersion: 1 },
            ),
          ]
        : []
      const receipt = await updateDependencies({ root, templates: {}, previous: {}, registry, applications })
      const actual = JSON.parse(await readFile(join(root, path, "package.json"), "utf8"))
      if (registered) {
        assert.equal(actual.dependencies["react-router"], "8.4.1")
        assert.equal(actual.dependencies.react, "catalog:")
      } else {
        assert.deepEqual(actual, original)
        assert(!receipt.entries.some((entry) => entry.location?.path === path))
      }
      await updateDependencies({
        root,
        templates: {},
        previous: {},
        offline: true,
        saved: receipt,
        registry: offlineRegistry,
        applications,
      })
      assert.deepEqual(JSON.parse(await readFile(join(root, path, "package.json"), "utf8")), actual)
    })
})

test("shared source and manifest contracts survive upgrades; offline replay never queries registry", async (t) => {
  const root = await fixture(t)
  const registry = registryFixture({
    react: releases({ "19.3.0": {} }),
    tool: releases({ "2.0.0": {} }),
    helper: releases({ "2.1.0": {} }),
  })
  const before = await readFile(join(root, "packages/ui/component.tsx"), "utf8")
  const receipt = await updateDependencies({ root, templates: {}, previous: {}, registry })
  assert.equal(parse(await readFile(join(root, "pnpm-workspace.yaml"), "utf8")).catalog.react, "19.3.0")
  assert((await readFile(join(root, "pnpm-workspace.yaml"), "utf8")).includes("# keep policy comment"))
  assert.equal(JSON.parse(await readFile(join(root, "package.json"), "utf8")).scripts.custom, "preserved")
  const ui = JSON.parse(await readFile(join(root, "packages/ui/package.json"), "utf8"))
  assert.deepEqual(ui.exports, { "./*": "./src/*" })
  assert.deepEqual(ui.peerDependencies, { react: "^19" })
  assert.equal(ui.dependencies.helper, "2.1.0")
  assert.equal(await readFile(join(root, "packages/ui/component.tsx"), "utf8"), before)
  const replay = await updateDependencies({
    root,
    templates: {},
    previous: {},
    offline: true,
    saved: receipt,
    registry: offlineRegistry,
  })
  assert.deepEqual(
    replay.entries.map(({ id, version }) => [id, version]),
    receipt.entries.map(({ id, version }) => [id, version]),
  )
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    "catalogs:\n  default:\n    react:\n      version: 19.3.0\nimporters:\n  .:\n    devDependencies:\n      tool:\n        version: 2.0.0\n  packages/ui:\n    dependencies:\n      helper:\n        version: 2.0.0\n",
  )
  await assert.rejects(verifyResolvedUpdates(root, receipt), /installed version differs from the update plan/)
})

test("managed Admin dependencies upgrade compatibly on full and partial rebuilds; business dependencies stay locked", async (t) => {
  for (const rebuildAdmin of [true, false]) {
    await t.test(rebuildAdmin ? "Admin rebuild" : "another target rebuild", async (t) => {
      const root = await fixture(t)
      await writeFile(
        join(root, "pnpm-workspace.yaml"),
        "catalog:\n  react: 19.3.0\n  lucide-react: 1.57.0\n  tailwindcss: 4.3.3\n  '@tailwindcss/vite': 4.3.3\n",
      )
      const admin = {
        dependencies: {
          react: "catalog:",
          "lucide-react": "catalog:",
          "react-router": "8.4.0",
          business: "^1",
          constructor: "^1",
        },
      }
      await mkdir(join(root, "apps/admin"))
      await writeFile(join(root, "apps/admin/package.json"), JSON.stringify(admin))
      await writeFile(
        join(root, "packages/ui/package.json"),
        JSON.stringify({ name: "ui", dependencies: { "lucide-react": "catalog:" }, peerDependencies: { react: "^19" } }),
      )
      await writeFile(
        join(root, "pnpm-lock.yaml"),
        "catalogs:\n  default:\n    react:\n      version: 19.3.0\n    lucide-react:\n      version: 1.57.0\nimporters:\n  apps/admin:\n    dependencies:\n      react-router:\n        version: 8.4.0\n      business:\n        version: 1.2.0\n      constructor:\n        version: 1.2.0\n",
      )
      const registry = registryFixture({
        react: releases({ "19.3.0": {} }),
        tool: releases({ "2.0.0": {} }),
        tailwindcss: releases({ "4.3.3": {} }),
        "@tailwindcss/vite": releases({ "4.3.3": {} }),
        "lucide-react": releases({ "2.0.0": { peerDependencies: { react: "^20" } }, "1.58.0": {} }),
        "react-router": releases({
          "9.0.0": {},
          "8.5.0": { peerDependencies: { react: "^20" } },
          "8.4.1": { peerDependencies: { react: "^19" } },
          "8.4.0": {},
        }),
        business: releases({ "2.0.0": {}, "1.2.0": {} }),
        constructor: releases({ "2.0.0": {}, "1.2.0": {} }),
      })
      const args = {
        root,
        templates: rebuildAdmin ? { admin: { dependencies: { react: "^19" } } } : {},
        previous: { admin },
      }
      const receipt = await updateDependencies({ ...args, registry })
      const router = required(receipt.entries.find((entry) => entry.id === "apps/admin:dependencies:react-router"))
      assert.equal(router?.version, "8.4.1")
      assert(router.reasons!.length, "An incompatible latest release must have a recorded explanation")
      assert.equal(receipt.entries.find((entry) => entry.id === "catalog:default:lucide-react")?.version, "1.58.0")
      const actual = JSON.parse(await readFile(join(root, "apps/admin/package.json"), "utf8"))
      assert.equal(actual.dependencies["react-router"], "8.4.1")
      assert.equal(actual.dependencies["lucide-react"], "catalog:")
      assert.equal(actual.dependencies.business, "^1")
      assert.equal(actual.dependencies.constructor, "^1")
      assert.equal(
        receipt.entries.some((entry) => entry.name === "constructor"),
        false,
      )
      assert.equal(
        receipt.entries.some((entry) => entry.name === "business"),
        false,
      )
      const replay = await updateDependencies({
        ...args,
        previous: { admin: actual },
        offline: true,
        saved: receipt,
        registry: offlineRegistry,
      })
      assert.equal(replay.entries.find((entry) => entry.id === router.id)?.version, "8.4.1")
      const before = await fingerprint(root)
      const invalid = structuredClone(receipt)
      required(invalid.entries.find((entry) => entry.id === router.id)).version = "9.0.0"
      await assert.rejects(
        updateDependencies({ ...args, offline: true, saved: invalid }),
        /project integration.*react-router.*\^8/,
      )
      assert.equal(await fingerprint(root), before, "An incompatible offline router must leave the project untouched")
      const missing = structuredClone(receipt)
      missing.entries = missing.entries.filter((entry) => entry.id !== router.id)
      await assert.rejects(
        updateDependencies({ ...args, offline: true, saved: missing }),
        /Offline receipt is missing apps\/admin:dependencies:react-router/,
      )
      const incompatible = {
        ...registry,
        latest: (name: string) => (name === "react-router" ? Promise.resolve({ version: "9.0.0" }) : registry.latest(name)),
        versions: (name: string) => (name === "react-router" ? Promise.resolve(["9.0.0"]) : registry.versions(name)),
      }
      await assert.rejects(
        updateDependencies({ ...args, registry: incompatible }),
        /No stable compatible dependency combination/,
      )
      assert.equal(await fingerprint(root), before, "Missing receipts and online incompatibility must not write project files")
    })
  }
})

test("rollback restores root manifest and catalogs alongside source, receipt and lockfile", async (t) => {
  const root = await fixture(t),
    stage = join(root, ".reinit/stage"),
    backup = join(root, ".reinit/backup")
  await mkdir(stage, { recursive: true })
  const paths = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"]
  const original = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")))
  for (const path of paths) await writeFile(join(stage, path), "candidate")
  await assert.rejects(
    promote({
      root,
      stage,
      backup,
      paths,
      validate: async () => {
        throw new Error("strict peers failed")
      },
    }),
    /strict peers failed/,
  )
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), "utf8"))), original)
  for (const path of paths) assert.equal(await readFile(join(backup, "failed-replacement", path), "utf8"), "candidate")
})

test("registry failure leaves manifests, catalogs and shared sources untouched", async (t) => {
  const root = await fixture(t)
  const paths = ["package.json", "pnpm-workspace.yaml", "packages/ui/package.json", "packages/ui/component.tsx"]
  const before = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")))
  await assert.rejects(
    updateDependencies({
      root,
      templates: {},
      previous: {},
      registry: {
        read: async () => assert.fail("Unexpected registry read"),
        versions: async () => assert.fail("Unexpected registry fallback"),
        latest: async () => {
          throw new Error("registry unavailable")
        },
      },
    }),
    /registry unavailable/,
  )
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(join(root, path), "utf8"))), before)
})

test("legacy offline records remain replayable without pretending to resolve latest", async (t) => {
  const root = await fixture(t)
  const args = { root, templates: {}, previous: {}, offline: true, registry: offlineRegistry }
  const first = await updateDependencies(args)
  assert.equal(first.policy, "legacy-offline")
  const second = await updateDependencies({ ...args, saved: first })
  assert.deepEqual(second.entries, [])
  assert.equal(parse(await readFile(join(root, "pnpm-workspace.yaml"), "utf8")).catalog.react, "^19.0.0")
})

test("partial reinit retains the compiler constraints of applications it does not rebuild", async (t) => {
  const root = await fixture(t)
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "catalog:\n  react: ^19\ncatalogs:\n  next:\n    typescript: ^5\n  vite:\n    typescript: ~6.0.0\n",
  )
  const registry = registryFixture({
    react: releases({ "19.3.0": {} }),
    tool: releases({ "2.0.0": {} }),
    helper: releases({ "2.0.0": {} }),
    typescript: releases({ "7.0.0": {}, "6.0.3": {}, "5.9.3": {} }),
  })
  const receipt = await updateDependencies({ root, templates: {}, previous: {}, registry })
  assert.equal(required(receipt.entries.find((entry) => entry.id === "catalog:next:typescript")).version, "5.9.3")
  assert.equal(required(receipt.entries.find((entry) => entry.id === "catalog:vite:typescript")).version, "6.0.3")
  for (const entry of receipt.entries.filter((entry) => entry.name === "typescript"))
    assert(entry.reasons!.some((reason) => reason.includes("Unrebuilt")))
})

test("reinit selects ESLint by runtime config peers while retaining template compiler constraints", async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, "pnpm-workspace.yaml"), "catalog:\n  react: ^19\n  eslint: ^9\n  '@eslint/js': ^9\n")
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "root", devDependencies: { eslint: "catalog:" } }))
  await mkdir(join(root, "packages/eslint-config"), { recursive: true })
  await writeFile(
    join(root, "packages/eslint-config/package.json"),
    JSON.stringify({
      name: "shared-lint",
      dependencies: { "@eslint/js": "catalog:" },
      peerDependencies: { eslint: "^10" },
      devDependencies: { eslint: "catalog:" },
    }),
  )
  const template = {
    dependencies: { next: "16.4.1", react: "^19" },
    devDependencies: { "eslint-config-next": "16.4.1", eslint: "^9", typescript: "^5" },
  }
  await mkdir(join(root, "apps/web"), { recursive: true })
  await writeFile(join(root, "apps/web/package.json"), JSON.stringify(template))
  const packages = {
    react: releases({ "19.3.0": {} }),
    helper: releases({ "2.0.0": {} }),
    next: releases({ "16.4.1": {} }),
    "eslint-config-next": releases({ "16.4.1": { peerDependencies: { eslint: ">=9" } } }),
    eslint: releases({ "10.12.0": {}, "9.39.5": {} }),
    "@eslint/js": releases({
      "10.0.1": { peerDependencies: { eslint: "^10" } },
      "9.39.5": { peerDependencies: { eslint: "^9" } },
    }),
    typescript: releases({ "7.0.2": {}, "5.9.3": {} }),
  }
  const args = { root, templates: { web: template }, previous: { web: template } }
  const receipt = await updateDependencies({ ...args, registry: registryFixture(packages) })
  assert.equal(required(receipt.entries.find((entry) => entry.name === "eslint")).version, "10.12.0")
  assert.equal(required(receipt.entries.find((entry) => entry.name === "@eslint/js")).version, "10.0.1")
  assert.equal(required(receipt.entries.find((entry) => entry.name === "typescript")).version, "5.9.3")
  required(receipt.entries.find((entry) => entry.name === "eslint")).required = []
  const replay = await updateDependencies({
    ...args,
    offline: true,
    saved: receipt,
    registry: offlineRegistry,
  })
  assert.deepEqual(
    replay.entries.map(({ id, version }) => [id, version]),
    receipt.entries.map(({ id, version }) => [id, version]),
  )
  assert(required(replay.entries.find((entry) => entry.name === "eslint")).required!.some(({ range }) => range === ">=10.0.0"))
  // Removing a starter constraint must not bypass an actual config peer limit.
  packages["eslint-config-next"].releases["16.4.1"].peerDependencies!.eslint = "^9"
  const before = await fingerprint(root)
  await assert.rejects(
    updateDependencies({ ...args, registry: registryFixture(packages) }),
    /eslint-config-next@16\.4\.1 requires eslint \^9/,
  )
  assert.equal(await fingerprint(root), before, "Incompatibility must not downgrade or modify the original project")
})

test("ESLint's minimum overrides legacy peers, existing releases and fixed versions", async (t) => {
  for (const extra of [{}, { current: "9.39.5" }, { fixed: "9.39.5" }]) {
    await t.test(JSON.stringify(extra), async () => {
      // Deliberately omit deprecated metadata and keep a loose peer: the floor
      // must be a project invariant rather than a registry metadata accident.
      const registry = registryFixture({ eslint: releases({ "9.39.5": {}, "9.0.0": {} }) })
      await assert.rejects(
        solveUpdates({
          registry,
          variables: [variable("eslint", extra)],
          scopes: [{ path: ".", dependencies: { eslint: "eslint" }, peers: { eslint: ">=9" } }],
        }),
        /minimum version.*eslint.*>=10\.0\.0/,
      )
    })
  }
})

test("offline ESLint 9 receipts and legacy locks are rejected before any project writes", async (t) => {
  for (const mode of ["receipt", "missing-receipt", "legacy-receipt", "fixed-app", "missing-version"]) {
    await t.test(mode, async (t) => {
      const root = await fixture(t)
      await writeFile(join(root, "package.json"), JSON.stringify({ name: "root", devDependencies: { eslint: "catalog:" } }))
      await writeFile(join(root, "pnpm-workspace.yaml"), "catalog:\n  react: ^19\n  eslint: 9.39.5\n")
      await writeFile(
        join(root, "pnpm-lock.yaml"),
        "catalogs:\n  default:\n    eslint:\n      version: 9.39.5\nimporters: {}\n",
      )
      const registry = registryFixture({
        react: releases({ "19.3.0": {} }),
        helper: releases({ "2.0.0": {} }),
        eslint: releases({ "10.12.0": {} }),
      })
      const receipt = await updateDependencies({ root, templates: {}, previous: {}, registry })
      const entry = required(receipt.entries.find((entry) => entry.name === "eslint"))
      // Simulate a pre-policy record that does not contain the new floor.
      entry.version = "9.39.5"
      entry.required = []
      let saved: DependencyReceipt | undefined = receipt
      if (mode !== "receipt") {
        saved = mode === "missing-receipt" || mode === "fixed-app" ? undefined : { policy: "legacy-offline", entries: [] }
      }
      if (mode === "fixed-app") {
        await writeFile(join(root, "pnpm-workspace.yaml"), "catalog:\n  react: ^19\n")
        await writeFile(join(root, "package.json"), JSON.stringify({ name: "root" }))
        await mkdir(join(root, "apps/web"), { recursive: true })
        await writeFile(join(root, "apps/web/package.json"), JSON.stringify({ devDependencies: { eslint: "^9" } }))
        await writeFile(
          join(root, "pnpm-lock.yaml"),
          "importers:\n  apps/web:\n    devDependencies:\n      eslint:\n        version: 9.39.5\n",
        )
      }
      if (mode === "missing-version") await writeFile(join(root, "pnpm-lock.yaml"), "importers: {}\n")
      const before = await fingerprint(root)
      await assert.rejects(
        updateDependencies({
          root,
          templates: {},
          previous: {},
          offline: true,
          saved,
          registry: offlineRegistry,
        }),
        /minimum version.*eslint.*>=10\.0\.0/,
      )
      assert.equal(await fingerprint(root), before, "Failure must not modify manifests, source, the lockfile or shared UI")
    })
  }
})

test("legacy offline ESLint 10 locks remain replayable without registry access", async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "root", devDependencies: { eslint: "catalog:" } }))
  await writeFile(join(root, "pnpm-workspace.yaml"), "catalog:\n  react: ^19\n  eslint: 10.12.0\n")
  await writeFile(join(root, "pnpm-lock.yaml"), "catalogs:\n  default:\n    eslint:\n      version: 10.12.0\nimporters: {}\n")
  const receipt = await updateDependencies({
    root,
    templates: {},
    previous: {},
    offline: true,
    registry: offlineRegistry,
  })
  assert.equal(receipt.policy, "legacy-offline")
  assert.equal(parse(await readFile(join(root, "pnpm-workspace.yaml"), "utf8")).catalog.eslint, "10.12.0")
  assert.equal(await readFile(join(root, "packages/ui/component.tsx"), "utf8"), "// custom shared shadcn component\n")
})

test("resolved ESLint 9 is rejected even without dependency receipts", async (t) => {
  const cases = {
    catalog: "catalogs:\n  default:\n    eslint:\n      version: 9.39.5\n",
    importer: "importers:\n  apps/web:\n    devDependencies:\n      eslint:\n        version: 9.39.5(jiti@2.7.0)\n",
    transitive: "packages:\n  eslint@9.39.5: {}\n",
  }
  for (const [name, lock] of Object.entries(cases)) {
    await t.test(name, async (t) => {
      const root = await fixture(t)
      await writeFile(join(root, "pnpm-lock.yaml"), lock)
      const before = await fingerprint(root)
      await assert.rejects(verifyResolvedUpdates(root, { entries: [] }), /minimum version.*eslint.*>=10\.0\.0/)
      assert.equal(await fingerprint(root), before)
    })
  }
})
