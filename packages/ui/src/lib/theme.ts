export const THEME_STORAGE_KEY = "browser-client-theme"
export const DARK_MODE_QUERY = "(prefers-color-scheme: dark)"
export type Theme = "light" | "dark" | "system"

export function normalizeTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system"
}

export function readTheme(): Theme {
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return "system"
  }
}

export function applyTheme(theme: Theme, systemDark: boolean) {
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(theme === "system" ? (systemDark ? "dark" : "light") : theme)
}
