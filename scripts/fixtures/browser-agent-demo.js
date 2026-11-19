import { createClient, chromeTransport } from "/sdk/client.mts"
import { invokeBrowserAgentTool } from "/sdk/tools.mts"

// This fictional business page owns a real SDK connection. Its public tools
// receive decisions from the separate recording/Agent process, never DOM selectors.
let client
let granted = []
const el = (id) => document.getElementById(id)
const input = el("draft")
input.addEventListener("input", () => {
  el("input-state").textContent = `Input event received · ${input.value.length} characters`
})
el("create").addEventListener("click", () => {
  if (!input.value.trim()) return
  el("draft-result").classList.add("done")
  el("draft-result").querySelector("b").textContent = input.value
  el("draft-result").querySelector("p").textContent = "Saved locally. Verify this note in the activity below."
  el("draft-result").querySelector("span").textContent = "✓"
  el("activity-result").textContent = input.value
  el("activity-detail").textContent = "Draft saved by the page click handler · no external submission."
})
Object.assign(window, {
  browserAgentDemo: {
    async connect(id) {
      client = createClient({ connect: chromeTransport(id), reconnect: true })
      client.subscribe("access", (value) => {
        granted = value.capabilities ?? []
        el("bridge-status").textContent = granted.length ? "Exact document approved" : "Native Port connected · no page grant"
        void window.browserAgentAccessChanged?.(granted).catch(() => {})
      })
      await client.connect()
      return await client.request("bridge.info", {})
    },
    async requestAccess() {
      return await client.request("access.request", {
        capabilities: ["page.read", "page.observe", "page.click", "page.type", "page.scroll"],
      })
    },
    approved() {
      return granted.includes("page.observe")
    },
    async tool(name, input) {
      try {
        return {
          ok: true,
          result: await invokeBrowserAgentTool(
            (method, params, options) => client.request(method, params, options),
            name,
            input,
          ),
        }
      } catch (error) {
        return { ok: false, code: error.code ?? "ERROR", message: error instanceof Error ? error.message : "Tool failed" }
      }
    },
    close() {
      client.close()
    },
  },
})
