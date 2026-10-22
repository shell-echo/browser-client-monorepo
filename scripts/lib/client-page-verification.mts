import type { Page } from "playwright"
import assert from "node:assert/strict"

const repository = "https://github.com/shell-echo/browser-client-monorepo"

export async function verifyPageFoundation(page: Page) {
  assert.equal(await page.locator("html").getAttribute("lang"), "en", "Pages must declare English as their default language")
  assert(!/\p{Script=Han}/u.test(await page.title()), "Page title must use English")
  const font = await page.evaluate(async () => {
    const faces = await document.fonts.load('400 16px "Inter Variable"', "Browser Client")
    await document.fonts.ready
    return {
      family: getComputedStyle(document.body).fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      loaded: faces.length > 0 && faces.every((face) => face.status === "loaded"),
    }
  })
  assert.equal(font.family, "Inter Variable", "Pages must use the Inter font selected by shadcn preset b0")
  assert(font.loaded, "The bundled Inter font did not load")
  const link = page.getByRole("link", { name: "GitHub repository (opens in a new tab)", exact: true })
  assert.equal(await link.getAttribute("href"), repository)
  assert.equal(await link.getAttribute("target"), "_blank")
  const rel = await link.getAttribute("rel")
  assert(rel)
  assert(rel.split(" ").includes("noopener"))
  const icon = link.locator("svg")
  assert.equal(await icon.count(), 1)
  assert(await icon.isVisible(), "GitHub icon is not visible")
  assert.equal(await icon.getAttribute("aria-hidden"), "true")
  const graphic = await icon.locator("path").getAttribute("d")
  assert(graphic)
  assert(graphic.length > 0, "GitHub icon has no graphic")

  const button = page.getByRole("button", { name: "Toggle theme", exact: true })
  assert.equal(await button.getAttribute("title"), "Toggle theme")
  assert.equal(await button.getAttribute("data-slot"), "dropdown-menu-trigger")
  const styles = await button.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      display: style.display,
      alignItems: style.alignItems,
      justifyContent: style.justifyContent,
      radius: style.borderRadius,
    }
  })
  assert(["flex", "inline-flex"].includes(styles.display), "Shared Button layout styles are not applied")
  assert.equal(styles.alignItems, "center")
  assert.equal(styles.justifyContent, "center")
  assert(parseFloat(styles.radius) > 0, "Shared Button border radius is not applied")
}

export async function verifyClientPage(page: Page, title: string) {
  await verifyPageFoundation(page)
  const main = page.getByRole("main")
  const heading = main.getByRole("heading", { level: 1 })
  await heading.waitFor()
  assert.equal(await heading.innerText(), title)
  const link = main.getByRole("link", { name: "GitHub repository (opens in a new tab)", exact: true })
  assert.equal((await main.innerText()).trim(), title, "Repository link must be presented as an icon")
  const [content, firstLine, secondLine] = await Promise.all([main.boundingBox(), heading.boundingBox(), link.boundingBox()])
  const viewport = page.viewportSize()
  assert(content && firstLine && secondLine && viewport, "Home page content is not visible")
  assert(Math.abs(content.x + content.width / 2 - viewport.width / 2) <= 2, "Home page content is not horizontally centered")
  assert(Math.abs(content.y + content.height / 2 - viewport.height / 2) <= 2, "Home page content is not vertically centered")
  assert(secondLine.y >= firstLine.y + firstLine.height, "GitHub icon must appear below the heading")
  assert(Math.abs(secondLine.x + secondLine.width / 2 - viewport.width / 2) <= 2, "GitHub icon is not centered")
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "Home page overflows horizontally",
  )
  assert(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
    "Home page overflows vertically",
  )
}
