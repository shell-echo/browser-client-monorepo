import path from "path";

import { crx } from "@crxjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import zip from "vite-plugin-zip-pack";

import manifest from "./manifest.config";
import { name, version } from "./package.json";

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5174,
    cors: { origin: [/chrome-extension:\/\//] },
    hmr: { port: 5174 },
  },
  plugins: [react(), tailwindcss(), crx({ manifest }), zip({ outDir: "release", outFileName: `crx-${name}-${version}.zip` })],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    exclude: ["@workspace/ui", "@workspace/components", "@workspace/types"],
  },
});
