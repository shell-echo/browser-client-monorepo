import type { BrowserConfig } from "../../scripts/lib/contracts.mts"
import assert from "node:assert/strict"
import { verifyExtensionBridge } from "../../scripts/lib/extension-bridge-verification.mts"
import {
  verifyExtensionPage,
  verifyExtensionSettings,
  verifyExtensionPreview,
} from "../../scripts/lib/extension-verification.mts"

export default {
  verifyPage: verifyExtensionPage,
  communicationOrigin: "http://127.0.0.1:3000",
  verifyConnections: verifyExtensionBridge,
  verifyInteractions: verifyExtensionSettings,
  verifyPreview: verifyExtensionPreview,
  async verifyBackground({ page, until }) {
    await until(
      async () => (await page.evaluate(() => chrome.storage.local.get("workspaceName"))).workspaceName === "Browser Client",
      "Background storage initialization",
    )
  },
  hmr: {
    file: "src/pages/options.tsx",
    update(source) {
      assert(source.includes(">Settings</h1>"), "Update the instance HMR assertion for the customized application")
      return source.replace(">Settings</h1>", ">Settings · HMR</h1>")
    },
    async verify({ page }) {
      await page.getByRole("heading", { name: "Settings · HMR", level: 1, exact: true }).waitFor()
    },
  },
} satisfies BrowserConfig["extension"]
