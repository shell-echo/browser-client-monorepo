import { defineManifest } from "@crxjs/vite-plugin"
import { webMatches } from "./src/bridge-policy.ts"

export default defineManifest({
  manifest_version: 3,
  name: "Browser Client",
  version: "0.1.0",
  description: "Browser Client extension for Chrome and Edge",
  minimum_chrome_version: "116",
  permissions: ["storage", "activeTab", "scripting", "sidePanel"],
  host_permissions: webMatches,
  incognito: "split",
  externally_connectable: { ids: [], matches: webMatches },
  content_scripts: [{ matches: webMatches, js: ["src/content.ts"], run_at: "document_idle", all_frames: false }],
  side_panel: { default_path: "sidepanel.html" },
  action: { default_title: "Browser Client", default_popup: "index.html" },
  options_page: "options.html",
  background: { service_worker: "src/background.ts", type: "module" },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
})
