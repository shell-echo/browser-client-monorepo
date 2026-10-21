import assert from "node:assert/strict"

const storageKey = "browser-client-theme"
const trigger = (page) => page.getByRole("button", { name: "Toggle theme", exact: true })
const menu = (page) => page.getByRole("menu", { name: "Theme options", exact: true })
const labels = { light: "Light", dark: "Dark", system: "System" }

async function closedMenu(page) {
  await menu(page).waitFor({ state: "hidden" })
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Toggle theme")
}

export async function chooseTheme(page, mode) {
  await trigger(page).click()
  await page.getByRole("menuitemradio", { name: labels[mode], exact: true }).click()
  await closedMenu(page)
}

async function selectedTheme(page, mode, screenshot) {
  await trigger(page).click()
  const item = page.getByRole("menuitemradio", { name: labels[mode], exact: true })
  await item.waitFor()
  assert.deepEqual(
    (await page.getByRole("menuitemradio").allTextContents()).map((text) => text.trim()),
    ["Light", "Dark", "System"],
    "Theme options must use English labels",
  )
  assert.equal(await item.getAttribute("aria-checked"), "true", "Menu does not mark the current theme")
  assert.equal(
    await page.getByRole("menuitemradio", { checked: true }).count(),
    1,
    "Theme menu must have exactly one selected item",
  )
  const bounds = await menu(page).boundingBox()
  const viewport = page.viewportSize()
  assert(bounds && bounds.x >= 0 && bounds.y >= 0, "Theme menu is outside the viewport")
  assert(
    bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height,
    "Theme menu is clipped by the viewport",
  )
  const styled = await menu(page).evaluate((element) => {
    const style = getComputedStyle(element)
    return style.backgroundColor !== "rgba(0, 0, 0, 0)" && parseFloat(style.borderRadius) > 0
  })
  assert(styled, "Shared Dropdown Menu styles are not applied")
  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true })
  await page.keyboard.press("Escape")
  await closedMenu(page)
}

async function themed(page, mode) {
  await page.waitForFunction((value) => document.documentElement.classList.contains(value), mode, {
    polling: 100,
    timeout: 10000,
  })
  const state = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    classes: [...document.documentElement.classList],
  }))
  assert.equal(state.scheme, mode)
  assert(!state.classes.includes(mode === "dark" ? "light" : "dark"))
  return state.background
}

export async function verifyThemes(page, { peer, errors, screenshot } = {}) {
  const ownsPeer = !peer
  if (!peer) {
    peer = await page.context().newPage()
    peer.on("pageerror", (error) => errors?.push(`theme peer: ${error.message}`))
    peer.on("console", (message) => {
      if (message.type() === "error") errors?.push(`theme peer: ${message.text()}`)
    })
    await peer.goto(page.url(), { waitUntil: "networkidle" })
  }
  try {
    const fields = page.locator("input, textarea")
    const before = await fields.evaluateAll((items) => items.map((item) => item.value))
    await page.emulateMedia({ colorScheme: "light" })
    await peer.emulateMedia({ colorScheme: "light" })
    await chooseTheme(page, "dark")
    await trigger(page).focus()
    await trigger(page).press("ArrowDown")
    await menu(page).waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitemradio")
    await page.keyboard.press("End")
    await page.waitForFunction(() => document.activeElement?.textContent?.includes("System"))
    await page.keyboard.press("Home")
    await page.waitForFunction(() => document.activeElement?.textContent?.includes("Light"))
    await page.keyboard.press("Enter")
    await closedMenu(page)
    await themed(page, "light")
    await selectedTheme(page, "light")
    await chooseTheme(page, "light")
    const light = await themed(page, "light")
    await chooseTheme(page, "dark")
    const dark = await themed(page, "dark")
    assert.notEqual(light, dark, "Theme classes changed but the rendered background color did not")
    assert.deepEqual(
      await fields.evaluateAll((items) => items.map((item) => item.value)),
      before,
      "Theme change lost unsaved input",
    )
    await themed(peer, "dark")
    await selectedTheme(peer, "dark")
    assert.equal(await page.evaluate((key) => window.localStorage.getItem(key), storageKey), "dark")
    await selectedTheme(page, "dark", screenshot)
    await page.reload({ waitUntil: "networkidle" })
    await themed(page, "dark")
    await selectedTheme(page, "dark")
    await chooseTheme(peer, "light")
    await themed(page, "light")
    await selectedTheme(page, "light")
    await page.emulateMedia({ colorScheme: "dark" })
    await chooseTheme(page, "light")
    await themed(page, "light")
    await themed(peer, "light")
    await chooseTheme(page, "system")
    await themed(page, "dark")
    await themed(peer, "light")
    await selectedTheme(peer, "system")
    await page.emulateMedia({ colorScheme: "light" })
    await themed(page, "light")
    await page.emulateMedia({ colorScheme: "dark" })
    await themed(page, "dark")
    await chooseTheme(page, "dark")
    await themed(peer, "dark")
    await page.emulateMedia({ colorScheme: "light" })
    await themed(page, "dark")
    await peer.evaluate((key) => window.localStorage.removeItem(key), storageKey)
    await themed(page, "light")
    await selectedTheme(page, "system")
    await chooseTheme(page, "system")
    await page.emulateMedia({ colorScheme: "light" })
    await themed(page, "light")
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      "Theme controls cause horizontal overflow",
    )
  } finally {
    if (ownsPeer) await peer.close()
  }
}

