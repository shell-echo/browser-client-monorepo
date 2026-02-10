import logger from "@workspace/logger";

import internal from "~/internal";
import ChromeEventServiceWorker from "~/service-worker/chrome-event";
import InjectServiceWorker from "~/service-worker/inject";

class ServiceWorker {
  inject: InjectServiceWorker;
  chromeEvent: ChromeEventServiceWorker;

  constructor() {
    logger.debug("service-worker init.");
    this.inject = new InjectServiceWorker();
    this.chromeEvent = new ChromeEventServiceWorker();
  }
}

internal.init({ platform: "service-worker" }).then(() => new ServiceWorker());
