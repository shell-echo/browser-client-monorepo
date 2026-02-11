/// <reference types="chrome" />
/// <reference path="./common.d.ts" />

declare module "*.css";

declare namespace Web {
  type Tab = chrome.tabs.Tab;

  interface Extension {
    id: string;
    name: string;
    version: string;
    invoke: <T extends Extension.Invoke.Type>(invoke: T, args?: Extension.Invoke.Args<T>) => Promise<Extension.Invoke.Resp<T>>;
    event: {
      on: <T extends keyof Extension.Event.Payload>(event: T, handler: Extension.Event.Handler<T>) => void;
      emit: <T extends keyof Extension.Event.Payload>(event: T, payload: Extension.Event.Payload[T]) => void;
      off: <T extends keyof Extension.Event.Payload>(event: T, handler: Extension.Event.Handler<T>) => void;
      handlers: { [T in Extension.Event.Type]?: Extension.Event.Handler<T>[] };
    };
  }
}
