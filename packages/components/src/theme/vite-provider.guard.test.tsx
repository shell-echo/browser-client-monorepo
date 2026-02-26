/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useContext: vi.fn(() => undefined),
  };
});

import { useTheme } from "./vite-provider.js";

function Consumer() {
  useTheme();

  return null;
}

describe("ThemeProvider (vite) guard branch", () => {
  it("throws when useContext unexpectedly returns undefined", () => {
    expect(() => render(<Consumer />)).toThrowError("useTheme must be used within a ThemeProvider");
  });
});
