import { defineManifest } from "@crxjs/vite-plugin";
import constant from "@workspace/constant";

import pkg from "./package.json";

export default defineManifest(({ mode }) => ({
  manifest_version: 3,
  name: `${mode === "development" ? "[DEV] " : ""}${constant.extension.name}`,
  description: constant.extension.description,
  version: pkg.version,
  action: {
    default_popup: "src/action-popup/index.html",
  },
  background: {
    service_worker: "src/service-worker/main.ts",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content-script/application.ts"],
      run_at: "document_start",
    },
    {
      matches: ["<all_urls>"],
      js: ["src/content-script/inject.ts"],
      run_at: "document_start",
    },
  ],
  side_panel: {
    default_path: "src/side-panel/index.html",
  },
  permissions: ["sidePanel", "tabs", "activeTab", "tabGroups", "scripting", "debugger"],
  host_permissions: ["<all_urls>"],
  externally_connectable: {
    matches: ["<all_urls>"],
  },
  web_accessible_resources: [
    {
      resources: ["src/content-script/library/inject.js"],
      matches: ["<all_urls>"],
    },
  ],
}));
