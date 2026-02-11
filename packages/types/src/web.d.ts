/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="chrome" />
/// <reference path="./common.d.ts" />
/// <reference path="./extension.d.ts" />

declare module "*.css";

declare namespace Web {
  type Tab = chrome.tabs.Tab;

  interface Extension {
    id: string;
    name: string;
    version: string;
    invoke: <T extends Extension.Invoke.Type>(
      invoke: T,
      params?: Extension.Invoke.Params<T>,
    ) => Promise<Extension.Invoke.Resp<T>>;
    event: {
      on: <T extends keyof Extension.Event.Payload>(event: T, handler: Extension.Event.Handler<T>) => void;
      emit: <T extends keyof Extension.Event.Payload>(event: T, payload: Extension.Event.Payload[T]) => void;
      off: <T extends keyof Extension.Event.Payload>(event: T, handler: Extension.Event.Handler<T>) => void;
      handlers: { [T in Extension.Event.Type]?: Extension.Event.Handler<T>[] };
    };
    network: {
      hook: {
        fetch: {
          request: {
            on: (name: string, func: (input: RequestInfo | URL, init: RequestInit | undefined) => void) => void;
            off: (name: string) => void;
          };
          response: {
            on: (
              name: string,
              func: (input: RequestInfo | URL, init: RequestInit | undefined, response: Response) => void,
            ) => void;
            off: (name: string) => void;
          };
        };
        xhr: {
          send: {
            on: (
              name: string,
              func: (
                meta: {
                  method: string;
                  url: string;
                  async: boolean;
                  user: string | undefined;
                  password: string | undefined;
                  headers: { [key: string]: any };
                  body: Document | XMLHttpRequestBodyInit | null | undefined;
                },
                xhr: XMLHttpRequest,
              ) => void,
            ) => void;
            off: (name: string) => void;
          };
        };
      };
    };
  }
}
