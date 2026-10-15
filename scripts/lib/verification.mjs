import { writeFile } from "node:fs/promises"
import { createWriteStream } from "node:fs"
import assert from "node:assert/strict"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { createCommandRunner } from "./commands.mjs"

// Browser checks share process ownership, log capture and bounded readiness waits.
export function createVerificationRunner({ logDir, ...options }) {
  const runner = createCommandRunner(options)
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
    const result = await start(command, args, logName).done
    if (result.reason || result.error) throw result.reason ?? result.error
    assert.equal(result.code, 0, `${command} ${args.join(" ")} 失败；查看 ${join(logDir, logName)}`)
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
    throw new Error(`等待超时：${label}`, { cause: lastError })
  }
  return { ...runner, start, run, until }
}

export async function finishVerification(report, cleanup) {
  const failures = []
  for (const close of cleanup) {
    try {
      await close()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    report.status = "failed"
    report.cleanupFailures = failures.map((error) => error.stack ?? String(error))
  }
  const path = join(report.runDir, "report.json")
  await writeFile(path, JSON.stringify(report, null, 2) + "\n")
  console.log(`浏览器验证报告：${path}`)
  if (failures.length) throw new AggregateError(failures, "浏览器测试现场清理失败")
}
