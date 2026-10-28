import assert from "node:assert/strict"
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"
import { join, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { createCommandRunner, handleCancellation } from "./lib/commands.mts"
import { finishVerification } from "./lib/verification.mts"
import { scanAccessibility } from "./lib/accessibility.mts"
import type { MaintenanceReport } from "./lib/contracts.mts"

const root = fileURLToPath(new URL("../", import.meta.url))
const base = join(root, ".reinit/verification")
const runDir = resolve(process.argv[2] ?? join(base, `accessibility-engine-${Date.now()}`))
assert(
  relative(base, runDir) && !relative(base, runDir).startsWith(".."),
  "Accessibility reports must stay in verification output",
)
await mkdir(runDir, { recursive: true, mode: 0o700 })
const report: MaintenanceReport & { runDir: string; checks: string[] } = {
  runDir,
  startedAt: new Date().toISOString(),
  checks: [],
}
const runner = createCommandRunner()
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const dispose = handleCancellation(runner, () => {
  void browser?.close().catch(() => {})
})
try {
  browser = await chromium.launch({ channel: "chromium", headless: true })
  const page = await browser.newPage()
  const document = (content: string) =>
    `<!doctype html><html lang="en"><head><title>Accessibility engine regression</title></head><body><main><h1>Regression fixture</h1>${content}</main></body></html>`
  await page.setContent(document('<button type="button">A named action</button>'))
  await scanAccessibility(page, runDir, "valid-fixture", "light")
  report.checks.push("The actual axe engine accepts an accessible document")
  await page.setContent(document('<button type="button"></button>'))
  await assert.rejects(scanAccessibility(page, runDir, "missing-label-fixture", "light"), /button-name/)
  report.checks.push("The actual axe engine rejects a nameless button")
  await page.setContent(document('<p style="color:#eee;background:#fff">Deliberately unreadable contrast</p>'))
  await assert.rejects(scanAccessibility(page, runDir, "contrast-fixture", "light"), /color-contrast/)
  report.checks.push("The actual axe engine rejects insufficient text contrast")
  report.status = "passed"
} catch (error) {
  report.status = "failed"
  report.failure = error instanceof Error ? error.stack : String(error)
  throw error
} finally {
  await finishVerification(report, [() => browser?.close(), runner.close, dispose])
}
