/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

import { Toaster, toast } from "./sonner";

describe("Sonner integration", () => {
  afterEach(() => {
    toast.dismiss();
    cleanup();
  });

  it("renders toast content through real sonner runtime", async () => {
    const message = `integration-message-${Date.now()}`;
    render(<Toaster position="top-right" />);
    toast(message);

    await waitFor(() => {
      expect(document.body.textContent ?? "").toContain(message);
    });
  });
});
