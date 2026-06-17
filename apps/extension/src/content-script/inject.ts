import logger from "@workspace/logger";

import internal from "~/internal";

class InjectContentScript {
  constructor() {
    logger.info("inject content script init.");
    this.insert();
  }

  private insert() {
    const onReady = () => {
      script.remove();
      networkHook.remove();
      internal.invoke("chrome:tabs:current").then((tab) => {
        if (tab) internal.event.emit("content-script:inject", { tab });
      });
    };

    const networkHook = document.createElement("script");
    networkHook.async = false;
    networkHook.src = chrome.runtime.getURL("src/content-script/library/network-hook.js");

    const script = document.createElement("script");
    script.async = false;
    script.src = chrome.runtime.getURL("src/content-script/library/inject.js");

    const firstChild = document.head.firstChild;

    window.addEventListener("__EXTENSION_INJECT_READY__", onReady, { once: true });
    document.head.insertBefore(networkHook, firstChild);
    document.head.insertBefore(script, firstChild);
  }
}

internal.init({ platform: "content-script", service: "inject" }).then(() => new InjectContentScript());
