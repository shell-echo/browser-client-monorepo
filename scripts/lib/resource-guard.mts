import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, rm, writeFile, appendFile, rename } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { createCommandRunner, handleCancellation } from "./commands.mts"
import { createCommandScope, inspectCommandScope } from "./command-scopes.mts"
import { fingerprint, ensureRealDirectory, writeAtomicJson } from "./workspace.mts"
import { lowResourceEnvironment, verificationTask } from "./verification-resources.mts"
import { createResourceProbe, resourcePolicy, runtimeReason, startupReady } from "./resource-probes.mts"
import type { ResourceSample } from "./resource-probes.mts"

export interface GuardArguments {
  guard: boolean
  task: string[]
  resume?: string
  waitMs: number
}
export function parseGuardArguments(args: string[]): GuardArguments {
  let guard = false,
    resume: string | undefined,
    waitMs = 600_000
  const task: string[] = [],
    seen = new Set<string>()
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      task.push(arg)
      continue
    }
    const key = arg.split("=")[0]
    assert(!seen.has(key), `Duplicate guard option: ${key}`)
    seen.add(key)
    if (arg === "--guard") guard = true
    else if (arg.startsWith("--resume=")) {
      resume = arg.slice(9)
      assert(/^guard-\d{13}-[a-f0-9]{8}$/.test(resume), "Invalid guard report ID")
    } else if (/^--wait-ms=\d+$/.test(arg)) {
      waitMs = Number(arg.slice(10))
      assert(Number.isSafeInteger(waitMs) && waitMs >= 1 && waitMs <= 86_400_000, "Wait budget must be 1..86400000 ms")
    } else throw new Error(`Unknown guard option: ${arg}`)
  }
  assert(guard || (!resume && !seen.has("--wait-ms")), "Guard options require --guard")
  assert(!resume || task.length === 0, "Resume uses the recorded task; do not supply another task")
  return { guard, resume, task: resume ? [] : verificationTask(task), waitMs }
}

interface GuardReport {
  schemaVersion: 1
  id: string
  runDir: string
  sourceFingerprint: string
  platform: string
  node: string
  task: string[]
  status: "waiting" | "running" | "passed" | "failed" | "resource-stopped" | "cancelled"
  startedAt: string
  finishedAt?: string
  taskStarted: boolean
  cleanup: "pending" | "passed" | "failed"
  ownerPid: number
  scopePath?: string
  resumeOf?: string
  retryAfter?: string
  failure?: string
  policy: typeof resourcePolicy
}
interface GuardOwner {
  pid: number
  token: string
  id: string
  scopePath?: string
}
class ResourcePause extends Error {}
const gone = (pid: number, group = false) => {
  assert(Number.isSafeInteger(pid) && pid > 1, "Invalid guard process identity")
  try {
    process.kill(group ? -pid : pid, 0)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true
    if ((error as NodeJS.ErrnoException).code === "EPERM") return false
    throw error
  }
}
async function regularJson<T>(path: string): Promise<T> {
  const stat = await lstat(path)
  assert(stat.isFile() && !stat.isSymbolicLink(), `Expected a regular guard record: ${path}`)
  return JSON.parse(await readFile(path, "utf8")) as T
}
async function guardLock(root: string, owner: GuardOwner) {
  const lock = join(root, ".reinit/guard.lock"),
    marker = join(lock, "owner.json")
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const stat = await lstat(lock)
    assert(stat.isDirectory() && !stat.isSymbolicLink(), "Guard lock must be a real directory")
    const old = await regularJson<GuardOwner>(marker)
    assert(/^guard-\d{13}-[a-f0-9]{8}$/.test(old.id) && typeof old.token === "string", "Unknown guard owner; preserve the lock")
    assert(gone(old.pid), `Resource guard is already running (${old.pid}); see ${old.id}`)
    const claim = join(lock, "reclaim.json")
    await writeFile(claim, JSON.stringify({ pid: process.pid, token: owner.token }), { flag: "wx", mode: 0o600 })
    let moved = false
    try {
      const oldRun = join(root, ".reinit/verification", old.id)
      const stat = await lstat(oldRun)
      assert(stat.isDirectory() && !stat.isSymbolicLink(), "Old guard directory must be real")
      const report = await regularJson<GuardReport>(join(oldRun, "report.json"))
      assert(
        report.ownerPid === old.pid &&
          report.id === old.id &&
          report.runDir === oldRun &&
          report.scopePath === old.scopePath &&
          old.scopePath,
        "Guard ownership is incomplete; preserve the lock and command records",
      )
      assert.equal(
        (await regularJson<{ pid: number }>(join(old.scopePath, "owner.json"))).pid,
        old.pid,
        "Guard scope owner does not match the lock",
      )
      for (const record of inspectCommandScope(old.scopePath)) {
        assert(record.state !== "starting" && record.pid !== null, "Guard command registration is uncertain; preserve the lock")
        assert(gone(record.pid) && gone(record.pid, true), "A previous guard command may still be running; preserve the lock")
      }
      assert.deepEqual(await regularJson(marker), old, "Guard lock changed during inspection")
      // Preserve the old lock too. An exclusive claim prevents two observers
      // from moving or removing a newly acquired lock during reclamation.
      await rename(lock, join(oldRun, `reclaimed-lock-${owner.token}`))
      moved = true
      await mkdir(lock, { mode: 0o700 })
    } finally {
      if (!moved) await rm(claim)
    }
  }
  await writeFile(marker, JSON.stringify(owner), { flag: "wx", mode: 0o600 })
  return {
    async attach(scopePath: string) {
      owner.scopePath = scopePath
      await writeAtomicJson(marker, owner)
    },
    async release() {
      assert.deepEqual(await regularJson(marker), owner, "Guard lock changed; preserve the scene")
      await rm(lock, { recursive: true })
    },
  }
}

