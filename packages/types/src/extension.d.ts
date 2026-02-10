/// <reference types="chrome" />
/// <reference path="./common.d.ts" />

declare namespace Extension {
  type Runtime = {
    platform: "service-worker" | "content-script" | "action-popup" | "side-panel" | "web";
    service?: string;
    tabId?: number;
    windowId?: number;
  };

  namespace Internal {
    type State = "initializing" | "ready" | "error";
    type InitParams = { platform: Extension.Runtime["platform"]; service?: string };
  }

  namespace Event {
    type InternalPayload = {
      "internal:init:state:change": { state?: Internal.State };
    };

    type ContentScriptPayload = {
      "content-script:application:init": { tab: chrome.tabs.Tab };
      "content-script:inject": { tab: chrome.tabs.Tab };
    };

    type ServiceWorkerPayload = {
      "service-worker:application:inject": { tab: chrome.tabs.Tab };
    };

    // https://developer.chrome.com/docs/extensions/reference/api/tabs?hl=zh-cn#event
    type ChromeTabsPayload = {
      "chrome:tabs:onActivated": { activeInfo: chrome.tabs.OnActivatedInfo };
      "chrome:tabs:onAttached": { tabId: number; attachInfo: chrome.tabs.OnAttachedInfo };
      "chrome:tabs:onCreated": { tab: chrome.tabs.Tab };
      "chrome:tabs:onDetached": { tabId: number; detachInfo: chrome.tabs.OnDetachedInfo };
      "chrome:tabs:onHighlighted": { highlightInfo: chrome.tabs.OnHighlightedInfo };
      "chrome:tabs:onMoved": { tabId: number; moveInfo: chrome.tabs.OnMovedInfo };
      "chrome:tabs:onRemoved": { tabId: number; removeInfo: chrome.tabs.OnRemovedInfo };
      "chrome:tabs:onReplaced": { addedTabId: number; removedTabId: number };
      "chrome:tabs:onUpdated": { tabId: number; changeInfo: chrome.tabs.OnUpdatedInfo; tab: chrome.tabs.Tab };
      "chrome:tabs:onZoomChange": { ZoomChangeInfo: chrome.tabs.OnZoomChangeInfo };
    };

    type ChromeEventPayload = ChromeTabsPayload;

    type Payload = InternalPayload & ContentScriptPayload & ServiceWorkerPayload & ChromeEventPayload;

    type Type = keyof Payload;
    type Params<T extends Type> = {
      payload: Payload[T];
      timestamp: Timestamp;
      from: Runtime & { sender?: chrome.runtime.MessageSender };
    };
    type Handler<T extends Type> = (params: Params<T>) => void;
  }

  namespace Invoke {
    type ChromeTabs = {
      "chrome:tabs:current": { params: undefined; resp?: chrome.tabs.Tab };
      "chrome:tabs:captureVisibleTab": {
        params: { windowId?: number; options?: extensionTypes.ImageDetails };
        resp: string;
      };
      // "chrome:tabs:connect": { params: { tabId: number; connectInfo?: chrome.tabs.ConnectInfo }; resp: chrome.runtime.Port };
      "chrome:tabs:create": { params: { createProperties: chrome.tabs.CreateProperties }; resp: chrome.tabs.Tab };
      "chrome:tabs:detectLanguage": { params: { tabId?: number }; resp: string };
      "chrome:tabs:discard": { params: { tabId?: number }; resp?: chrome.tabs.Tab };
      "chrome:tabs:duplicate": { params: { tabId: number }; resp?: chrome.tabs.Tab };
      "chrome:tabs:get": { params: { tabId: number }; resp: chrome.tabs.Tab };
      "chrome:tabs:getCurrent": { params: undefined; resp?: chrome.tabs.Tab };
      "chrome:tabs:getZoom": { params: { tabId?: number }; resp: number };
      "chrome:tabs:getZoomSettings": { params: { tabId?: number }; resp: chrome.tabs.ZoomSettings };
      "chrome:tabs:goBack": { params: { tabId?: number }; resp: void };
      "chrome:tabs:goForward": { params: { tabId?: number }; resp: void };
      "chrome:tabs:group": { params: { options: chrome.tabs.GroupOptions }; resp: number };
      "chrome:tabs:highlight": { params: { highlightInfo: chrome.tabs.HighlightInfo }; resp: chrome.windows.Window };
      "chrome:tabs:move": { params: { tabIds: number[]; moveProperties: chrome.tabs.MoveProperties }; resp: chrome.tabs.Tab[] };
      "chrome:tabs:query": { params: { queryInfo: chrome.tabs.QueryInfo }; resp: chrome.tabs.Tab[] };
      "chrome:tabs:reload": {
        params: { tabId?: number; reloadProperties?: chrome.tabs.ReloadProperties };
        resp: void;
      };
      "chrome:tabs:remove": { params: { tabIds: number[] }; resp: void };
      // "chrome:tabs:sendMessage": { params: { tabId: number; message: any; options: chrome.tabs.MessageSendOptions }; resp: any; };
      "chrome:tabs:setZoom": { params: { tabId?: number; zoomFactor: number }; resp: void };
      "chrome:tabs:setZoomSettings": { params: { tabId?: number; zoomSettings: chrome.tabs.ZoomSettings }; resp: void };
      "chrome:tabs:ungroup": { params: { tabIds: number | [number, ...number[]] }; resp: void };
      "chrome:tabs:update": {
        params: { tabId?: number; updateProperties: chrome.tabs.UpdateProperties };
        resp?: chrome.tabs.Tab;
      };
    };

    type Definition = ChromeTabs;

    type Type = keyof Definition;
    type Params<K extends Type> = Definition[K]["params"];
    type Resp<K extends Type> = Definition[K]["resp"];
    type DispatchArgs<T extends Type> =
      undefined extends Params<T>
        ? [params?: Params<T>, sender?: chrome.runtime.MessageSender]
        : [params: Params<T>, sender?: chrome.runtime.MessageSender];
    type Handler<T extends Type> = (...args: DispatchArgs<T>) => Promise<Resp<T>>;
  }
}
