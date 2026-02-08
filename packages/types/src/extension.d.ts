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
    type InitParams = { platform: Extension.Runtime.Platform; service?: string };
  }

  namespace Event {
    type InternalPayload = {
      "internal:init:state:change": { state: Internal.State | undefined };
    };

    type ContentScriptPayload = {
      "content-script:application:init": { tab: chrome.tabs.Tab };
    };

    type Payload = InternalPayload & ContentScriptPayload;

    type Type = keyof Payload;
    type Params<T extends Type> = { payload: Payload[T]; timestamp: Timestamp; from: Sender };
    type Handler<T extends Type> = (params: Params<T>) => void;
  }

  namespace Invoke {
    type ChromeTab = {
      "chrome:tab:current": { params: undefined; resp: chrome.tabs.Tab | undefined };
      "chrome:tab:captureVisibleTab": { params: { windowId?: number; options?: extensionTypes.ImageDetails }; resp: string };
    };

    type Definition = ChromeTab;

    type Type = keyof Definition;
    type Params<K extends Type> = Definition[K]["params"];
    type Resp<K extends Type> = Definition[K]["resp"];
    type Handler<T extends Type> = (params: Params<T>, sender?: chrome.runtime.MessageSender) => Promise<Resp<T>>;
  }
}
