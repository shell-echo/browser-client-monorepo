import type { Browser } from "playwright"
import type { MaintenanceReport } from "./lib/contracts.mts"
import { toError } from "./lib/contracts.mts"
import assert from "node:assert/strict"
import { mkdir, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { handleCancellation } from "./lib/commands.mts"
import { readApplications, selectApplications } from "./lib/apps.mts"
import { copySource, fingerprint, ignored } from "./lib/workspace.mts"
import { createVerificationRunner, finishVerification } from "./lib/verification.mts"
import {
  verifyThemes,
  verifyThemeBeforeHydration,
  verifyUnavailableStorage,
  verifyInvalidWebTheme,
  verifyThemeWriteFailure,
  verifyThemeEventIsolation,
} from "./lib/theme-verification.mts"
import { browserUrl, loadApplicationBrowserConfig } from "./lib/browser-config.mts"
import { assertTestPortAvailable, serverLogReady } from "./lib/test-ports.mts"

const root = fileURLToPath(new URL("../", import.meta.url))
const app = selectApplications(await readApplications(root), process.argv[2])[0]
assert(app && app.type !== "extension", "Expected a registered Web/Admin instance")
const runDir = resolve(process.argv[3] ?? join(root, ".reinit/verification", `page-${app.id}-${Date.now()}`))
const workspace = join(runDir, "workspace")
const port = Number(app.type === "web" ? (process.env.WEB_TEST_PORT ?? 3150) : (process.env.ADMIN_TEST_PORT ?? 3151))
assert(Number.isSafeInteger(port) && port >= 1024 && port <= 65535, "Invalid browser test port")
const report: MaintenanceReport & { runDir: string; checks: string[]; errors: string[] } = {
  runDir,
  appId: app.id,
  checks: [],
  errors: [],
  startedAt: new Date().toISOString(),
}
const runner = createVerificationRunner({
  cwd: workspace,
  logDir: runDir,
  report,
  timeoutMs: 300_000,
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
async function pageFor(name: string, url: string) {
  assert(browser)
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on("pageerror", (error) => report.errors.push(`${name}: ${error.message}`))
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(`${name}: ${message.text()} ${message.location().url}`)
  })
  page.on("requestfailed", (request) => report.errors.push(`${name}: ${request.url()} ${request.failure()?.errorText}`))
  page.on("response", (response) => {
    if (response.status() >= 400) report.errors.push(`${name}: HTTP ${response.status()} ${response.url()}`)
  })
  const response = await page.goto(url, { waitUntil: "networkidle" })
  assert.equal(response?.status(), 200)
  assert.equal(
    await page.locator("html").getAttribute("data-app-namespace"),
    app.instanceId,
    "Application shell lost its instance namespace",
  )
  assert.equal(
    await page.locator("html").getAttribute("data-app-legacy"),
    String(app.legacy),
    "Application shell changed its legacy preference policy",
  )
  return page
}
try {
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  const baseline = await fingerprint(root)
  report.sourceFingerprint = baseline
  await assertTestPortAvailable(port)
  await runner.phase("Source copy", async () => {
    for (const name of await readdir(root))
      if (!ignored(name)) await copySource(join(root, name), join(workspace, name), { root })
  })
  await runner.run("git", ["init", "--quiet"], "git.log")
  await runner.run("pnpm", ["install", "--offline", "--frozen-lockfile"], "install.log")
  const config = (await loadApplicationBrowserConfig(workspace, app)).page
  assert(config)
  await runner.run("pnpm", ["exec", "turbo", "run", "build", `--filter=${app.packageName}`], "build.log")
  const origin = `http://127.0.0.1:${port}`
  const args =
    app.type === "web"
      ? ["next", "start", "--hostname", "127.0.0.1", "--port", String(port)]
      : ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"]
  const server = runner.start("pnpm", ["--filter", app.packageName, "exec", ...args], "server.log", {}, 0)
  await runner.phase("Production server ready", () =>
    runner.until(
      async () => {
        assert.equal(server.child.exitCode, null, "Production server exited early")
        if (!(await serverLogReady(join(runDir, "server.log")))) return false
        return (await fetch(origin, { signal: AbortSignal.timeout(2000) })).ok
      },
      origin,
      60_000,
    ),
  )
  browser = await chromium.launch({ channel: "chromium", headless: true })
  report.chromium = browser.version()
  const url = browserUrl(origin, config.path)
  const page = await pageFor(app.id, url)
  await runner.phase("Instance business assertions", () =>
    config.verify({ page, browser: browser!, pageFor, url, runDir, errors: report.errors, passed }),
  )
  await runner.phase("Shared themes and storage recovery", async () => {
    await verifyThemes(page, { errors: report.errors, screenshot: join(runDir, "dark.png") })
    await verifyThemeBeforeHydration(browser!, url, app.type !== "web")
    if (app.type === "web") {
      await verifyInvalidWebTheme(browser!, url)
      await verifyThemeWriteFailure(browser!, url)
    }
    await verifyUnavailableStorage(page)
    await verifyThemeEventIsolation(browser!, url)
  })
  passed("Themes retain persistence, system preference, first paint, storage-event isolation and unavailable-storage recovery")
  if (app.type === "admin") await config.verifyRoutes({ pageFor, url: origin, runDir, errors: report.errors, passed })
  assert.deepEqual(report.errors, [], "Browser runtime, console or resource errors detected")
  assert.equal(await fingerprint(root), baseline, "Browser test changed the source workspace")
  passed("Production browser assertions passed in an isolated workspace without source changes")
  report.status = "passed"
} catch (caught) {
  const error = toError(caught)
  report.status = "failed"
  report.failure = error.stack
  for (const [index, page] of (browser?.contexts().flatMap((context) => context.pages()) ?? []).entries())
    await page.screenshot({ path: join(runDir, `failure-${index}.png`), fullPage: true, timeout: 5000 }).catch(() => {})
  throw error
} finally {
  await finishVerification(report, [() => browser?.close(), runner.close, dispose])
}
