import assert from "node:assert/strict"

const storageKey = "browser-client-theme"
const trigger = (page) => page.getByRole("button", { name: "主题模式", exact: true })
const menu = (page) => page.getByRole("menu", { name: "主题模式选项", exact: true })
const labels = { light: "浅色模式", dark: "深色模式", system: "跟随系统" }

async function closedMenu(page) {
  await menu(page).waitFor({ state: "hidden" })
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "主题模式")
}

async function chooseTheme(page, mode) {
  await trigger(page).click()
  await page.getByRole("menuitemradio", { name: labels[mode], exact: true }).click()
  await closedMenu(page)
}

async function selectedTheme(page, mode, screenshot) {
  await trigger(page).click()
  const item = page.getByRole("menuitemradio", { name: labels[mode], exact: true })
  assert.equal(await item.getAttribute("aria-checked"), "true", "菜单未标记当前主题")
  assert.equal(await page.getByRole("menuitemradio", { checked: true }).count(), 1, "主题菜单应恰好选中一项")
  const bounds = await menu(page).boundingBox()
  const viewport = page.viewportSize()
  assert(bounds && bounds.x >= 0 && bounds.y >= 0, "主题菜单超出视口")
  assert(bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, "主题菜单被视口裁切")
  const styled = await menu(page).evaluate((element) => {
    const style = getComputedStyle(element)
    return style.backgroundColor !== "rgba(0, 0, 0, 0)" && parseFloat(style.borderRadius) > 0
  })
  assert(styled, "共享 Dropdown Menu 样式未生效")
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
    await page.waitForFunction(() => document.activeElement?.textContent?.includes("跟随系统"))
    await page.keyboard.press("Home")
    await page.waitForFunction(() => document.activeElement?.textContent?.includes("浅色模式"))
    await page.keyboard.press("Enter")
    await closedMenu(page)
    await themed(page, "light")
    await selectedTheme(page, "light")
    await chooseTheme(page, "light")
    const light = await themed(page, "light")
    await chooseTheme(page, "dark")
    const dark = await themed(page, "dark")
    assert.notEqual(light, dark, "主题类发生变化，但实际背景颜色未变化")
    assert.deepEqual(await fields.evaluateAll((items) => items.map((item) => item.value)), before, "主题切换丢失未保存的输入")
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
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "主题控件造成页面水平溢出")
  } finally {
    if (ownsPeer) await peer.close()
  }
}

export async function verifyThemeBeforeHydration(browser, url, vite) {
  const context = await browser.newContext({ colorScheme: "light" })
  try {
    await context.addInitScript((key) => window.localStorage.setItem(key, "dark"), storageKey)
    const page = await context.newPage()
    await page.route("**/*.js", (route) =>
      new URL(route.request().url()).pathname === "/theme-init.js"
        ? route.continue()
        : route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
    )
    await page.goto(url, { waitUntil: "networkidle" })
    await themed(page, "dark")
    if (vite) assert.equal(await trigger(page).count(), 0, "Vite React 入口未被隔离")
    else assert(await trigger(page).isDisabled(), "Next 首屏已 hydrate，不能证明初始化脚本独立生效")
  } finally {
    await context.close()
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
    assert.deepEqual(errors, [], "禁用存储导致主题功能崩溃")
  } finally {
    await probe.close()
  }
}
