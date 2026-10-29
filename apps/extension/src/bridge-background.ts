import { createBroker } from "@browser-client/extension-sdk/broker"
import { PORT_NAME } from "@browser-client/extension-sdk/protocol"
import { webOrigins } from "./bridge-policy"
import { readWorkspaceName, validateWorkspaceName } from "./lib/settings"

const grantKey = `bridge:grants:v1:${chrome.extension.inIncognitoContext ? "private" : "regular"}`
const broker = createBroker({
  instance: chrome.runtime.id,
  policy: { extensionId: chrome.runtime.id, origins: webOrigins, incognito: chrome.extension.inIncognitoContext },
  loadGrants: async () => (await chrome.storage.session.get(grantKey))[grantKey],
  saveGrants: async (value) => {
    await chrome.storage.session.set({ [grantKey]: value })
  },
  workspace: readWorkspaceName,
  setWorkspace: async (value) => {
    await chrome.storage.local.set({ workspaceName: validateWorkspaceName(value) })
  },
  authorizeOrigin: async (origin) => {
    const url = new URL(origin)
    return chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })
  },
  activeTab: async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (tab?.id === undefined) throw new Error("No selected tab")
    return tab.id
  },
  preparePage: async (tabId) => {
    const scripts = chrome.runtime.getManifest().content_scripts?.[0]?.js
    if (!scripts?.length) throw new Error("Content agent entry is missing")
    const result = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: scripts })
    const documentId = result[0]?.documentId
    if (!documentId) throw new Error("Document identity is unavailable")
    await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      func: async () => {
        // CRXJS's isolated loader can finish its module import asynchronously.
        const scope = globalThis as typeof globalThis & { __browserClientPageAgent?: { connect(): void } }
        for (let attempt = 0; attempt < 20; attempt++) {
          if (scope.__browserClientPageAgent) {
            scope.__browserClientPageAgent.connect()
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error("Page agent did not initialize")
      },
    })
    return documentId
  },
})

// Register synchronously; initialization promises must not delay MV3 listeners.
chrome.runtime.onConnect.addListener((port) => broker.attach(port, port.sender, false, port.name))
chrome.runtime.onConnectExternal.addListener((port) => broker.attach(port, port.sender, true, port.name))
const report = (error: unknown) => console.error("Bridge state update failed", error instanceof Error ? error.name : "Error")
chrome.tabs.onRemoved.addListener((tabId) => {
  void broker.invalidateTab(tabId).catch(report)
})
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" || change.url) void broker.invalidateTab(tabId).catch(report)
})
chrome.permissions.onRemoved.addListener(() => {
  void broker.revokeAll().catch(report)
})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.hasOwn(changes, "workspaceName")) broker.workspaceChanged()
})
// Expose only a typed channel name to the content entry; no public raw API proxy.
export { PORT_NAME }
