import internal from "~/internal";

class Trust {
  private tabIds: number[] = [];

  constructor() {
    if (internal.runtime.platform !== "service-worker") return;
    internal.event.on(
      "chrome:tabs:onRemoved",
      ({ payload }) => (this.tabIds = this.tabIds.filter((tabId) => tabId !== payload.tabId)),
    );
  }

  public addTab(tab: chrome.tabs.Tab) {
    if (!tab.id || this.tabIds.includes(tab.id)) return;
    this.tabIds.push(tab.id);
  }

  public isTrustTab(tab: chrome.tabs.Tab) {
    if (internal.runtime.platform !== "service-worker" || !tab.id) return false;

    if (this.tabIds.includes(tab.id)) return true;

    const trust_host = (import.meta.env.VITE_TRUST_HOST || "").split(",");

    try {
      const url = new URL(tab.url || "");

      return trust_host.includes(url.host);
    } catch {
      return false;
    }
  }
}

export default Trust;
