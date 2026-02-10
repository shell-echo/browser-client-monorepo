import constant from "@workspace/constant";
import helper from "@workspace/helper";
import logger from "@workspace/logger";

import internal from "~/internal";

export type EventTransportMessage<T extends Extension.Event.Type> = {
  type: typeof constant.extension.event.transport.message.type;
  event: T;
  params: Extension.Event.Params<T>;
};

class Event {
  private handlers: { [T in Extension.Event.Type]?: Extension.Event.Handler<T>[] } = {};

  constructor() {}

  private dispatch<T extends Extension.Event.Type>(event: T, params: Extension.Event.Params<T>): void {
    const handlers = this.handlers[event] || [];
    if (handlers.length === 0) return;
    handlers.slice().forEach((handler) => {
      Promise.resolve()
        .then(() => handler(params))
        .catch((err) =>
          logger.error("Event handler error", {
            event,
            from: params.from,
            timestamp: params.timestamp,
            handler: handler.name || "<anonymous>",
            error: err,
          }),
        );
    });
  }

  emit<T extends Extension.Event.Type>(event: T, payload: Extension.Event.Payload[T]): void {
    const params: Extension.Event.Params<T> = { payload, timestamp: Date.now(), from: internal.runtime };
    this.dispatch(event, params);
    this.broadcast(event, params);
  }

  on<T extends Extension.Event.Type>(event: T, handler: Extension.Event.Handler<T>): () => void {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(handler);

    return () => this.off(event, handler);
  }

  off<T extends Extension.Event.Type>(event: T, handler: Extension.Event.Handler<T>) {
    if (!this.handlers[event]) return;
    const index = this.handlers[event]!.indexOf(handler);
    if (index === -1) return;
    this.handlers[event]!.splice(index, 1);
  }

  private broadcast<T extends Extension.Event.Type>(event: T, params: Extension.Event.Params<T>) {
    const type = constant.extension.event.transport.message.type;
    const message: EventTransportMessage<Extension.Event.Type> = { type, event, params };

    const errmsg = (target: string, reason: undefined, tab?: chrome.tabs.Tab) => [
      `broadcast event to ${target} fail.`,
      { message, reason },
      tab,
    ];

    // service-worker <--> action-popup <--> side-panel <--> content-script
    chrome.runtime.sendMessage(message).catch((reason) => logger.null(...errmsg("other service platform", reason)));

    // service-worker、side-panel、action-popup
    if (!["service-worker", "side-panel", "action-popup"].includes(internal.runtime.platform)) return;

    const send2contentscript = (tab: chrome.tabs.Tab) => {
      chrome.tabs.sendMessage(tab.id!, message).catch((reason) => logger.null(...errmsg("content-script", reason, tab)));
    };
    const send2web = (tab: chrome.tabs.Tab) => {
      const webargs = { name: internal.name, message, constant };
      const func = (args: typeof webargs) => {
        const { name, message, constant } = args;
        const eventname = `${name}-${constant.extension.event.transport.message.type}-event`;
        const event = new CustomEvent(eventname, { detail: { message } });
        document.dispatchEvent(event);
      };
      chrome.scripting
        .executeScript({
          world: "MAIN",
          target: { tabId: tab.id! },
          args: [webargs],
          func,
        })
        .catch((reason) => logger.error(...errmsg("web", reason, tab)));
    };

    // service-worker/side-panel/action-popup -> content-script/web
    chrome.tabs.query({}, (tabs) =>
      tabs
        .filter((tab) => internal.trust.isTrustTab(tab) && !helper.utils.isRestrictedUrl(tab.url || ""))
        .forEach((tab) => {
          // content-script
          send2contentscript(tab);

          // web (src/service-worker/inject)
          send2web(tab);
        }),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onMessage(message: any, sender: chrome.runtime.MessageSender) {
    if (typeof message !== "object") return;
    const type = message.type;
    if (type !== constant.extension.event.transport.message.type) return;

    const { event, params } = message as EventTransportMessage<Extension.Event.Type>;
    this.dispatch(event, { ...params, from: { ...params.from, sender } });
  }
}

export default Event;
