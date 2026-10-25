import type { PackageManifest, TemplateVersions, DependencyReceipt } from "./contracts.mts"
import { toError } from "./contracts.mts"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, readdir, lstat, rm, readFile, writeFile, chmod } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import {
  readApplications,
  readAppsConfig,
  readVersions,
  application,
  identityOf,
  assertAppId,
  integrationVersion,
  type Application,
  type AppDefinition,
} from "./apps.mts"
import { readJson, writeJson, integrate } from "./integrate.mts"
import {
  copySource,
  exists,
  fingerprint,
  ignored,
  preserveApp,
  promote,
  writeAtomicJson,
  ensureRealDirectory,
} from "./workspace.mts"
import { createCommandRunner, handleCancellation } from "./commands.mts"
import { createRegistry, updateDependencies, verifyResolvedUpdates } from "./updates.mts"
import { validateBeforePromotion } from "./reinit-validation.mts"
import { createMaintenanceReport } from "./maintenance-report.mts"
import { reinitTimeouts, timeoutForCommand } from "./reinit-timeouts.mts"
import { parse, stringify } from "yaml"
import { createCommandScope } from "./command-scopes.mts"
import { fileURLToPath } from "node:url"

export type MaintenanceOperation =
  | { kind: "reinit"; ids: string[] }
  | { kind: "add"; id: string; definition: AppDefinition }
  | { kind: "remove"; id: string }
  | { kind: "restore"; archive: string }
interface Archive {
  schemaVersion: 1
  id: string
  definition: AppDefinition
  record: NonNullable<TemplateVersions["applications"]>[string]
  fingerprint: string
  dependencies?: DependencyReceipt
  importer?: unknown
}
const generatorFor = (app: Application) => (app.type === "web" ? "create-next-app" : "create-vite")
const nextFlags = [
  "--ts",
  "--eslint",
  "--tailwind",
  "--app",
  "--src-dir",
  "--import-alias",
  "@/*",
  "--use-pnpm",
  "--skip-install",
  "--disable-git",
  "--no-agents-md",
  "--no-agent-feedback",
  "--no-react-compiler",
  "--no-cache-components",
  "--yes",
]

export async function readArchive(root: string, id: string): Promise<{ path: string; metadata: Archive }> {
  assert(/^[a-z0-9-]{1,100}$/.test(id), "Invalid archive identifier")
  const path = join(root, ".reinit/archives", id)
  for (const directory of [join(root, ".reinit"), join(root, ".reinit/archives"), path])
    assert(!(await lstat(directory)).isSymbolicLink(), "Archive paths must not be symbolic links")
  const metadata = await readJson<Archive>(join(path, "archive.json"))
  assert.equal(metadata.schemaVersion, 1, "Unsupported application archive")
  assertAppId(metadata.id)
  application(metadata.id, metadata.definition, metadata.record)
  assert.equal(await fingerprint(join(path, "app")), metadata.fingerprint, "Archived source has changed")
  return { path, metadata }
}

export async function assertRemovable(root: string, app: Application) {
  const paths = ["."]
  for (const parent of ["apps", "packages"])
    for (const entry of await readdir(join(root, parent), { withFileTypes: true }))
      if (entry.isDirectory()) paths.push(`${parent}/${entry.name}`)
  const references: string[] = []
  for (const path of paths) {
    if (path === app.path || !(await exists(join(root, path, "package.json")))) continue
    const manifest = await readJson(join(root, path, "package.json"))
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
      for (const [name, specifier] of Object.entries((manifest[field] ?? {}) as Record<string, string>)) {
        const local = /^(?:workspace:|file:|link:)(.+)$/.exec(specifier)?.[1]
        const location = specifier.startsWith("file://")
          ? fileURLToPath(specifier)
          : local
            ? resolve(root, path, local)
            : undefined
        const target = resolve(root, app.path)
        if (
          name === app.packageName ||
          specifier.startsWith(`workspace:${app.packageName}@`) ||
          (location && (location === target || location.startsWith(target + sep)))
        )
          references.push(`${path}: ${name}`)
      }
    }
  }
  assert.equal(references.length, 0, `Application is still referenced: ${references.join(", ")}`)
}

