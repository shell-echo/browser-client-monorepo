import constant from "@workspace/constant";
import helper from "@workspace/helper";

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
  "chrome:tabs:create": async (params) => {
    const { url, ...createProps } = params.createProperties;
    if (params.createProperties.openerTabId) {
      const opener = await chrome.tabs.get(params.createProperties.openerTabId);
      const emptyTab = await chrome.tabs.create(createProps);
      if (internal.trust.isTrustTab(opener)) internal.trust.addTab(emptyTab);
      const tab = await chrome.tabs.update(emptyTab.id, { url });

      return tab || emptyTab;
    }

    return await chrome.tabs.create(params.createProperties);
  },
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

const chrometabgroups: { [T in keyof Extension.Invoke.ChromeTabGroups]: Extension.Invoke.Handler<T> } = {
  "chrome:tabGroups:get": (params) => chrome.tabGroups.get(params.groupId),
  "chrome:tabGroups:move": (params) => chrome.tabGroups.move(params.groupId, params.moveProperties),
  "chrome:tabGroups:query": (params) => chrome.tabGroups.query(params.queryInfo),
  "chrome:tabGroups:update": (params) => chrome.tabGroups.update(params.groupId, params.updateProperties),
};

const chromedebugger: { [T in keyof Extension.Invoke.ChromeDebugger]: Extension.Invoke.Handler<T> } = {
  "chrome:debugger:attach": (params) => chrome.debugger.attach(params.target, params.requiredVersion),
  "chrome:debugger:detach": (params) => chrome.debugger.detach(params),
  "chrome:debugger:getTargets": () => chrome.debugger.getTargets(),
  "chrome:debugger:sendCommand": (params) => chrome.debugger.sendCommand(params.target, params.method, params.commandParams),
};

const chromedownloads: { [T in keyof Extension.Invoke.ChromeDownloads]: Extension.Invoke.Handler<T> } = {
  "chrome:downloads:acceptDanger": (params) => chrome.downloads.acceptDanger(params.downloadId),
  "chrome:downloads:cancel": (params) => chrome.downloads.cancel(params.downloadId),
  "chrome:downloads:download": (params) => chrome.downloads.download(params.options),
  "chrome:downloads:erase": (params) => chrome.downloads.erase(params.query),
  "chrome:downloads:getFileIcon": (params) => chrome.downloads.getFileIcon(params.downloadId, params.options),
  "chrome:downloads:open": (params) => chrome.downloads.open(params.downloadId),
  "chrome:downloads:pause": (params) => chrome.downloads.pause(params.downloadId),
  "chrome:downloads:removeFile": (params) => chrome.downloads.removeFile(params.downloadId),
  "chrome:downloads:resume": (params) => chrome.downloads.resume(params.downloadId),
  "chrome:downloads:search": (params) => chrome.downloads.search(params.query),
  "chrome:downloads:setUiOptions": (params) => chrome.downloads.setUiOptions(params.options),
  "chrome:downloads:show": async (params) => chrome.downloads.show(params.downloadId),
  "chrome:downloads:showDefaultFolder": async () => chrome.downloads.showDefaultFolder(),
};

const serviceWorker: { [T in keyof Extension.Invoke.ServiceWorker]: Extension.Invoke.Handler<T> } = {
  "service-worker:fetch": async (args) => {
    const url = new URL(args.url);
    const { query, ...init } = args.init ?? {};
    Object.keys(query || {}).forEach((key) => {
      const param = (args.init?.query || {})[key];
      if (Array.isArray(param)) {
        param.forEach((value) => {
          url.searchParams.append(key, value);
        });
      } else {
        url.searchParams.append(key, `${(args.init?.query || {})[key]}`);
      }
    });

    const resp = await fetch(url, { ...init, method: args.method });
    const headers = Object.fromEntries(resp.headers.entries());
    const body = helper.utils.arrayBufferToBase64(await resp.arrayBuffer());

    return {
      status: resp.status,
      statusText: resp.statusText,
      ok: resp.ok,
      redirected: resp.redirected,
      type: resp.type,
      url: resp.url,
      headers,
      body,
    };
  },
};

const web: { [T in keyof Extension.Invoke.Web]: Extension.Invoke.Handler<T> } = {
  "web:runtime:evaluate": (params) =>
    chrome.scripting.executeScript({
      world: "MAIN",
      target: { tabId: params.tabId },
      args: [{ args: params.args, code: params.code }],
      func: async (args) => {
        const cr = new Function(`return ${args.code}`)();
        if (typeof cr === "function") {
          try {
            return { success: true, data: await cr(...(args.args || [])), message: "ok" };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (error: any) {
            return { success: false, data: null, message: error.toString() };
          }
        }

        return { success: true, data: cr, message: "ok" };
      },
    }),
};

export type InvokeTransportMessage<T extends Extension.Invoke.Type> = {
  type: typeof constant.extension.invoke.transport.message.type;
  invoke: T;
  params: Extension.Invoke.Params<T>;
};

class Invoke {
  private handler: { [T in Extension.Invoke.Type]: Extension.Invoke.Handler<T> } = {
    ...chrometabs,
    ...chrometabgroups,
    ...chromedebugger,
    ...chromedownloads,
    ...serviceWorker,
    ...web,
  };

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

        return;
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

  private isTrustedSender(sender: chrome.runtime.MessageSender) {
    if (sender.id && sender.id === chrome.runtime.id) return true;
    if (sender.tab) return internal.trust.isTrustTab(sender.tab);
    const senderUrl = sender.url || sender.origin;

    return Boolean(senderUrl);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
    if (internal.runtime.platform !== "service-worker" || typeof message !== "object") return false;
    const type = message.type;
    if (type !== constant.extension.invoke.transport.message.type) return false;
    if (!this.isTrustedSender(sender)) return false;

    const { invoke, params } = message as InvokeTransportMessage<Extension.Invoke.Type>;
    this.dispatch(invoke, params, sender)
      .then((resp) => sendResponse({ success: true, data: resp, sender, message: "ok" }))
      .catch((reason) => sendResponse({ success: false, data: reason, message: reason.msg || reason.toString() }));

    return true;
  }
}

export default Invoke;
