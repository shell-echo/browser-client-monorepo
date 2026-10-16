import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath, URL } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  plugins: [react(), tailwindcss()],
})
