import type { Browser } from "playwright"
import type { MaintenanceReport } from "./lib/contracts.mts"
import { toError } from "./lib/contracts.mts"
import assert from "node:assert/strict"
import { mkdir, readdir } from "node:fs/promises"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { handleCancellation, positiveTimeout } from "./lib/commands.mts"
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
import { browserUrl, loadBrowserConfig } from "./lib/browser-config.mts"

const root = fileURLToPath(new URL("../", import.meta.url))
const runDir = join(
  resolve(process.env.BROWSER_TEST_OUTPUT_ROOT ?? join(root, ".reinit/verification")),
  `web-admin-${Date.now()}`,
)
const workspace = join(runDir, "workspace")
const report: MaintenanceReport & { runDir: string; checks: string[]; errors: string[] } = {
  runDir,
  checks: [],
  errors: [],
  startedAt: new Date().toISOString(),
}
const port = (value: string | undefined, fallback: number, label: string) => {
  const number = positiveTimeout(value, fallback, label)
  assert(number < 65536, `${label} must be less than 65536`)
  return number
}
const webPort = port(process.env.WEB_TEST_PORT, 3150, "WEB_TEST_PORT")
const adminPort = port(process.env.ADMIN_TEST_PORT, 3151, "ADMIN_TEST_PORT")
assert.notEqual(webPort, adminPort, "Web / Admin test ports must be different")
const runner = createVerificationRunner({
  cwd: workspace,
  logDir: runDir,
  report,
  timeoutMs: positiveTimeout(process.env.WEB_ADMIN_TEST_COMMAND_TIMEOUT_MS, 300_000, "WEB_ADMIN_TEST_COMMAND_TIMEOUT_MS"),
  env: { NEXT_TELEMETRY_DISABLED: "1", TURBO_TELEMETRY_DISABLED: "1" },
})
const { phase } = runner
let browser: Browser | undefined, originalFingerprint: string
const dispose = handleCancellation(runner, () => {
  void browser?.close().catch(() => {})
})
const passed = (message: string) => {
  report.checks.push(message)
  console.log(`✓ ${message}`)
}

async function freePort(port: number) {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject)
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, resolve)
  })
  await new Promise<void>((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())))
}

async function pageFor(name: string, url: string) {
  assert(browser, "Browser has not launched")
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on("pageerror", (error) => report.errors.push(`${name}: ${error.message}`))
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(`${name}: ${message.text()} ${message.location().url}`)
  })
  page.on("requestfailed", (request) =>
    report.errors.push(`${name}: ${request.method()} ${request.url()} ${request.failure()?.errorText}`),
  )
  page.on("response", (response) => {
    if (response.status() >= 400) report.errors.push(`${name}: HTTP ${response.status()} ${response.url()}`)
  })
  const response = await page.goto(url, { waitUntil: "networkidle" })
  assert(response)
  assert.equal(response.status(), 200)
  return page
}

try {
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  originalFingerprint = await fingerprint(root)
  await freePort(webPort)
  await freePort(adminPort)
  await phase("Source copy", async () => {
    for (const name of await readdir(root))
      if (!ignored(name)) await copySource(join(root, name), join(workspace, name), { root })
  })
  await runner.run("git", ["init", "--quiet"], "git.log")
  await runner.run("pnpm", ["install", "--offline", "--frozen-lockfile"], "install.log")
  const config = await loadBrowserConfig(workspace)
  const webUrl = browserUrl(`http://127.0.0.1:${webPort}`, config.web.path)
  const adminOrigin = `http://127.0.0.1:${adminPort}`
  const adminUrl = browserUrl(adminOrigin, config.admin.path)
  await runner.run(
    "pnpm",
    ["exec", "turbo", "run", "build", "--filter=@browser-client/web", "--filter=@browser-client/admin"],
    "build.log",
  )
  const web = runner.start(
    "pnpm",
    ["--filter", "@browser-client/web", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)],
    "web.log",
    {},
    0,
  )
  const admin = runner.start(
    "pnpm",
    [
      "--filter",
      "@browser-client/admin",
      "exec",
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(adminPort),
      "--strictPort",
    ],
    "admin.log",
    {},
    0,
  )
  for (const [server, url] of [
    [web, webUrl],
    [admin, adminUrl],
  ] as const) {
    await phase(`Production server ready: ${url}`, () =>
      runner.until(
        async () => {
          assert.equal(server.child.exitCode, null, "Production server exited early; check the logs")
          return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok
        },
        `Production server ${url}`,
        60_000,
      ),
    )
  }
  browser = await phase("Launch Chromium", () => chromium.launch({ channel: "chromium", headless: true }))
  runner.check()
  report.chromium = browser.version()

  const webPage = await pageFor("web", webUrl)
  await phase("Web page", () =>
    config.web.verify({ page: webPage, browser: browser!, pageFor, url: webUrl, runDir, errors: report.errors, passed }),
  )
  await phase("Web themes and storage recovery", async () => {
    await verifyThemes(webPage, { errors: report.errors, screenshot: join(runDir, "web-dark.png") })
    await verifyThemeBeforeHydration(browser!, webUrl, false)
    await verifyInvalidWebTheme(browser!, webUrl)
    await verifyThemeWriteFailure(browser!, webUrl)
    await verifyUnavailableStorage(webPage)
    await verifyThemeEventIsolation(browser!, webUrl)
  })
  passed(
    "Web ignores native sessionStorage and unknown-area theme events, including blocked storage, while retaining local preference and business events",
  )
  passed("Web storage quota failures preserve valid themes, recover invalid themes before hydration and allow switching")
  passed("Web invalid stored themes, early first paint, cross-tab recovery and cleared storage passed")
  passed("Web themes, persistence, tab synchronization, system changes and dark first paint before hydration passed")

  const adminPage = await pageFor("admin", adminUrl)
  await phase("Admin page", () =>
    config.admin.verify({ page: adminPage, browser: browser!, pageFor, url: adminUrl, runDir, errors: report.errors, passed }),
  )
  await phase("Admin themes and storage recovery", async () => {
    await verifyThemes(adminPage, { errors: report.errors, screenshot: join(runDir, "admin-dark.png") })
    await verifyThemeBeforeHydration(browser!, adminUrl, true)
    await verifyUnavailableStorage(adminPage)
    await verifyThemeEventIsolation(browser!, adminUrl)
  })
  passed("Admin ignores sessionStorage theme events without losing local preference synchronization or business events")
  passed("Admin themes, persistence, tab synchronization, system changes, early first paint and unavailable storage passed")
  await phase("Admin routes, responsive navigation and recovery", () =>
    config.admin.verifyRoutes({ pageFor, url: adminOrigin, runDir, errors: report.errors, passed }),
  )
  assert.deepEqual(report.errors, [], "Browser runtime, console or resource errors detected")
  passed("Web / Admin have no browser runtime, console or resource errors")
  assert.equal(await fingerprint(root), originalFingerprint, "Smoke test changed the original workspace source")
  passed("Smoke test used a temporary copy; original workspace source is unchanged")
  report.status = "passed"
} catch (caught) {
  const error = toError(caught)
  report.status = "failed"
  report.failure = error.stack
  for (const [index, page] of (browser?.contexts().flatMap((context) => context.pages()) ?? []).entries()) {
    await page.screenshot({ path: join(runDir, `failure-${index}.png`), fullPage: true, timeout: 5000 }).catch(() => {})
  }
  throw error
} finally {
  await finishVerification(report, [() => browser?.close(), runner.close, dispose])
}
