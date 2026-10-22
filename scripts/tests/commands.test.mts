import type { CommandHandle } from "../lib/contracts.mts"
import { toError } from "../lib/contracts.mts"
import assert from "node:assert/strict"
import { once } from "node:events"
import { test } from "node:test"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setTimeout as delay } from "node:timers/promises"
import { createCommandRunner, positiveTimeout } from "../lib/commands.mts"
import { promote } from "../lib/workspace.mts"

const gone = (pid: number | undefined) => {
  try {
    assert(pid)
    process.kill(pid, 0)
    return false
  } catch (caught) {
    const error = toError(caught)
    if (error.code === "ESRCH") return true
    throw error
  }
}

const ready = (handle: CommandHandle) => {
  assert(handle.child.stdout)
  return Promise.race([
    once(handle.child.stdout, "data"),
    handle.done.then((result) => {
      throw result.reason ?? result.error ?? new Error("Command exited before reporting readiness")
    }),
  ])
}

test("command runner captures output and reports exit and launch failures", async (t) => {
  const runner = createCommandRunner()
  t.after(() => runner.close())
  assert.equal(await runner.run(process.execPath, ["-e", 'console.log("captured")'], { capture: true }), "captured")
  await assert.rejects(runner.run(process.execPath, ["-e", "process.exit(7)"], { stdio: "ignore" }), /failed.*7/)
  await assert.rejects(runner.run("browser-client-nonexistent-command", [], { stdio: "ignore" }), /ENOENT/)
  assert.throws(() => positiveTimeout("0", 100))
  assert.throws(() => positiveTimeout("NaN", 100))
})

test(
  "timeout escalates when a process ignores SIGTERM, and settles after exit",
  { skip: process.platform === "win32" },
  async (t) => {
    const runner = createCommandRunner({ timeoutMs: 5000, graceMs: 100 })
    t.after(() => runner.close())
    const handle = runner.start(
      process.execPath,
      ["-e", 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'],
      { stdio: ["ignore", "pipe", "ignore"] },
    )
    await ready(handle)
    const result = await handle.done
    assert(result.reason)
    assert.match(result.reason.message, /Timed out/)
    assert.equal(result.signal, "SIGKILL")
    assert.equal(gone(handle.child.pid), true)
  },
)

test(
  "SIGINT cancellation cleans the separately spawned child before the parent exits",
  { skip: process.platform === "win32" },
  async (t) => {
    const runner = createCommandRunner({ timeoutMs: 10_000, graceMs: 1000 })
    t.after(() => runner.close())
    const moduleUrl = new URL("../lib/commands.mts", import.meta.url).href
    const code = `
    import {createCommandRunner, handleCancellation} from ${JSON.stringify(moduleUrl)};
    const runner = createCommandRunner();
    const dispose = handleCancellation(runner);
    const handle = runner.start(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore', timeoutMs:0});
    console.log(handle.child.pid);
    try { await handle.done; runner.check(); } catch { process.exitCode = 130; }
    finally { await runner.close(); dispose(); }
  `
    const parent = runner.start(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] })
    let errors = ""
    parent.child.stderr!.on("data", (chunk) => {
      errors += chunk
    })
    const [data] = await ready(parent)
    const childPid = Number(String(data).trim())
    assert(Number.isSafeInteger(childPid))
    process.kill(parent.child.pid!, "SIGINT")
    assert.equal((await parent.done).code, 130, errors)
    assert.equal(gone(childPid), true)
    assert.equal(gone(parent.child.pid), true)
  },
)

test("cancellation prevents subsequent commands", async () => {
  const runner = createCommandRunner()
  runner.cancel(new Error("cancelled by test"))
  await assert.rejects(runner.run(process.execPath, ["-e", "process.exit(0)"]), /cancelled by test/)
  await runner.close()
})

test("validation timeout stops a writer before rollback restores source", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "browser-client-process-rollback-"))
  const root = join(base, "root"),
    stage = join(base, "stage"),
    backup = join(base, "backup")
  const runner = createCommandRunner({ timeoutMs: 5000, graceMs: 1000 })
  t.after(async () => {
    await runner.close()
    await rm(base, { recursive: true, force: true })
  })
  for (const dir of [root, stage]) await mkdir(join(dir, "apps"), { recursive: true })
  await writeFile(join(root, "apps/data"), "original")
  await writeFile(join(stage, "apps/data"), "candidate")
  await assert.rejects(
    promote({
      root,
      stage,
      backup,
      paths: ["apps"],
      validate: () =>
        runner.run(
          process.execPath,
          [
            "-e",
            `
    const {writeFileSync, renameSync} = require('node:fs');
    const path = ${JSON.stringify(join(root, "apps/data"))};
    // Use atomic replacement so stopping between truncate and write cannot
    // invalidate the content assertion for an otherwise correct rollback.
    const update = () => { writeFileSync(path + '.pending', 'still-writing'); renameSync(path + '.pending', path); };
    update();
    writeFileSync(path + '.pid', String(process.pid));
    setInterval(update, 10);
  `,
          ],
          { stdio: "ignore" },
        ),
    }),
    /Timed out/,
  )
  await delay(100)
  assert.equal(await readFile(join(root, "apps/data"), "utf8"), "original")
  assert.equal(await readFile(join(backup, "failed-replacement/apps/data"), "utf8"), "still-writing")
  const writerPid = Number(await readFile(join(backup, "failed-replacement/apps/data.pid"), "utf8"))
  assert(Number.isSafeInteger(writerPid) && writerPid > 0)
  assert.equal(gone(writerPid), true)
  assert.equal(JSON.parse(await readFile(join(backup, "journal.json"), "utf8")).state, "rolled-back")
})

test("a command exiting before readiness rejects the wait instead of hanging", async (t) => {
  const runner = createCommandRunner({ timeoutMs: 50, graceMs: 1000 })
  t.after(() => runner.close())
  const handle = runner.start(process.execPath, ["-e", 'setTimeout(() => console.log("ready"), 500)'], {
    stdio: ["ignore", "pipe", "ignore"],
  })
  await assert.rejects(ready(handle), /Timed out/)
  assert.equal(gone(handle.child.pid), true)
})
