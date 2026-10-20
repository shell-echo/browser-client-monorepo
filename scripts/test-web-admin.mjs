import assert from "node:assert/strict"
import { mkdir, readdir } from "node:fs/promises"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { handleCancellation, positiveTimeout } from "./lib/commands.mjs"
import { copySource, fingerprint, ignored } from "./lib/workspace.mjs"
import { createVerificationRunner, finishVerification } from "./lib/verification.mjs"
import { verifyThemes, verifyThemeBeforeHydration, verifyUnavailableStorage } from "./lib/theme-verification.mjs"
import { browserUrl, loadBrowserConfig } from "./lib/browser-config.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const runDir = join(
  resolve(process.env.BROWSER_TEST_OUTPUT_ROOT ?? join(root, ".reinit/verification")),
  `web-admin-${Date.now()}`,
)
const workspace = join(runDir, "workspace")
const report = { runDir, checks: [], errors: [], startedAt: new Date().toISOString() }
const port = (value, fallback, label) => {
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
  timeoutMs: positiveTimeout(process.env.WEB_ADMIN_TEST_COMMAND_TIMEOUT_MS, 300_000, "WEB_ADMIN_TEST_COMMAND_TIMEOUT_MS"),
  env: { NEXT_TELEMETRY_DISABLED: "1", TURBO_TELEMETRY_DISABLED: "1" },
})
let browser, originalFingerprint
const dispose = handleCancellation(runner, () => {
  void browser?.close().catch(() => {})
})
const passed = (message) => {
  report.checks.push(message)
  console.log(`✓ ${message}`)
}

async function freePort(port) {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once("error", reject)
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, resolve)
  })
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())))
}

async function pageFor(name, url) {
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
  assert.equal(response.status(), 200)
  return page
}

try {
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  originalFingerprint = await fingerprint(root)
  await freePort(webPort)
  await freePort(adminPort)
  for (const name of await readdir(root))
    if (!ignored(name)) await copySource(join(root, name), join(workspace, name), { root })
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
  ]) {
    await runner.until(
      async () => {
        assert.equal(server.child.exitCode, null, "Production server exited early; check the logs")
        return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok
      },
      `Production server ${url}`,
      60_000,
    )
  }
  browser = await chromium.launch({ channel: "chromium", headless: true })
  runner.check()
  report.chromium = browser.version()

  const webPage = await pageFor("web", webUrl)
  await config.web.verify({ page: webPage, browser, pageFor, url: webUrl, runDir, errors: report.errors, passed })
  await verifyThemes(webPage, { errors: report.errors, screenshot: join(runDir, "web-dark.png") })
  await verifyThemeBeforeHydration(browser, webUrl, false)
  passed("Web themes, persistence, tab synchronization, system changes and dark first paint before hydration passed")

  const adminPage = await pageFor("admin", adminUrl)
  await config.admin.verify({ page: adminPage, browser, pageFor, url: adminUrl, runDir, errors: report.errors, passed })
  await verifyThemes(adminPage, { errors: report.errors, screenshot: join(runDir, "admin-dark.png") })
  await verifyThemeBeforeHydration(browser, adminUrl, true)
  await verifyUnavailableStorage(adminPage)
  passed("Admin themes, persistence, tab synchronization, system changes, early first paint and unavailable storage passed")
  await config.admin.verifyRoutes({ pageFor, url: adminOrigin, runDir, errors: report.errors, passed })
  assert.deepEqual(report.errors, [], "Browser runtime, console or resource errors detected")
  passed("Web / Admin have no browser runtime, console or resource errors")
  assert.equal(await fingerprint(root), originalFingerprint, "Smoke test changed the original workspace source")
  passed("Smoke test used a temporary copy; original workspace source is unchanged")
  report.status = "passed"
} catch (error) {
  report.status = "failed"
  report.failure = error.stack
  for (const [index, page] of (browser?.contexts().flatMap((context) => context.pages()) ?? []).entries()) {
    await page.screenshot({ path: join(runDir, `failure-${index}.png`), fullPage: true, timeout: 5000 }).catch(() => {})
  }
  throw error
} finally {
  await finishVerification(report, [() => browser?.close(), runner.close, dispose])
}
