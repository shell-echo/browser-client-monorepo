import constant from "@workspace/constant";

import internal from "~/internal";

const chrometabs: { [T in keyof Extension.Invoke.ChromeTabs]: Extension.Invoke.Handler<T> } = {
  "chrome:tabs:current": async (_, sender) => sender?.tab,

  // https://developer.chrome.com/docs/extensions/reference/api/tabs?hl=zh-cn#method
  "chrome:tabs:captureVisibleTab": (params) => {
    const { windowId, options } = params ?? {};

    if (windowId !== undefined && options !== undefined) {
      return chrome.tabs.captureVisibleTab(windowId, options);
    }
    if (windowId !== undefined) {
      return chrome.tabs.captureVisibleTab(windowId);
    }
    if (options !== undefined) {
      return chrome.tabs.captureVisibleTab(options);
    }

    return chrome.tabs.captureVisibleTab();
  },
  "chrome:tabs:create": (params) => chrome.tabs.create(params.createProperties),
  "chrome:tabs:detectLanguage": (params) => chrome.tabs.detectLanguage(params?.tabId),
  "chrome:tabs:discard": (params) => chrome.tabs.discard(params?.tabId),
  "chrome:tabs:duplicate": (params) => chrome.tabs.duplicate(params.tabId),
  "chrome:tabs:get": (params) => chrome.tabs.get(params.tabId),
  "chrome:tabs:getCurrent": () => chrome.tabs.getCurrent(),
  "chrome:tabs:getZoom": (params) => chrome.tabs.getZoom(params?.tabId),
  "chrome:tabs:getZoomSettings": (params) => chrome.tabs.getZoomSettings(params?.tabId),
  "chrome:tabs:goBack": () => chrome.tabs.goBack(),
  "chrome:tabs:goForward": (params) => chrome.tabs.goForward(params?.tabId),
  "chrome:tabs:group": (params) => chrome.tabs.group(params.options),
  "chrome:tabs:highlight": (params) => chrome.tabs.highlight(params.highlightInfo),
  "chrome:tabs:move": (params) => chrome.tabs.move(params.tabIds, params.moveProperties),
  "chrome:tabs:query": (params) => chrome.tabs.query(params.queryInfo),
  "chrome:tabs:reload": (params) => {
    const { tabId, reloadProperties } = params ?? {};

    if (tabId !== undefined && reloadProperties !== undefined) {
      return chrome.tabs.reload(tabId, reloadProperties);
    }
    if (tabId !== undefined) {
      return chrome.tabs.reload(tabId);
    }
    if (reloadProperties !== undefined) {
      return chrome.tabs.reload(reloadProperties);
    }

    return chrome.tabs.reload();
  },
  "chrome:tabs:remove": (params) => chrome.tabs.remove(params.tabIds),
  "chrome:tabs:setZoom": (params) => chrome.tabs.setZoom(params.tabId, params.zoomFactor),
  "chrome:tabs:setZoomSettings": (params) => chrome.tabs.setZoomSettings(params.tabId, params.zoomSettings),
  "chrome:tabs:ungroup": (params) => chrome.tabs.ungroup(params.tabIds),
  "chrome:tabs:update": (params) => chrome.tabs.update(params.tabId, params.updateProperties),
};

export type InvokeTransportMessage<T extends Extension.Invoke.Type> = {
  type: typeof constant.extension.invoke.transport.message.type;
  invoke: T;
  params: Extension.Invoke.Params<T>;
};

class Invoke {
  private handler: { [T in Extension.Invoke.Type]: Extension.Invoke.Handler<T> } = chrometabs;

  constructor() {}

  dispatch<T extends Extension.Invoke.Type>(invoke: T, ...args: Extension.Invoke.DispatchArgs<T>) {
    const [params, sender] = args;

    return new Promise<Extension.Invoke.Resp<T>>((resolve, reject) => {
      if (internal.runtime.platform !== "service-worker") {
        chrome.runtime?.sendMessage(
          { type: constant.extension.invoke.transport.message.type, invoke, params } as InvokeTransportMessage<T>,
          (resp: { success: boolean; data: Promise<Extension.Invoke.Resp<T>>; message: string }) => {
            if (!resp.success) return reject(resp.message);
            resolve(resp.data);
          },
        );
      }

      // deal
      const handler = this.handler[invoke] as Extension.Invoke.Handler<T>;
      if (!handler) {
        reject(`${invoke} handler is undefined.`);

        return;
      }
      handler(params, sender)
        .then((resp) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(err);
          resolve(resp);
        })
        .catch((reason) => reject(reason));

      return;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
    if (internal.runtime.platform !== "service-worker" || typeof message !== "object") return;
    const type = message.type;
    if (type !== constant.extension.invoke.transport.message.type) return;

    const { invoke, params } = message as InvokeTransportMessage<Extension.Invoke.Type>;
    this.dispatch(invoke, params, sender)
      .then((resp) => sendResponse({ success: true, data: resp, sender, message: "ok" }))
      .catch((reason) => sendResponse({ success: false, data: reason, message: reason.msg || reason.toString() }));

    return true;
  }
}

export default Invoke;
