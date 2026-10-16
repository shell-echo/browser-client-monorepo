import { crx } from "@crxjs/vite-plugin"
import manifest from "./manifest.config.ts"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath, URL } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
const port = Number(process.env.EXTENSION_DEV_PORT ?? 5174)

export default defineConfig(({ command, mode }) => ({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", port, strictPort: true, ws: { clientPort: port } },
  build: { outDir: command === "serve" ? "dist-dev" : "dist" },
  plugins: [
    {
      name: "browser-client:theme-bootstrap",
      apply: "serve",
      enforce: "pre",
      resolveId(id) {
        if (id === "/theme-init.js") {
          return fileURLToPath(new URL("../../packages/ui/src/lib/theme-init.js", import.meta.url))
        }
      },
    },
    react(),
    tailwindcss(),
    ...(mode === "preview-ui" ? [] : [crx({ manifest })]),
  ],
}))
