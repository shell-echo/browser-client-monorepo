import assert from "node:assert/strict"
import { test } from "node:test"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { getPriority, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createCommandRunner } from "../lib/commands.mts"
import { createVerificationRunner, finishVerification } from "../lib/verification.mts"
import type { MaintenanceReport } from "../lib/contracts.mts"
import {
  lowResourceEnvironment,
  lowResourceVerification,
  verificationTask,
  verificationTestConcurrency,
  withVerificationResources,
} from "../lib/verification-resources.mts"

const root = fileURLToPath(new URL("../../", import.meta.url))
async function fixture(t: import("node:test").TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "browser-client-low-resource-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test("resource limits opt in explicitly without mutating normal configuration or caller environment", () => {
  const environment = Object.freeze({ CUSTOM: "preserved", NODE_OPTIONS: "--enable-source-maps", TURBO_CONCURRENCY: "9" })
  const limited = lowResourceEnvironment(environment)
  for (const name of ["TURBO_CONCURRENCY", "RAYON_NUM_THREADS", "UV_THREADPOOL_SIZE", "GOMAXPROCS"])
    assert.equal(limited[name], "1")
  assert.equal(limited.CUSTOM, environment.CUSTOM)
  assert.equal(limited.NODE_OPTIONS, environment.NODE_OPTIONS)
  assert.equal(environment.TURBO_CONCURRENCY, "9")
  assert.equal(lowResourceVerification(environment), false)
  assert.equal(verificationTestConcurrency(environment), 2)
  assert.equal(verificationTestConcurrency(limited), 1)
  for (const invalid of ["0", "true", "", "2"])
    assert.throws(() => lowResourceVerification({ BROWSER_CLIENT_LOW_RESOURCE: invalid }), /must be 1 or unset/)

  const config = Object.freeze({
    transpilePackages: ["shared-ui"],
    experimental: Object.freeze({ cpus: 8, memoryBasedWorkersCount: true, customFutureOption: "preserved" }),
    turbopack: { rules: { "*.css": { loaders: ["upstream-loader"] } } },
  })
  assert.equal(withVerificationResources(config, environment), config)
  const low = withVerificationResources(config, limited)
  assert.equal(low.experimental.cpus, 1)
  assert.equal(low.experimental.memoryBasedWorkersCount, false)
  assert.equal(low.experimental.customFutureOption, "preserved")
  assert.equal(low.turbopack, config.turbopack)
  assert.equal(config.experimental.cpus, 8)
})

test("low-resource entry accepts verification only and rejects development, writes and argument injection", () => {
  for (const task of ["check", "test", "test:apps", "test:reinit", "typecheck:scripts", "format:check"])
    assert.deepEqual(verificationTask([task]), [task])
  for (const task of ["test:browser", "test:extension", "test:web-admin"])
    assert.deepEqual(verificationTask([task, "console"]), [task, "console"])
  for (const args of [
    [],
    ["dev"],
    ["reinit", "--apply"],
    ["test:browser", "--skip"],
    ["test:browser", "invalid--id"],
    ["test:browser", "x".repeat(49)],
    ["test", "--test-only"],
    ["check", "extra"],
  ])
    assert.throws(() => verificationTask(args))
})

test("real low-resource CLI propagates environment and scheduling priority into a dependency-free child", async (t) => {
  const directory = await fixture(t)
  await mkdir(join(directory, "scripts/lib"), { recursive: true })
  await cp(join(root, "scripts/verify-low-resource.mts"), join(directory, "scripts/verify-low-resource.mts"))
  for (const name of [
    "commands",
    "command-scopes",
    "command-diagnostics",
    "contracts",
    "verification-resources",
    "resource-guard",
    "resource-probes",
    "workspace",
  ])
    await cp(join(root, "scripts/lib", `${name}.mts`), join(directory, "scripts/lib", `${name}.mts`))
  await writeFile(join(directory, "package.json"), JSON.stringify({ private: true, scripts: { test: "node probe.mts" } }))
  await writeFile(
    join(directory, "probe.mts"),
    `import {writeFileSync} from 'node:fs'; import {getPriority} from 'node:os';
writeFileSync('child.json', JSON.stringify({priority: getPriority(), marker: process.env.BROWSER_CLIENT_LOW_RESOURCE,
turbo: process.env.TURBO_CONCURRENCY, rayon: process.env.RAYON_NUM_THREADS, uv: process.env.UV_THREADPOOL_SIZE, go: process.env.GOMAXPROCS}));
process.exit(Number(process.env.PROBE_EXIT ?? 0));`,
  )
  const priority = getPriority()
  const marker = process.env.BROWSER_CLIENT_LOW_RESOURCE
  const runner = createCommandRunner({ cwd: directory, timeoutMs: 15_000 })
  t.after(() => runner.close())
  const entry = ["scripts/verify-low-resource.mts", "test"]
  await runner.run(process.execPath, entry, { stdio: "ignore" })
  const child = JSON.parse(await readFile(join(directory, "child.json"), "utf8"))
  assert.equal(child.priority, 19)
  assert.deepEqual(child, { priority: 19, marker: "1", turbo: "1", rayon: "1", uv: "1", go: "1" })
  assert.equal(getPriority(), priority)
  assert.equal(process.env.BROWSER_CLIENT_LOW_RESOURCE, marker)
  // A rejected child still fails the wrapper; the profile never conceals a gate failure.
  const failed = await runner.start(process.execPath, entry, { env: { PROBE_EXIT: "7" }, stdio: "ignore" }).done
  assert.equal(failed.code, 1)
})

