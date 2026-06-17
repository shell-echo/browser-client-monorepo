import logger from "@workspace/logger";

import internal from "~/internal";

class InjectContentScript {
  constructor() {
    logger.info("inject content script init.");
    this.insert();
  }

  private insert() {
    const networkHook = document.createElement("script");
    networkHook.src = chrome.runtime.getURL("src/content-script/library/network-hook.js");

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/content-script/library/inject.js");

    document.head.insertBefore(script, document.head.firstChild);
    document.head.insertBefore(networkHook, script);

    window.addEventListener("__EXTENSION_INJECT_READY__", () => {
      script.remove();
      networkHook.remove();
      internal.invoke("chrome:tabs:current").then((tab) => {
        if (tab) internal.event.emit("content-script:inject", { tab });
      });
    });
  }
}

internal.init({ platform: "content-script", service: "inject" }).then(() => new InjectContentScript());
