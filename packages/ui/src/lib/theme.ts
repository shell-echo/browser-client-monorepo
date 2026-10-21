export const THEME_STORAGE_KEY = "browser-client-theme"
export const DARK_MODE_QUERY = "(prefers-color-scheme: dark)"
export type Theme = "light" | "dark" | "system"

// Run before next-themes reads storage, including its pre-hydration script.
// Keep this self-contained so it also works before the application JS loads.
// Removing an invalid preference uses the system default without allocating
// storage, so recovery also works when setItem would exceed the quota.
export const THEME_STORAGE_SCRIPT =
  "(()=>{try{const key=" +
  JSON.stringify(THEME_STORAGE_KEY) +
  ';const saved=window.localStorage.getItem(key);if(saved!==null&&saved!=="light"&&saved!=="dark"&&saved!=="system")window.localStorage.removeItem(key)}catch{}})()'

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
