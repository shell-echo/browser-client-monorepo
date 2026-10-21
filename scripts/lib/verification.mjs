import { writeFile } from "node:fs/promises"
import { createWriteStream } from "node:fs"
import assert from "node:assert/strict"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { createCommandRunner } from "./commands.mjs"
import { createPhaseReporter } from "./maintenance-report.mjs"

// Browser checks share process ownership, log capture and bounded readiness waits.
export function createVerificationRunner({ logDir, report, ...options }) {
  const runner = createCommandRunner(options)
  const phase = report ? createPhaseReporter({ report }).phase : (_name, work) => work()
  function start(command, args, logName, env = {}, timeoutMs) {
    const log = createWriteStream(join(logDir, logName))
    log.on("error", (error) => runner.cancel(error))
    const handle = runner.start(command, args, { env, timeoutMs, stdio: ["ignore", "pipe", "pipe"] })
    handle.child.stdout.pipe(log, { end: false })
    handle.child.stderr.pipe(log, { end: false })
    handle.child.on("close", () => log.end())
    return handle
  }
  async function run(command, args, logName) {
    return phase(
      `command: ${logName}`,
      async () => {
        const result = await start(command, args, logName).done
        if (result.reason || result.error) throw result.reason ?? result.error
        assert.equal(result.code, 0, `${command} ${args.join(" ")} failed; see ${join(logDir, logName)}`)
      },
      { timeoutMs: options.timeoutMs },
    )
  }
  async function until(check, label, timeout = 30_000) {
    const deadline = Date.now() + timeout
    let lastError
    while (Date.now() < deadline) {
      runner.check()
      try {
        if (await check()) return
      } catch (error) {
        lastError = error
      }
      await delay(150)
    }
    throw new Error(`Timed out waiting for: ${label}`, { cause: lastError })
  }
  return { ...runner, start, run, until, phase }
}

export async function finishVerification(report, cleanup) {
  const failures = []
  let cleanupFailure
  try {
    await createPhaseReporter({ report }).phase("Cleanup", async () => {
      for (const close of cleanup) {
        try {
          await close()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length) throw new AggregateError(failures, "Browser test workspace cleanup failed")
    })
  } catch (error) {
    cleanupFailure = error
    report.status = "failed"
    report.cleanupFailures = failures.map((error) => error.stack ?? String(error))
  }
  report.finishedAt = new Date().toISOString()
  if (report.startedAt) report.durationMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt)
  const path = join(report.runDir, "report.json")
  await writeFile(path, JSON.stringify(report, null, 2) + "\n")
  console.log(`Browser verification report: ${path}`)
  if (cleanupFailure) throw cleanupFailure
}
