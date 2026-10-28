import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, realpath, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseAppsConfig, readApplications, selectApplications, type AppsConfig } from "../lib/apps.mts"
import { verifyBrowserCoverage } from "../lib/browser-suite.mts"
import { assertRemovable, runMaintenance } from "../lib/maintenance.mts"
import { planCleanup } from "../clean-reinit.mts"
import { createCommandRunner } from "../lib/commands.mts"
import { exists, fingerprint } from "../lib/workspace.mts"

const config = (apps: AppsConfig["apps"]) => ({ schemaVersion: 1, apps })
async function fixture(
  t: import("node:test").TestContext,
  apps: AppsConfig["apps"] = { admin: { type: "admin", port: 5173 } },
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "browser-client-apps-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "apps"))
  await mkdir(join(root, "packages"))
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-root" }))
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n")
  await writeFile(join(root, "apps.config.json"), JSON.stringify(config(apps)))
  const applications: Record<string, unknown> = {}
  for (const [id, definition] of Object.entries(apps)) {
    const identity = { instanceId: `fixture-${id}`, type: definition.type, legacy: false, integrationVersion: 1 }
    applications[id] = identity
    await mkdir(join(root, "apps", id))
    await writeFile(join(root, "apps", id, "package.json"), JSON.stringify({ name: `@browser-client/${id}` }))
    await writeFile(join(root, "apps", id, "app-identity.json"), JSON.stringify(identity))
  }
  await writeFile(join(root, "template-versions.json"), JSON.stringify({ schemaVersion: 2, applications }))
  return root
}

test("application combinations include single clients, multiple instances and an explicit empty workspace", async (t) => {
  for (const apps of [
    {},
    { admin: { type: "admin", port: 5173 } },
    { site: { type: "web", port: 3000 } },
    { addon: { type: "extension", port: 5174 } },
    {
      website: { type: "web", port: 3000 },
      portal: { type: "web", port: 3001 },
      admin: { type: "admin", port: 5173 },
      operations: { type: "admin", port: 5175 },
      addon: { type: "extension", port: 5174 },
    },
  ] as AppsConfig["apps"][]) {
    const root = await fixture(t, apps)
    const found = await readApplications(root)
    assert.deepEqual(
      found.map((app) => app.id),
      Object.keys(apps),
    )
    for (const app of found) assert.equal(app.type, apps[app.id].type)
    assert.throws(() => selectApplications(found, "unknown"), /Unknown application/)
  }
})

test("Git exports retain workspace boundaries for an explicit empty application registry", async (t) => {
  const root = await fixture(t, {})
  const source = fileURLToPath(new URL("../../", import.meta.url))
  await writeFile(join(root, "apps/.gitkeep"), await readFile(join(source, "apps/.gitkeep")))
  await writeFile(join(root, "packages/.gitkeep"), "")
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
      encoding: "utf8",
      env,
    }).trim()
  git("init", "--quiet")
  git("add", "--all")
  const tree = git("write-tree")
  const archive = join(root, "source.tar")
  git("archive", "--output", archive, tree)
  const exported = join(root, "exported")
  await mkdir(exported)
  execFileSync("tar", ["-xf", archive, "-C", exported])
  assert.deepEqual(await readApplications(exported), [])
})

test("reinit keeps the registry bytes intact before generation", async (t) => {
  const root = await fixture(t)
  const before = await readFile(join(root, "apps.config.json"), "utf8")
  const baseline = await fingerprint(root)
  let observed = false
  await assert.rejects(
    runMaintenance(root, { kind: "reinit", ids: ["admin"] }, true, {
      boundary: async (name) => {
        if (name !== "candidate-configured") return
        const [id] = await readdir(join(root, ".reinit/staging"))
        assert.equal(await readFile(join(root, ".reinit/staging", id, "apps.config.json"), "utf8"), before)
        observed = true
        throw new Error("fixture stopped before generation")
      },
    }),
    /fixture stopped before generation/,
  )
  assert(observed)
  assert.equal(await fingerprint(root), baseline)
})

test("invalid maintenance timeout settings never acquire a lock and corrected settings can retry", async (t) => {
  const root = await fixture(t)
  const before = await fingerprint(root)
  const keys = ["REINIT_COMMAND_TIMEOUT_MS", "REINIT_BROWSER_TIMEOUT_MS"] as const
  const previous = keys.map((key) => process.env[key])
  try {
    for (const key of keys) delete process.env[key]
    for (const key of keys) {
      for (const value of ["invalid", "0", "2147483648"]) {
        process.env[key] = value
        await assert.rejects(runMaintenance(root, { kind: "reinit", ids: ["admin"] }, true), /positive integer/)
        assert.equal(await exists(join(root, ".reinit/lock")), false, `${key}=${value} left a lock`)
        assert.equal(await fingerprint(root), before)
        delete process.env[key]
      }
    }
    let reachedCandidate = false
    await assert.rejects(
      runMaintenance(root, { kind: "reinit", ids: ["admin"] }, true, {
        boundary(name) {
          if (name === "candidate-configured") {
            reachedCandidate = true
            throw new Error("fixture stopped before generation")
          }
        },
      }),
      /fixture stopped before generation/,
    )
    assert(reachedCandidate, "Correcting the settings did not unblock maintenance")
    assert.equal(await exists(join(root, ".reinit/lock")), false)
    assert.equal(await fingerprint(root), before)
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]
      else process.env[key] = previous[index]
    })
  }
})

