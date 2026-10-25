import assert from "node:assert/strict"
import { mkdir, readdir, readFile, writeFile, rm, lstat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Browser } from "playwright"
import { readApplications, readVersions } from "./lib/apps.mts"
import { copySource, fingerprint, ignored } from "./lib/workspace.mts"
import { createVerificationRunner, finishVerification } from "./lib/verification.mts"
import { handleCancellation } from "./lib/commands.mts"
import { preservedSnapshot } from "./lib/reinit-acceptance.mts"
import { assertTestPortAvailable, serverLogReady } from "./lib/test-ports.mts"
import type { MaintenanceReport } from "./lib/contracts.mts"

const root = fileURLToPath(new URL("../", import.meta.url))
const runDir = join(resolve(process.env.BROWSER_TEST_OUTPUT_ROOT ?? join(root, ".reinit/verification")), `apps-${Date.now()}`)
const workspace = join(runDir, "workspace")
const report: MaintenanceReport & { runDir: string; checks: string[] } = {
  runDir,
  checks: [],
  startedAt: new Date().toISOString(),
}
const runner = createVerificationRunner({
  cwd: workspace,
  logDir: runDir,
  report,
  timeoutMs: 1_800_000,
  env: { NEXT_TELEMETRY_DISABLED: "1", TURBO_TELEMETRY_DISABLED: "1" },
})
let browser: Browser | undefined
const dispose = handleCancellation(runner, () => {
  void browser?.close().catch(() => {})
})
const passed = (message: string) => {
  report.checks.push(message)
  console.log(`✓ ${message}`)
}
const run = (args: string[], log: string) => runner.run("pnpm", args, log)

