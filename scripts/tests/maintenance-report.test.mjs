import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createMaintenanceReport, createPhaseReporter, formatBytes, summarizeMaintenance } from "../lib/maintenance-report.mjs"

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "browser-client-metrics-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test("phase reporting preserves return values, failure identity and private final diagnostics", async (t) => {
  const root = await fixture(t)
  const path = join(root, "reports/reinit.json")
  const metrics = createMaintenanceReport({ path, details: { operation: "reinit", offline: true }, log() {} })
  assert.equal(await metrics.phase("install", async () => 42), 42)
  const failure = Object.assign(new Error("process exit unconfirmed"), { unsafeToRestore: true })
  await assert.rejects(
    metrics.phase("browser", async () => {
      throw failure
    }),
    (error) => error === failure,
  )
  await metrics.finish("recovery-required", { lockRetained: true })
  const report = JSON.parse(await readFile(path, "utf8"))
  assert.equal(report.status, "recovery-required")
  assert.equal(report.lockRetained, true)
  assert.equal(report.phases[0].status, "passed")
  assert.equal(report.phases[1].status, "failed")
  assert.equal(report.phases[1].failure, failure.message)
  assert(report.durationMs >= 0 && report.phases.every((phase) => phase.durationMs >= 0))
})

test("size preview measures eligible and retained data once without following external links", async (t) => {
  const root = await fixture(t)
  const state = join(root, ".reinit")
  const candidate = join(state, "verification/old/workspace")
  await mkdir(candidate, { recursive: true })
  await mkdir(join(state, "reports"))
  await writeFile(join(candidate, "source"), "12345")
  await writeFile(join(state, "reports/result.json"), "123")
  const usage = await summarizeMaintenance(state, [{ path: candidate }])
  assert.equal(usage.totalBytes, 8)
  assert.equal(usage.eligibleBytes, 5)
  assert.equal(usage.retainedBytes, 3)
  assert.equal(usage.categories.verification, 5)
  assert.equal(usage.files, 2)
  await writeFile(join(root, "outside"), "private data that must not be followed")
  await symlink(join(root, "outside"), join(state, "external"))
  const linked = await summarizeMaintenance(state, [{ path: candidate }])
  assert.equal(linked.files, 3)
  assert.equal(await readFile(join(root, "outside"), "utf8"), "private data that must not be followed")
  const controller = new AbortController()
  controller.abort(new Error("cancel size scan"))
  await assert.rejects(summarizeMaintenance(state, [], { signal: controller.signal }), /cancel size scan/)
  assert.equal(formatBytes(1536), "1.5 KiB")
})

test("report writes reject a linked report directory", async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, "outside"))
  await symlink(join(root, "outside"), join(root, "reports"))
  const metrics = createMaintenanceReport({ path: join(root, "reports/result.json"), log() {} })
  await assert.rejects(metrics.finish("passed"), /real directory/)
})

test("phase heartbeats expose elapsed time and budgets, then stop on success or failure", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const report = {},
    messages = []
  const { phase } = createPhaseReporter({ report, log: (message) => messages.push(message) })
  for (const fail of [false, true]) {
    let release
    const pending = new Promise((resolve) => {
      release = resolve
    })
    const failure = Object.assign(new Error("browser timeout"), { unsafeToRestore: true })
    const result = phase(
      "browser routes",
      async () => {
        await pending
        if (fail) throw failure
        return 42
      },
      { timeoutMs: 1_200_000 },
    )
    t.mock.timers.tick(30_000)
    assert.match(messages.at(-1), /browser routes: still running \([\d.]+s; limit 1200\.0s\)/)
    release()
    if (fail) await assert.rejects(result, (error) => error === failure)
    else assert.equal(await result, 42)
    const count = messages.length
    t.mock.timers.tick(60_000)
    assert.equal(messages.length, count, "A completed phase left a heartbeat running")
    const entry = report.phases.at(-1)
    assert.equal(entry.timeoutMs, 1_200_000)
    assert.equal(entry.status, fail ? "failed" : "passed")
    assert(entry.durationMs >= 0 && entry.finishedAt)
    if (fail) assert.equal(entry.failure, failure.message)
  }
})
