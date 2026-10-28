import type { Target, MaintenanceReport } from "./contracts.mts"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readApplications, selectApplications } from "./apps.mts"
import { fingerprint } from "./workspace.mts"
import { createVerificationRunner, finishVerification } from "./verification.mts"
import { handleCancellation } from "./commands.mts"
import type { AccessibilityCoverage } from "./accessibility.mts"

export interface InstanceBrowserReport {
  appId: string
  sourceFingerprint: string
  status: string
  checks?: string[]
  accessibility?: AccessibilityCoverage
}
export function verifyBrowserCoverage(expected: string[], reports: InstanceBrowserReport[], baseline: string) {
  assert.equal(new Set(expected).size, expected.length, "Duplicate expected browser instance")
  assert.equal(new Set(reports.map((report) => report.appId)).size, reports.length, "Duplicate browser report")
  assert.deepEqual(
    reports.map((report) => report.appId).sort(),
    [...expected].sort(),
    "Browser reports do not cover the expected instances",
  )
  for (const report of reports) {
    assert.equal(report.status, "passed", `Browser verification failed or was skipped: ${report.appId}`)
    assert.equal(report.sourceFingerprint, baseline, `Browser report uses a different source snapshot: ${report.appId}`)
    assert(
      report.accessibility?.status === "passed" &&
        Number.isSafeInteger(report.accessibility.scans) &&
        report.accessibility.scans > 0 &&
        report.accessibility.violations === 0 &&
        typeof report.accessibility.engine === "string" &&
        report.accessibility.engine.length > 0,
      `Accessibility coverage is missing or failed: ${report.appId}`,
    )
  }
}

export async function runBrowserSuite(types: readonly Target[], label: string) {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  const apps = selectApplications(await readApplications(root), process.argv[2]).filter((app) => types.includes(app.type))
  if (process.argv[2] && process.argv[2] !== "all")
    assert(apps.length === 1, "Requested instance does not match this browser suite")
  const baseline = await fingerprint(root)
  const runDir = join(
    resolve(process.env.BROWSER_TEST_OUTPUT_ROOT ?? join(root, ".reinit/verification")),
    `${label}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  )
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  const report: MaintenanceReport & { runDir: string; checks: string[] } = {
    runDir,
    startedAt: new Date().toISOString(),
    expected: apps.map((app) => app.id),
    sourceFingerprint: baseline,
    checks: [],
  }
  const runner = createVerificationRunner({ cwd: root, logDir: runDir, report, timeoutMs: 1_200_000 })
  const dispose = handleCancellation(runner)
  try {
    if (apps.length)
      await runner.run(
        process.execPath,
        ["scripts/test-accessibility.mts", join(runDir, "accessibility-engine")],
        "accessibility-engine.log",
      )
    const reports: InstanceBrowserReport[] = []
    for (const app of apps) {
      const path = join(runDir, app.id)
      const file = app.type === "extension" ? "scripts/test-extension-instance.mts" : "scripts/test-page.mts"
      await runner.run(process.execPath, [file, app.id, path], `${app.id}.log`)
      // Each worker receives its identity through its own command arguments,
      // and its output path is deterministic within this operation.
      reports.push(JSON.parse(await readFile(join(path, "report.json"), "utf8")))
    }
    verifyBrowserCoverage(
      apps.map((app) => app.id),
      reports,
      baseline,
    )
    assert.equal(await fingerprint(root), baseline, "Browser verification changed the source workspace")
    report.instances = reports
    report.checks.push(...reports.flatMap((item) => (item.checks ?? []).map((check) => `${item.appId}: ${check}`)))
    report.status = apps.length ? "passed" : "not-applicable"
    console.log(
      apps.length
        ? `Browser coverage passed: ${apps.map((app) => app.id).join(", ")}`
        : "No registered applications match this suite; not applicable.",
    )
  } catch (error) {
    report.status = "failed"
    report.failure = error instanceof Error ? error.stack : String(error)
    throw error
  } finally {
    await finishVerification(report, [runner.close, dispose])
  }
}
