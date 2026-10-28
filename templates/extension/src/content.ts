import { createPageAgent } from "@browser-client/extension-sdk/agent"
import { PORT_NAME } from "@browser-client/extension-sdk/protocol"

// ISOLATED world only. No window.postMessage/CustomEvent bridge into page scripts.
const scope = globalThis as typeof globalThis & { __browserClientPageAgent?: { connect(): void } }
if (!scope.__browserClientPageAgent) {
  const agent = createPageAgent({
    connect() {
      const port = chrome.runtime.connect({ name: PORT_NAME })
      port.onDisconnect.addListener(() => {
        try {
          void chrome.runtime.lastError
        } catch {
          /* Extension context was reloaded. */
        }
      })
      return port
    },
    read: () => ({
      title: document.title.slice(0, 512),
      url: `${location.origin}${location.pathname}`.slice(0, 2048),
      selection: window.getSelection()?.toString().slice(0, 4096) ?? "",
    }),
  })
  scope.__browserClientPageAgent = { connect: agent.connect }
  agent.connect()
  const show = (event: PageTransitionEvent) => {
    if (event.isTrusted && event.persisted) agent.connect()
  }
  const hide = (event: PageTransitionEvent) => {
    if (!event.isTrusted) return
    agent.suspend()
    if (!event.persisted) {
      agent.close()
      delete scope.__browserClientPageAgent
      window.removeEventListener("pagehide", hide)
      window.removeEventListener("pageshow", show)
    }
  }
  window.addEventListener("pagehide", hide)
  window.addEventListener("pageshow", show)
}
