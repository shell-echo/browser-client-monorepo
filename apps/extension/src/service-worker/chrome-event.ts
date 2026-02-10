import internal from "~/internal";

class ChromeEventServiceWorker {
  constructor() {
    this.registerTabsEvent();
  }

  private registerTabsEvent = () => {
    const emit = internal.event.emit.bind(internal.event);

    // chrome.tabs.on**
    chrome.tabs.onActivated.addListener((activeInfo) => emit("chrome:tabs:onActivated", { activeInfo }));
    chrome.tabs.onAttached.addListener((tabId, attachInfo) => emit("chrome:tabs:onAttached", { tabId, attachInfo }));
    chrome.tabs.onCreated.addListener((tab) => emit("chrome:tabs:onCreated", { tab }));
    chrome.tabs.onDetached.addListener((tabId, detachInfo) => emit("chrome:tabs:onDetached", { tabId, detachInfo }));
    chrome.tabs.onHighlighted.addListener((highlightInfo) => emit("chrome:tabs:onHighlighted", { highlightInfo }));
    chrome.tabs.onMoved.addListener((tabId, moveInfo) => emit("chrome:tabs:onMoved", { tabId, moveInfo }));
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => emit("chrome:tabs:onRemoved", { tabId, removeInfo }));
    chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) =>
      emit("chrome:tabs:onReplaced", { addedTabId, removedTabId }),
    );
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => emit("chrome:tabs:onUpdated", { tabId, changeInfo, tab }));
    chrome.tabs.onZoomChange.addListener((ZoomChangeInfo) => emit("chrome:tabs:onZoomChange", { ZoomChangeInfo }));
  };
}

export default ChromeEventServiceWorker;
