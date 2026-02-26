/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders base style classes and appends custom className", () => {
    render(<Skeleton className="h-4 w-20" data-testid="sk" />);
    const element = screen.getByTestId("sk");

    expect(element.tagName).toBe("DIV");
    expect(element.getAttribute("data-slot")).toBe("skeleton");
    expect(element.className).toContain("bg-accent");
    expect(element.className).toContain("animate-pulse");
    expect(element.className).toContain("h-4");
    expect(element.className).toContain("w-20");
  });
});
