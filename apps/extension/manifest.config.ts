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
  ],
  side_panel: {
    default_path: "src/side-panel/index.html",
  },
  permissions: ["sidePanel", "tabs"],
}));
