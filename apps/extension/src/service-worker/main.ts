import logger from "@workspace/logger";

import internal from "~/internal";

class ServiceWorker {
  constructor() {
    logger.debug("service-worker init.");
  }
}

internal.init({ platform: "service-worker" }).then(() => new ServiceWorker());
