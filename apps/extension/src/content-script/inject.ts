import logger from "@workspace/logger";

import internal from "~/internal";

class InjectContentScript {
  constructor() {
    logger.info("inject content script init.");
    this.insert();
  }

  private insert() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("internal/library/inject.js");
    document.head.insertBefore(script, document.head.firstChild);
    script.remove();

    window.addEventListener("__EXTENSION_INJECT_READY__", () =>
      internal.invoke("chrome:tab:current").then((tab) => {
        if (tab) internal.event.emit("content-script:inject", { tab });
      }),
    );
  }
}

internal.init({ platform: "content-script", service: "inject" }).then(() => new InjectContentScript());
