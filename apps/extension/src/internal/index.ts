import constant from "@workspace/constant";
import logger from "@workspace/logger";

import Event from "~/internal/event";
import Invoke from "~/internal/invoke";

import pkg from "../../package.json";

class Internal {
  static #instance: Internal;

  name = constant.extension.name;
  version = pkg.version;

  public static get instance(): Internal {
    if (!Internal.#instance) {
      Internal.#instance = new Internal();
    }

    return Internal.#instance;
  }

  get mode() {
    return import.meta.env.MODE as MODE;
  }

  private _runtime?: Extension.Runtime;
  get runtime() {
    if (!this._runtime) {
      throw new Error("Internal not initialized: runtime is unavailable");
    }

    return this._runtime;
  }

  private _state?: Extension.Internal.State;
  get state() {
    return this._state;
  }
  get isReady() {
    return this._state === "ready";
  }
  private _error: unknown;
  get error() {
    return this._error;
  }

  private _event!: Event;
  get event() {
    return this._event;
  }
  private _invoke!: Invoke;
  get invoke() {
    return this._invoke.dispatch.bind(this._invoke);
  }

  public async init(runtime: Extension.Runtime): Promise<void> {
    this._state = "initializing";
    try {
      this._runtime = runtime;
      logger.init(`${this.runtime.platform}${this.runtime.service ? `:${this.runtime.service}` : ""}`, this.mode);

      this._event = new Event();
      this._invoke = new Invoke();
      this.event.emit("internal:init:state:change", { state: this.state });

      chrome.runtime?.onMessage.addListener((message, sender, sendResponse) => this.onMessage(message, sender, sendResponse));
      if (this.runtime.platform === "service-worker") {
        chrome.runtime?.onMessageExternal.addListener((message, sender, sendResponse) =>
          this.onMessage(message, sender, sendResponse),
        );
      }

      if (this.runtime.platform !== "service-worker") {
        const tab = await this.invoke("chrome:tabs:current");
        if (this.runtime.platform === "content-script") {
          this._runtime.tabId = tab?.id;
        }
        if (["action-popup", "side-panel"].includes(this.runtime.platform)) {
          this._runtime.windowId = tab?.windowId;
        }
      }

      const info = [this.name, this.version, this.mode, this.runtime];
      logger.debug("\t%s(%s) internal init. (%s)\n\rruntime: %o", ...info);

      this._state = "ready";
      this.event.emit("internal:init:state:change", { state: this.state });
    } catch (error) {
      this._error = error;
      this._state = "error";
      this.event.emit("internal:init:state:change", { state: this.state });
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
    if (typeof message !== "object") return;
    const event = this._event.onMessage(message, sender);
    const invoke = this._invoke.onMessage(message, sender, sendResponse);

    return Boolean(invoke || event);
  }
}

const internal = Internal.instance;

export default internal;
