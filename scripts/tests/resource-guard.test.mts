import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import {
  createResourceProbe,
  intervalCpu,
  linuxMemory,
  linuxTicks,
  macCpu,
  macMemory,
  ownedMemory,
  resourcePolicy,
  runtimeReason,
  startupReady,
} from "../lib/resource-probes.mts"
import { parseGuardArguments, runResourceGuard } from "../lib/resource-guard.mts"
import { exists, fingerprint } from "../lib/workspace.mts"
import { createCommandScope } from "../lib/command-scopes.mts"

const healthy = () => ({
  at: new Date().toISOString(),
  memoryFreePercent: 60,
  memoryPressureNormal: true,
  cpuIdlePercent: 95,
  ownedRssMiB: 50,
})
test("resource probes use interval CPU, real available memory and owned descendants only", () => {
  assert.equal(macCpu("CPU usage: 1% user, 1% sys, 98% idle\nCPU usage: 40% user, 10% sys, 50% idle"), 50)
  assert.throws(() => macCpu("CPU usage: 98% idle"))
  assert.deepEqual(macMemory("2", "System-wide memory free percentage: 70%"), {
    memoryFreePercent: 70,
    memoryPressureNormal: false,
  })
  assert.throws(() => macMemory("", "System-wide memory free percentage: 70%"))
  assert.deepEqual(
    linuxMemory("MemTotal: 1000 kB\nMemAvailable: 500 kB", "some avg10=0.02 avg60=0.00\nfull avg10=0.00 avg60=0.00"),
    { memoryFreePercent: 50, memoryPressureNormal: true },
  )
  assert.equal(linuxMemory("MemTotal: 1000 kB\nMemAvailable: 500 kB", "full avg10=0.01 avg60=0.00").memoryPressureNormal, false)
  assert.throws(() => linuxMemory("MemFree: 1000 kB", "full avg10=0.00 avg60=0.00"))
  const before = linuxTicks("cpu 10 0 10 80 0 0 0 0 5 0")
  const after = linuxTicks("cpu 20 0 20 160 0 0 0 0 10 0")
  assert.equal(intervalCpu(before, after), 80)
  assert.throws(() => intervalCpu(after, before))
  assert.equal(ownedMemory("100 1 1024\n101 100 2048\n102 101 1024\n200 1 900000", 100), 4)
  assert.throws(() => ownedMemory("200 1 1", 100))
  assert.throws(() => createResourceProbe("win32"))
})

test("headroom policy fails closed and retains hard, consecutive and memory thresholds", () => {
  assert(startupReady(healthy()))
  for (const change of [
    { cpuIdlePercent: 79 },
    { memoryFreePercent: 39 },
    { memoryPressureNormal: false },
    { cpuIdlePercent: undefined },
    { ownedRssMiB: undefined },
    { ownedRssMiB: 2049 },
    { cpuIdlePercent: NaN },
    { memoryFreePercent: Infinity },
    { ownedRssMiB: -1 },
  ])
    assert.equal(startupReady({ ...healthy(), ...change }), false)
  assert.equal(runtimeReason({ ...healthy(), cpuIdlePercent: NaN }, 0).reason, "probe-unavailable")
  assert.equal(runtimeReason({ ...healthy(), cpuIdlePercent: 34 }, 0).reason, "cpu-headroom")
  assert.equal(runtimeReason({ ...healthy(), cpuIdlePercent: 49 }, 0).reason, undefined)
  assert.equal(runtimeReason({ ...healthy(), cpuIdlePercent: 49 }, 1).reason, "cpu-headroom")
  assert.equal(
    runtimeReason({ ...healthy(), memoryPressureNormal: false, cpuIdlePercent: undefined }, 0).reason,
    "memory-pressure",
  )
  assert.equal(runtimeReason({ ...healthy(), ownedRssMiB: undefined }, 0).reason, "probe-unavailable")
  assert.equal(runtimeReason({ ...healthy(), ownedRssMiB: 2049 }, 0).reason, "owned-memory")
  assert.equal(resourcePolicy.cooldownMs, 900000)
})