try {
  const baseline = await fingerprint(root)
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  // This is a fresh, disposable composition, never a modification of the
  // caller's registry, business applications or protected removal archives.
  for (const name of await readdir(root))
    if (!ignored(name)) await copySource(join(root, name), join(workspace, name), { root })
  await rm(join(workspace, "apps"), { recursive: true })
  await mkdir(join(workspace, "apps"))
  await writeFile(join(workspace, "apps/.gitkeep"), await readFile(join(root, "apps/.gitkeep")))
  await writeFile(join(workspace, "apps.config.json"), JSON.stringify({ schemaVersion: 1, apps: {} }))
  const records = await readVersions(workspace)
  records.applications = {}
  records.dependencies!.entries = records.dependencies!.entries.filter((entry) => !entry.location?.path?.startsWith("apps/"))
  await writeFile(join(workspace, "template-versions.json"), JSON.stringify(records))
  await runner.run("git", ["init", "--quiet"], "git.log")
  await run(["install", "--offline", "--no-frozen-lockfile"], "empty-install.log")
  await run(["exec", "prettier", "--write", "apps.config.json"], "empty-format.log")
  await run(["check"], "empty-check.log")
  await run(["test:browser"], "empty-browser.log")
  assert.deepEqual(await readApplications(workspace), [])
  passed("Empty composition installs and checks shared packages; browser coverage explicitly reports not applicable")

  for (const [id, type, port] of [
    ["console", "admin", 5210],
    ["studio", "admin", 5211],
    ["website", "web", 3010],
    ["portal", "web", 3011],
    ["addon", "extension", 5214],
    ["companion", "extension", 5215],
  ] as const) {
    await run(["app", "add", id, "--type", type, "--port", String(port), "--apply"], `add-${id}.log`)
    const apps = await readApplications(workspace)
    const app = apps.find((app) => app.id === id)!
    assert.equal(app.type, type)
    assert.equal(app.port, port)
    assert.equal(app.legacy, false)
    assert.equal(new Set(apps.map((app) => app.instanceId)).size, apps.length)
    passed(`Official-template addition ${id} (${type}) passed full workspace and browser gates`)
  }

  // Cookies are shared across localhost ports. Two real Admin instances must
  // preserve independent sidebar preferences in the very same browser context.
  const services = []
  for (const [id, port] of [
    ["console", 3210],
    ["studio", 3211],
  ] as const) {
    await assertTestPortAvailable(port)
    const log = `isolation-${id}.log`
    const server = runner.start(
      "pnpm",
      [
        "--filter",
        `@browser-client/${id}`,
        "exec",
        "vite",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ],
      log,
      {},
      0,
    )
    services.push(server)
    await runner.until(
      async () => {
        assert.equal(server.child.exitCode, null)
        return (
          (await serverLogReady(join(runDir, log))) &&
          (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2000) })).ok
        )
      },
      `${id} isolation server`,
      60_000,
    )
  }
  browser = await chromium.launch({ channel: "chromium", headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const first = await context.newPage(),
    second = await context.newPage()
  const sidebar = '[data-slot="sidebar"][data-state]'
  await first.goto("http://127.0.0.1:3210/dashboard")
  await first.locator(`${sidebar}[data-state="expanded"]`).waitFor()
  await first.getByRole("button", { name: "Toggle Sidebar", exact: true }).click()
  await first.locator(`${sidebar}[data-state="collapsed"]`).waitFor({ state: "attached" })
  await second.goto("http://127.0.0.1:3211/dashboard")
  await second.locator(`${sidebar}[data-state="expanded"]`).waitFor()
  await second.getByRole("button", { name: "Toggle Sidebar", exact: true }).click()
  await second.locator(`${sidebar}[data-state="collapsed"]`).waitFor({ state: "attached" })
  await second.getByRole("button", { name: "Toggle Sidebar", exact: true }).click()
  await second.locator(`${sidebar}[data-state="expanded"]`).waitFor()
  await first.reload()
  await first.locator(`${sidebar}[data-state="collapsed"]`).waitFor({ state: "attached" })
  assert.equal((await context.cookies()).filter((cookie) => cookie.name.startsWith("sidebar_state_")).length, 2)
  await browser.close()
  browser = undefined
  for (const server of services) await server.stop()
  passed("Two Admin instances on the same hostname retain separate sidebar cookies in one real browser context")

  const source = join(workspace, "apps/portal/public/composition-private.txt")
  await writeFile(source, "business archive probe\n", { mode: 0o600 })
  const beforeRemoval = (await readApplications(workspace)).find((app) => app.id === "portal")!
  await run(["app", "remove", "portal", "--apply", "--offline"], "remove.log")
  assert(!(await readApplications(workspace)).some((app) => app.id === "portal"))
  const archiveIds = await readdir(join(workspace, ".reinit/archives"))
  assert.equal(archiveIds.length, 1)
  await run(["app", "restore", archiveIds[0], "--apply", "--offline"], "restore.log")
  assert.deepEqual(
    (await readApplications(workspace)).find((app) => app.id === "portal"),
    beforeRemoval,
  )
  assert.equal(await readFile(source, "utf8"), "business archive probe\n")
  assert.equal((await lstat(source)).mode & 0o777, 0o600, "Restore changed private source permissions")
  passed(
    "Offline removal and restoration preserve archived business files, ports and identities without overwriting the workspace lockfile",
  )

  const preserved = await preservedSnapshot(workspace)
  const identities = await readApplications(workspace)
  await run(["reinit", "--apply", "--offline"], "offline-reinit.log")
  assert.deepEqual(await preservedSnapshot(workspace), preserved)
  assert.deepEqual(await readApplications(workspace), identities)
  passed("Six-instance offline reinit preserves source and identity with complete per-instance browser coverage")

  // Kill the actual maintenance owner in the node_modules rename gap, then
  // bootstrap recovery using only Node built-ins and execute final checks.
  const beforeRecovery = await fingerprint(workspace)
  const script =
    'import {runMaintenance} from "./scripts/lib/maintenance.mts";await runMaintenance(process.cwd(),{kind:"reinit",ids:["console"]},true,{boundary(name){if(name==="promotion:original-moved:node_modules")process.kill(process.pid,"SIGKILL")}})'
  const interrupted = await runner.start(process.execPath, ["--input-type=module", "-e", script], "interrupted.log").done
  assert.equal(interrupted.signal, "SIGKILL")
  const owner = JSON.parse(await readFile(join(workspace, ".reinit/lock/owner.json"), "utf8"))
  assert.equal(owner.processesStopped, true)
  await runner.run(process.execPath, ["scripts/app.mts", "recover", owner.id, "--apply"], "recovery.log")
  assert.equal(await fingerprint(workspace), beforeRecovery)
  passed(
    "SIGKILL during real dependency replacement recovers original files and passes checks without relying on missing dependencies",
  )
  assert.equal(await fingerprint(root), baseline, "Composition acceptance changed the user's project")
  report.status = "passed"
} catch (error) {
  report.status = "failed"
  report.failure = error instanceof Error ? error.stack : String(error)
  throw error
} finally {
  await finishVerification(report, [() => browser?.close(), runner.close, dispose])
}
