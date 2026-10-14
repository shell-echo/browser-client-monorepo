import { execFile, spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"

const alive = (child) => {
  if (!child.pid) return false
  if (process.platform === "win32") return child.exitCode === null && child.signalCode === null
  try { process.kill(-child.pid, 0); return true } catch (error) {
    if (error.code === "ESRCH") return false
    // A group containing only a just-exited child may briefly return EPERM on
    // macOS until the close event reaps it. Keep waiting; never assume exit.
    if (error.code === "EPERM") return true
    throw error
  }
}

async function killTree(child, signal) {
  if (!alive(child)) return
  if (process.platform === "win32") {
    await new Promise((resolve, reject) => execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], (error) => {
      if (error && alive(child)) reject(error)
      else resolve()
    }))
  } else {
    try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== "ESRCH") throw error }
  }
}

async function waitForExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (alive(child) && Date.now() < deadline) await delay(30)
  return !alive(child)
}

export function positiveTimeout(value, fallback, label = "超时") {
  const timeout = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new Error(`${label}必须为正整数毫秒`)
  return timeout
}

// Own every process we start, including descendants that outlive their parent.
// A command is settled only after its process group and streams have exited.
export function createCommandRunner({ cwd, env = {}, timeoutMs = 180_000, graceMs = 5_000 } = {}) {
  const active = new Set()
  let cancelled
  let disposed = false
  const check = () => {
    if (cancelled) throw cancelled
    if (disposed) throw new Error("命令执行器已关闭")
  }
  const start = (command, args = [], options = {}) => {
    check()
    const limit = options.timeoutMs ?? timeoutMs
    if (limit !== 0) positiveTimeout(limit, timeoutMs)
    const child = spawn(command, args, {
      cwd: options.cwd ?? cwd, shell: false, detached: process.platform !== "win32",
      env: { ...process.env, ...env, ...options.env },
      stdio: options.stdio ?? (options.capture ? ["ignore", "pipe", "inherit"] : "inherit"),
    })
    let output = "", reason, spawnError, stopping, timer
    let closedResolve
    const closed = new Promise((resolve) => { closedResolve = resolve })
    let doneResolve, doneReject
    const done = new Promise((resolve, reject) => { doneResolve = resolve; doneReject = reject })
    // Long-running services may finish before their caller awaits them.
    void done.catch(() => {})
    if (options.capture) child.stdout?.on("data", (chunk) => { output += chunk })
    child.once("error", (error) => { spawnError = error })

    const stop = (cause) => {
      reason ??= cause
      if (stopping) return stopping
      stopping = (async () => {
        clearTimeout(timer)
        await killTree(child, "SIGTERM")
        if (!await waitForExit(child, graceMs)) {
          await killTree(child, "SIGKILL")
          if (!await waitForExit(child, graceMs)) throw new Error(`无法确认进程树已退出：${command}（${child.pid}）`)
        }
        let closeTimer
        try {
          await Promise.race([closed, new Promise((_, reject) => {
            closeTimer = setTimeout(() => reject(new Error(`进程流未关闭：${command}（${child.pid}）`)), graceMs)
          })])
        } finally { clearTimeout(closeTimer) }
      })()
      void stopping.catch((error) => { error.unsafeToRestore = true; doneReject(error) })
      return stopping
    }
    const handle = { child, done, stop }
    active.add(handle)
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      closedResolve()
      void (async () => {
        try {
          if (stopping) await stopping
          else if (alive(child)) await stop()
          doneResolve({ code, signal, error: spawnError, reason, output: output.trim() })
          active.delete(handle)
        } catch (error) { doneReject(error) }
      })()
    })
    if (limit) timer = setTimeout(() => { void stop(new Error(`${command} ${args.join(" ")} 超时（${limit}ms）`)).catch(() => {}) }, limit)
    return handle
  }
  const run = async (command, args, options) => {
    const result = await start(command, args, options).done
    if (result.reason) throw result.reason
    if (result.error) throw result.error
    if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} 失败（${result.signal ?? result.code}）`)
    return result.output
  }
  const cancel = (reason = new Error("操作已取消")) => {
    cancelled ??= reason
    for (const handle of active) void handle.stop(cancelled).catch(() => {})
  }
  const close = async () => {
    disposed = true
    const results = await Promise.allSettled([...active].map((handle) => handle.stop()))
    const failed = results.find((result) => result.status === "rejected")
    if (failed) throw failed.reason
  }
  return { start, run, cancel, check, close }
}

export function handleCancellation(runner, onCancel = () => {}) {
  const listener = (signal) => {
    runner.cancel(new Error(`操作已取消（${signal}）`))
    onCancel(signal)
  }
  process.on("SIGINT", listener)
  process.on("SIGTERM", listener)
  return () => {
    process.off("SIGINT", listener)
    process.off("SIGTERM", listener)
  }
}
