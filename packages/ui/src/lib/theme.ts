export const THEME_STORAGE_KEY = "browser-client-theme"
export const DARK_MODE_QUERY = "(prefers-color-scheme: dark)"
export type Theme = "light" | "dark" | "system"

export function themeStorageKey(namespace?: string) {
  const value = namespace ?? (typeof document === "undefined" ? undefined : document.documentElement?.dataset?.appNamespace)
  return value ? `${THEME_STORAGE_KEY}:${value}` : THEME_STORAGE_KEY
}

// Normalize the namespaced preference before hydration and the first paint.
// Keep this self-contained so it works before the application JS loads.
// Removing an invalid preference uses the system default without allocating
// storage, so recovery also works when setItem would exceed the quota.
export const THEME_STORAGE_SCRIPT =
  "(()=>{try{const key=" +
  JSON.stringify(THEME_STORAGE_KEY) +
  ';const root=typeof document==="undefined"?null:document.documentElement;const namespace=root?.dataset?.appNamespace;const target=namespace?key+":"+namespace:key;let saved=window.localStorage.getItem(target);if(saved===null&&namespace&&root.dataset.appLegacy==="true"){const legacy=window.localStorage.getItem(key);if(legacy==="light"||legacy==="dark"||legacy==="system"){try{window.localStorage.setItem(target,legacy);window.localStorage.removeItem(key);saved=legacy}catch{}}}if(saved!==null&&saved!=="light"&&saved!=="dark"&&saved!=="system")window.localStorage.removeItem(target)}catch{}})()'

export function normalizeTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system"
}

export const THEME_APPLY_SCRIPT =
  '(()=>{const root=document.documentElement;let theme="system";try{const key="browser-client-theme";const namespace=root.dataset.appNamespace;let saved=localStorage.getItem(namespace?key+":"+namespace:key);if(saved===null&&namespace&&root.dataset.appLegacy==="true")saved=localStorage.getItem(key);if(saved==="light"||saved==="dark")theme=saved}catch{}const dark=typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches;root.classList.remove("light","dark");root.classList.add(theme==="system"?(dark?"dark":"light"):theme)})()'

export function readTheme(): Theme {
  try {
    const key = themeStorageKey()
    const saved = window.localStorage.getItem(key)
    const legacy = key !== THEME_STORAGE_KEY && document.documentElement?.dataset?.appLegacy === "true"
    return normalizeTheme(saved === null && legacy ? window.localStorage.getItem(THEME_STORAGE_KEY) : saved)
  } catch {
    return "system"
  }
}

export function applyTheme(theme: Theme, systemDark: boolean) {
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(theme === "system" ? (systemDark ? "dark" : "light") : theme)
}