test("guard CLI is explicit, bounded, task-only, and resume cannot switch commands", () => {
  assert.deepEqual(parseGuardArguments(["check"]), { guard: false, task: ["check"], resume: undefined, waitMs: 600000 })
  assert.equal(parseGuardArguments(["--guard", "--wait-ms=20", "test:accessibility"]).waitMs, 20)
  assert.equal(parseGuardArguments(["--guard", "--resume=guard-1793010000000-1234abcd"]).resume, "guard-1793010000000-1234abcd")
  for (const args of [
    ["--guard", "dev"],
    ["--wait-ms=1", "check"],
    ["--guard", "--wait-ms=0", "check"],
    ["--guard", "--guard", "check"],
    ["--guard", "--resume=../other"],
    ["--guard", "--resume=guard-1793010000000-1234abcd", "test"],
    ["--guard", "--memory-min=0", "check"],
  ])
    assert.throws(() => parseGuardArguments(args))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "browser-client-guard-"))
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, scripts: { test: "node probe.mts" } }))
  // Match the real repository: running a task must not auto-install a fixture
  // lockfile before the guard can verify its unchanged-source invariant.
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\nverifyDepsBeforeRun: false\n")
  await writeFile(
    join(root, "probe.mts"),
    `import {writeFileSync,appendFileSync} from 'node:fs';
writeFileSync('.reinit/started',String(process.pid));
if(process.env.BROWSER_CLIENT_GUARD_FIXTURE_FINISH==='1')process.exit(0);
setInterval(()=>appendFileSync('.reinit/writer','x'),10);setTimeout(()=>process.exit(9),20000);`,
  )
  return root
}

test("unavailable startup observations never start commands and retain a resumable report", async () => {
  const root = await fixture(),
    before = await fingerprint(root)
  let clock = 0
  const result = await runResourceGuard(root, parseGuardArguments(["--guard", "--wait-ms=1", "test"]), {
    probe: async () => {
      throw new Error("Probe unavailable")
    },
    now: () => clock++,
    startupIntervalMs: 0,
  })
  assert.equal(result.code, 75)
  assert.equal(result.report.status, "waiting")
  assert.equal(result.report.cleanup, "passed")
  assert.equal(result.report.taskStarted, false)
  assert.equal(await exists(join(root, ".reinit/started")), false)
  assert.equal(await exists(join(root, ".reinit/guard.lock")), false)
  assert.equal(await fingerprint(root), before)
  await writeFile(join(root, "changed.txt"), "new source")
  await assert.rejects(
    runResourceGuard(root, parseGuardArguments(["--guard", `--resume=${result.report.id}`]), { probe: async () => healthy() }),
    /Source changed/,
  )
  await rm(root, { recursive: true })
})

test("source changes during the resource wait fail before any task can start", async () => {
  const root = await fixture()
  let samples = 0
  const result = await runResourceGuard(root, parseGuardArguments(["--guard", "test"]), {
    probe: async () => {
      if (++samples === resourcePolicy.startupSamples) await writeFile(join(root, "changed.txt"), "concurrent source change")
      return healthy()
    },
    startupIntervalMs: 0,
  })
  assert.equal(result.report.status, "failed")
  assert.equal(result.report.taskStarted, false)
  assert.equal(result.report.cleanup, "passed")
  assert.match(result.report.failure!, /Source changed while waiting/)
  assert.equal(await exists(join(root, ".reinit/started")), false)
  await rm(root, { recursive: true })
})

