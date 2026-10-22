import type { MaintenanceReport, PhaseEntry } from "../lib/contracts.mts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createVerificationRunner, finishVerification } from "../lib/verification.mts"

test("cleanup failures persist a failed report and still close the other owned resources", async (t) => {
  const runDir = await mkdtemp(join(tmpdir(), "browser-client-report-"))
  t.after(() => rm(runDir, { recursive: true, force: true }))
  const report: MaintenanceReport & { runDir: string } = { status: "passed", runDir, checks: ["runtime passed"] }
  let runnerClosed = false,
    handlersRemoved = false
  await assert.rejects(
    finishVerification(report, [
      () => {
        throw new Error("browser close failed")
      },
      () => {
        runnerClosed = true
      },
      () => {
        handlersRemoved = true
      },
    ]),
    /workspace cleanup failed/,
  )
  assert.equal(runnerClosed, true)
  assert.equal(handlersRemoved, true)
  const saved = JSON.parse(await readFile(join(runDir, "report.json"), "utf8"))
  assert.equal(saved.status, "failed")
  assert.match(saved.cleanupFailures[0], /browser close failed/)
  assert.deepEqual(saved.checks, ["runtime passed"])
  assert.equal(saved.phases.at(-1).name, "Cleanup")
  assert.equal(saved.phases.at(-1).status, "failed")
})

test("verification reports retain successful command and failing browser-stage timings after cleanup", async (t) => {
  const runDir = await mkdtemp(join(tmpdir(), "browser-client-timed-report-"))
  t.after(() => rm(runDir, { recursive: true, force: true }))
  const report: MaintenanceReport & { runDir: string } = { runDir, checks: [], errors: [], startedAt: new Date().toISOString() }
  const runner = createVerificationRunner({ logDir: runDir, report, timeoutMs: 5000 })
  t.after(() => runner.close())
  await runner.run(process.execPath, ["-e", "console.log('offline install fixture')"], "install.log")
  const failure = new Error("route verification failed")
  await assert.rejects(
    runner.phase("Admin routes", async () => {
      throw failure
    }),
    (error) => error === failure,
  )
  report.status = "failed"
  report.failure = failure.message
  await finishVerification(report, [runner.close])
  const saved = JSON.parse(await readFile(join(runDir, "report.json"), "utf8"))
  assert.equal(saved.status, "failed")
  assert.equal(saved.phases[0].name, "command: install.log")
  assert.equal(saved.phases[0].status, "passed")
  assert.equal(saved.phases[0].timeoutMs, 5000)
  assert.equal(saved.phases[1].name, "Admin routes")
  assert.equal(saved.phases[1].status, "failed")
  assert.equal(saved.phases[1].failure, failure.message)
  assert.equal(saved.phases.at(-1).name, "Cleanup")
  assert.equal(saved.phases.at(-1).status, "passed")
  assert(saved.phases.every((entry: PhaseEntry) => entry.durationMs! >= 0 && entry.finishedAt))
  assert.match(await readFile(join(runDir, "install.log"), "utf8"), /offline install fixture/)
})
