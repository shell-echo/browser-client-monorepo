import { describe, expect, it } from "vitest";

import constant from "./index.js";

describe("@workspace/constant", () => {
  it("exports the monorepo name", () => {
    expect(constant.name).toBe("browser-client-monorepo");
    expect(constant.extension.name).toBe(constant.name);
  });

  it("builds extension event transport message type from name", () => {
    expect(constant.extension.event.transport.message.type).toBe(`${constant.name}-extension-event`);
  });

  it("builds extension invoke transport message type from name", () => {
    expect(constant.extension.invoke.transport.message.type).toBe(`${constant.name}-extension-invoke`);
  });
});