export async function runMaintenance(
  root: string,
  operation: MaintenanceOperation,
  offline: boolean,
  hooks: { boundary?: (name: string) => void | Promise<void> } = {},
) {
  assert.equal(Number(process.versions.node.split(".")[0]), 24, "Use Node.js 24 LTS")
  const timeouts = reinitTimeouts()
  const baseline = await fingerprint(root)
  await hooks.boundary?.("baseline-read")
  const originalApps = await readApplications(root)
  const originalConfig = await readAppsConfig(root)
  const originalRecords = await readVersions(root)
  const config = structuredClone(originalConfig)
  const versions = structuredClone(originalRecords)
  const apps = [...originalApps]
  let removed: Application | undefined
  let restored: Awaited<ReturnType<typeof readArchive>> | undefined
  if (operation.kind === "add") {
    assertAppId(operation.id)
    assert(
      !apps.some((app) => app.id === operation.id) && !(await exists(join(root, "apps", operation.id))),
      "Application directory is already occupied",
    )
    assert(
      !offline,
      "Creating a new instance requires online official templates; offline reinit remains available for recorded instances",
    )
    const app = application(operation.id, operation.definition, {
      instanceId: `app-${randomUUID()}`,
      type: operation.definition.type,
      legacy: false,
      integrationVersion,
    })
    apps.push(app)
    config.apps[app.id] = operation.definition
    versions.applications![app.id] = identityOf(app)
  } else if (operation.kind === "remove") {
    removed = apps.find((app) => app.id === operation.id)
    assert(removed, `Unknown application: ${operation.id}`)
    await assertRemovable(root, removed)
    apps.splice(apps.indexOf(removed), 1)
    delete config.apps[removed.id]
    delete versions.applications![removed.id]
    if (["web", "admin", "extension"].includes(removed.id)) delete versions[removed.id as "web" | "admin" | "extension"]
  } else if (operation.kind === "restore") {
    restored = await readArchive(root, operation.archive)
    const { metadata } = restored
    assert(
      !apps.some((app) => app.id === metadata.id) && !(await exists(join(root, "apps", metadata.id))),
      "Restore target is already occupied",
    )
    const app = application(metadata.id, metadata.definition, metadata.record)
    apps.push(app)
    config.apps[app.id] = metadata.definition
    versions.applications![app.id] = metadata.record
  }
  // Validate the proposed configuration before acquiring a lock or writing.
  const { parseAppsConfig } = await import("./apps.mts")
  parseAppsConfig(JSON.stringify(config))
  const selected =
    operation.kind === "reinit"
      ? operation.ids.map((id) => {
          const app = apps.find((entry) => entry.id === id)
          assert(app, `Unknown application: ${id}`)
          return app
        })
      : operation.kind === "add"
        ? apps.filter((app) => app.id === operation.id)
        : []
  assert.equal(new Set(selected.map((app) => app.id)).size, selected.length, "Duplicate rebuild target")
  await hooks.boundary?.("planned")

  const state = join(root, ".reinit")
  if (await exists(state)) assert(!(await lstat(state)).isSymbolicLink(), ".reinit must not be a symbolic link")
  await mkdir(state, { recursive: true, mode: 0o700 })
  for (const name of ["staging", "backups", "reports", "archives"]) await ensureRealDirectory(join(state, name))
  const lock = join(state, "lock")
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`.toLowerCase()
  const stage = join(state, "staging", id)
  const backup = join(state, "backups", id)
  const runner = createCommandRunner({
    timeoutMs: timeouts.command,
    env: {
      CI: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      TURBO_TELEMETRY_DISABLED: "1",
      pnpm_config_update_notifier: "false",
      pnpm_config_fetch_timeout: process.env.pnpm_config_fetch_timeout ?? "120000",
      pnpm_config_fetch_retries: process.env.pnpm_config_fetch_retries ?? "2",
      pnpm_config_fetch_retry_mintimeout: process.env.pnpm_config_fetch_retry_mintimeout ?? "1000",
      pnpm_config_fetch_retry_maxtimeout: process.env.pnpm_config_fetch_retry_maxtimeout ?? "5000",
      pnpm_config_network_concurrency: process.env.pnpm_config_network_concurrency ?? "4",
      ...(offline ? { pnpm_config_offline: "true" } : {}),
    },
  })
  const dispose = handleCancellation(runner, () =>
    console.error("Cancellation requested; stopping owned commands before recovery."),
  )
  let scope: ReturnType<typeof createCommandScope> | undefined
  let ownershipEnv: NodeJS.ProcessEnv = {}
  const writeOwner = (processesStopped: boolean) =>
    writeAtomicJson(join(lock, "owner.json"), {
      pid: process.pid,
      operation: operation.kind,
      id,
      stage,
      backup,
      scope: scope?.path,
      processesStopped,
    })
  const metrics = createMaintenanceReport({
    path: join(state, "reports", `${operation.kind}-${id}.json`),
    details: { operation: operation.kind, id, root, stage, backup, selected: selected.map((app) => app.id), offline, timeouts },
  })
  const run = (args: string[], cwd: string, capture = false, env: NodeJS.ProcessEnv = {}) => {
    const pnpm = process.env.npm_execpath
    const command = pnpm ? process.execPath : "pnpm"
    const argv = pnpm ? [pnpm, ...args] : args
    const timeoutMs = timeoutForCommand(args, timeouts)
    const work = () => runner.run(command, argv, { cwd, capture, env: { ...ownershipEnv, ...env }, timeoutMs })
    return capture ? work() : metrics.phase(`${cwd === root ? "final" : "candidate"}: ${args.join(" ")}`, work, { timeoutMs })
  }
  let leaveLock = false,
    status = "failed",
    failure: string | undefined
  let pending: ReturnType<typeof toError> | undefined
  // Finish fallible setup before locking. Once acquired, every subsequent
  // operation is covered by the cleanup/recovery boundary below.
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch (error) {
    await runner.close()
    dispose()
    throw new Error("Maintenance lock exists; inspect .reinit/lock/owner.json and the recovery journal before retrying", {
      cause: error,
    })
  }
  try {
    await writeOwner(false)
    scope = createCommandScope()
    scope.attach(process.pid)
    scope.retain()
    ownershipEnv = scope.env
    await writeOwner(false)
    assert.equal(await fingerprint(root), baseline, "Workspace changed while planning; original files were preserved")
    await mkdir(stage, { recursive: true, mode: 0o700 })
    await chmod(stage, (await lstat(root)).mode & 0o7777)
    await runner.run("git", ["init", "--quiet", stage], { capture: true, env: ownershipEnv })
    for (const entry of await readdir(root))
      if (!ignored(entry)) await copySource(join(root, entry), join(stage, entry), { root })
    assert.equal(await fingerprint(stage), baseline, "Workspace changed while copying; stopping maintenance")
    assert.deepEqual(await readApplications(stage), originalApps, "Application inputs changed during planning")
    assert.deepEqual(await readAppsConfig(stage), originalConfig, "Application configuration changed during planning")
    assert.deepEqual(await readVersions(stage), originalRecords, "Dependency records changed during planning")
    const input = join(stage, ".reinit/input")
    await mkdir(input, { recursive: true, mode: (await lstat(root)).mode & 0o777 })
    await chmod(input, (await lstat(root)).mode & 0o7777)
    for (const entry of await readdir(stage))
      if (!ignored(entry)) await copySource(join(stage, entry), join(input, entry), { root: stage })
    assert.equal(await fingerprint(input), baseline, "Maintenance input snapshot is inconsistent")
    if (operation.kind !== "reinit") await writeJson(join(stage, "apps.config.json"), config)
    await writeJson(join(stage, "template-versions.json"), versions)
    if (removed) await rm(join(stage, removed.path), { recursive: true })
    if (restored) {
      const app = apps.find((entry) => entry.id === restored.metadata.id)!
      await copySource(join(restored.path, "app"), join(stage, app.path))
      assert.equal(
        await fingerprint(join(stage, app.path)),
        restored.metadata.fingerprint,
        "Archive changed during restoration",
      )
      const lockPath = join(stage, "pnpm-lock.yaml")
      const lockfile = parse(await readFile(lockPath, "utf8"))
      if (restored.metadata.importer) lockfile.importers[app.path] = restored.metadata.importer
      await writeFile(lockPath, stringify(lockfile))
      const archived = restored.metadata.dependencies?.entries.filter((entry) => entry.location?.path === app.path) ?? []
      versions.dependencies = { ...versions.dependencies, entries: [...(versions.dependencies?.entries ?? []), ...archived] }
    }
    await hooks.boundary?.("candidate-configured")
    const registry = createRegistry(async (specifier, fields) =>
      JSON.parse(await run(["view", specifier, ...fields, "--json"], stage, true)),
    )
    const resolved = new Map<string, string>()
    const templates: Record<string, PackageManifest> = {},
      previous: Record<string, PackageManifest> = {}
    const workspacePolicy = await readFile(join(stage, "pnpm-workspace.yaml"), "utf8")
    for (const app of selected) {
      runner.check()
      const generator = generatorFor(app)
      const saved = versions.applications![app.id]
      let version: string
      if (offline) {
        assert(
          saved.generator === generator && /^\d+\.\d+\.\d+$/.test(saved.version ?? ""),
          `No recorded official template for ${app.id}`,
        )
        version = saved.version!
      } else {
        if (!resolved.has(generator))
          resolved.set(
            generator,
            (await metrics.phase(`resolve ${generator} latest`, () => registry.latest(generator))).version,
          )
        version = resolved.get(generator)!
      }
      previous[app.id] = await readJson(
        join(input, operation.kind === "add" ? `templates/${app.type}` : app.path, "package.json"),
      )
      await rm(join(stage, app.path), { recursive: true, force: true })
      await run(
        [
          "dlx",
          `${generator}@${version}`,
          app.path,
          ...(app.type === "web" ? nextFlags : ["--template", "react-ts", "--no-interactive"]),
        ],
        stage,
      )
      templates[app.id] = await readJson(join(stage, app.path, "package.json"))
      versions.applications![app.id] = { ...identityOf(app), generator, version, generatedAt: new Date().toISOString() }
    }
    await writeFile(join(stage, "pnpm-workspace.yaml"), workspacePolicy)
    const receipt = await metrics.phase("dependency planning", () =>
      updateDependencies({
        root: stage,
        templates,
        previous,
        registry,
        offline,
        saved: versions.dependencies,
        applications: apps,
        retainExisting: operation.kind !== "reinit",
      }),
    )
    versions.dependencies = receipt
    for (const app of selected) {
      await integrate(stage, app.id, previous[app.id], await readJson(join(stage, app.path, "package.json")), app)
      await preserveApp(join(input, operation.kind === "add" ? `templates/${app.type}` : app.path), join(stage, app.path))
      await writeJson(join(stage, app.path, "app-identity.json"), identityOf(app))
    }
    await writeJson(join(stage, "template-versions.json"), versions)
    await run(["install", ...(offline ? ["--offline"] : []), "--no-frozen-lockfile", "--strict-peer-dependencies"], stage)
    await verifyResolvedUpdates(stage, receipt)
    await validateBeforePromotion({
      root,
      stage,
      baseline,
      offline,
      selected: selected.map((app) => app.id),
      run,
      checkInterrupted: runner.check,
      promote: async () => {
        await writeOwner(true)
        if (removed) {
          const archive = join(state, "archives", id)
          await mkdir(archive, { recursive: true, mode: 0o700 })
          await copySource(join(input, removed.path), join(archive, "app"))
          const sourceLock = parse(await readFile(join(input, "pnpm-lock.yaml"), "utf8"))
          const originalVersions = await readVersions(input)
          const metadata: Archive = {
            schemaVersion: 1,
            id: removed.id,
            definition: { type: removed.type, port: removed.port },
            record: originalVersions.applications![removed.id],
            fingerprint: await fingerprint(join(archive, "app")),
            dependencies: originalVersions.dependencies,
            importer: sourceLock.importers[removed.path],
          }
          await writeFile(join(archive, "archive.json"), JSON.stringify(metadata, null, 2) + "\n", { mode: 0o600 })
          console.log(`Protected application archive: ${archive}`)
          assert.equal(await fingerprint(root), baseline, "Workspace changed during archival; stopping replacement")
        }
        try {
          await promote({
            root,
            stage,
            backup,
            expectedFingerprint: baseline,
            expectedCandidateFingerprint: await fingerprint(stage),
            boundary: (name, path) => hooks.boundary?.(`promotion:${name}:${path}`),
            paths: [
              "apps",
              "packages",
              "apps.config.json",
              "package.json",
              "pnpm-workspace.yaml",
              "node_modules",
              "pnpm-lock.yaml",
              "template-versions.json",
            ],
            checkInterrupted: runner.check,
            validate: async () => {
              await writeOwner(false)
              await run(["install", ...(offline ? ["--offline"] : []), "--frozen-lockfile", "--strict-peer-dependencies"], root)
              await verifyResolvedUpdates(root, receipt)
              await run(["check"], root)
              await writeOwner(true)
            },
          })
        } catch (error) {
          const journal = await readJson<{ state?: string }>(join(backup, "journal.json")).catch(() => null)
          leaveLock = journal?.state !== "rolled-back"
          throw error
        }
      },
    })
    status = "passed"
    console.log(`Maintenance complete. Backup: ${backup}`)
  } catch (caught) {
    const error = toError(caught)
    leaveLock ||= Boolean(error.unsafeToRestore)
    failure = error.message
    pending = error
    console.error(`Diagnostics: ${stage}`)
  } finally {
    try {
      await runner.close()
      await writeOwner(true)
    } catch (error) {
      leaveLock = true
      failure ??= toError(error).message
      pending = Object.assign(
        new AggregateError(
          [...(pending ? [pending] : []), error],
          "Maintenance commands did not settle; preserve recovery state",
        ),
        { unsafeToRestore: true },
      )
    }
    dispose()
    if (!leaveLock) {
      try {
        scope?.settle()
        await rm(lock, { recursive: true, force: true })
      } catch (error) {
        leaveLock = true
        failure ??= toError(error).message
        pending = Object.assign(
          new AggregateError([...(pending ? [pending] : []), error], "Maintenance cleanup failed; inspect the retained state"),
          { unsafeToRestore: true },
        )
      }
    }
    try {
      await metrics.finish(leaveLock ? "recovery-required" : status, { failure, lockRetained: leaveLock })
    } catch (error) {
      pending = Object.assign(
        new AggregateError([...(pending ? [pending] : []), error], "Maintenance report could not be saved"),
        { unsafeToRestore: leaveLock },
      )
    }
  }
  if (leaveLock) {
    const error = pending ?? new Error(`Recovery requires attention; lock retained. ${failure ?? "Inspect the journal"}`)
    throw Object.assign(error, { unsafeToRestore: true })
  }
  if (pending) throw pending
}
