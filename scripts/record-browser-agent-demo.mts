import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, writeFile, mkdir, stat } from "node:fs/promises"
import { createRequire, stripTypeScriptTypes } from "node:module"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright"
import { invokeBrowserAgentTool } from "../packages/browser-agent/src/tools.mts"
import { lowerVerificationPriority } from "./lib/verification-resources.mts"

// A real isolated browser, plus a separate read-only integration console.
// Decisions arrive one at a time from an external Agent/operator after it has
// inspected the extension's returned image. No target selectors choose actions.
const root = fileURLToPath(new URL("../", import.meta.url))
const directory = resolve(process.argv[2] ?? "")
assert(directory.startsWith(join(root, ".reinit/")), "Use a private .reinit recording directory")
await mkdir(directory, { recursive: true })
await mkdir(join(directory, "decisions"))
await writeFile(join(directory, "recording-start.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), {
  flag: "wx",
})
lowerVerificationPriority()
const goal =
  "Choose the release candidate marked Ready with zero failures. Save a local release note containing its product name, version and passed-check count. Scroll to Activity and verify the saved note."
const connectionCode = `import { createClient, chromeTransport }\n  from "@browser-client/extension-sdk";\n\nconst client = createClient({\n  connect: chromeTransport(extensionId)\n});\nawait client.connect();\nawait client.request("access.request", {\n  capabilities: ["page.observe", "page.click",\n    "page.type", "page.scroll"]\n});\n// The user approves the exact page.\nconst frame = await client.request(\n  "page.observe", { includeScreenshot: true }\n);`
interface Frame {
  id: string
  dataUrl: string
  width: number
  height: number
}
interface Event {
  name: string
  ok: boolean
  detail: string
}
const state = {
  revision: 0,
  live: false,
  hideIntro: false,
  chapter: "01 / TEMPLATE + CAPABILITY",
  title: "Your agent. Our browser tools.",
  subtitle: "Keep your agent and business UI. Reuse the extension's authorized execution boundary.",
  badge: "Real Chrome",
  code: "",
  goal: "",
  decision: "",
  result: "Production MV3 extension · isolated profile",
  boundary: "This take is driven by the current Codex Agent reading actual images. No external model API is simulated.",
  denied: false,
  frame: null as Frame | null,
  events: [] as Event[],
}
const source = new URL("./fixtures/", import.meta.url)
// Use the website's real tokens and font, rather than maintaining a demo palette.
const sharedTheme = await readFile(join(root, "packages/ui/src/styles/globals.css"), "utf8")
const darkTokens = /\.dark\s*\{([^}]+)\}/.exec(sharedTheme)?.[1]
const radius = /--radius:\s*([^;]+);/.exec(sharedTheme)?.[1]
assert(darkTokens && radius, "The shared website dark theme must be available")
const themeCss = `@font-face { font-family: "Inter Variable"; font-style: normal; font-weight: 100 900; font-display: swap; src: url("/inter.woff2") format("woff2"); }
:root { ${darkTokens} --radius: ${radius}; font-family: "Inter Variable", sans-serif; background: var(--background); color: var(--foreground); }
`
const uiRequire = createRequire(join(root, "packages/ui/package.json"))
const fontPath = uiRequire.resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")
const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:3000")
    response.setHeader("Cache-Control", "no-store")
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; connect-src 'self'",
    )
    if (url.pathname === "/state") {
      if (url.searchParams.get("after") === String(state.revision)) {
        response.writeHead(204)
        response.end()
        return
      }
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify(state))
      return
    }
    if (url.pathname === "/theme.css") {
      response.setHeader("Content-Type", "text/css; charset=utf-8")
      response.end(themeCss)
      return
    }
    if (url.pathname === "/inter.woff2") {
      response.setHeader("Content-Type", "font/woff2")
      response.end(await readFile(fontPath))
      return
    }
    const assets: Record<string, [string, string]> = {
      "/": ["browser-agent-demo.html", "text/html"],
      "/demo.css": ["browser-agent-demo.css", "text/css"],
      "/demo.js": ["browser-agent-demo.js", "text/javascript"],
      "/agent": ["browser-agent-console.html", "text/html"],
      "/console.css": ["browser-agent-console.css", "text/css"],
      "/console.js": ["browser-agent-console.js", "text/javascript"],
    }
    if (assets[url.pathname]) {
      const [name, mime] = assets[url.pathname]
      response.setHeader("Content-Type", `${mime}; charset=utf-8`)
      response.end(await readFile(new URL(name, source)))
      return
    }
    const modules: Record<string, string> = {
      "/sdk/client.mts": "packages/extension-sdk/src/client.mts",
      "/sdk/protocol.mts": "packages/extension-sdk/src/protocol.mts",
      "/sdk/browser-agent.mts": "packages/browser-agent/src/capabilities.mts",
      "/sdk/tools.mts": "packages/browser-agent/src/tools.mts",
    }
    if (modules[url.pathname]) {
      const text = (await readFile(join(root, modules[url.pathname]), "utf8")).replaceAll(
        '"@browser-client/browser-agent"',
        '"/sdk/browser-agent.mts"',
      )
      response.setHeader("Content-Type", "text/javascript; charset=utf-8")
      response.end(stripTypeScriptTypes(text, { mode: "strip" }))
      return
    }
    response.writeHead(url.pathname === "/favicon.ico" ? 204 : 404)
    response.end()
  })().catch(() => {
    response.writeHead(500)
    response.end("Demo asset failed")
  })
})
interface ToolResponse {
  ok: boolean
  code?: string
  message?: string
  result?: unknown
}
interface DemoApi {
  connect(id: string): Promise<unknown>
  requestAccess(): Promise<unknown>
  approved(): boolean
  tool(name: string, input: Record<string, unknown>): Promise<ToolResponse>
  close(): void
}
declare global {
  interface Window {
    browserAgentDemo: DemoApi
    browserAgentConsoleRevision?: number
    browserAgentAccessChanged?: (capabilities: string[]) => Promise<void>
  }
}
let context: BrowserContext | undefined, site: Page | undefined, consolePage: Page | undefined
let cancelled = false,
  targetStarted = 0,
  consoleStarted = 0
