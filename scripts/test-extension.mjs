import assert from "node:assert/strict"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { copySource, exists, fingerprint, ignored } from "./lib/workspace.mjs"
import { handleCancellation, positiveTimeout } from "./lib/commands.mjs"
import { createVerificationRunner, finishVerification } from "./lib/verification.mjs"
import { chooseTheme, verifyThemes } from "./lib/theme-verification.mjs"
import { loadBrowserConfig, prepareHmrUpdate } from "./lib/browser-config.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const runDir = join(resolve(process.env.BROWSER_TEST_OUTPUT_ROOT ?? join(root, ".reinit/verification")), `crxjs-${Date.now()}`)
const workspace = join(runDir, "workspace")
const app = join(workspace, "apps/extension")
const port = positiveTimeout(process.env.EXTENSION_TEST_PORT, 3102, "EXTENSION_TEST_PORT")
assert(port < 65536, "EXTENSION_TEST_PORT must be less than 65536")
const report = { checks: [], errors: [], runDir, startedAt: new Date().toISOString() }
const runner = createVerificationRunner({
  cwd: workspace,
  logDir: runDir,
  timeoutMs: positiveTimeout(process.env.EXTENSION_TEST_COMMAND_TIMEOUT_MS, 180_000, "EXTENSION_TEST_COMMAND_TIMEOUT_MS"),
})
const { start, run, until } = runner
let server, context, config
const removeSignalHandlers = handleCancellation(runner, () => {
  console.error("Cancellation requested; closing the browser and test processes.")
  void context?.close().catch(() => {})
})
const originalFingerprint = await fingerprint(root)
await mkdir(workspace, { recursive: true })

function passed(message) {
  report.checks.push(message)
  console.log(`✓ ${message}`)
}

async function launch(directory, profile) {
  const context = await chromium.launchPersistentContext(join(runDir, profile), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
  })
  context.on("page", (page) => {
    page.on("pageerror", (error) => report.errors.push(`${profile}: ${error.message}`))
    page.on("console", (message) => {
      if (message.type() === "error") report.errors.push(`${profile}: ${message.text()}`)
    })
  })
  return context
}

async function extensionPages(context) {
  let worker
  await until(() => {
    worker = context.serviceWorkers().find((item) => item.url().startsWith("chrome-extension://"))
    return Boolean(worker)
  }, "Extension service worker")
  const id = new URL(worker.url()).host
  const popup = await context.newPage()
  await popup.setViewportSize({ width: 360, height: 280 })
  await popup.goto(`chrome-extension://${id}/index.html`)
  await config.extension.verifyPage({ page: popup, kind: "popup" })
  const opened = context.waitForEvent("page")
  await popup.evaluate(() => chrome.runtime.openOptionsPage())
  const options = await opened
  await options.waitForURL(`chrome-extension://${id}/options.html`)
  await options.setViewportSize({ width: 1280, height: 900 })
  await config.extension.verifyPage({ page: options, kind: "options" })
  await config.extension.verifyBackground({ page: options, until })
  return { popup, options }
}

async function storageRoundTrip(popup, options, name) {
  const key = "__browser_client_verification__"
  await options.evaluate(({ key, name }) => chrome.storage.local.set({ [key]: name }), { key, name })
  assert.equal(await options.evaluate(async (key) => (await chrome.storage.local.get(key))[key], key), name)
  await popup.reload()
  await config.extension.verifyPage({ page: popup, kind: "popup" })
  assert.equal(await popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key], key), name)
  await options.evaluate((key) => chrome.storage.local.remove(key), key)
}

