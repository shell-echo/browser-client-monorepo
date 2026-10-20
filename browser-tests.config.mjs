import assert from "node:assert/strict"
import { join } from "node:path"
import { verifyClientPage } from "./scripts/lib/client-page-verification.mjs"
import { verifyAdminTemplates } from "./scripts/lib/admin-verification.mjs"

// Replace these business assertions when customizing the starter pages.
// The runners always enforce runtime errors, themes, HMR and source isolation.
async function client({ page, title, name, runDir }) {
  await verifyClientPage(page, title)
  await page.screenshot({ path: join(runDir, `${name}-desktop.png`), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await verifyClientPage(page, title)
  await page.screenshot({ path: join(runDir, `${name}-mobile.png`), fullPage: true })
}

export default {
  web: {
    path: "/",
    async verify({ page, runDir, passed }) {
      assert.equal(await page.title(), "Browser Client")
      await client({ page, title: "Web Client", name: "web", runDir })
      passed("Web production page, GitHub link, shared styles and desktop / mobile centering passed")
    },
  },
  admin: {
    path: "/",
    async verify({ page, runDir, passed }) {
      await client({ page, title: "Admin Client", name: "admin", runDir })
      passed("Admin production page, GitHub link, shared styles and desktop / mobile centering passed")
    },
    async verifyRoutes({ pageFor, url, runDir, errors, passed }) {
      await verifyAdminTemplates({ pageFor, url, runDir, errors, passed })
    },
  },
  extension: {
    async verifyPage({ page }) {
      await verifyClientPage(page, "Extension Client")
    },
    async verifyBackground({ page, until }) {
      await until(
        async () => (await page.evaluate(() => chrome.storage.local.get("workspaceName"))).workspaceName === "Browser Client",
        "Background storage initialization",
      )
    },
    hmr: {
      file: "apps/extension/src/App.tsx",
      update(source) {
        assert(source.includes('title="Extension Client"'), "Update extension.hmr for the customized application")
        return source.replace('title="Extension Client"', 'title="Extension Client · HMR"')
      },
      async verify({ page }) {
        await page.getByRole("heading", { name: "Extension Client · HMR", exact: true }).waitFor()
      },
    },
  },
}
