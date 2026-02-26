import { describe, expect, it } from "vitest";

import helper from "./index.js";
import UtilsHelper from "./utils.js";

describe("@workspace/helper default export", () => {
  it("exposes a UtilsHelper instance", () => {
    expect(helper.utils).toBeInstanceOf(UtilsHelper);
  });

  it("delegates utility behavior through the exported instance", () => {
    expect(helper.utils.isRestrictedUrl("about:blank")).toBe(true);
    expect(helper.utils.isRestrictedUrl("https://example.com")).toBe(false);
  });
});
