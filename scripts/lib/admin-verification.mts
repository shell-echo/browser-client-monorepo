import type { Page, Locator, Request } from "playwright"
import type { RouteAssertions, BrowserAssertions } from "./contracts.mts"
import assert from "node:assert/strict"
import { join } from "node:path"
import { chooseTheme, verifyThemes } from "./theme-verification.mts"

async function noHorizontalOverflow(page: Page) {
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    `Admin overflows horizontally at ${page.viewportSize()?.width}px on ${new URL(page.url()).pathname}`,
  )
}

async function inViewport(page: Page, locator: Locator) {
  await locator.waitFor({ state: "visible" })
  await page.waitForFunction(
    (element) => {
      const box = element.getBoundingClientRect()
      return box.x >= 0 && box.y >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight
    },
    await locator.elementHandle(),
  )
  const box = await locator.boundingBox()
  assert(box, "Expected visible browser geometry")
  const viewport = page.viewportSize()
  assert(viewport, "Expected visible browser geometry")
  assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height)
}

async function focused(locator: Locator) {
  assert(await locator.evaluate((element) => element === document.activeElement), "Focus did not return to the trigger")
}

export async function verifyAdminTemplates({ pageFor, url, runDir, errors, passed }: RouteAssertions) {
  const page = await pageFor("admin templates", `${url}/`)
  await page.evaluate(() => {
    window.__adminTemplateNavigation = "preserved"
  })
  await page.getByRole("link", { name: "Login template", exact: true }).click()
  await page.getByRole("heading", { name: "Welcome to Browser Client", exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, "/login")
  assert.equal(await page.evaluate(() => window.__adminTemplateNavigation), "preserved", "Home link reloaded the document")
  const requests: string[] = []
  const record = (request: Request) => requests.push(`${request.method()} ${request.url()}`)
  page.on("request", record)
  const email = page.getByRole("textbox", { name: "Email", exact: true })
  const status = page.getByRole("status")
  await page.getByRole("button", { name: "Login", exact: true }).click()
  assert(await email.evaluate((element) => element instanceof HTMLInputElement && element.validity.valueMissing))
  assert.equal(await status.textContent(), "")
  await focused(email)
  await email.fill("invalid-email")
  await page.getByRole("button", { name: "Login", exact: true }).click()
  assert(await email.evaluate((element) => element instanceof HTMLInputElement && element.validity.typeMismatch))
  assert.equal(await status.textContent(), "")
  await email.fill("preview@example.com")
  await page.getByRole("button", { name: "Login", exact: true }).click()
  await page.getByText("Email sign-in is not configured yet.", { exact: true }).waitFor()
  for (const provider of ["Apple", "Google"]) {
    await page.getByRole("button", { name: `Continue with ${provider}`, exact: true }).click()
    await page.getByText(`${provider} sign-in is not configured yet.`, { exact: true }).waitFor()
  }
  assert.deepEqual(requests, [], "Template sign-in actions must not submit credentials or invoke authentication")
  page.off("request", record)
  assert.equal(new URL(page.url()).pathname, "/login")

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await noHorizontalOverflow(page)
    const form = await page.locator("form").boundingBox()
    assert(form, "Expected visible browser geometry")
    assert(form.width <= 384 && form.x >= 0 && form.x + form.width <= width, "Login form must fit the viewport")
    const apple = await page.getByRole("button", { name: "Continue with Apple", exact: true }).boundingBox()
    assert(apple, "Expected visible browser geometry")
    const google = await page.getByRole("button", { name: "Continue with Google", exact: true }).boundingBox()
    assert(google, "Expected visible browser geometry")
    if (width < 640) assert(google.y >= apple.y + apple.height, "Narrow login must stack social buttons")
    else assert.equal(apple.y, google.y, "Wide login must place social buttons in one row")
    await page.screenshot({ path: join(runDir, `admin-login-${width}.png`), fullPage: true })
  }
  await verifyThemes(page, { errors, screenshot: join(runDir, "admin-login-dark.png") })
  passed("Admin login validates email locally, preserves input during theme changes and fits 320 / 390 / 768 / 1280px")

  await page.evaluate(() => {
    window.__adminTemplateNavigation = "preserved"
  })
  await page.getByRole("link", { name: "Preview dashboard", exact: true }).click()
  await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor({ state: "attached" })
  assert.equal(new URL(page.url()).pathname, "/dashboard")
  assert.equal(await page.evaluate(() => window.__adminTemplateNavigation), "preserved", "Route links reloaded the document")
  await page.goBack()
  await email.waitFor()
  await page.goForward()
  await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor({ state: "attached" })
  assert.equal(await page.evaluate(() => window.__adminTemplateNavigation), "preserved")

  const desktopSidebar = page.locator('[data-slot="sidebar"][data-state]')
  const toggle = page.getByRole("button", { name: "Toggle Sidebar", exact: true })
  await toggle.click()
  await page.waitForFunction(
    () => document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state") === "collapsed",
  )
  await page.reload()
  await page.waitForFunction(
    () => document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state") === "collapsed",
  )
  // Route unmounts must restore the preference too, without a document reload.
  await page.getByRole("link", { name: "Overview", exact: true }).click()
  await page.getByRole("link", { name: "Dashboard template", exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state") === "collapsed",
  )
  await page.keyboard.press("Control+b")
  await page.waitForFunction(
    () => document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state") === "expanded",
  )
  await page.reload()
  await page.waitForFunction(
    () => document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state") === "expanded",
  )
  await page.evaluate(() => {
    document.cookie = "sidebar_state=invalid; path=/"
  })
  await page.reload()
  await page.waitForFunction(
    () => document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state") === "expanded",
  )
  passed(
    "Admin sidebar restores collapsed / expanded preferences after reload and route navigation; invalid cookies use defaults",
  )

  const restricted = await pageFor("admin blocked cookies", `${url}/dashboard`)
  try {
    await restricted.addInitScript(() => {
      Object.defineProperty(Document.prototype, "cookie", {
        configurable: true,
        get() {
          throw new DOMException("Cookies blocked", "SecurityError")
        },
        set() {
          throw new DOMException("Cookies blocked", "SecurityError")
        },
      })
    })
    await restricted.reload()
    await restricted.getByRole("button", { name: "Toggle Sidebar", exact: true }).click()
    await restricted.waitForFunction(
      () => document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state") === "collapsed",
    )
  } finally {
    await restricted.context().close()
  }
  passed("Admin sidebar remains usable when cookie reads and writes throw")
  await page.getByRole("button", { name: "Toggle Playground", exact: true }).click()
  await page.getByRole("link", { name: "History", exact: true }).waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "Toggle Playground", exact: true }).click()
  await page.getByRole("link", { name: "History", exact: true }).waitFor()

  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const mobile = width < 768
    const dialog = page.getByRole("dialog", { name: "Sidebar", exact: true })
    if (mobile) {
      await desktopSidebar.waitFor({ state: "detached" })
      await toggle.click()
      await inViewport(page, dialog)
      await inViewport(page, dialog.getByRole("button", { name: "Close", exact: true }))
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "hidden" })
      await focused(toggle)
      await toggle.click()
      await inViewport(page, dialog)
    } else {
      await desktopSidebar.waitFor()
      assert.equal(await dialog.count(), 0, "Desktop sidebar must not use a modal dialog")
    }
    await noHorizontalOverflow(page)
    const user = page.getByRole("button", { name: /Demo User admin@example.com/ })
    await user.click()
    const userMenu = page.getByRole("menu").filter({ has: page.getByRole("menuitem", { name: "Back to login", exact: true }) })
    await inViewport(page, userMenu)
    await page.keyboard.press("Escape")
    await userMenu.waitFor({ state: "hidden" })
    await focused(user)
    const project = page.getByRole("button", { name: "More about Design Engineering", exact: true })
    await project.click()
    const projectMenu = page
      .getByRole("menu")
      .filter({ has: page.getByRole("menuitem", { name: "View Project", exact: true }) })
    await inViewport(page, projectMenu)
    await page.keyboard.press("Escape")
    await projectMenu.waitFor({ state: "hidden" })
    await focused(project)
    if (mobile) {
      await page.screenshot({ path: join(runDir, `admin-dashboard-sidebar-${width}.png`), fullPage: true })
      await dialog.getByRole("button", { name: "Close", exact: true }).click()
      await dialog.waitFor({ state: "hidden" })
      await focused(toggle)
      // Touch users can also dismiss through the visible backdrop.
      await toggle.click()
      await inViewport(page, dialog)
      await page.mouse.click(width - 8, 400)
      await dialog.waitFor({ state: "hidden" })
    }
    const cards = page.getByLabel("Dashboard summary placeholders", { exact: true }).locator(":scope > div")
    const first = await cards.nth(0).boundingBox()
    assert(first, "Expected visible browser geometry")
    const second = await cards.nth(1).boundingBox()
    assert(second, "Expected visible browser geometry")
    if (mobile) assert(second.y >= first.y + first.height, "Mobile summary cards must stack")
    else assert.equal(first.y, second.y, "Desktop summary cards must share a row")
    await page.evaluate(() => window.scrollTo(0, 0))
    await chooseTheme(page, "dark")
    await page.screenshot({ path: join(runDir, `admin-dashboard-${width}-dark.png`), fullPage: true })
    await chooseTheme(page, "light")
    await noHorizontalOverflow(page)
  }
  passed(
    "Admin sidebar, nested navigation and menus work on desktop and mobile, with Escape, close, backdrop and focus restoration",
  )
  await verifyThemes(page, { errors })

  for (const [path, heading] of [
    ["/login", "Welcome to Browser Client"],
    ["/dashboard", "Dashboard"],
    ["/missing-page", "Page not found"],
  ]) {
    const response = await page.goto(`${url}${path}`, { waitUntil: "networkidle" })
    assert(response)
    assert.equal(response.status(), 200, "Production SPA host must serve deep links")
    await page.getByRole("heading", { name: heading, exact: true }).waitFor({ state: "attached" })
    await page.reload({ waitUntil: "networkidle" })
    await page.getByRole("heading", { name: heading, exact: true }).waitFor({ state: "attached" })
    await noHorizontalOverflow(page)
  }
  await page.getByRole("link", { name: "Back to home", exact: true }).click()
  await page.getByRole("link", { name: "Dashboard template", exact: true }).click()
  await toggle.click()
  await page.getByRole("button", { name: /Demo User admin@example.com/ }).click()
  await page.getByRole("menuitem", { name: "Back to login", exact: true }).click()
  await email.waitFor()
  assert.equal(new URL(page.url()).pathname, "/login")
  passed("Admin template links, browser history, direct production URLs, reload and unknown routes passed")
  const browser = page.context().browser()
  assert(browser)
  await verifyRouteRecovery({ browser, url, runDir, passed })
  await page.context().close()
}

