/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, buttonVariants } from "./button";

describe("Button", () => {
  it("builds default and variant classes", () => {
    const defaults = buttonVariants();
    const outlineSmall = buttonVariants({ variant: "outline", size: "sm" });

    expect(defaults).toContain("bg-primary");
    expect(defaults).toContain("h-9");
    expect(outlineSmall).toContain("border");
    expect(outlineSmall).toContain("h-8");
  });

  it("renders data attributes and merges custom className", () => {
    render(<Button className="custom-class">Click</Button>);
    const element = screen.getByRole("button", { name: "Click" });

    expect(element.getAttribute("data-slot")).toBe("button");
    expect(element.getAttribute("data-variant")).toBe("default");
    expect(element.getAttribute("data-size")).toBe("default");
    expect(element.className).toContain("custom-class");
  });

  it("uses Slot component when asChild is true", () => {
    render(
      <Button asChild>
        <a href="/x">Child</a>
      </Button>,
    );
    const element = screen.getByRole("link", { name: "Child" });

    expect(element.getAttribute("data-slot")).toBe("button");
    expect(element.getAttribute("href")).toBe("/x");
  });
});
