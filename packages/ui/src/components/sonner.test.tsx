/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("sonner", () => ({
  Toaster: (props: { theme?: string; position?: string; className?: string }) => {
    sonnerMock.toasterPropsSpy(props);

    return (
      <div data-testid="sonner-proxy" data-theme={props.theme} data-position={props.position} data-class={props.className} />
    );
  },
  toast: sonnerMock.toast,
}));

import { Toaster, toast } from "./sonner";

describe("Sonner wrapper", () => {
  it("re-exports sonner toast", () => {
    expect(toast).toBe(sonnerMock.toast);
  });

  it("passes mapped theme and default ui props to Sonner", () => {
    render(<Toaster position="top-right" />);
    const proxy = screen.getByTestId("sonner-proxy");

    expect(proxy.getAttribute("data-theme")).toBe("dark");
    expect(proxy.getAttribute("data-position")).toBe("top-right");
    expect(proxy.getAttribute("data-class")).toBe("toaster group");

    const props = sonnerMock.toasterPropsSpy.mock.calls[0]?.[0] as {
      className: string;
      icons: Record<string, unknown>;
      style: Record<string, string>;
    };
    expect(props.className).toBe("toaster group");
    expect(props.icons).toMatchObject({
      success: expect.anything(),
      info: expect.anything(),
      warning: expect.anything(),
      error: expect.anything(),
      loading: expect.anything(),
    });
    expect(props.style).toMatchObject({
      "--normal-bg": "var(--popover)",
      "--normal-text": "var(--popover-foreground)",
      "--normal-border": "var(--border)",
      "--border-radius": "var(--radius)",
    });
  });
});
