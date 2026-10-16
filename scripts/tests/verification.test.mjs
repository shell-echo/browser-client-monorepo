import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { finishVerification } from "../lib/verification.mjs"

test("cleanup failures persist a failed report and still close the other owned resources", async (t) => {
  const runDir = await mkdtemp(join(tmpdir(), "browser-client-report-"))
  t.after(() => rm(runDir, { recursive: true, force: true }))
  const report = { status: "passed", runDir, checks: ["runtime passed"] }
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
})
