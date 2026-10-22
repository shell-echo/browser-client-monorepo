import type { TemplateVersions } from "./lib/contracts.mts"
import type { MaintenanceReport } from "./lib/contracts.mts"
import { toError } from "./lib/contracts.mts"
import assert from "node:assert/strict"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { copySource, fingerprint, ignored } from "./lib/workspace.mts"
import { handleCancellation, positiveTimeout } from "./lib/commands.mts"
import { createVerificationRunner, finishVerification } from "./lib/verification.mts"
import {
  assertEslintFloorRejection,
  dependencyVersions,
  generatorVersions,
  preservedSnapshot,
  seedReinitAcceptance,
} from "./lib/reinit-acceptance.mts"

const root = fileURLToPath(new URL("../", import.meta.url))
const runDir = join(resolve(process.env.BROWSER_TEST_OUTPUT_ROOT ?? join(root, ".reinit/verification")), `reinit-${Date.now()}`)
const workspace = join(runDir, "workspace")
const report: MaintenanceReport & { runDir: string; checks: string[]; errors: string[] } = {
  operation: "reinit-acceptance",
  runDir,
  checks: [],
  errors: [],
  startedAt: new Date().toISOString(),
}
const runner = createVerificationRunner({
  cwd: workspace,
  logDir: runDir,
  timeoutMs: positiveTimeout(process.env.REINIT_TEST_COMMAND_TIMEOUT_MS, 1_800_000, "REINIT_TEST_COMMAND_TIMEOUT_MS"),
  env: { NEXT_TELEMETRY_DISABLED: "1", TURBO_TELEMETRY_DISABLED: "1" },
})
const dispose = handleCancellation(runner)
const passed = (message: string) => {
  report.checks.push(message)
  console.log(`✓ ${message}`)
}

try {
  const baseline = await fingerprint(root)
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  for (const name of await readdir(root))
    if (!ignored(name)) await copySource(join(root, name), join(workspace, name), { root })
  await runner.run("git", ["init", "--quiet"], "git.log")
  await runner.run("pnpm", ["install", "--offline", "--frozen-lockfile"], "install.log")
  await seedReinitAcceptance(workspace)
  const preserved = await preservedSnapshot(workspace)

  await runner.run("pnpm", ["reinit", "--apply"], "online.log")
  assert.deepEqual(await preservedSnapshot(workspace), preserved, "Online reinit changed preserved business files")
  const recordsPath = join(workspace, "template-versions.json")
  const online: TemplateVersions = JSON.parse(await readFile(recordsPath, "utf8"))
  assert.equal(online.dependencies!.policy, "stable-compatible-v1")
  assert(dependencyVersions(online).length > 0, "Online reinit did not record dependency decisions")
  passed(
    "Real online official generators, compatible upgrades, browser gates and final-location checks passed; business source preserved",
  )

  await runner.run("pnpm", ["reinit", "--apply", "--offline"], "offline.log")
  assert.deepEqual(await preservedSnapshot(workspace), preserved, "Offline reinit changed preserved business files")
  const offlineBytes = await readFile(recordsPath, "utf8")
  const offline: TemplateVersions = JSON.parse(offlineBytes)
  assert.deepEqual(generatorVersions(offline), generatorVersions(online), "Offline generator versions drifted")
  assert.deepEqual(dependencyVersions(offline), dependencyVersions(online), "Offline dependency versions drifted")
  report.generators = generatorVersions(offline)
  report.dependencies = dependencyVersions(offline)
  passed("Real offline replay, browser gates and final-location checks passed; versions and business source preserved")

  const invalid = structuredClone(offline)
  const eslint = invalid.dependencies!.entries.find((entry) => entry.name === "eslint")
  assert(eslint, "ESLint must have an offline receipt")
  eslint.version = "9.39.0"
  await writeFile(recordsPath, JSON.stringify(invalid, null, 2) + "\n")
  const beforeFailure = await fingerprint(workspace)
  const result = await runner.start("pnpm", ["reinit", "--apply", "--offline"], "rejected.log").done
  assertEslintFloorRejection(result, await readFile(join(runDir, "rejected.log"), "utf8"))
  assert.equal(await fingerprint(workspace), beforeFailure, "Rejected reinit changed the original temporary project")
  await writeFile(recordsPath, offlineBytes)
  passed("Actual CLI rejected an ESLint 9 offline receipt without replacing source, manifests or the lockfile")

  assert.equal(await fingerprint(root), baseline, "Reinit acceptance changed the user's original source")
  passed("All reinitializations ran only in an isolated copy; original workspace source is unchanged")
  report.status = "passed"
} catch (caught) {
  const error = toError(caught)
  report.status = "failed"
  report.failure = error.stack
  throw error
} finally {
  await finishVerification(report, [runner.close, dispose])
}