test("actual Turbo strict-mode tasks run serially, inherit limits, and separate resource-mode cache keys", async (t) => {
  const directory = await fixture(t)
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  const config = JSON.parse(await readFile(join(root, "turbo.json"), "utf8"))
  await writeFile(join(directory, "package.json"), JSON.stringify({ private: true, packageManager: manifest.packageManager }))
  await writeFile(join(directory, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n")
  await writeFile(
    join(directory, "turbo.json"),
    JSON.stringify({ globalEnv: config.globalEnv, tasks: { probe: { cache: false } } }),
  )
  for (const id of ["one", "two"]) {
    const app = join(directory, "packages", id)
    await mkdir(app, { recursive: true })
    await writeFile(join(app, "package.json"), JSON.stringify({ name: id, scripts: { probe: "node probe.mts" } }))
    await writeFile(
      join(app, "probe.mts"),
      `import assert from 'node:assert/strict'; import {appendFileSync, openSync, closeSync, unlinkSync} from 'node:fs';
for (const key of ['BROWSER_CLIENT_LOW_RESOURCE', 'RAYON_NUM_THREADS', 'UV_THREADPOOL_SIZE', 'GOMAXPROCS']) assert.equal(process.env[key], '1', key);
const lock = '../../exclusive.lock'; const fd = openSync(lock, 'wx');
appendFileSync('../../events.log', '${id}:start\\n');
await new Promise(resolve => setTimeout(resolve, 300));
appendFileSync('../../events.log', '${id}:end\\n'); closeSync(fd); unlinkSync(lock);`,
    )
  }
  const runner = createCommandRunner({ cwd: directory, timeoutMs: 15_000 })
  t.after(() => runner.close())
  const turbo = join(root, "node_modules/turbo/bin/turbo")
  const environment = lowResourceEnvironment({ ...process.env, TURBO_TELEMETRY_DISABLED: "1" })
  const args = [turbo, "run", "probe", "--env-mode=strict"]
  await runner.run(process.execPath, args, { env: environment, stdio: "ignore" })
  const events = (await readFile(join(directory, "events.log"), "utf8")).trim().split("\n")
  assert.equal(events.length, 4)
  for (let index = 0; index < 4; index += 2) {
    const id = events[index].split(":")[0]
    assert.equal(events[index], `${id}:start`)
    assert.equal(events[index + 1], `${id}:end`, "Turbo ran verification tasks concurrently")
  }
  const normal = { ...environment }
  for (const key of ["BROWSER_CLIENT_LOW_RESOURCE", "RAYON_NUM_THREADS", "UV_THREADPOOL_SIZE", "GOMAXPROCS"])
    normal[key] = undefined
  const hashes: string[][] = []
  for (const env of [environment, normal]) {
    const dry = JSON.parse(await runner.run(process.execPath, [...args, "--dry=json"], { env, capture: true }))
    hashes.push(dry.tasks.map((task: { hash: string }) => task.hash))
  }
  assert(
    hashes[0].every((hash: string, index: number) => hash !== hashes[1][index]),
    "Resource modes shared cache keys",
  )
})

test("browser reports retain the active resource profile through cleanup", async (t) => {
  const directory = await fixture(t)
  const report: MaintenanceReport & { runDir: string } = { runDir: directory }
  const runner = createVerificationRunner({
    logDir: directory,
    report,
    env: lowResourceEnvironment(),
    timeoutMs: 5000,
  })
  t.after(() => runner.close())
  await runner.run(process.execPath, ["-e", "console.log(process.env.BROWSER_CLIENT_LOW_RESOURCE)"], "child.log")
  report.status = "passed"
  await finishVerification(report, [runner.close])
  assert.equal(JSON.parse(await readFile(join(directory, "report.json"), "utf8")).resourceMode, "low")
  assert.equal((await readFile(join(directory, "child.log"), "utf8")).trim(), "1")
})
