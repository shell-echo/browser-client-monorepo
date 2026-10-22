import type { Page } from "playwright"
import type { BrowserConfig } from "./scripts/lib/contracts.mts"
import assert from "node:assert/strict"
import { join } from "node:path"
import { verifyClientPage } from "./scripts/lib/client-page-verification.mts"
import { verifyAdminTemplates } from "./scripts/lib/admin-verification.mts"
import { verifyWebTemplate } from "./scripts/lib/web-verification.mts"
import { verifyExtensionPage, verifyExtensionSettings, verifyExtensionPreview } from "./scripts/lib/extension-verification.mts"

// Replace these business assertions when customizing the starter pages.
// The runners always enforce runtime errors, themes, HMR and source isolation.
async function client({ page, title, name, runDir }: { page: Page; title: string; name: string; runDir: string }) {
  await verifyClientPage(page, title)
  await page.screenshot({ path: join(runDir, `${name}-desktop.png`), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await verifyClientPage(page, title)
  await page.screenshot({ path: join(runDir, `${name}-mobile.png`), fullPage: true })
}

export default {
  web: {
    path: "/",
    verify: verifyWebTemplate,
  },
  admin: {
    path: "/",
    async verify({ page, runDir, passed }) {
      await client({ page, title: "Overview", name: "admin", runDir })
      passed("Admin production page, GitHub link, shared styles and desktop / mobile centering passed")
    },
    async verifyRoutes({ pageFor, url, runDir, errors, passed }) {
      await verifyAdminTemplates({ pageFor, url, runDir, errors, passed })
    },
  },
  extension: {
    verifyPage: verifyExtensionPage,
    verifyInteractions: verifyExtensionSettings,
    verifyPreview: verifyExtensionPreview,
    async verifyBackground({ page, until }) {
      await until(
        async () => (await page.evaluate(() => chrome.storage.local.get("workspaceName"))).workspaceName === "Browser Client",
        "Background storage initialization",
      )
    },
    hmr: {
      file: "apps/extension/src/pages/options.tsx",
      update(source) {
        assert(source.includes(">Settings</h1>"), "Update extension.hmr for the customized application")
        return source.replace(">Settings</h1>", ">Settings · HMR</h1>")
      },
      async verify({ page }) {
        await page.getByRole("heading", { name: "Settings · HMR", level: 1, exact: true }).waitFor()
      },
    },
  },
} satisfies BrowserConfig
