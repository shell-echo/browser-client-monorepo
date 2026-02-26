import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("merges tailwind utility classes", () => {
    expect(cn("px-2", "px-4", "font-bold")).toBe("px-4 font-bold");
  });
});
