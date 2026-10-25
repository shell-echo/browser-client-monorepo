import type { BrowserContext, Worker, Page } from "playwright"
import type { CommandHandle, BrowserConfig } from "./lib/contracts.mts"
import type { MaintenanceReport } from "./lib/contracts.mts"
import { toError } from "./lib/contracts.mts"
import assert from "node:assert/strict"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { copySource, exists, fingerprint, ignored } from "./lib/workspace.mts"
import { handleCancellation, positiveTimeout } from "./lib/commands.mts"
import { createVerificationRunner, finishVerification } from "./lib/verification.mts"
import { readApplications, selectApplications } from "./lib/apps.mts"
import { chooseTheme, verifyThemes } from "./lib/theme-verification.mts"
import { loadApplicationBrowserConfig, prepareHmrUpdate } from "./lib/browser-config.mts"
import { assertTestPortAvailable, serverLogReady } from "./lib/test-ports.mts"

const root = fileURLToPath(new URL("../", import.meta.url))
const selected = selectApplications(await readApplications(root), process.argv[2])[0]
assert(selected?.type === "extension", "Expected a registered extension instance")
const runDir = resolve(process.argv[3] ?? join(root, ".reinit/verification", `extension-${selected.id}-${Date.now()}`))
const workspace = join(runDir, "workspace")
const app = join(workspace, selected.path)
const port = positiveTimeout(process.env.EXTENSION_TEST_PORT, 3102, "EXTENSION_TEST_PORT")
assert(port < 65536, "EXTENSION_TEST_PORT must be less than 65536")
const report: MaintenanceReport & { runDir: string; checks: string[]; errors: string[] } = {
  appId: selected.id,
  checks: [],
  errors: [],
  runDir,
  startedAt: new Date().toISOString(),
}
const runner = createVerificationRunner({
  cwd: workspace,
  logDir: runDir,
  report,
  timeoutMs: positiveTimeout(process.env.EXTENSION_TEST_COMMAND_TIMEOUT_MS, 180_000, "EXTENSION_TEST_COMMAND_TIMEOUT_MS"),
})
const { start, run, until, phase } = runner
let server: CommandHandle | undefined, context: BrowserContext | undefined
let config: { extension: BrowserConfig["extension"] }
const removeSignalHandlers = handleCancellation(runner, () => {
  console.error("Cancellation requested; closing the browser and test processes.")
  void context?.close().catch(() => {})
})
const originalFingerprint = await fingerprint(root)
report.sourceFingerprint = originalFingerprint
await mkdir(workspace, { recursive: true })

function passed(message: string) {
  report.checks.push(message)
  console.log(`✓ ${message}`)
}

async function launch(directory: string, profile: string) {
  const context = await phase(`Launch Chromium: ${profile}`, () =>
    chromium.launchPersistentContext(join(runDir, profile), {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
    }),
  )
  context.on("page", (page) => {
    page.on("pageerror", (error) => report.errors.push(`${profile}: ${error.message}`))
    page.on("console", (message) => {
      if (message.type() === "error") report.errors.push(`${profile}: ${message.text()}`)
    })
  })
  return context
}

async function extensionPages(context: BrowserContext) {
  let worker: Worker | undefined
  await until(() => {
    worker = context.serviceWorkers().find((item) => item.url().startsWith("chrome-extension://"))
    return Boolean(worker)
  }, "Extension service worker")
  assert(worker, "Production extension worker is missing")
  const id = new URL(worker.url()).host
  const popup = await context.newPage()
  await popup.setViewportSize({ width: 360, height: 280 })
  await popup.goto(`chrome-extension://${id}/index.html`)
  await config.extension.verifyPage({ page: popup, kind: "popup" })
  await verifyIdentity(popup)
  const opened = context.waitForEvent("page")
  await popup.evaluate(() => chrome.runtime.openOptionsPage())
  const options = await opened
  await options.waitForURL(`chrome-extension://${id}/options.html`)
  await options.setViewportSize({ width: 1280, height: 900 })
  await config.extension.verifyPage({ page: options, kind: "options" })
  await verifyIdentity(options)
  await config.extension.verifyBackground({ page: options, until })
  return { popup, options }
}

async function verifyIdentity(page: Page) {
  assert.equal(
    await page.locator("html").getAttribute("data-app-namespace"),
    selected.instanceId,
    "Extension shell lost its instance namespace",
  )
  assert.equal(
    await page.locator("html").getAttribute("data-app-legacy"),
    String(selected.legacy),
    "Extension shell changed its legacy preference policy",
  )
}

async function storageRoundTrip(popup: Page, options: Page, name: string) {
  const key = "__browser_client_verification__"
  await options.evaluate(({ key, name }) => chrome.storage.local.set({ [key]: name }), { key, name })
  assert.equal(await options.evaluate(async (key) => (await chrome.storage.local.get(key))[key], key), name)
  await popup.reload()
  await config.extension.verifyPage({ page: popup, kind: "popup" })
  assert.equal(await popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key], key), name)
  await options.evaluate((key) => chrome.storage.local.remove(key), key)
}