try {
  for (const name of await readdir(root)) {
    if (!ignored(name)) await copySource(join(root, name), join(workspace, name), { root })
  }
  await run("git", ["init", "--quiet"], "git.log")
  await run("pnpm", ["install", "--offline", "--frozen-lockfile"], "install.log")
  config = await loadBrowserConfig(workspace)
  await run("node", ["scripts/check-extension-compat.mjs"], "compat.log")
  server = start("pnpm", ["--filter", "@browser-client/extension", "dev"], "dev.log", { EXTENSION_DEV_PORT: String(port) }, 0)
  await until(
    async () => {
      assert.equal(server.child.exitCode, null, `Development server exited: ${join(runDir, "dev.log")}`)
      return (
        (await exists(join(app, "dist-dev/manifest.json"))) &&
        (await fetch(`http://127.0.0.1:${port}/@vite/client`, { signal: AbortSignal.timeout(2000) })).ok
      )
    },
    "Development output and Vite server",
    60_000,
  )
  context = await launch(join(app, "dist-dev"), "profile-dev")
  runner.check()
  report.chromium = context.browser().version()
  const { popup, options } = await extensionPages(context)
  await storageRoundTrip(popup, options, "Development storage test")
  await popup.screenshot({ path: join(runDir, "extension-popup.png"), fullPage: true })
  passed("Development extension loaded; configured popup / options, background initialization and storage round trip passed")
  await verifyThemes(options, { peer: popup, errors: report.errors, screenshot: join(runDir, "extension-dev-dark.png") })
  passed("Development extension themes, popup / options synchronization, persistence and system preference passed")

  const hmrUpdate = await prepareHmrUpdate(workspace, config.extension.hmr)
  const paths = ["packages/ui/src/components/button.tsx", "packages/ui/src/styles/globals.css"]
  const originals = await Promise.all(paths.map((path) => readFile(join(workspace, path), "utf8")))
  await options.emulateMedia({ colorScheme: "light" })
  // An unavailable storage backend makes the selected theme a real React-only
  // state probe: remounting the provider cannot restore dark mode from disk.
  await options.evaluate(() => {
    window.__hmrSentinel = "same-document"
    Object.defineProperty(window, "localStorage", {
      get: () => {
        throw new DOMException("Storage disabled", "SecurityError")
      },
    })
  })
  await chooseTheme(options, "dark")
  const background = await options.evaluate(() => getComputedStyle(document.body).backgroundColor)
  let navigations = 0
  options.on("framenavigated", (frame) => {
    if (frame === options.mainFrame()) navigations++
  })
  const preserved = async () => {
    assert(
      await options.locator("html").evaluate((element) => element.classList.contains("dark")),
      "HMR lost React theme state",
    )
    assert.equal(await options.evaluate(() => getComputedStyle(document.body).backgroundColor), background)
    await options.getByRole("button", { name: "Toggle theme", exact: true }).click()
    assert.equal(await options.getByRole("menuitemradio", { name: "Dark", exact: true }).getAttribute("aria-checked"), "true")
    await options.keyboard.press("Escape")
    assert.equal(await options.evaluate(() => window.__hmrSentinel), "same-document")
    assert.equal(navigations, 0, "HMR caused a full page reload")
  }
  await hmrUpdate.apply()
  await config.extension.hmr.verify({ page: options, popup })
  await preserved()
  passed("Extension React HMR retained theme state without storage persistence or a full page reload")

  assert(originals[0].includes('data-slot="button"'))
  await writeFile(
    join(workspace, paths[0]),
    originals[0].replace('data-slot="button"', 'data-slot="button" data-hmr-shared="updated"'),
  )
  await options
    .getByRole("button", { name: "Toggle theme", exact: true })
    .and(options.locator('[data-hmr-shared="updated"]'))
    .waitFor()
  await popup
    .getByRole("button", { name: "Toggle theme", exact: true })
    .and(popup.locator('[data-hmr-shared="updated"]'))
    .waitFor()
  await preserved()
  passed("Shared shadcn/ui Button HMR updated popup / options and retained React state")

  await writeFile(
    join(workspace, paths[1]),
    `${originals[1]}\n[data-slot="dropdown-menu-trigger"] { border-top-width: 7px !important; }\n`,
  )
  await until(
    () =>
      options
        .getByRole("button", { name: "Toggle theme", exact: true })
        .evaluate((button) => getComputedStyle(button).borderTopWidth === "7px"),
    "Shared theme CSS HMR",
  )
  await preserved()
  passed("Shared Tailwind / UI style HMR retained React state")
  await context.close()
  context = undefined
  await server.stop()
  server = undefined
  for (let i = 0; i < paths.length; i++) await writeFile(join(workspace, paths[i]), originals[i])
  await hmrUpdate.restore()

  await run("pnpm", ["--filter", "@browser-client/extension", "build"], "build.log")
  await run("node", ["scripts/check-extension.mjs"], "production-check.log")
  context = await launch(join(app, "dist"), "profile-production")
  runner.check()
  const network = []
  context.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url())
  })
  const production = await extensionPages(context)
  await storageRoundTrip(production.popup, production.options, "Production storage test")
  await verifyThemes(production.options, {
    peer: production.popup,
    errors: report.errors,
    screenshot: join(runDir, "extension-production-dark.png"),
  })
  passed("Production extension themes and page synchronization passed under strict CSP without inline scripts")
  assert.deepEqual(network, [], "Production extension requested external HTTP resources")
  assert.deepEqual(report.errors, [], "Browser runtime errors detected")
  passed(
    "Production extension loaded independently after stopping the dev server; background, popup, options and storage passed without external HTTP requests or runtime errors",
  )
  assert.equal(await fingerprint(root), originalFingerprint, "Test changed the original workspace source")
  passed("Browser test only modified a temporary copy; original workspace source is unchanged")
  report.status = "passed"
} catch (error) {
  report.status = "failed"
  report.failure = error.stack
  throw error
} finally {
  await finishVerification(report, [() => context?.close(), runner.close, removeSignalHandlers])
}
