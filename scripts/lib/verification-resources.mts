import assert from "node:assert/strict"
import { getPriority, setPriority } from "node:os"

// Opt-in only. Nested maintenance and browser copies inherit the same profile.
export function lowResourceVerification(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.BROWSER_CLIENT_LOW_RESOURCE
  assert(value === undefined || value === "1", "BROWSER_CLIENT_LOW_RESOURCE must be 1 or unset")
  return value === "1"
}

export function lowResourceEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...environment,
    BROWSER_CLIENT_LOW_RESOURCE: "1",
    TURBO_CONCURRENCY: "1",
    RAYON_NUM_THREADS: "1",
    UV_THREADPOOL_SIZE: "1",
    GOMAXPROCS: "1",
  }
}

export function lowerVerificationPriority() {
  // Lower this wrapper only; its children inherit the scheduling priority.
  // Failure stops startup instead of silently running at normal priority.
  setPriority(0, 19)
  return getPriority()
}

export function verificationTestConcurrency(environment: NodeJS.ProcessEnv = process.env) {
  return lowResourceVerification(environment) ? 1 : 2
}

export function withVerificationResources<T extends { experimental?: { cpus?: number; memoryBasedWorkersCount?: boolean } }>(
  config: T,
  environment: NodeJS.ProcessEnv = process.env,
): T {
  if (!lowResourceVerification(environment)) return config
  return {
    ...config,
    experimental: { ...config.experimental, cpus: 1, memoryBasedWorkersCount: false },
  }
}

const tasks = new Set([
  "check",
  "test",
  "test:browser",
  "test:web-admin",
  "test:extension",
  "test:reinit",
  "test:apps",
  "test:accessibility",
  "audit:security",
  "lint:scripts",
  "typecheck:scripts",
  "format:check",
])

export function verificationTask(args: string[]) {
  const [task, ...rest] = args
  assert(tasks.has(task), "Choose a supported verification task; see pnpm verify:low --help")
  const instanceTask = ["test:browser", "test:web-admin", "test:extension"].includes(task)
  assert(rest.length <= (instanceTask ? 1 : 0), "Unexpected verification arguments")
  if (rest.length)
    assert(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(rest[0]) && rest[0].length <= 48, "Invalid verification instance")
  return [task, ...rest]
}
