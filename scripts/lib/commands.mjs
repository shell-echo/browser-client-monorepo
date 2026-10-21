import { execFile, spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import { commandFailure } from "./command-diagnostics.mjs"
import { createCommandScope } from "./command-scopes.mjs"

const alive = (pid) => {
  if (!pid) return false
  if (!Number.isSafeInteger(pid) || pid < 2 || pid === process.pid || pid === process.ppid)
    throw new Error(`Refusing to signal an invalid owned process identifier: ${pid}`)
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0)
    return true
  } catch (error) {
    if (error.code === "ESRCH") return false
    // A group containing only a just-exited child may briefly return EPERM on
    // macOS until the close event reaps it. Keep waiting; never assume exit.
    if (error.code === "EPERM") return true
    throw error
  }
}

async function killTree(pid, signal) {
  if (!alive(pid)) return
  if (process.platform === "win32") {
    await new Promise((resolve, reject) =>
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], (error) => {
        if (error && alive(pid)) reject(error)
        else resolve()
      }),
    )
  } else {
    try {
      process.kill(-pid, signal)
    } catch (error) {
      if (error.code !== "ESRCH") throw error
    }
  }
}

const scopeAlive = (scope) => scope.records().some((record) => record.state === "starting" || alive(record.pid))

async function signalScope(scope, signal) {
  for (const record of scope.records()) await killTree(record.pid, signal)
}

async function waitForExit(scope, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (scopeAlive(scope) && Date.now() < deadline) await delay(30)
  return !scopeAlive(scope)
}

export function positiveTimeout(value, fallback, label = "Timeout") {
  const timeout = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647)
    throw new Error(`${label} must be a positive integer in milliseconds`)
  return timeout
}

// Own every process we start, including descendants that outlive their parent.
// Nested runners register their detached groups in an inherited private scope.
// Settle only after all registered groups and the command's streams exit.
export function createCommandRunner({ cwd, env = {}, timeoutMs = 180_000, graceMs = 5_000 } = {}) {
  const active = new Set()
  let cancelled
  let disposed = false
  const check = () => {
    if (cancelled) throw cancelled
    if (disposed) throw new Error("Command runner is closed")
  }
  const start = (command, args = [], options = {}) => {
    check()
    const limit = options.timeoutMs ?? timeoutMs
    if (limit !== 0) positiveTimeout(limit, timeoutMs)
    const scope = createCommandScope()
    let child
    try {
      child = spawn(command, args, {
        cwd: options.cwd ?? cwd,
        shell: false,
        detached: process.platform !== "win32",
        env: { ...process.env, ...env, ...options.env, ...scope.env },
        stdio: options.stdio ?? (options.capture ? ["ignore", "pipe", "inherit"] : "inherit"),
      })
    } catch (error) {
      scope.discard()
      throw error
    }
    let registrationError
    try {
      scope.attach(child.pid)
    } catch (error) {
      registrationError = error
      registrationError.unsafeToRestore = true
    }
    let output = "",
      reason,
      spawnError,
      stopping,
      timer
    let closedResolve
    const closed = new Promise((resolve) => {
      closedResolve = resolve
    })
    let doneResolve, doneReject
    const done = new Promise((resolve, reject) => {
      doneResolve = resolve
      doneReject = reject
    })
    // Long-running services may finish before their caller awaits them.
    void done.catch(() => {})
    if (options.capture)
      child.stdout?.on("data", (chunk) => {
        output += chunk
      })
    child.once("error", (error) => {
      spawnError = error
    })

    const stop = (cause) => {
      reason ??= cause
      if (stopping) return stopping
      stopping = (async () => {
        clearTimeout(timer)
        try {
          scope.stopping()
          await signalScope(scope, "SIGTERM")
        } catch (error) {
          // Even when ownership storage is unreadable, stop the direct group
          // we created. Unknown nested groups still prohibit restoration.
          await killTree(child.pid, "SIGKILL")
          await waitForExit({ records: () => [{ pid: child.pid }] }, graceMs)
          throw error
        }
        if (!(await waitForExit(scope, graceMs))) {
          await signalScope(scope, "SIGKILL")
          if (!(await waitForExit(scope, graceMs)))
            throw new Error(`Cannot confirm the process tree has exited: ${command} (${child.pid}); ownership: ${scope.path}`)
        }
        let closeTimer
        try {
          await Promise.race([
            closed,
            new Promise((_, reject) => {
              closeTimer = setTimeout(
                () => reject(new Error(`Process streams did not close: ${command} (${child.pid})`)),
                graceMs,
              )
            }),
          ])
        } finally {
          clearTimeout(closeTimer)
        }
        scope.settle()
      })()
      void stopping.catch((error) => {
        error.unsafeToRestore = true
        doneReject(error)
      })
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
          else await stop()
          doneResolve({ code, signal, error: spawnError, reason, output: output.trim() })
          active.delete(handle)
        } catch (error) {
          doneReject(error)
        }
      })()
    })
    if (limit)
      timer = setTimeout(() => {
        void stop(new Error(`${command} ${args.join(" ")} Timed out (${limit}ms)`)).catch(() => {})
      }, limit)
    if (registrationError) void stop(registrationError).catch(() => {})
    return handle
  }
  const run = async (command, args, options) => {
    const result = await start(command, args, options).done
    if (result.reason) throw result.reason
    if (result.error) throw result.error
    if (result.code !== 0) throw commandFailure(command, args, result, { ...process.env, ...env, ...options?.env })
    return result.output
  }
  const cancel = (reason = new Error("Operation cancelled")) => {
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
    runner.cancel(new Error(`Operation cancelled (${signal})`))
    onCancel(signal)
  }
  process.on("SIGINT", listener)
  process.on("SIGTERM", listener)
  return () => {
    process.off("SIGINT", listener)
    process.off("SIGTERM", listener)
  }
}
