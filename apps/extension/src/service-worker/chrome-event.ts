import internal from "~/internal";

class ChromeEventServiceWorker {
  constructor() {
    this.registerTabsEvent();
    this.registerTabGroupsEvent();
    this.registerDebuggerEvent();
    this.registerDownloadsEvent();
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

  private registerTabGroupsEvent() {
    const emit = internal.event.emit.bind(internal.event);

    // chrome.tabGroups.on**
    chrome.tabGroups.onCreated.addListener((group) => emit("chrome:tabGroups:onCreated", { group }));
    chrome.tabGroups.onMoved.addListener((group) => emit("chrome:tabGroups:onMoved", { group }));
    chrome.tabGroups.onRemoved.addListener((group) => emit("chrome:tabGroups:onRemoved", { group }));
    chrome.tabGroups.onUpdated.addListener((group) => emit("chrome:tabGroups:onUpdated", { group }));
  }

  private registerDebuggerEvent() {
    const emit = internal.event.emit.bind(internal.event);

    // chrome.debugger.on**
    chrome.debugger.onDetach.addListener((source, reason) => emit("chrome:debugger:onDetach", { source, reason }));
    chrome.debugger.onEvent.addListener((source, method, params) =>
      emit("chrome:debugger:onEvent", { source, method, params }),
    );
  }

  private registerDownloadsEvent() {
    const emit = internal.event.emit.bind(internal.event);

    // chrome.downloads.on**
    chrome.downloads.onChanged.addListener((downloadDelta) => emit("chrome:downloads:onChanged", { downloadDelta }));
    chrome.downloads.onCreated.addListener((downloadItem) => emit("chrome:downloads:onCreated", { downloadItem }));
    // chrome.downloads.onDeterminingFilename.addListener
    chrome.downloads.onErased.addListener((downloadId) => emit("chrome:downloads:onErased", { downloadId }));
  }
}

export default ChromeEventServiceWorker;
