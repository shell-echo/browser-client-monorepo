#!/usr/bin/env node
import { randomUUID } from "node:crypto"
import { mkdir, readdir, lstat, rm, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { integrate, readJson, writeJson, targets } from "./lib/integrate.mjs"
import { copySource, exists, fingerprint, ignored, preserveApp, promote } from "./lib/workspace.mjs"
import { createCommandRunner, handleCancellation } from "./lib/commands.mjs"
import { createRegistry, updateDependencies, verifyResolvedUpdates } from "./lib/updates.mjs"
import { validateBeforePromotion } from "./lib/reinit-validation.mjs"
import { createMaintenanceReport } from "./lib/maintenance-report.mjs"
import { reinitTimeouts, timeoutForCommand } from "./lib/reinit-timeouts.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const help = `Usage: pnpm reinit [all|web|admin|extension] [--dry-run|--apply] [--offline]

Shows the plan by default without network access or file writes. Use --apply to rebuild.
Generates official latest templates in an isolated directory and replaces the project after validation.
Next / Vite / CRXJS use the latest stable releases; shared dependencies use the highest compatible stable versions with reasons recorded.
ESLint must be 10 or newer for online candidates, offline receipts and installed dependencies. Incompatibility stops replacement and preserves the original project.
Preserves application source, public assets, environment files, application dependencies and shared UI source; updates shared dependency manifests and catalogs.
Regenerates framework configuration and standard scripts; backs up original directories and the lockfile to .reinit/backups/.
Web / Admin and extension browser tests must pass before replacement. Online mode prepares Chromium; offline mode requires a cached browser.
Formats generated configuration only; application and shared UI source must pass formatting checks without automatic changes.
Stop development / build processes and pause editing before running.
--offline replays recorded, cached versions from template-versions.json without querying latest.
`

export function parseArgs(args) {
  const positional = args.filter((arg) => !arg.startsWith("--"))
  for (const arg of args.filter((arg) => arg.startsWith("--"))) {
    if (!["--apply", "--dry-run", "--help", "--offline"].includes(arg)) throw new Error(`Unknown option: ${arg}`)
  }
  if (positional.length > 1 || (positional[0] && !["all", ...targets].includes(positional[0])))
    throw new Error("Target must be all, web, admin or extension")
  if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("--apply and --dry-run cannot be used together")
  return {
    selected: !positional[0] || positional[0] === "all" ? targets : positional,
    apply: args.includes("--apply"),
    help: args.includes("--help"),
    offline: args.includes("--offline"),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(help)
    return
  }
  const pkg = await readJson(join(root, "package.json"))
  if (pkg.name !== "browser-client") throw new Error("Project root identifier does not match")
  console.log(`Project: ${root}\nRebuild: ${options.selected.join(", ")}\n${help}`)
  if (!options.apply) return
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Use Node.js 24 LTS")

  const timeouts = reinitTimeouts()
  const installEnv = {
    pnpm_config_fetch_timeout: process.env.pnpm_config_fetch_timeout ?? "120000",
    pnpm_config_fetch_retries: process.env.pnpm_config_fetch_retries ?? "2",
    pnpm_config_fetch_retry_mintimeout: process.env.pnpm_config_fetch_retry_mintimeout ?? "1000",
    pnpm_config_fetch_retry_maxtimeout: process.env.pnpm_config_fetch_retry_maxtimeout ?? "5000",
    pnpm_config_network_concurrency: process.env.pnpm_config_network_concurrency ?? "4",
  }
  const runner = createCommandRunner({
    timeoutMs: timeouts.command,
    env: {
      CI: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      TURBO_TELEMETRY_DISABLED: "1",
      pnpm_config_update_notifier: "false",
      pnpm_config_fetch_retries: process.env.pnpm_config_fetch_retries ?? "2",
      pnpm_config_fetch_timeout: process.env.pnpm_config_fetch_timeout ?? "30000",
      pnpm_config_fetch_retry_mintimeout: process.env.pnpm_config_fetch_retry_mintimeout ?? "1000",
      pnpm_config_fetch_retry_maxtimeout: process.env.pnpm_config_fetch_retry_maxtimeout ?? "5000",
      ...(options.offline ? { pnpm_config_offline: "true" } : {}),
    },
  })
  const state = join(root, ".reinit")
  if ((await exists(state)) && (await lstat(state)).isSymbolicLink()) throw new Error(".reinit must not be a symbolic link")
  await mkdir(state, { recursive: true, mode: 0o700 })
  const lock = join(state, "lock")
  try {
    await mkdir(lock)
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "A reinit lock already exists. Inspect .reinit/lock/owner.json and related processes; after a forced interruption, review the backup journal before manually releasing the lock.",
        { cause: error },
      )
    throw error
  }
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`
  const stage = join(state, "staging", id)
  const backup = join(state, "backups", id)
  let leaveLock = false
  const removeSignalHandlers = handleCancellation(runner, () =>
    console.error("Cancellation requested; stopping the current command and child processes, then restoring the workspace."),
  )
  const checkInterrupted = runner.check
  const run = (args, cwd, capture = false, env = {}) => {
    // npm_execpath pins the active pnpm implementation; PATH is the fallback for node scripts/reinit.mjs.
    const pnpm = process.env.npm_execpath
    const command = pnpm ? process.execPath : "pnpm"
    const commandArgs = pnpm ? [pnpm, ...args] : args
    const timeoutMs = timeoutForCommand(args, timeouts)
    const work = () => runner.run(command, commandArgs, { cwd, capture, env, timeoutMs })
    return capture ? work() : metrics.phase(`${cwd === root ? "final" : "candidate"}: ${args.join(" ")}`, work, { timeoutMs })
  }

  const reportPath = join(state, "reports", `reinit-${id}.json`)
  const metrics = createMaintenanceReport({
    path: reportPath,
    details: { operation: "reinit", id, root, stage, backup, targets: options.selected, offline: options.offline, timeouts },
  })
  let status = "failed",
    failure

  try {
    await writeJson(join(lock, "owner.json"), { pid: process.pid, operation: "reinit", id, stage, backup })
    const baseline = await fingerprint(root)
    await mkdir(stage, { recursive: true, mode: 0o700 })
    // A real repository boundary prevents parent .gitignore from hiding the
    // entire staging tree from Oxlint. No commits, hooks or remotes are created.
    await runner.run("git", ["init", "--quiet", stage], { capture: true })
    for (const entry of await readdir(root)) {
      if (!ignored(entry) && entry !== "apps") await copySource(join(root, entry), join(stage, entry), { root })
    }
    await mkdir(join(stage, "apps"))
    const versions = (await exists(join(root, "template-versions.json")))
      ? await readJson(join(root, "template-versions.json"))
      : {}
    const registry = createRegistry(async (specifier, fields) =>
      JSON.parse(await run(["view", specifier, ...fields, "--json"], stage, true)),
    )
    const resolved = {}
    for (const target of options.selected) {
      const generator = target === "web" ? "create-next-app" : "create-vite"
      if (options.offline) {
        const saved = versions[target]
        if (saved?.generator !== generator || !/^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(saved.version))
          throw new Error(`No official template version record for ${target}; cannot rebuild offline`)
        continue
      }
      if (!resolved[generator]) {
        const metadata = await metrics.phase(`resolve ${generator} latest`, () => registry.latest(generator))
        resolved[generator] = metadata.version
      }
    }
    const templates = {},
      previous = {}
    const workspacePolicy = await readFile(join(stage, "pnpm-workspace.yaml"), "utf8")
    for (const target of targets) {
      const original = join(root, "apps", target)
      if (!options.selected.includes(target)) {
        await copySource(original, join(stage, "apps", target), { root })
        continue
      }
      const generator = target === "web" ? "create-next-app" : "create-vite"
      const version = options.offline ? versions[target].version : resolved[generator]
      console.log(`\nGenerating ${target}: ${generator}@${version}`)
      const flags =
        target === "web"
          ? [
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
          : ["--template", "react-ts", "--no-interactive"]
      await run(["dlx", `${generator}@${version}`, `apps/${target}`, ...flags], stage)
      templates[target] = await readJson(join(stage, "apps", target, "package.json"))
      previous[target] = await readJson(join(original, "package.json"))
      versions[target] = { generator, version, generatedAt: new Date().toISOString() }
    }
    // Additional user workspaces under apps/ remain intact.
    for (const entry of await readdir(join(root, "apps"))) {
      if (!targets.includes(entry) && !ignored(`apps/${entry}`))
        await copySource(join(root, "apps", entry), join(stage, "apps", entry), { root })
    }
    // pnpm dlx may add release-age exceptions for its temporary generator.
    // Those are not project dependencies; preserve the original project policy.
    await writeFile(join(stage, "pnpm-workspace.yaml"), workspacePolicy)
    versions.dependencies = await metrics.phase("dependency planning", () =>
      updateDependencies({
        root: stage,
        templates,
        previous,
        registry,
        offline: options.offline,
        saved: versions.dependencies,
      }),
    )
    for (const target of options.selected) {
      await integrate(stage, target, previous[target], await readJson(join(stage, "apps", target, "package.json")))
      await preserveApp(join(root, "apps", target), join(stage, "apps", target))
    }
    await writeJson(join(stage, "template-versions.json"), versions)
    await run(
      ["install", ...(options.offline ? ["--offline"] : []), "--no-frozen-lockfile", "--strict-peer-dependencies"],
      stage,
      false,
      installEnv,
    )
    await verifyResolvedUpdates(stage, versions.dependencies)
    await validateBeforePromotion({
      root,
      stage,
      baseline,
      offline: options.offline,
      selected: options.selected,
      run,
      checkInterrupted,
      promote: async () => {
        console.log(`\nValidation passed; backing up original directories to ${backup}`)
        try {
          await promote({
            root,
            stage,
            backup,
            paths: [
              "apps",
              "packages",
              "package.json",
              "pnpm-workspace.yaml",
              "node_modules",
              "pnpm-lock.yaml",
              "template-versions.json",
            ],
            checkInterrupted,
            validate: async () => {
              await run(
                ["install", ...(options.offline ? ["--offline"] : []), "--frozen-lockfile", "--strict-peer-dependencies"],
                root,
                false,
                installEnv,
              )
              await verifyResolvedUpdates(root, versions.dependencies)
              await run(["check"], root)
            },
          })
        } catch (error) {
          const journal = await readJson(join(backup, "journal.json")).catch(() => null)
          leaveLock = journal?.state !== "rolled-back"
          if (leaveLock)
            console.error(`Recovery is incomplete; retaining the lock and workspace. Inspect ${backup}/journal.json`)
          else console.error("Final validation failed; original directories and dependencies have been restored.")
          throw error
        }
      },
    })
    console.log(`\nRebuild complete. Backup: ${backup}\nGenerator versions: template-versions.json`)
    status = "passed"
  } catch (error) {
    failure = error.message
    console.error(`\n${error.message}\nDiagnostics directory: ${stage}`)
    process.exitCode = 1
  } finally {
    try {
      await runner.close()
    } catch (error) {
      leaveLock = true
      console.error(`Process exit is unconfirmed; retaining the lock and workspace: ${error.message}`)
      process.exitCode = 1
      failure ??= error.message
    }
    removeSignalHandlers()
    try {
      if (!leaveLock) await rm(lock, { recursive: true, force: true })
    } catch (error) {
      leaveLock = true
      failure ??= error.message
      console.error(`Could not release the maintenance lock: ${error.message}`)
      process.exitCode = 1
    }
    try {
      await metrics.finish(leaveLock ? "recovery-required" : status, { failure, lockRetained: leaveLock })
    } catch (error) {
      console.error(`Could not save the maintenance report: ${error.message}`)
      process.exitCode = 1
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