test("runtime pressure stops the owned writer, preserves evidence, enforces cooldown and safely retries", async () => {
  const root = await fixture(),
    before = await fingerprint(root)
  const result = await runResourceGuard(root, parseGuardArguments(["--guard", "test"]), {
    probe: async () =>
      (await exists(join(root, ".reinit/started"))) ? { ...healthy(), memoryPressureNormal: false } : healthy(),
    startupIntervalMs: 0,
    runtimeIntervalMs: 10,
  })
  assert.equal(result.code, 75)
  assert.equal(result.report.status, "resource-stopped")
  assert.equal(result.report.cleanup, "passed")
  const pid = Number(await readFile(join(root, ".reinit/started"), "utf8"))
  assert.throws(
    () => process.kill(pid, 0),
    (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH",
  )
  const writer = join(root, ".reinit/writer")
  const contents = await readFile(writer, "utf8").catch(() => "")
  await delay(50)
  assert.equal(await readFile(writer, "utf8").catch(() => ""), contents)
  assert.equal(await fingerprint(root), before)
  const resume = parseGuardArguments(["--guard", `--resume=${result.report.id}`])
  await assert.rejects(runResourceGuard(root, resume, { probe: async () => healthy() }), /cooldown/)
  const saved = await readFile(join(result.report.runDir, "report.json"), "utf8")
  const previous = process.env.BROWSER_CLIENT_GUARD_FIXTURE_FINISH
  try {
    process.env.BROWSER_CLIENT_GUARD_FIXTURE_FINISH = "1"
    const retry = await runResourceGuard(root, resume, {
      probe: async () => healthy(),
      now: () => Date.now() + resourcePolicy.cooldownMs + 1000,
      startupIntervalMs: 0,
    })
    assert.equal(retry.code, 0)
    assert.equal(retry.report.resumeOf, result.report.id)
    assert.notEqual(retry.report.runDir, result.report.runDir)
  } finally {
    if (previous === undefined) delete process.env.BROWSER_CLIENT_GUARD_FIXTURE_FINISH
    else process.env.BROWSER_CLIENT_GUARD_FIXTURE_FINISH = previous
  }
  assert.equal(await readFile(join(result.report.runDir, "report.json"), "utf8"), saved)
  assert.equal((await readdir(join(root, ".reinit/verification"))).length, 2)
  await rm(root, { recursive: true })
})

test("an active or unknown guard lock never starts another task", async () => {
  const root = await fixture()
  await mkdir(join(root, ".reinit/guard.lock"), { recursive: true })
  const owner = JSON.stringify({ pid: process.pid, token: "fixture", id: "guard-1793010000000-1234abcd" })
  await writeFile(join(root, ".reinit/guard.lock/owner.json"), owner)
  await assert.rejects(
    runResourceGuard(root, parseGuardArguments(["--guard", "test"]), { probe: async () => healthy() }),
    /already running/,
  )
  assert.equal(await exists(join(root, ".reinit/started")), false)
  assert.equal(await readFile(join(root, ".reinit/guard.lock/owner.json"), "utf8"), owner)
  await rm(root, { recursive: true })
})

test("a dead guard lock is retained in its old report; uncertain commands prevent reclamation", async (t) => {
  for (const uncertain of [false, true])
    await t.test(String(uncertain), async () => {
      const root = await fixture()
      const child = spawnSync(process.execPath, ["-e", ""], { timeout: 5000 })
      assert.equal(child.status, 0)
      const scope = createCommandScope({})
      if (!uncertain) scope.attach(child.pid)
      scope.retain()
      const id = "guard-1793010000000-1234abcd",
        runDir = join(root, ".reinit/verification", id)
      await mkdir(runDir, { recursive: true })
      await mkdir(join(root, ".reinit/guard.lock"))
      const owner = { pid: child.pid, token: "fixture", id, scopePath: scope.path }
      // Uncertain registration remains represented by a starting child record.
      if (uncertain) {
        scope.attach(child.pid)
        createCommandScope(scope.env).retain()
      }
      await writeFile(join(root, ".reinit/guard.lock/owner.json"), JSON.stringify(owner))
      const original = JSON.stringify({ ...owner, ownerPid: child.pid, runDir })
      await writeFile(join(runDir, "report.json"), original)
      const args = parseGuardArguments(["--guard", "--wait-ms=1", "test"])
      const dependencies = {
        probe: async () => {
          throw new Error("unavailable")
        },
        now: (() => {
          let n = 0
          return () => n++
        })(),
        startupIntervalMs: 0,
      }
      if (uncertain) {
        await assert.rejects(runResourceGuard(root, args, dependencies), /registration is uncertain/)
        assert.equal(await exists(join(root, ".reinit/guard.lock/reclaim.json")), false)
        assert.deepEqual(JSON.parse(await readFile(join(root, ".reinit/guard.lock/owner.json"), "utf8")), owner)
      } else {
        assert.equal((await runResourceGuard(root, args, dependencies)).report.status, "waiting")
        assert((await readdir(runDir)).some((name) => name.startsWith("reclaimed-lock-")))
        assert.equal(await exists(join(root, ".reinit/guard.lock")), false)
      }
      assert.equal(await readFile(join(runDir, "report.json"), "utf8"), original)
      assert.equal(await exists(join(root, ".reinit/started")), false)
      scope.discard() // Fixture only; the recorded process already exited.
      await rm(root, { recursive: true })
    })
})

test("a real command failure is never resumable as a resource pause", async () => {
  const root = await fixture()
  await writeFile(join(root, "probe.mts"), "process.exitCode = 9")
  const result = await runResourceGuard(root, parseGuardArguments(["--guard", "test"]), {
    probe: async () => healthy(),
    startupIntervalMs: 0,
    runtimeIntervalMs: 10,
  })
  assert.equal(result.code, 1)
  assert.equal(result.report.status, "failed")
  assert.equal(result.report.cleanup, "passed")
  assert.match(result.report.failure!, /Verification failed/)
  await assert.rejects(
    runResourceGuard(root, parseGuardArguments(["--guard", `--resume=${result.report.id}`])),
    /Only safely stopped/,
  )
  await rm(root, { recursive: true })
})

test("an unavailable runtime probe stops owned work instead of assuming healthy resources", async () => {
  const root = await fixture()
  const result = await runResourceGuard(root, parseGuardArguments(["--guard", "test"]), {
    probe: async () => {
      if (await exists(join(root, ".reinit/started"))) throw new Error("Observation timed out")
      return healthy()
    },
    startupIntervalMs: 0,
    runtimeIntervalMs: 10,
  })
  assert.equal(result.report.status, "resource-stopped")
  assert.equal(result.report.cleanup, "passed")
  assert.match(result.report.failure!, /probe unavailable/)
  const pid = Number(await readFile(join(root, ".reinit/started"), "utf8"))
  assert.throws(
    () => process.kill(pid, 0),
    (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH",
  )
  assert.equal(await exists(join(root, ".reinit/guard.lock")), false)
  await rm(root, { recursive: true })
})