try {
  await assertTestPortAvailable(port)
  await phase("Source copy", async () => {
    for (const name of await readdir(root)) {
      if (!ignored(name)) await copySource(join(root, name), join(workspace, name), { root })
    }
  })
  await run("git", ["init", "--quiet"], "git.log")
  await run("pnpm", ["install", "--offline", "--frozen-lockfile"], "install.log")
  const loaded = await loadApplicationBrowserConfig(workspace, selected)
  assert(loaded.extension)
  config = { extension: loaded.extension }
  await run("node", ["scripts/check-extension-compat.mts", selected.id], "compat.log")
  server = start(
    "pnpm",
    ["--filter", selected.packageName, "dev"],
    "dev.log",
    { APP_DEV_PORT: String(port), APP_INSTANCE_ID: selected.id },
    0,
  )
  await phase("Development server ready", () =>
    until(
      async () => {
        assert.equal(server!.child.exitCode, null, `Development server exited: ${join(runDir, "dev.log")}`)
        if (!(await serverLogReady(join(runDir, "dev.log")))) return false
        return (
          (await exists(join(app, "dist-dev/manifest.json"))) &&
          (await fetch(`http://127.0.0.1:${port}/@vite/client`, { signal: AbortSignal.timeout(2000) })).ok
        )
      },
      "Development output and Vite server",
      60_000,
    ),
  )
  context = await launch(join(app, "dist-dev"), "profile-dev")
  runner.check()
  const launchedBrowser = context.browser()
  assert(launchedBrowser)
  report.chromium = launchedBrowser.version()
  const { popup, options } = await phase("Development pages and storage", async () => {
    assert(context)
    const pages = await extensionPages(context)
    await storageRoundTrip(pages.popup, pages.options, "Development storage test")
    return pages
  })
  if (config.extension.verifyInteractions) {
    await phase("Development settings interactions", () =>
      config.extension.verifyInteractions!({ popup, options, until, runDir, profile: "development" }),
    )
    passed("Development popup / options settings, validation, persistence, synchronization and failure recovery passed")
  }
  await popup.screenshot({ path: join(runDir, "extension-popup.png"), fullPage: true })
  passed("Development extension loaded; configured popup / options, background initialization and storage round trip passed")
  await phase("Development themes", () =>
    verifyThemes(options, { peer: popup, errors: report.errors, screenshot: join(runDir, "extension-dev-dark.png") }),
  )
  passed("Development extension themes, popup / options synchronization, persistence and system preference passed")

  const hmrUpdate = await prepareHmrUpdate(workspace, config.extension.hmr, selected.path)
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
  await phase("Extension React HMR", async () => {
    await hmrUpdate.apply()
    await config.extension.hmr.verify({ page: options, popup })
    await preserved()
  })
  passed("Extension React HMR retained theme state without storage persistence or a full page reload")

  await phase("Shared component HMR", async () => {
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
  })
  passed("Shared shadcn/ui Button HMR updated popup / options and retained React state")

  await phase("Shared style HMR", async () => {
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
  })
  passed("Shared Tailwind / UI style HMR retained React state")
  await context.close()
  context = undefined
  await server.stop()
  server = undefined
  for (let i = 0; i < paths.length; i++) await writeFile(join(workspace, paths[i]), originals[i])
  await hmrUpdate.restore()

  await run("pnpm", ["--filter", selected.packageName, "build"], "build.log")
  await run("node", ["scripts/check-extension.mts", selected.id], "production-check.log")
  context = await launch(join(app, "dist"), "profile-production")
  runner.check()
  const network: string[] = []
  context.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url())
  })
  const production = await phase("Production pages and storage", async () => {
    assert(context)
    const pages = await extensionPages(context)
    await storageRoundTrip(pages.popup, pages.options, "Production storage test")
    return pages
  })
  if (config.extension.verifyInteractions) {
    await phase("Production settings interactions", () =>
      config.extension.verifyInteractions!({ ...production, until, runDir, profile: "production" }),
    )
    passed("Production popup / options settings, validation, persistence, synchronization and failure recovery passed")
  }
  await phase("Production themes", () =>
    verifyThemes(production.options, {
      peer: production.popup,
      errors: report.errors,
      screenshot: join(runDir, "extension-production-dark.png"),
    }),
  )
  passed("Production extension themes and page synchronization passed under strict CSP without inline scripts")
  assert.deepEqual(network, [], "Production extension requested external HTTP resources")
  assert.deepEqual(report.errors, [], "Browser runtime errors detected")
  passed(
    "Production extension loaded independently after stopping the dev server; background, popup, options and storage passed without external HTTP requests or runtime errors",
  )
  if (config.extension.verifyPreview) {
    server = start(
      "pnpm",
      ["--filter", selected.packageName, "preview:ui"],
      "preview.log",
      { APP_DEV_PORT: String(port), APP_INSTANCE_ID: selected.id },
      0,
    )
    await phase("Browser preview ready", () =>
      until(
        async () => {
          assert.equal(server!.child.exitCode, null, "Preview server exited early")
          return (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })).ok
        },
        "Extension browser preview",
        60_000,
      ),
    )
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}/`)
    await verifyIdentity(page)
    await phase("Browser preview settings", () => config.extension.verifyPreview!({ page, until, runDir }))
    assert.deepEqual(report.errors, [], "Browser preview runtime errors detected")
    passed("Ordinary browser popup / options preview, separate settings persistence and responsive layouts passed")
  }
  assert.equal(await fingerprint(root), originalFingerprint, "Test changed the original workspace source")
  passed("Browser test only modified a temporary copy; original workspace source is unchanged")
  report.status = "passed"
} catch (caught) {
  const error = toError(caught)
  report.status = "failed"
  report.failure = error.stack
  throw error
} finally {
  await finishVerification(report, [() => context?.close(), runner.close, removeSignalHandlers])
}