export async function verifyThemeBeforeHydration(
  browser,
  url,
  vite,
  { saved = "dark", expected = "dark", system = "light", writeFailure = false } = {},
) {
  const context = await browser.newContext({ colorScheme: system, storageState: themeStorageState(url, saved) })
  try {
    if (writeFailure) await blockStorageWrites(context)
    const page = await context.newPage()
    await page.route("**/*.js", (route) =>
      new URL(route.request().url()).pathname === "/theme-init.js"
        ? route.continue()
        : route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
    )
    await page.goto(url, { waitUntil: "networkidle" })
    await themed(page, expected)
    if (vite) assert.equal(await trigger(page).count(), 0, "Vite React entry was not isolated")
    else
      assert(
        await trigger(page).isDisabled(),
        "Next first paint is already hydrated; cannot verify the bootstrap independently",
      )
  } finally {
    await context.close()
  }
}

export async function verifyInvalidWebTheme(browser, url) {
  for (const saved of ["sepia", "invalid theme"]) {
    await verifyThemeBeforeHydration(browser, url, false, { saved, expected: "dark", system: "dark" })
    const context = await browser.newContext({
      colorScheme: "dark",
      storageState: {
        cookies: [],
        origins: [{ origin: new URL(url).origin, localStorage: [{ name: storageKey, value: saved }] }],
      },
    })
    const errors = []
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)))
    try {
      const page = await context.newPage()
      await page.goto(url, { waitUntil: "networkidle" })
      await themed(page, "dark")
      await selectedTheme(page, "system")
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), null)
      const peer = await context.newPage()
      await peer.goto(url, { waitUntil: "networkidle" })
      for (const invalid of ["sepia", "invalid theme"]) {
        await peer.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: invalid })
        await page.waitForFunction((key) => localStorage.getItem(key) === "system", storageKey)
        await themed(page, "dark")
        await selectedTheme(page, "system")
        await page.emulateMedia({ colorScheme: "light" })
        await themed(page, "light")
        await page.emulateMedia({ colorScheme: "dark" })
        await themed(page, "dark")
      }
      await page.evaluate(() => {
        window.addEventListener("storage", (event) => {
          if (event.key === null) window.__themeClearObserved = true
        })
      })
      await chooseTheme(page, "dark")
      await page.emulateMedia({ colorScheme: "light" })
      await peer.evaluate(() => localStorage.clear())
      await themed(page, "light")
      await selectedTheme(page, "system")
      assert.equal(
        await page.evaluate(() => window.__themeClearObserved),
        true,
        "Theme recovery swallowed the business storage-clear event",
      )
      assert.deepEqual(errors, [], "Invalid theme storage caused a browser error")
    } finally {
      await context.close()
    }
  }
}

function themeStorageState(url, saved) {
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(url).origin,
        localStorage: [
          ...(saved === null ? [] : [{ name: storageKey, value: saved }]),
          { name: "business-draft", value: "keep me" },
        ],
      },
    ],
  }
}

async function blockStorageWrites(context) {
  await context.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (...args) {
      if (this === window.localStorage) throw new DOMException("Storage quota exceeded", "QuotaExceededError")
      return setItem.apply(this, args)
    }
  })
}

export async function verifyThemeWriteFailure(browser, url) {
  for (const saved of [null, "light", "dark", "system", "sepia", "invalid theme", ""]) {
    const manual = saved === "light" || saved === "dark"
    const expected = manual ? saved : "dark"
    const stored = saved === "system" || manual ? saved : null
    await verifyThemeBeforeHydration(browser, url, false, { saved, expected, system: "dark", writeFailure: true })
    const context = await browser.newContext({ colorScheme: "dark", storageState: themeStorageState(url, saved) })
    const errors = []
    context.on("page", (page) => {
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
      })
    })
    try {
      await blockStorageWrites(context)
      const page = await context.newPage()
      assert.equal((await page.goto(url, { waitUntil: "networkidle" })).status(), 200)
      await themed(page, expected)
      await selectedTheme(page, manual ? saved : "system")
      assert.equal(
        await page.evaluate(() => {
          try {
            localStorage.setItem("quota-probe", "test")
          } catch (error) {
            return error.name
          }
        }),
        "QuotaExceededError",
        "Storage write failure was not installed",
      )
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), stored)
      assert.equal(await page.evaluate(() => localStorage.getItem("business-draft")), "keep me")
      assert(!(await page.locator("html").getAttribute("class")).includes("sepia"))
      await page.emulateMedia({ colorScheme: "light" })
      await themed(page, manual ? saved : "light")
      for (const mode of ["dark", "light", "system"]) {
        await chooseTheme(page, mode)
        await themed(page, mode === "system" ? "light" : mode)
        await selectedTheme(page, mode)
      }
      await page.emulateMedia({ colorScheme: "dark" })
      await themed(page, "dark")
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), stored)
      await page.reload({ waitUntil: "networkidle" })
      await themed(page, expected)
      await selectedTheme(page, manual ? saved : "system")
      assert.deepEqual(errors, [], `Storage quota failure caused browser errors for ${JSON.stringify(saved)}`)
    } finally {
      await context.close()
    }
  }
}

export async function verifyUnavailableStorage(page) {
  const probe = await page.context().newPage()
  const errors = []
  probe.on("pageerror", (error) => errors.push(error.message))
  try {
    await probe.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get: () => {
          throw new DOMException("Storage disabled", "SecurityError")
        },
      })
    })
    await probe.goto(page.url(), { waitUntil: "networkidle" })
    await chooseTheme(probe, "dark")
    await themed(probe, "dark")
    await chooseTheme(probe, "light")
    await themed(probe, "light")
    assert.deepEqual(errors, [], "Disabling storage caused theme errors")
  } finally {
    await probe.close()
  }
}
