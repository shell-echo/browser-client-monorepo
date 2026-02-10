import constant from "@workspace/constant";
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

    // service-worker <--> action-popup <--> side-panel
    chrome.runtime?.sendMessage(message).catch((reason) => logger.null(...errmsg("other service platform", reason)));
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
