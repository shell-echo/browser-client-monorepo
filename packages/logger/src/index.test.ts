import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import logger from "./index.js";

describe("@workspace/logger", () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    logSpy.mockClear();
    logger.init("unit-test", "development");
    logger.setLevel("debug");
  });

  afterEach(() => {
    logger.init("reset", "production");
    logger.setLevel("debug");
  });

  afterAll(() => {
    logSpy.mockRestore();
  });

  it("initializes name/mode/level correctly", () => {
    logger.init("web", "production");
    expect(logger.name).toBe("browser-client-monorepo web");
    expect(logger.mode).toBe("production");
    expect(logger.getLevel()).toBe("info");

    logger.init("admin", "development");
    expect(logger.getLevel()).toBe("debug");
  });

  it("setLevel/getLevel map values correctly", () => {
    logger.setLevel("warn");
    expect(logger.getLevel()).toBe("warn");

    logger.setLevel("null");
    expect(logger.getLevel()).toBe("null");
  });

  it("filters logs by current level", () => {
    logger.setLevel("error");
    logger.info("skip me");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("logs prefix only when called without payload", () => {
    logger.info();
    expect(logSpy).toHaveBeenCalledTimes(1);

    const [prefix] = logSpy.mock.calls[0] as [string];
    expect(prefix).toContain("[browser-client-monorepo unit-test info]");
    expect(prefix).toContain("[caller:");
  });

  it("logs string payload as inline message", () => {
    logger.warn("warn-message", { code: 7 });
    expect(logSpy).toHaveBeenCalledTimes(1);

    const [firstArg, secondArg] = logSpy.mock.calls[0] as [string, { code: number }];
    expect(firstArg).toContain("[browser-client-monorepo unit-test warn]");
    expect(firstArg).toContain("warn-message");
    expect(secondArg).toEqual({ code: 7 });
  });

  it("logs non-string payload as separate argument", () => {
    logger.debug({ ok: true }, "tail");
    expect(logSpy).toHaveBeenCalledTimes(1);

    const [prefix, firstPayload, secondPayload] = logSpy.mock.calls[0] as [string, { ok: boolean }, string];
    expect(prefix).toContain("[browser-client-monorepo unit-test debug]");
    expect(firstPayload).toEqual({ ok: true });
    expect(secondPayload).toBe("tail");
  });

  it("omits caller info in production mode", () => {
    logger.init("unit-test", "production");
    logger.setLevel("debug");
    logger.error("prod-log");

    const [firstArg] = logSpy.mock.calls[0] as [string];
    expect(firstArg).toContain("[browser-client-monorepo unit-test error]");
    expect(firstArg).not.toContain("[caller:");
  });

  it("allows null level logger method when threshold is null", () => {
    logger.setLevel("null");
    logger.null("silent-channel");
    expect(logSpy).toHaveBeenCalledTimes(1);

    const [firstArg] = logSpy.mock.calls[0] as [string];
    expect(firstArg).toContain("[browser-client-monorepo unit-test null]");
    expect(firstArg).toContain("silent-channel");
  });

  it("extracts url caller from stack when it matches parser pattern", () => {
    const invokeFromHttpLikeSource = new Function(
      "logger",
      "logger.warn('stack-url');\n//# sourceURL=http://example.com/src/file.ts",
    ) as (loggerArg: { warn: (message: string) => void }) => void;
    invokeFromHttpLikeSource(logger);

    const [firstArg] = logSpy.mock.calls[0] as [string];
    expect(firstArg).toMatch(/\[caller: http:\/\/example\.com\/src\/file\.ts:\d+:\d+\]/);
  });

  it("falls back to unknown caller when Error stack is missing", () => {
    function EmptyStackError() {
      return { stack: "" } as Error;
    }

    const errorSpy = vi.spyOn(globalThis, "Error").mockImplementation(EmptyStackError as never);
    try {
      logger.info("stack-fallback");
    } finally {
      errorSpy.mockRestore();
    }

    const [firstArg] = logSpy.mock.calls[0] as [string];
    expect(firstArg).toContain("[caller: unknown caller]");
  });
});
