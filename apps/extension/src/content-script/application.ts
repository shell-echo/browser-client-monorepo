import logger from "@workspace/logger";

import internal from "~/internal";

class ApplicationContentScript {
  constructor() {
    logger.debug("application content-script init.");
    internal.invoke("chrome:tabs:current").then((tab) => {
      if (tab) internal.event.emit("content-script:application:init", { tab });
    });
  }
}

internal.init({ platform: "content-script", service: "application" }).then(() => new ApplicationContentScript());
