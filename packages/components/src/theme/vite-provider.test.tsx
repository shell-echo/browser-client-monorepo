/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "./vite-provider.js";

const mockMatchMedia = (matches: boolean) => {
  const fn = vi.fn().mockImplementation(() => ({
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  vi.stubGlobal("matchMedia", fn);
};

function createStorage() {
  const store = new Map<string, string>();

  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

function ThemeConsumer() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button onClick={() => setTheme("light")}>set-light</button>
      <button onClick={() => setTheme("dark")}>set-dark</button>
      <button onClick={() => setTheme("system")}>set-system</button>
    </div>
  );
}

function ThemeConsumerWithoutProvider() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <span data-testid="theme-value-without-provider">{theme}</span>
      <button onClick={() => setTheme("dark")}>set-dark-without-provider</button>
    </div>
  );
}

describe("ThemeProvider (vite)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    document.documentElement.className = "";
    mockMatchMedia(true);
  });

  afterEach(() => {
    cleanup();
    document.documentElement.className = "";
    vi.unstubAllGlobals();
  });

  it("applies system theme by default", async () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(screen.getByTestId("theme-value").textContent).toBe("system");
  });

  it("applies light class when system preference is light", async () => {
    mockMatchMedia(false);

    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains("light")).toBe(true);
    });
  });

  it("reads persisted theme from localStorage using storageKey", async () => {
    localStorage.setItem("test-theme-key", "light");

    render(
      <ThemeProvider storageKey="test-theme-key">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains("light")).toBe(true);
    });
    expect(screen.getByTestId("theme-value").textContent).toBe("light");
  });

  it("setTheme updates storage and root class", async () => {
    render(
      <ThemeProvider storageKey="my-theme">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "set-light" }));

    await waitFor(() => {
      expect(localStorage.getItem("my-theme")).toBe("light");
    });
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("setTheme supports dark theme", async () => {
    render(
      <ThemeProvider storageKey="my-theme">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "set-dark" }));

    await waitFor(() => {
      expect(localStorage.getItem("my-theme")).toBe("dark");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setTheme supports system theme and applies current preference", async () => {
    mockMatchMedia(true);

    render(
      <ThemeProvider defaultTheme="light" storageKey="my-theme">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "set-system" }));

    await waitFor(() => {
      expect(localStorage.getItem("my-theme")).toBe("system");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("returns default context value without provider and setTheme is no-op", () => {
    render(<ThemeConsumerWithoutProvider />);

    expect(screen.getByTestId("theme-value-without-provider").textContent).toBe("system");
    fireEvent.click(screen.getByRole("button", { name: "set-dark-without-provider" }));
    expect(localStorage.getItem("vite-ui-theme")).toBeNull();
  });
});
