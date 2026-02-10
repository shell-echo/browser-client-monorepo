import logger from "@workspace/logger";

import internal from "~/internal";
import InjectServiceWorker from "~/service-worker/inject";

class ServiceWorker {
  inject: InjectServiceWorker;

  constructor() {
    logger.debug("service-worker init.");
    this.inject = new InjectServiceWorker();
  }
}

internal.init({ platform: "service-worker" }).then(() => new ServiceWorker());
