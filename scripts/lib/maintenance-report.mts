import type { MaintenanceReport, PhaseEntry } from "./contracts.mts"
import { toError } from "./contracts.mts"
import { lstat, mkdir, readdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export function formatBytes(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let index = 0
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024
    index++
  }
  return `${bytes.toFixed(index ? 1 : 0)} ${units[index]}`
}

// Apparent file sizes, not promised reclaimed blocks: pnpm uses hard links and
// APFS may share extents. Never follow links outside private maintenance data.
export async function summarizeMaintenance(
  state: string,
  candidates: { path: string }[] = [],
  { signal }: { signal?: AbortSignal } = {},
) {
  const eligible = new Set(candidates.map(({ path }) => path))
  const usage = {
    totalBytes: 0,
    eligibleBytes: 0,
    retainedBytes: 0,
    files: 0,
    categories: Object.create(null) as Record<string, number>,
  }
  async function visit(path: string): Promise<number> {
    signal?.throwIfAborted()
    const stat = await lstat(path)
    let bytes = 0
    if (stat.isDirectory()) {
      for (const name of await readdir(path)) bytes += await visit(join(path, name))
    } else {
      bytes = stat.size
      usage.files++
    }
    if (eligible.has(path)) usage.eligibleBytes += bytes
    return bytes
  }
  try {
    const stat = await lstat(state)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Maintenance state must be a real directory")
  } catch (caught) {
    const error = toError(caught)
    if (error.code === "ENOENT") return usage
    throw error
  }
  for (const name of await readdir(state)) {
    const bytes = await visit(join(state, name))
    usage.categories[name] = bytes
    usage.totalBytes += bytes
  }
  usage.retainedBytes = usage.totalBytes - usage.eligibleBytes
  return usage
}

export function createPhaseReporter({
  report,
  log = console.log,
  heartbeatMs = 30_000,
}: {
  report: MaintenanceReport
  log?: (message: string) => void
  heartbeatMs?: number
}) {
  const phases = (report.phases ??= [])
  async function phase<T>(name: string, work: () => T | Promise<T>, { timeoutMs }: { timeoutMs?: number } = {}): Promise<T> {
    const started = performance.now()
    const entry: PhaseEntry = {
      name,
      status: "running",
      startedAt: new Date().toISOString(),
      ...(timeoutMs ? { timeoutMs } : {}),
    }
    phases.push(entry)
    const budget = timeoutMs ? `; limit ${(timeoutMs / 1000).toFixed(1)}s` : ""
    log(`${name}: running${budget}`)
    const heartbeat = setInterval(() => {
      log(`${name}: still running (${((performance.now() - started) / 1000).toFixed(1)}s${budget})`)
    }, heartbeatMs)
    heartbeat.unref()
    try {
      const result = await work()
      entry.status = "passed"
      return result
    } catch (caught) {
      const error = toError(caught)
      entry.status = "failed"
      entry.failure = error.message
      throw error
    } finally {
      clearInterval(heartbeat)
      entry.durationMs = Math.round(performance.now() - started)
      entry.finishedAt = new Date().toISOString()
      log(`${name}: ${entry.status} (${(entry.durationMs / 1000).toFixed(1)}s)`)
    }
  }
  return { phase }
}

export function createMaintenanceReport({
  path,
  details = {},
  log = console.log,
}: {
  path: string
  details?: Record<string, unknown>
  log?: (message: string) => void
}) {
  const start = performance.now()
  const report: MaintenanceReport = { ...details, startedAt: new Date().toISOString(), phases: [] }
  const { phase } = createPhaseReporter({ report, log })
  async function finish(status: string, extra: Record<string, unknown> = {}) {
    Object.assign(report, extra, {
      status,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - start),
    })
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const stat = await lstat(dirname(path))
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Report directory must be a real directory")
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 })
    await rename(temporary, path)
    log(`Maintenance ${status} in ${((report.durationMs ?? 0) / 1000).toFixed(1)}s. Report: ${path}`)
    return report
  }
  return { phase, finish }
}