test("an occupied maintenance lock preserves its owner and does not leak cancellation listeners", async (t) => {
  const root = await fixture(t)
  const lock = join(root, ".reinit/lock")
  await mkdir(lock, { recursive: true })
  const owner = JSON.stringify({ id: "existing-operation", pid: process.pid })
  await writeFile(join(lock, "owner.json"), owner)
  const signals = ["SIGINT", "SIGTERM"] as const
  const listeners = signals.map((signal) => process.listenerCount(signal))
  await assert.rejects(runMaintenance(root, { kind: "reinit", ids: ["admin"] }, true), /Maintenance lock exists/)
  assert.equal(await readFile(join(lock, "owner.json"), "utf8"), owner)
  assert.deepEqual(
    signals.map((signal) => process.listenerCount(signal)),
    listeners,
  )
})

test("registry rejects ambiguous JSON, unknown fields, reserved names, path traversal and port conflicts", () => {
  for (const source of [
    '{"schemaVersion":1,"apps":{},"apps":{}}',
    '{"schemaVersion":1,"apps":{"admin":{"type":"admin","type":"web","port":5173}}}',
    JSON.stringify({ ...config({}), schemaVersion: 2 }),
    JSON.stringify({ ...config({}), enabled: true }),
    JSON.stringify(config({ "../outside": { type: "web", port: 3000 } })),
    JSON.stringify(config({ all: { type: "web", port: 3000 } })),
    JSON.stringify(config({ con: { type: "web", port: 3000 } })),
    JSON.stringify(config({ web: { type: "web", port: 3000 }, admin: { type: "admin", port: 3000 } })),
    '{"schemaVersion":1,"apps":{"admin":{"type":"unknown","port":5173}}}',
    '{"schemaVersion":1,"apps":{"admin":{"type":"admin","port":"5173"}}}',
    '{"schemaVersion":1,"apps":{"admin":{"type":"admin","port":0}}}',
    '{"schemaVersion":1,"apps":{"admin":{"type":"admin","port":5173,"enabled":false}}}',
  ])
    assert.throws(() => parseAppsConfig(source), source)
})

test("configuration omissions, type changes, missing identities and package-name drift fail closed", async (t) => {
  for (const change of ["omitted", "type", "identity", "package", "missing"]) {
    const root = await fixture(t)
    if (change === "omitted") await writeFile(join(root, "apps.config.json"), JSON.stringify(config({})))
    if (change === "type")
      await writeFile(join(root, "apps.config.json"), JSON.stringify(config({ admin: { type: "web", port: 5173 } })))
    if (change === "identity") await writeFile(join(root, "apps/admin/app-identity.json"), "{}")
    if (change === "package") await writeFile(join(root, "apps/admin/package.json"), '{"name":"different"}')
    if (change === "missing") await rm(join(root, "apps/admin"), { recursive: true })
    const before = await fingerprint(root)
    await assert.rejects(readApplications(root))
    assert.equal(await fingerprint(root), before)
  }
})

test("external workspaces remain present, while reverse references prevent application removal", async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, "apps/custom"))
  const file = join(root, "apps/custom/package.json")
  await writeFile(file, JSON.stringify({ name: "external", dependencies: { alias: "workspace:@browser-client/admin@*" } }))
  const apps = await readApplications(root)
  assert.equal(apps.length, 1)
  await assert.rejects(assertRemovable(root, apps[0]), /still referenced/)
  assert.equal(JSON.parse(await readFile(file, "utf8")).name, "external")
})

test("source configuration symlinks and duplicate workspace package names are rejected", async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, "packages/duplicate"))
  await writeFile(join(root, "packages/duplicate/package.json"), '{"name":"@browser-client/admin"}')
  await assert.rejects(readApplications(root), /duplicate workspace name/)
  await rm(join(root, "packages/duplicate"), { recursive: true })
  await rm(join(root, "apps/admin/app-identity.json"))
  await symlink(join(root, "template-versions.json"), join(root, "apps/admin/app-identity.json"))
  await assert.rejects(readApplications(root), /regular file/)
})

