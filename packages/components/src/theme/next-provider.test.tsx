/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const nextThemesMock = vi.hoisted(() => ({
  providerPropsSpy: vi.fn(),
}));

vi.mock("next-themes", () => ({
  ThemeProvider: (props: { attribute?: string; children?: React.ReactNode }) => {
    nextThemesMock.providerPropsSpy(props);

    return (
      <div data-testid="next-theme-provider" data-attribute={props.attribute}>
        {props.children}
      </div>
    );
  },
}));

import { ThemeProvider } from "./next-provider.js";

describe("ThemeProvider (next)", () => {
  it("forwards props and renders children", () => {
    render(
      <ThemeProvider attribute="class">
        <span>child content</span>
      </ThemeProvider>,
    );

    const provider = screen.getByTestId("next-theme-provider");
    expect(provider.getAttribute("data-attribute")).toBe("class");
    expect(screen.getByText("child content")).not.toBeNull();
    expect(nextThemesMock.providerPropsSpy).toHaveBeenCalledTimes(1);
  });
});
