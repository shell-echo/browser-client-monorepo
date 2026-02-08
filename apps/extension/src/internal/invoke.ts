import constant from "@workspace/constant";

import internal from "~/internal";

const chrometab: { [T in keyof Extension.Invoke.ChromeTab]: Extension.Invoke.Handler<T> } = {
  "chrome:tab:current": async (_, sender) => sender?.tab,
  "chrome:tab:captureVisibleTab": (params) => {
    const { windowId, options } = params;

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
};

export type InvokeTransportMessage<T extends Extension.Invoke.Type> = {
  type: typeof constant.extension.invoke.transport.message.type;
  invoke: T;
  params: Extension.Invoke.Params<T>;
};

class Invoke {
  private handler: { [T in Extension.Invoke.Type]: Extension.Invoke.Handler<T> } = chrometab;

  constructor() {}

  dispatch<T extends Extension.Invoke.Type>(
    invoke: T,
    params?: Extension.Invoke.Params<T>,
    sender?: chrome.runtime.MessageSender,
  ) {
    return new Promise<Extension.Invoke.Resp<T>>((resolve, reject) => {
      if (internal.runtime.platform === "service-worker") {
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
      }

      chrome.runtime?.sendMessage(
        { type: constant.extension.invoke.transport.message.type, invoke, params } as InvokeTransportMessage<T>,
        (resp: { success: boolean; data: Promise<Extension.Invoke.Resp<T>>; message: string }) => {
          if (!resp.success) return reject(resp.message);
          resolve(resp.data);
        },
      );
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
