import assert from "node:assert/strict"
import { join } from "node:path"
import { verifyPageFoundation } from "./client-page-verification.mjs"

export async function verifyWebTemplate({ page, runDir, passed }) {
  assert.equal(await page.title(), "Browser Client")
  await page.getByRole("heading", { name: "Welcome", level: 1, exact: true }).waitFor()
  await verifyPageFoundation(page)
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Web overflow at ${width}px`)
    const mobile = page.getByRole("button", { name: "Open navigation", exact: true })
    if (width < 768) {
      await mobile.click()
      const drawer = page.getByRole("dialog")
      await drawer.waitFor()
      await drawer.getByRole("link", { name: "Features", exact: true }).click()
      await drawer.waitFor({ state: "hidden" })
      assert.equal(new URL(page.url()).hash, "#features")
      await mobile.click()
      await page.keyboard.press("Escape")
      await drawer.waitFor({ state: "hidden" })
      assert(await mobile.evaluate((element) => document.activeElement === element), "Navigation did not restore focus")
      await mobile.click()
      await drawer.getByRole("button", { name: "Close", exact: true }).click()
      await drawer.waitFor({ state: "hidden" })
    } else {
      assert.equal(await mobile.isVisible(), false)
      await page
        .getByRole("navigation", { name: "Main navigation", exact: true })
        .getByRole("link", { name: "Resources", exact: true })
        .click()
      assert.equal(new URL(page.url()).hash, "#resources")
    }
    await page.getByRole("link", { name: "Explore features", exact: true }).click()
    assert.equal(new URL(page.url()).hash, "#features")
    const docs = page.getByRole("link", { name: "Read the docs (opens in a new tab)", exact: true })
    assert.equal(await docs.getAttribute("href"), "https://github.com/shell-echo/browser-client-monorepo#readme")
    assert.equal(await docs.getAttribute("target"), "_blank")
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: join(runDir, `web-${width}.png`), fullPage: true })
  }
  passed("Web responsive template, Inter, shared UI, links and mobile navigation passed at 320 / 390 / 768 / 1280px")
}