async function verifyRouteRecovery({
  browser,
  url,
  runDir,
  passed,
}: Pick<BrowserAssertions, "browser" | "url" | "runDir" | "passed">) {
  for (const name of ["login", "dashboard"]) {
    const context = await browser.newContext({ viewport: { width: 320, height: 844 } })
    try {
      const page = await context.newPage()
      const runtimeErrors: string[] = [],
        consoleErrors: { text: string; url: string }[] = [],
        failedRequests: string[] = []
      page.on("pageerror", (error) => runtimeErrors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url })
      })
      page.on("requestfailed", (request) => failedRequests.push(request.url()))
      await page.goto(url, { waitUntil: "networkidle" })
      await page.getByRole("heading", { name: "Overview", level: 1, exact: true }).waitFor()
      await page.evaluate(() => {
        window.__routeRecovery = "preserved"
      })
      let failedChunk: string | undefined
      const pattern = "**/assets/" + name + "-*.js"
      await page.route(pattern, (route) => {
        failedChunk = route.request().url()
        return name === "login"
          ? route.fulfill({ status: 503, contentType: "text/javascript", body: "// Deliberate unavailable route chunk" })
          : route.abort("failed")
      })
      await page.getByRole("link", { name: name === "login" ? "Login template" : "Dashboard template", exact: true }).click()
      await page.getByRole("heading", { name: "Unable to load this page", exact: true }).waitFor()
      assert(failedChunk, "The route fault must intercept a real production chunk")
      await noHorizontalOverflow(page)
      await chooseTheme(page, "dark")
      await page.screenshot({ path: join(runDir, "admin-" + name + "-load-failure.png"), fullPage: true })
      if (name === "dashboard") {
        await page.getByRole("link", { name: "Back to home", exact: true }).click()
        await page.getByRole("heading", { name: "Overview", level: 1, exact: true }).waitFor()
        assert.equal(
          await page.evaluate(() => window.__routeRecovery),
          "preserved",
          "Returning home must not reload the document",
        )
        await page.getByRole("link", { name: "Dashboard template", exact: true }).click()
        await page.getByRole("heading", { name: "Unable to load this page", exact: true }).waitFor()
      }
      await page.unroute(pattern)
      await Promise.all([
        page.waitForEvent("domcontentloaded"),
        page.getByRole("button", { name: "Refresh page", exact: true }).click(),
      ])
      await page
        .getByRole("heading", { name: name === "login" ? "Welcome to Browser Client" : "Dashboard", exact: true })
        .waitFor({ state: "attached" })
      assert.equal(
        await page.evaluate(() => window.__routeRecovery),
        undefined,
        "Refresh must retry cached failed imports in a new document",
      )
      assert(
        await page.evaluate(() => document.documentElement.classList.contains("dark")),
        "Recovery must retain the selected theme",
      )
      assert.deepEqual(runtimeErrors, [], "A handled route failure must not produce an uncaught browser error")
      assert(
        failedRequests.every((request) => request === failedChunk),
        "An unrelated request failed",
      )
      assert(
        consoleErrors.every((error) => error.url === failedChunk || error.text.includes(failedChunk!)),
        "An unrelated console error occurred",
      )
    } finally {
      await context.close()
    }
  }
  passed("Admin route chunk HTTP / network failures show a responsive recovery page; home navigation and refresh retry passed")
}
