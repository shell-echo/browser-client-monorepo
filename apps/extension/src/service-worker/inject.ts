/* eslint-disable @typescript-eslint/no-explicit-any */
import constant from "@workspace/constant";
import helper from "@workspace/helper";
import logger from "@workspace/logger";

import internal from "~/internal";
import type { EventTransportMessage } from "~/internal/event";
import type { InvokeTransportMessage } from "~/internal/invoke";

class InjectServiceWorker {
  constructor() {
    internal.event.on("content-script:inject", ({ payload: { tab } }) => {
      this.setApplicationInteractive(tab);
    });
  }

  get interactive() {
    return { id: chrome.runtime.id, name: internal.name, version: internal.version, constant };
  }

  private applicationInteractive = (params: this["interactive"] & { tabId: number }) => {
    const { id, name, version, constant, tabId } = params;
    const runtime: Extension.Runtime = { platform: "web", tabId };

    // internal/invoke
    const invoke = <T extends Extension.Invoke.Type>(invoke: T, params?: Extension.Invoke.Params<T>) => {
      return new Promise<Extension.Invoke.Resp<T>>((resolve, reject) =>
        chrome.runtime.sendMessage(
          id,
          { type: constant.extension.invoke.transport.message.type, invoke, params } as InvokeTransportMessage<T>,
          (resp: { success: boolean; data: Promise<Extension.Invoke.Resp<T>>; message: string }) => {
            if (!resp.success) return reject(resp.message);
            resolve(resp.data);
          },
        ),
      );
    };

    // internal/event
    const event = () => {
      const handlers: { [T in Extension.Event.Type]?: Extension.Event.Handler<T>[] } = {};

      const on = <T extends Extension.Event.Type>(event: T, handler: Extension.Event.Handler<T>) => {
        if (!handlers[event]) {
          handlers[event] = [];
        }
        handlers[event].push(handler);
      };

      const dispatch = <T extends Extension.Event.Type>(event: T, params: Extension.Event.Params<T>) => {
        const hs = handlers[event] || [];
        if (hs.length === 0) return;
        Promise.all(
          hs.slice().map((handler) =>
            Promise.resolve()
              .then(() => handler(params))
              .catch((err) => logger.error(err)),
          ),
        );
      };

      const emit = <T extends Extension.Event.Type>(event: T, payload: Extension.Event.Payload[T]) => {
        const params: Extension.Event.Params<T> = { payload, timestamp: Date.now(), from: runtime };
        dispatch(event, params);

        const message: EventTransportMessage<Extension.Event.Type> = {
          type: constant.extension.event.transport.message.type,
          event,
          params,
        };

        chrome.runtime.sendMessage(id, message).catch((reason) => logger.error(reason));
      };

      const off = <T extends Extension.Event.Type>(event: T, handler: Extension.Event.Handler<T>) => {
        if (!handlers[event]) return;
        const index = handlers[event]!.indexOf(handler);
        if (index === -1) return;
        handlers[event]!.splice(index, 1);
      };

      const listener = (event: Event & { detail?: { message: any } }) => {
        const message = event.detail?.message;
        if (typeof message !== "object") return;

        switch (message.type) {
          case constant.extension.event.transport.message.type: {
            const { event, params } = message as EventTransportMessage<Extension.Event.Type>;
            dispatch(event, params);
            break;
          }
        }
      };
      const eventname = `${name}-${constant.extension.event.transport.message.type}-event`;
      document.removeEventListener(eventname, listener);
      document.addEventListener(eventname, listener);

      return {
        on,
        emit,
        off,
        get handlers() {
          return handlers;
        },
      };
    };

    const network = { hook: (window as any).__NETWORK_HOOK__ };
    (window as any)[params.name] = { id, name, version, invoke, event: event(), network };
  };

  private setApplicationInteractive(tab: chrome.tabs.Tab) {
    if (!tab.id || helper.utils.isRestrictedUrl(tab.url || "") || !internal.trust.isTrustTab(tab)) return;

    chrome.scripting
      .executeScript({
        world: "MAIN",
        target: { tabId: tab.id },
        args: [{ ...this.interactive, tabId: tab.id }],
        func: this.applicationInteractive,
      })
      .then(() => internal.event.emit("service-worker:application:inject", { tab }))
      .catch((reason) => logger.error(reason));
  }
}

export default InjectServiceWorker;
