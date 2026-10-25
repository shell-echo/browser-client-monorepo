import type { BrowserConfig } from "../../scripts/lib/contracts.mts"
import { verifyClientPage } from "../../scripts/lib/client-page-verification.mts"
import { verifyAdminTemplates } from "../../scripts/lib/admin-verification.mts"
import { join } from "node:path"

export default {
  path: "/",
  async verify({ page, runDir, passed }) {
    await verifyClientPage(page, "Overview")
    await page.screenshot({ path: join(runDir, "admin-desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await verifyClientPage(page, "Overview")
    await page.screenshot({ path: join(runDir, "admin-mobile.png"), fullPage: true })
    passed("Admin production page, GitHub link, shared styles and desktop / mobile centering passed")
  },
  verifyRoutes: verifyAdminTemplates,
} satisfies BrowserConfig["admin"]
