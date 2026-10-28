import type { Page } from "playwright"
import type { AxeResults, RunOptions } from "axe-core"
import axe from "axe-core"
import assert from "node:assert/strict"
import { appendFile } from "node:fs/promises"
import { join } from "node:path"
import { chooseTheme } from "./theme-verification.mts"

export const accessibilityTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
export interface AccessibilityScan {
  label: string
  url: string
  theme: string
  width: number
  engine: string
  violations: {
    id: string
    impact: string | null
    help: string
    helpUrl: string
    nodes: { target: string[]; summary?: string }[]
  }[]
  incomplete: { id: string; nodes: number }[]
  passes: number
}
export interface AccessibilityCoverage {
  status: "passed"
  engine: string
  scans: number
  violations: 0
}
export function accessibilityScan(
  result: AxeResults,
  context: Omit<AccessibilityScan, "engine" | "violations" | "incomplete" | "passes">,
): AccessibilityScan {
  assert(
    result &&
      typeof result.testEngine?.version === "string" &&
      Array.isArray(result.violations) &&
      Array.isArray(result.incomplete) &&
      Array.isArray(result.passes),
    "Malformed accessibility engine result",
  )
  return {
    ...context,
    engine: result.testEngine.version,
    passes: result.passes.length,
    violations: result.violations.map(({ id, impact, help, helpUrl, nodes }) => ({
      id,
      impact: impact ?? null,
      help,
      helpUrl,
      nodes: nodes.map(({ target, failureSummary }) => ({ target: target.map(String), summary: failureSummary })),
    })),
    incomplete: result.incomplete.map(({ id, nodes }) => ({ id, nodes: nodes.length })),
  }
}
export function assertAccessible(scan: AccessibilityScan) {
  assert.equal(
    scan.violations.length,
    0,
    `Accessibility violations in ${scan.label} (${scan.theme}, ${scan.width}px): ${JSON.stringify(scan.violations)}`,
  )
}
export async function scanAccessibility(page: Page, runDir: string, label: string, theme: string) {
  await page.locator("body").waitFor()
  await page.evaluate(() => document.fonts.ready)
  // DevTools evaluation installs the audit engine only in the test page. It
  // neither changes production CSP nor bundles any audit code into clients.
  await page.evaluate(axe.source)
  const options: RunOptions = {
    runOnly: { type: "tag", values: accessibilityTags },
    resultTypes: ["violations", "incomplete", "passes"],
  }
  const result = await page.evaluate(
    (options) => (globalThis as unknown as { axe: typeof axe }).axe.run(document, options),
    options,
  )
  const scan = accessibilityScan(result, { label, url: page.url(), theme, width: page.viewportSize()?.width ?? 0 })
  // Keep rule IDs/targets, not page HTML or form values, in diagnostic artifacts.
  await appendFile(join(runDir, "accessibility.jsonl"), JSON.stringify(scan) + "\n")
  assertAccessible(scan)
  return scan
}
export async function verifyAccessibility(page: Page, runDir: string, label: string, widths = [1280, 320]) {
  const viewport = page.viewportSize()
  const namespace = await page.locator("html").getAttribute("data-app-namespace")
  assert(namespace, "Accessibility page must have a checked instance namespace")
  const original = await page.evaluate((key) => localStorage.getItem(key), `browser-client-theme:${namespace}`)
  const mode = original === "light" || original === "dark" ? original : "system"
  const scans: AccessibilityScan[] = []
  try {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of ["light", "dark"] as const) {
        await chooseTheme(page, theme)
        await page.waitForFunction((mode) => document.documentElement.classList.contains(mode), theme)
        scans.push(await scanAccessibility(page, runDir, label, theme))
      }
    }
  } finally {
    if (!page.isClosed()) {
      await chooseTheme(page, mode)
      await page.evaluate(
        ({ key, original }) => {
          if (original === null) localStorage.removeItem(key)
          else localStorage.setItem(key, original)
        },
        { key: `browser-client-theme:${namespace}`, original },
      )
      if (viewport) await page.setViewportSize(viewport)
    }
  }
  return scans
}
export function accessibilityCoverage(scans: AccessibilityScan[]): AccessibilityCoverage {
  assert(scans.length > 0, "Accessibility scans are missing")
  for (const scan of scans) assertAccessible(scan)
  return { status: "passed", engine: axe.version, scans: scans.length, violations: 0 }
}
