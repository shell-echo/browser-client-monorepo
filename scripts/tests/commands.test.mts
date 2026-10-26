import type { CommandHandle } from "../lib/contracts.mts"
import { toError } from "../lib/contracts.mts"
import assert from "node:assert/strict"
import { once } from "node:events"
import { test } from "node:test"
import type { TestContext } from "node:test"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setTimeout as delay } from "node:timers/promises"
import { createCommandRunner, positiveTimeout } from "../lib/commands.mts"
import { inspectCommandScope } from "../lib/command-scopes.mts"
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

async function permissionFixture(t: TestContext) {
  const kill = process.kill.bind(process)
  const runner = createCommandRunner({ timeoutMs: 5000, graceMs: 100 })
  const handle = runner.start(
    process.execPath,
    [
      "-e",
      `process.on('SIGTERM',()=>{});process.stdin.on('data',()=>process.exit(0));
console.log(JSON.parse(process.env.BROWSER_CLIENT_COMMAND_SCOPE).path);setInterval(()=>{},1000)`,
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  )
  const closed = once(handle.child, "close")
  const ownership: { path?: string } = {}
  let restore = () => {}
  t.after(async () => {
    restore()
    try {
      kill(-handle.child.pid!, "SIGKILL")
    } catch (caught) {
      if (toError(caught).code !== "ESRCH" && toError(caught).code !== "EPERM") throw caught
    }
    await closed
    await runner.close().catch(() => {})
    let exited = false
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        kill(-handle.child.pid!, 0)
      } catch (caught) {
        if (toError(caught).code === "ESRCH") {
          exited = true
          break
        }
        if (toError(caught).code !== "EPERM") throw caught
      }
      await delay(20)
    }
    assert(exited, "Keep ownership evidence until the fixture's process group has exited")
    if (ownership.path) await rm(ownership.path, { recursive: true, force: true })
  })
  const [data] = await ready(handle)
  const scopePath = String(data).trim()
  ownership.path = scopePath
  assert.equal(inspectCommandScope(scopePath).at(-1)?.pid, handle.child.pid)
  return { runner, handle, scopePath, kill, setRestore: (callback: () => void) => (restore = callback) }
}

for (const deniedSignal of ["SIGTERM", "SIGKILL"] as const)
  test(
    `transient ${deniedSignal} EPERM waits for a real process-group exit before settling`,
    { skip: process.platform === "win32" },
    async (t) => {
      const fixture = await permissionFixture(t)
      let denied = 0,
        probeDenied = 0,
        exitConfirmed = false
      const signals: (number | NodeJS.Signals | undefined)[] = []
      const mock = t.mock.method(process, "kill", (pid: number, signal?: number | NodeJS.Signals) => {
        if (pid === -fixture.handle.child.pid!) {
          if (signal !== 0) signals.push(signal)
          if (signal === deniedSignal) {
            denied++
            // The fixture exits independently; a denied signal is never exit evidence.
            fixture.handle.child.stdin!.end("exit\n")
            throw Object.assign(new Error("Transient process-group signal"), { code: "EPERM" })
          }
          if (signal === 0 && denied && !probeDenied) {
            probeDenied++
            throw Object.assign(new Error("Transient process-group probe"), { code: "EPERM" })
          }
        }
        try {
          return fixture.kill(pid, signal)
        } catch (caught) {
          if (pid === -fixture.handle.child.pid! && signal === 0 && toError(caught).code === "ESRCH") exitConfirmed = true
          throw caught
        }
      })
      fixture.setRestore(() => mock.mock.restore())
      const reason = new Error("cancelled by permission regression")
      await fixture.handle.stop(reason)
      const result = await fixture.handle.done
      assert.equal(result.reason, reason)
      assert.equal(result.code, 0)
      assert.equal(denied, 1)
      assert.equal(probeDenied, 1)
      assert(exitConfirmed, "Only a real ESRCH may establish that the owned group exited")
      assert.equal(signals.includes("SIGKILL"), deniedSignal === "SIGKILL")
      await fixture.runner.close()
    },
  )

test(
  "persistent process-group EPERM rejects cleanup and retains live ownership evidence",
  { skip: process.platform === "win32" },
  async (t) => {
    const fixture = await permissionFixture(t)
    const signals: (number | NodeJS.Signals | undefined)[] = []
    const mock = t.mock.method(process, "kill", (pid: number, signal?: number | NodeJS.Signals) => {
      if (pid === -fixture.handle.child.pid!) {
        signals.push(signal)
        throw Object.assign(new Error("Persistent process-group permission denial"), { code: "EPERM" })
      }
      return fixture.kill(pid, signal)
    })
    fixture.setRestore(() => mock.mock.restore())
    const isUnsafeExit = (error: unknown) => {
      assert.match(toError(error).message, /Cannot confirm the process tree has exited/)
      assert.equal(toError(error).unsafeToRestore, true)
      return true
    }
    await assert.rejects(fixture.handle.stop(), isUnsafeExit)
    await assert.rejects(fixture.handle.done, isUnsafeExit)
    await assert.rejects(fixture.runner.close(), isUnsafeExit)
    assert(signals.includes("SIGTERM"))
    assert(signals.includes("SIGKILL"))
    assert.equal(fixture.kill(-fixture.handle.child.pid!, 0), true)
    const records = inspectCommandScope(fixture.scopePath)
    assert(records.some((record) => record.pid === fixture.handle.child.pid && record.state === "stopping"))
  },
)

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
      // This fixture deliberately writes source from an owned validator.
      // Production maintenance does not grant this exception.
      validationWrites: ["apps/data", "apps/data.pid", "apps/data.pending"],
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