test("relative, absolute and URL local dependencies prevent removing a referenced application", async (t) => {
  const root = await fixture(t)
  const app = (await readApplications(root))[0]
  const path = join(root, "package.json")
  for (const specifier of [
    "file:apps/admin",
    "link:apps/admin",
    `file:${join(root, app.path)}`,
    `link:${join(root, app.path)}`,
    pathToFileURL(join(root, app.path)).href,
    "workspace:./apps/admin",
  ]) {
    await writeFile(path, JSON.stringify({ name: "fixture-root", dependencies: { alias: specifier } }))
    await assert.rejects(assertRemovable(root, app), /still referenced/, specifier)
  }
})

test("maintenance refuses symlinked state directories before generating or changing external files", async (t) => {
  for (const name of ["staging", "backups", "reports", "archives"]) {
    const root = await fixture(t)
    const external = join(root, "external")
    await mkdir(external)
    await writeFile(join(external, "keep.txt"), "private source")
    await mkdir(join(root, ".reinit"))
    await symlink(external, join(root, ".reinit", name))
    const before = await fingerprint(external)
    await assert.rejects(runMaintenance(root, { kind: "reinit", ids: ["admin"] }, true), /real directory/)
    assert.equal(await fingerprint(external), before)
    await assert.rejects(readFile(join(root, ".reinit/lock/owner.json")), /ENOENT/)
  }
})

test("browser coverage cannot pass with missing, duplicate, skipped, unknown or stale instance reports", () => {
  const good = {
    appId: "admin",
    status: "passed",
    sourceFingerprint: "baseline",
    accessibility: { status: "passed" as const, engine: "4.14.0", scans: 4, violations: 0 as const },
  }
  assert.doesNotThrow(() => verifyBrowserCoverage([], [], "baseline"))
  assert.doesNotThrow(() => verifyBrowserCoverage(["admin"], [good], "baseline"))
  for (const reports of [
    [],
    [good, good],
    [{ ...good, appId: "other" }],
    [{ ...good, status: "skipped" }],
    [{ ...good, sourceFingerprint: "old" }],
    [{ ...good, accessibility: undefined }],
    [{ ...good, accessibility: { ...good.accessibility, scans: 0 } }],
  ])
    assert.throws(() => verifyBrowserCoverage(["admin"], reports, "baseline"))
})

test("application archives are never candidates for normal reinit cleanup", async (t) => {
  const root = await fixture(t)
  const archive = join(root, ".reinit/archives/old/app")
  await mkdir(archive, { recursive: true })
  await writeFile(join(archive, "business.ts"), "preserve this application")
  const plan = await planCleanup(root, { keep: 1, days: 0 })
  assert(!plan.candidates.some((candidate) => candidate.path.includes("archives")))
  assert.equal(await readFile(join(archive, "business.ts"), "utf8"), "preserve this application")
})

test("real maintenance previews and invalid selectors do not alter project source", async (t) => {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  const runner = createCommandRunner({ cwd: root, timeoutMs: 30_000 })
  t.after(() => runner.close())
  const before = await fingerprint(root)
  const apps = await readApplications(root)
  let port = 60000
  while (apps.some((app) => app.port === port)) port--
  const previewId = `preview-${randomUUID().slice(0, 8)}`
  await runner.run(process.execPath, ["scripts/app.mts", "add", previewId, "--type", "web", "--port", String(port)])
  for (const args of [
    ["remove", "all"],
    ["dev", "all"],
    ["add", "portal", "--type=web=admin", "--port=3001"],
  ])
    await assert.rejects(runner.run(process.execPath, ["scripts/app.mts", ...args]))
  assert.equal(await fingerprint(root), before)
})

test("maintenance rejects edits between planning and lock acquisition without overwriting them", async (t) => {
  const root = await fixture(t)
  await assert.rejects(
    runMaintenance(root, { kind: "reinit", ids: ["admin"] }, true, {
      boundary: async (name) => {
        if (name === "planned") await writeFile(join(root, "apps/admin/user.txt"), "concurrent edit")
      },
    }),
    /Workspace changed while planning/,
  )
  assert.equal(await readFile(join(root, "apps/admin/user.txt"), "utf8"), "concurrent edit")
  await assert.rejects(readFile(join(root, ".reinit/lock/owner.json")), /ENOENT/)
})

test("planning cannot commit a transient registry version even when its bytes are restored before locking", async (t) => {
  const root = await fixture(t)
  const path = join(root, "apps.config.json")
  const original = await readFile(path, "utf8")
  const before = await fingerprint(root)
  await assert.rejects(
    runMaintenance(root, { kind: "reinit", ids: ["admin"] }, true, {
      boundary: async (name) => {
        if (name === "baseline-read") await writeFile(path, JSON.stringify(config({ admin: { type: "admin", port: 5199 } })))
        if (name === "planned") await writeFile(path, original)
      },
    }),
    /inputs changed|configuration changed/,
  )
  assert.equal(await fingerprint(root), before)
  await assert.rejects(readFile(join(root, ".reinit/lock/owner.json")), /ENOENT/)
})
