/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sonnerMock = vi.hoisted(() => ({
  toasterPropsSpy: vi.fn(),
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  },
}));

vi.mock("@workspace/ui/components/sonner", () => ({
  Toaster: (props: { richColors?: boolean; position?: string }) => {
    sonnerMock.toasterPropsSpy(props);

    return <div data-testid="notice-toaster-proxy" data-rich-colors={String(props.richColors)} />;
  },
  toast: sonnerMock.toast,
}));

import Notice, { notice } from "./notice.js";

describe("Notice", () => {
  beforeEach(() => {
    sonnerMock.toasterPropsSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("re-exports toast object", () => {
    expect(notice.toast).toBe(sonnerMock.toast);
  });

  it("defaults richColors to true and forwards props", () => {
    render(<Notice.Toaster position="top-right" />);
    const proxy = screen.getByTestId("notice-toaster-proxy");

    expect(proxy.getAttribute("data-rich-colors")).toBe("true");

    const props = sonnerMock.toasterPropsSpy.mock.calls[0]?.[0] as { position?: string };
    expect(props.position).toBe("top-right");
  });

  it("allows overriding richColors", () => {
    render(<Notice.Toaster richColors={false} />);
    const proxy = screen.getByTestId("notice-toaster-proxy");

    expect(proxy.getAttribute("data-rich-colors")).toBe("false");
  });
});