export interface GuardDependencies {
  probe?: () => Promise<ResourceSample>
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
  startupIntervalMs?: number
  runtimeIntervalMs?: number
}
export async function runResourceGuard(root: string, args: GuardArguments, dependencies: GuardDependencies = {}) {
  const probe = dependencies.probe ?? createResourceProbe()
  const sleep = dependencies.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }))
  const now = dependencies.now ?? Date.now
  const baseline = await fingerprint(root)
  let task = args.task
  if (args.resume) {
    const previousDir = join(root, ".reinit/verification", args.resume)
    const stat = await lstat(previousDir)
    assert(stat.isDirectory() && !stat.isSymbolicLink(), "Paused guard directory must be real")
    const previous = await regularJson<GuardReport>(join(previousDir, "report.json"))
    assert.equal(previous.schemaVersion, 1)
    assert.equal(previous.id, args.resume)
    assert.equal(previous.sourceFingerprint, baseline, "Source changed since the paused verification; start a new run")
    assert.equal(previous.platform, process.platform, "Guard platform changed")
    assert.equal(previous.node, process.version, "Node changed; start a new verification")
    assert(
      ["waiting", "resource-stopped", "cancelled"].includes(previous.status) && previous.cleanup === "passed",
      "Only safely stopped or startup-wait reports may resume; preserve unknown/failed scenes",
    )
    assert(
      !previous.retryAfter || now() >= Date.parse(previous.retryAfter),
      `Resource cooldown remains until ${previous.retryAfter}`,
    )
    task = verificationTask(previous.task)
  }
  task = verificationTask(task)
  await ensureRealDirectory(join(root, ".reinit"))
  await ensureRealDirectory(join(root, ".reinit/verification"))
  const id = `guard-${Date.now()}-${randomUUID().slice(0, 8)}`,
    runDir = join(root, ".reinit/verification", id)
  await mkdir(runDir, { mode: 0o700 })
  const report: GuardReport = {
    schemaVersion: 1,
    id,
    runDir,
    sourceFingerprint: baseline,
    platform: process.platform,
    node: process.version,
    task,
    status: "waiting",
    startedAt: new Date().toISOString(),
    taskStarted: false,
    cleanup: "pending",
    ownerPid: process.pid,
    resumeOf: args.resume,
    policy: resourcePolicy,
  }
  const save = () => writeAtomicJson(join(runDir, "report.json"), report)
  const lock = await guardLock(root, { id, pid: process.pid, token: randomUUID() })
  let scope: ReturnType<typeof createCommandScope> | undefined
  let runner: ReturnType<typeof createCommandRunner> | undefined
  let dispose: (() => void) | undefined,
    monitor: Promise<void> | undefined,
    monitorFailure: Error | undefined,
    commandFailure: Error | undefined
  const abort = new AbortController(),
    stopMonitoring = new AbortController()
  const observe = async () => {
    const sample = await probe()
    await appendFile(join(runDir, "resources.jsonl"), JSON.stringify(sample) + "\n")
    console.log(
      `Resource guard: idle=${sample.cpuIdlePercent?.toFixed(1) ?? "unmeasured"}%, memory=${sample.memoryFreePercent.toFixed(1)}%, pressure=${sample.memoryPressureNormal ? "normal" : "high"}`,
    )
    return sample
  }
  try {
    scope = createCommandScope(lowResourceEnvironment())
    scope.attach(process.pid)
    scope.retain()
    report.scopePath = scope.path
    await lock.attach(scope.path)
    runner = createCommandRunner({ cwd: root, env: { ...lowResourceEnvironment(), ...scope.env }, timeoutMs: 0 })
    dispose = handleCancellation(runner, () => abort.abort())
    await save()
    console.log(`Resource guard report: ${runDir}`)
    const deadline = now() + args.waitMs
    let ready = 0
    while (ready < resourcePolicy.startupSamples) {
      runner.check()
      abort.signal.throwIfAborted()
      try {
        ready = startupReady(await observe()) ? ready + 1 : 0
      } catch (error) {
        ready = 0
        await appendFile(
          join(runDir, "resources.jsonl"),
          JSON.stringify({ at: new Date().toISOString(), unavailable: String(error) }) + "\n",
        )
      }
      if (ready === resourcePolicy.startupSamples) break
      if (now() >= deadline) throw new ResourcePause("Resource window unavailable; resume this report later")
      await sleep(dependencies.startupIntervalMs ?? resourcePolicy.startupIntervalMs, abort.signal)
    }
    assert.equal(await fingerprint(root), baseline, "Source changed while waiting; no verification started")
    runner.check()
    report.taskStarted = true
    report.status = "running"
    await save()
    monitor = (async () => {
      let low = 0
      try {
        while (!stopMonitoring.signal.aborted) {
          await sleep(dependencies.runtimeIntervalMs ?? resourcePolicy.runtimeIntervalMs, stopMonitoring.signal)
          if (stopMonitoring.signal.aborted) break
          const state = runtimeReason(await observe(), low)
          low = state.low
          if (state.reason) throw new ResourcePause(`Resource protection: ${state.reason}; only owned commands are stopped`)
        }
      } catch (error) {
        if (!stopMonitoring.signal.aborted) {
          monitorFailure =
            error instanceof ResourcePause ? error : new ResourcePause(`Resource probe unavailable: ${String(error)}`)
          runner!.cancel(monitorFailure)
        }
      }
    })()
    const { createWriteStream } = await import("node:fs")
    const log = createWriteStream(join(runDir, "task.log"), { flags: "wx", mode: 0o600 })
    log.on("error", (error) => runner!.cancel(error))
    const handle = runner.start("pnpm", task, { stdio: ["ignore", "pipe", "pipe"] })
    // A host alarm during descendant/stream cleanup must not hide an earlier
    // real test failure. Cancellation initiated by the monitor is separate.
    handle.child.once("exit", (code, signal) => {
      if (!monitorFailure && !abort.signal.aborted && (code !== 0 || signal !== null))
        commandFailure = new Error(`Verification failed (${code ?? signal}); see ${join(runDir, "task.log")}`)
    })
    handle.child.once("error", (error) => {
      if (!monitorFailure) commandFailure = error
    })
    handle.child.stdout!.pipe(log, { end: false })
    handle.child.stderr!.pipe(log, { end: false })
    const closed = new Promise<void>((resolve, reject) => {
      log.once("finish", resolve)
      log.once("error", reject)
    })
    void closed.catch(() => {})
    handle.child.once("close", () => log.end())
    const result = await handle.done
    await closed
    stopMonitoring.abort()
    await monitor
    if (commandFailure) throw commandFailure
    if (monitorFailure || result.reason || result.error) throw monitorFailure ?? result.reason ?? result.error
    assert.equal(result.code, 0, `Verification failed (${result.code}); see ${join(runDir, "task.log")}`)
    assert.equal(await fingerprint(root), baseline, "Verification changed the original source")
    report.status = "passed"
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error)
    report.status = commandFailure
      ? "failed"
      : abort.signal.aborted
        ? "cancelled"
        : error instanceof ResourcePause
          ? report.taskStarted
            ? "resource-stopped"
            : "waiting"
          : "failed"
    if (["resource-stopped", "cancelled"].includes(report.status) && report.taskStarted)
      report.retryAfter = new Date(now() + resourcePolicy.cooldownMs).toISOString()
  } finally {
    stopMonitoring.abort()
    await monitor
    try {
      await runner?.close()
      scope?.settle()
      await lock.release()
      report.cleanup = "passed"
    } catch (error) {
      report.status = "failed"
      report.cleanup = "failed"
      report.failure = `Process cleanup unconfirmed; retain the guard lock and ownership evidence: ${String(error)}`
    }
    dispose?.()
    report.finishedAt = new Date().toISOString()
    await save()
  }
  console.log(`Guard status: ${report.status}; report=${id}`)
  if (report.failure) console.error(report.failure)
  return { code: report.status === "passed" ? 0 : ["waiting", "resource-stopped"].includes(report.status) ? 75 : 1, report }
}
