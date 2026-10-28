import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import { setTimeout as delay } from "node:timers/promises"

export interface ResourceSample {
  at: string
  memoryFreePercent: number
  memoryPressureNormal: boolean
  cpuIdlePercent?: number
  ownedRssMiB?: number
}
const execute = promisify(execFile)
export const resourcePolicy = Object.freeze({
  startupCpuIdle: 80,
  memoryFree: 40,
  startupSamples: 3,
  startupIntervalMs: 20_000,
  runtimeIntervalMs: 15_000,
  runtimeCpuHardFloor: 35,
  runtimeCpuSoftFloor: 50,
  runtimeCpuLowSamples: 2,
  ownedRssMiB: 2048,
  cooldownMs: 15 * 60_000,
})

export function macMemory(pressure: string, memory: string) {
  assert(/^[124]$/.test(pressure.trim()), "Cannot read macOS memory pressure")
  const match = /System-wide memory free percentage:\s*(\d+)%/.exec(memory)
  assert(match && Number(match[1]) <= 100, "Cannot read macOS memory availability")
  return { memoryFreePercent: Number(match[1]), memoryPressureNormal: pressure.trim() === "1" }
}
export function macCpu(top: string) {
  const samples = [...top.matchAll(/CPU usage:.*?(-?[\d.]+)% idle/g)]
  assert(samples.length === 2, "Expected two interval CPU samples from top")
  const idle = Number(samples[1][1])
  assert(Number.isFinite(idle) && idle >= 0 && idle <= 100, "Invalid interval CPU measurement")
  return idle
}
export function linuxMemory(memory: string, pressure: string) {
  const total = /^MemTotal:\s+(\d+) kB$/m.exec(memory)
  const available = /^MemAvailable:\s+(\d+) kB$/m.exec(memory)
  const full = /^full avg10=([\d.]+) /m.exec(pressure)
  assert(total && available && full, "Cannot read Linux available memory and PSI")
  const all = Number(total[1]),
    free = Number(available[1]),
    stalled = Number(full[1])
  assert(
    all > 0 && free >= 0 && free <= all && Number.isFinite(stalled) && stalled >= 0 && stalled <= 100,
    "Invalid Linux memory measurement",
  )
  return { memoryFreePercent: (free / all) * 100, memoryPressureNormal: stalled === 0 }
}
export function linuxTicks(source: string) {
  const match = /^cpu\s+([\d ]+)$/m.exec(source)
  assert(match, "Cannot read aggregate Linux CPU counters")
  const values = match[1].trim().split(/\s+/).map(Number)
  assert(values.length >= 8 && values.every((value) => Number.isSafeInteger(value) && value >= 0), "Invalid CPU counters")
  // guest / guest_nice are already included in user / nice.
  return { total: values.slice(0, 8).reduce((a, b) => a + b, 0), idle: values[3] + values[4] }
}
export function intervalCpu(before: ReturnType<typeof linuxTicks>, after: ReturnType<typeof linuxTicks>) {
  const total = after.total - before.total,
    idle = after.idle - before.idle
  assert(total > 0 && idle >= 0 && idle <= total, "CPU counters did not advance safely")
  return (idle / total) * 100
}
export function ownedMemory(source: string, owner: number) {
  const rows = source
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line)
      assert(match, "Cannot inspect owned process memory")
      const row = { pid: Number(match[1]), parent: Number(match[2]), rss: Number(match[3]) }
      assert(
        Object.values(row).every((value) => Number.isSafeInteger(value) && value >= 0),
        "Invalid process counters",
      )
      return row
    })
  assert(
    rows.some((row) => row.pid === owner),
    "Resource guard owner is absent from process observation",
  )
  const owned = new Set([owner])
  let size: number
  do {
    size = owned.size
    for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid)
  } while (size !== owned.size)
  return rows.filter((row) => owned.has(row.pid)).reduce((sum, row) => sum + row.rss, 0) / 1024
}

export function createResourceProbe(platform = process.platform, owner = process.pid): () => Promise<ResourceSample> {
  assert(["darwin", "linux"].includes(platform), "Resource guard supports macOS and Linux; plain verify:low remains available")
  return async () => {
    const memory =
      platform === "darwin"
        ? macMemory(
            (await execute("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { timeout: 5000 })).stdout,
            (await execute("memory_pressure", ["-Q"], { timeout: 5000 })).stdout,
          )
        : linuxMemory(await readFile("/proc/meminfo", "utf8"), await readFile("/proc/pressure/memory", "utf8"))
    const sample: ResourceSample = { at: new Date().toISOString(), ...memory }
    if (!memory.memoryPressureNormal || memory.memoryFreePercent < resourcePolicy.memoryFree) return sample
    if (platform === "darwin") {
      sample.cpuIdlePercent = macCpu(
        (await execute("top", ["-l", "2", "-s", "2", "-n", "0"], { timeout: 10_000, maxBuffer: 262144 })).stdout,
      )
    } else {
      const before = linuxTicks(await readFile("/proc/stat", "utf8"))
      await delay(2000)
      sample.cpuIdlePercent = intervalCpu(before, linuxTicks(await readFile("/proc/stat", "utf8")))
    }
    sample.ownedRssMiB = ownedMemory(
      (await execute("ps", ["-Ao", "pid=,ppid=,rss="], { timeout: 5000, maxBuffer: 2_097_152 })).stdout,
      owner,
    )
    return sample
  }
}

function validSample(sample: ResourceSample) {
  return (
    typeof sample.memoryPressureNormal === "boolean" &&
    Number.isFinite(sample.memoryFreePercent) &&
    sample.memoryFreePercent >= 0 &&
    sample.memoryFreePercent <= 100 &&
    (sample.cpuIdlePercent === undefined ||
      (Number.isFinite(sample.cpuIdlePercent) && sample.cpuIdlePercent >= 0 && sample.cpuIdlePercent <= 100)) &&
    (sample.ownedRssMiB === undefined || (Number.isFinite(sample.ownedRssMiB) && sample.ownedRssMiB >= 0))
  )
}
export function startupReady(sample: ResourceSample) {
  return (
    validSample(sample) &&
    sample.memoryPressureNormal &&
    sample.memoryFreePercent >= resourcePolicy.memoryFree &&
    sample.cpuIdlePercent !== undefined &&
    sample.cpuIdlePercent >= resourcePolicy.startupCpuIdle &&
    sample.ownedRssMiB !== undefined &&
    sample.ownedRssMiB <= resourcePolicy.ownedRssMiB
  )
}
export function runtimeReason(sample: ResourceSample, previousLow: number) {
  const low =
    sample.cpuIdlePercent !== undefined && sample.cpuIdlePercent < resourcePolicy.runtimeCpuSoftFloor ? previousLow + 1 : 0
  const reason = !validSample(sample)
    ? "probe-unavailable"
    : !sample.memoryPressureNormal || sample.memoryFreePercent < resourcePolicy.memoryFree
      ? "memory-pressure"
      : sample.cpuIdlePercent === undefined || sample.ownedRssMiB === undefined
        ? "probe-unavailable"
        : sample.cpuIdlePercent < resourcePolicy.runtimeCpuHardFloor || low >= resourcePolicy.runtimeCpuLowSamples
          ? "cpu-headroom"
          : sample.ownedRssMiB > resourcePolicy.ownedRssMiB
            ? "owned-memory"
            : undefined
  return { low, reason }
}
