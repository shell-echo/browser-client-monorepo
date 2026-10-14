import { defineManifest } from "@crxjs/vite-plugin"

export default defineManifest({
  manifest_version: 3,
  name: "Browser Client",
  version: "0.1.0",
  description: "Browser Client 的 Chrome / Edge 扩展",
  permissions: ["storage"],
  action: { default_title: "Browser Client", default_popup: "index.html" },
  options_page: "options.html",
  background: { service_worker: "src/background.ts", type: "module" },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
})
