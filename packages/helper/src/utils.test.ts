import { describe, expect, it } from "vitest";

import UtilsHelper from "./utils.js";

const toBytes = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer));

describe("UtilsHelper", () => {
  const utils = new UtilsHelper();

  it("marks restricted urls correctly", () => {
    expect(utils.isRestrictedUrl("")).toBe(true);
    expect(utils.isRestrictedUrl("about:blank")).toBe(true);
    expect(utils.isRestrictedUrl("chrome-error://chromewebdata/")).toBe(true);
    expect(utils.isRestrictedUrl("view-source:https://example.com")).toBe(true);
    expect(utils.isRestrictedUrl("CHROME-EXTENSION://abc123/popup.html")).toBe(true);

    expect(utils.isRestrictedUrl("https://example.com")).toBe(false);
    expect(utils.isRestrictedUrl("http://localhost:3000")).toBe(false);
    expect(utils.isRestrictedUrl("chrome-extension://abc123/popup.html")).toBe(false);
  });

  it("converts arrayBuffer to base64 and back", () => {
    const source = new Uint8Array([0, 1, 2, 127, 128, 255]).buffer;
    const base64 = utils.arrayBufferToBase64(source);
    const restored = utils.base64ToArrayBuffer(base64);

    expect(toBytes(restored)).toEqual([0, 1, 2, 127, 128, 255]);
  });

  it("supports data url prefix and url-safe base64 in decoder", () => {
    const base64Url = "data:application/octet-stream;base64,-_8";
    const restored = utils.base64ToArrayBuffer(base64Url);

    expect(toBytes(restored)).toEqual([251, 255]);
  });

  it("handles large buffers through chunked encoding path", () => {
    const source = new Uint8Array(0x8001).fill(65).buffer;
    const base64 = utils.arrayBufferToBase64(source);
    const restored = utils.base64ToArrayBuffer(base64);

    expect(toBytes(restored)).toEqual(toBytes(source));
  });
});