let frameCounter = 0,
  latestFrame: string | undefined
let actionRevision = 0,
  observedActionRevision = -1
const trace: unknown[] = [],
  segments: Record<string, unknown>[] = []
const report: Record<string, unknown> = {
  status: "running",
  startedAt: new Date().toISOString(),
  goal,
  headless: true,
  isolatedProfile: true,
  decisionMode: "External image-driven Agent/operator files; this take is driven by Codex, not a simulated external API",
}
const now = () => Date.now() / 1000
async function update(value: Partial<typeof state>) {
  Object.assign(state, value)
  const revision = ++state.revision
  await consolePage?.waitForFunction((revision) => (window.browserAgentConsoleRevision ?? -1) >= revision, revision)
}
async function pair(label: string, seconds: number, action?: () => Promise<void>) {
  const start = now()
  const targetStart = start - targetStarted,
    consoleStart = start - consoleStarted
  if (action) await action()
  await delay(seconds * 1000)
  segments.push({ kind: "pair", label, targetStart, consoleStart, duration: now() - start })
}
async function full(page: Page, started: number, label: string, seconds: number, action?: () => Promise<void>) {
  const start = now()
  if (action) await action()
  await delay(seconds * 1000)
  segments.push({ kind: "full", label, path: await page.video()!.path(), start: start - started, duration: now() - start })
}
async function calibrateNativeCapture(cdp: CDPSession) {
  const pageSession = await context!.newCDPSession(site!)
  const samples: Record<string, unknown>[] = []
  report.captureCalibration = samples
  try {
    const { targetInfo } = await pageSession.send("Target.getTargetInfo")
    for (let attempt = 0; attempt < 4; attempt++) {
      await site!.bringToFront()
      const response = await site!.evaluate(() =>
        window.browserAgentDemo.tool("browser_page_observe", { includeScreenshot: true }),
      )
      assert(response.ok, JSON.stringify(response))
      const value = response.result as { screenshot: Frame; viewport: { width: number; height: number } }
      const nativeWindow = await cdp.send("Browser.getWindowForTarget", { targetId: targetInfo.targetId })
      const sample = {
        attempt,
        viewport: value.viewport,
        screenshot: { width: value.screenshot.width, height: value.screenshot.height },
        nativeWindow,
      }
      samples.push(sample)
      await writeFile(
        join(directory, `calibration-${attempt}.jpg`),
        Buffer.from(value.screenshot.dataUrl.split(",")[1], "base64"),
      )
      await writeFile(join(directory, "capture-calibration.json"), JSON.stringify(samples, null, 2))
      if (
        Math.abs(value.screenshot.width * value.viewport.height - value.screenshot.height * value.viewport.width) <=
        Math.max(value.viewport.width, value.viewport.height)
      )
        return
      assert(attempt < 3, "Native capture geometry did not converge")
      assert.equal(nativeWindow.bounds.width, value.viewport.width, "Window width must match CSS before height calibration")
      assert(
        typeof nativeWindow.bounds.height === "number" && Number.isFinite(nativeWindow.bounds.height),
        "Native window height is unavailable",
      )
      // Headless Chrome's native capture can exclude browser chrome even when
      // emulation reports the requested viewport. Measure, resize, then verify
      // the next unmodified SDK image; never crop an image into agreement.
      const difference = value.viewport.height - (value.screenshot.height * value.viewport.width) / value.screenshot.width
      assert(Math.abs(difference) <= 200, "Unexpected native window geometry")
      await cdp.send("Browser.setWindowBounds", {
        windowId: nativeWindow.windowId,
        bounds: {
          width: value.viewport.width,
          height: nativeWindow.bounds.height + Math.round(difference),
          windowState: "normal",
        },
      })
      await delay(250)
    }
  } finally {
    await pageSession.detach()
  }
}
async function call(name: string, input: Record<string, unknown>, publish = true) {
  await site!.bringToFront() // Only this private headless browser is activated.
  const response = await site!.evaluate(({ name, input }) => window.browserAgentDemo.tool(name, input), { name, input })
  const receipt: Record<string, unknown> = { at: new Date().toISOString(), name, input, response }
  if (name === "browser_page_observe" && response.ok) {
    const value = response.result as {
      screenshot?: Omit<Frame, "id">
      viewport: { width: number; height: number; scrollY: number }
    }
    assert(value.screenshot, "Observation must contain the real Chrome screenshot")
    assert(
      Math.abs(value.screenshot.width * value.viewport.height - value.screenshot.height * value.viewport.width) <=
        Math.max(value.viewport.width, value.viewport.height),
      "The native screenshot and CSS viewport must have matching geometry",
    )
    observedActionRevision = actionRevision
    latestFrame = `frame-${String(++frameCounter).padStart(3, "0")}`
    await writeFile(join(directory, `${latestFrame}.jpg`), Buffer.from(value.screenshot.dataUrl.split(",")[1], "base64"))
    await writeFile(
      join(directory, `${latestFrame}.json`),
      JSON.stringify({
        id: latestFrame,
        viewport: value.viewport,
        screenshot: { width: value.screenshot.width, height: value.screenshot.height },
      }),
    )
    await update({
      frame: { ...value.screenshot, id: latestFrame },
      result: `Chrome screenshot received · scrollY ${value.viewport.scrollY}`,
    })
    receipt.response = { ok: true, result: { ...value, screenshot: { ...value.screenshot, dataUrl: `[${latestFrame}.jpg]` } } }
  } else if (!response.ok) await update({ denied: true, result: `${response.code} · ${response.message}` })
  else {
    actionRevision++
    if (publish) await update({ result: "Action accepted. A fresh observation must verify its result." })
  }
  if (publish)
    state.events.push({
      name: name.replace("browser_", ""),
      ok: response.ok,
      detail: response.ok ? (name === "browser_page_observe" ? latestFrame! : "accepted") : response.code!,
    })
  if (state.events.length > 12) state.events.shift()
  trace.push(receipt)
  await writeFile(join(directory, "trace.json"), JSON.stringify(trace, null, 2))
  if (publish) await update({})
  return response
}
async function stop() {
  cancelled = true
  await context?.close()
  server.closeAllConnections()
  server.close()
}
process.once("SIGTERM", () => {
  void stop()
})
process.once("SIGINT", () => {
  void stop()
})
try {
  await new Promise<void>((ok, fail) => {
    server.once("error", fail)
    server.listen(3000, "127.0.0.1", ok)
  })
  context = await chromium.launchPersistentContext(join(directory, "profile"), {
    channel: "chromium",
    executablePath: process.env.BROWSER_CLIENT_DEMO_BROWSER,
    ignoreDefaultArgs: ["--disable-extensions"],
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    recordVideo: { dir: join(directory, "raw-video"), size: { width: 1440, height: 900 } },
    args: [
      "--enable-unsafe-extension-debugging",
      ...(process.env.BROWSER_CLIENT_DEMO_BROWSER
        ? []
        : [`--disable-extensions-except=${join(directory, "extension")}`, `--load-extension=${join(directory, "extension")}`]),
    ],
  })
  const cdp = await context.browser()!.newBrowserCDPSession()
  const extensionCommand = cdp.send.bind(cdp) as (name: string, input: Record<string, unknown>) => Promise<unknown>
  const id = process.env.BROWSER_CLIENT_DEMO_BROWSER
    ? ((await extensionCommand("Extensions.loadUnpacked", { path: join(directory, "extension") })) as { id: string }).id
    : new URL((context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))).url()).hostname
  report.browserVersion = context.browser()?.version()
  report.installation = await extensionCommand("Extensions.getExtensions", {})
  const optionsStarted = now(),
    options = await context.newPage()
  await options.goto(`chrome-extension://${id}/sidepanel.html`)
  await options.getByRole("heading", { name: "Connections", exact: true }).waitFor()
  await options.getByRole("status").filter({ hasText: "connected" }).waitFor()
  targetStarted = now()
  site = await context.newPage()
  await site.exposeFunction("browserAgentAccessChanged", async (capabilities: string[]) => {
    if (!capabilities.includes("page.observe")) await update({ frame: null, badge: "No page grant" })
  })
  await site.goto("http://127.0.0.1:3000")
  await site.waitForFunction(() => Boolean(window.browserAgentDemo))
  await site.evaluate(() => document.fonts.ready)
  consoleStarted = now()
  consolePage = await context.newPage()
  await consolePage.goto("http://127.0.0.1:3000/agent")
  await consolePage.evaluate(() => document.fonts.ready)
  await update({})
  await pair("Template, capability contract and concrete runtime", 6)
  await update({
    hideIntro: true,
    chapter: "02 / CONNECT YOUR OWN AGENT",
    title: "A small SDK integration.",
    subtitle: "Connect, ask for exact-page approval, then give the returned image to your agent.",
    code: connectionCode,
    result: "MCP / OpenAI / LangChain tool adapters share the same contract.",
  })
  await pair("Minimal public SDK connection", 8)
  const managerStarted = now(),
    manager = await context.newPage()
  await manager.goto("chrome://extensions/")
  await manager.getByText("Browser Client", { exact: true }).first().waitFor()
  await full(manager, managerStarted, "Installed production extension in real Chrome", 5)
  await manager.close()
  report.bridge = await site.evaluate((id) => window.browserAgentDemo.connect(id), id)
  await site.evaluate(() => window.browserAgentDemo.requestAccess())
  await options.getByRole("button", { name: "Allow this page", exact: true }).waitFor()
  await full(options, optionsStarted, "Explicit exact-document approval in the actual extension", 5, async () => {
    await delay(1800)
    await options.getByRole("button", { name: "Allow this page", exact: true }).click()
    await site!.waitForFunction(() => window.browserAgentDemo.approved())
  })
  await site.bringToFront()
  const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] })
  const target = targetInfos.find((value) => value.url === site!.url())
  assert(target)
  await extensionCommand("Extensions.triggerAction", { id, targetId: target.targetId })
  await site.bringToFront()
  await calibrateNativeCapture(cdp)
  await update({
    live: true,
    chapter: "03 / THE USER TASK",
    title: "Read. Decide. Act. Verify.",
    subtitle: "The current Codex Agent receives real images and chooses each next tool call.",
    goal,
    code: 'client.request("page.observe", {\n  includeScreenshot: true\n})',
    result: "Acquiring the first real Chrome frame…",
    badge: "Approved",
  })
  await pair("Natural-language goal and first actual observation", 4, async () => {
    assert((await call("browser_page_observe", { includeScreenshot: true })).ok)
  })
  await writeFile(
    join(directory, "ready.json"),
    JSON.stringify(
      {
        goal,
        frame: latestFrame,
        decisions:
          "Write numbered 001.json etc to decisions/; use sourceFrame matching the latest returned frame, tool, input and short observable decision. Use finish:true only after visually verifying Activity.",
      },
      null,
      2,
    ),
  )
  console.log(`Agent ready: ${join(directory, `${latestFrame}.jpg`)}`)
  const deadline = Date.now() + 10 * 60_000
  let finished = false
  for (let sequence = 1; sequence <= 20 && !finished; sequence++) {
    const path = join(directory, "decisions", `${String(sequence).padStart(3, "0")}.json`)
    let command:
      { sourceFrame: string; tool?: string; input?: Record<string, unknown>; decision: string; finish?: boolean } | undefined
    while (!command) {
      assert(!cancelled && Date.now() < deadline, "Agent decision timeout or cancellation")
      try {
        const info = await stat(path)
        assert(info.size <= 16384, "Decision exceeds bounded input")
        command = JSON.parse(await readFile(path, "utf8"))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
      if (!command) await delay(250)
    }
    assert.equal(command.sourceFrame, latestFrame, "An action must refer to the latest real observation")
    assert(
      typeof command.decision === "string" && command.decision.length > 0 && command.decision.length <= 240,
      "Use a short observable decision",
    )
    assert(
      Object.keys(command).every((key) => ["sourceFrame", "tool", "input", "decision", "finish"].includes(key)),
      "Unexpected decision field",
    )
    if (command.finish === true) {
      assert(!command.tool && !command.input)
      assert(
        frameCounter >= 2 && observedActionRevision === actionRevision,
        "Completion requires a real screenshot after the final action",
      )
      finished = true
      await update({ decision: command.decision })
      break
    }
    assert(["browser_page_observe", "browser_page_click", "browser_page_type", "browser_page_scroll"].includes(command.tool!))
    assert(
      command.tool === "browser_page_observe" || observedActionRevision === actionRevision,
      "Observe again after every action before choosing another action",
    )
    assert(command.input && typeof command.input === "object" && !Array.isArray(command.input))
    await invokeBrowserAgentTool(async () => null, command.tool!, command.input)
    await update({
      chapter: "04 / IMAGE-DRIVEN AGENT LOOP",
      title: `Agent decision ${sequence}`,
      decision: command.decision,
      code: `${command.tool}(\n  ${JSON.stringify(command.input)}\n)`,
      denied: false,
    })
    await pair(`Agent decision ${sequence}: ${command.tool}`, command.tool === "browser_page_observe" ? 4.5 : 3, async () => {
      if (command!.tool === "browser_page_scroll") {
        const totalX = command!.input!.deltaX as number,
          totalY = command!.input!.deltaY as number
        // Keep larger valid deltas within the same finite recording budget.
        const steps = Math.min(35, Math.max(1, Math.ceil(Math.max(Math.abs(totalX), Math.abs(totalY)) / 18)))
        for (let index = 0; index < steps; index++) {
          const deltaX = Math.round((totalX * (index + 1)) / steps) - Math.round((totalX * index) / steps)
          const deltaY = Math.round((totalY * (index + 1)) / steps) - Math.round((totalY * index) / steps)
          assert((await call(command!.tool!, { deltaX, deltaY }, false)).ok)
          await delay(40)
        }
        state.events.push({ name: "page_scroll", ok: true, detail: `${steps} actual SDK calls` })
        await update({ result: "Scroll completed. A fresh observation must verify the new viewport." })
      } else assert((await call(command!.tool!, command!.input!)).ok)
    })
    await writeFile(
      join(directory, `receipt-${sequence}.json`),
      JSON.stringify(
        {
          sequence,
          sourceFrame: command.sourceFrame,
          latestFrame,
          actionRevision,
          observedActionRevision,
          tool: command.tool,
          completed: true,
        },
        null,
        2,
      ),
    )
    console.log(`Decision ${sequence} complete; latest ${latestFrame}`)
  }
  assert(finished, "The Agent must explicitly verify and finish")
  // Outcome assertions are independent of the Agent's completion claim.
  assert.equal(await site.locator("#activity-result").textContent(), "Chrome bridge v0.2.0 — 41 checks passed")
  assert.equal(await site.locator("#input-state").textContent(), "Input event received · 39 characters")
  assert(
    await site.locator("#activity-result").evaluate((element) => {
      const r = element.getBoundingClientRect()
      return r.top >= 80 && r.bottom <= window.innerHeight
    }),
  )
  await update({
    chapter: "05 / VERIFIED OUTCOME",
    title: "The image confirms the result.",
    subtitle: "The Ready release was selected. Its name, version and check count are saved and visible in Activity.",
    result: "Verified in a fresh extension screenshot.",
    code: "observe → choose one action → observe again",
  })
  await pair("Visually verified saved release note", 5)
  await full(options, optionsStarted, "User revokes the real document grant", 3.5, async () => {
    await delay(1200)
    await options.getByRole("button", { name: "Revoke access", exact: true }).click()
    await site!.waitForFunction(() => !window.browserAgentDemo.approved())
  })
  assert.equal(state.frame, null, "The real access event must clear the console screenshot")
  await update({
    badge: "Revoked",
    frame: null,
    chapter: "06 / ACCESS IS REVOCABLE",
    title: "The next tool call is denied.",
    subtitle: "The exact document grant is gone. A new observation cannot return page pixels.",
    decision: "",
    code: 'client.request("page.observe", {\n  includeScreenshot: true\n})',
  })
  await pair("Real revocation denial and screenshot cleared", 5, async () => {
    assert.equal((await call("browser_page_observe", { includeScreenshot: true })).code, "NOT_AUTHORIZED")
  })
  assert.equal(state.frame, null)
  await update({
    live: false,
    hideIntro: false,
    goal: "",
    decision: "",
    code: "",
    denied: false,
    chapter: "07 / BUILD ON THE TEMPLATE",
    title: "Keep the tools. Make it yours.",
    subtitle: "Web, Admin and MV3 templates share the UI and engineering foundation. The capability contract stays separate.",
    result: "This video demonstrates one real browser task; it is not a full security certification.",
    boundary:
      "Current scope: allowed origins, approved documents and bounded page actions. No arbitrary-site, OS-input or unrestricted script control.",
  })
  await pair("Reusable template, independent capabilities and supported scope", 6)
  report.status = "passed"
  report.segments = segments
  report.targetVideo = await site.video()!.path()
  report.consoleVideo = await consolePage.video()!.path()
  report.checks = [
    "actual installed extension shown",
    "minimal SDK code shown",
    "real extension approval",
    "real Native Port connection",
    "actual viewport returned to external Agent",
    "incremental decisions refer to latest image",
    "target actions execute through public SDK",
    "visible draft exactly matches Ready candidate",
    "input event fired",
    "fresh observation after actions",
    "Activity visually in viewport",
    "actual extension revocation",
    "NOT_AUTHORIZED after revoke",
    "console discards screenshot after revoke",
  ]
} catch (error) {
  report.status = "failed"
  report.error = error instanceof Error ? error.stack : String(error)
  console.error(report.error)
  process.exitCode = 1
} finally {
  try {
    await site?.evaluate(() => window.browserAgentDemo?.close()).catch(() => {})
    await context?.close()
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((ok) => server.close(() => ok()))
    report.cleanup = "passed"
  } catch (error) {
    report.cleanup = String(error)
    process.exitCode = 1
  }
  report.finishedAt = new Date().toISOString()
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2))
  console.log(`Recording ${report.status}; Cleanup ${report.cleanup}`)
}
