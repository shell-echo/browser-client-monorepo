import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath, URL } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { applicationSettings, identityPlugin } from "../../scripts/lib/app-runtime.mts"

const application = applicationSettings(import.meta.url)

// https://vite.dev/config/
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: application.port, strictPort: true },
  plugins: [identityPlugin(application), react(), tailwindcss()],
})
