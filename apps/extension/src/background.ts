// Register listeners at the top level so Manifest V3 can wake this worker.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.storage.local
      .get("workspaceName")
      .then((settings) => {
        if (settings.workspaceName === undefined) {
          return chrome.storage.local.set({ workspaceName: "Browser Client" })
        }
      })
      .catch((error: unknown) => console.error("Unable to initialize extension settings", error))
  }
})
