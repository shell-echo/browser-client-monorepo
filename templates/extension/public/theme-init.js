// browser-client theme bootstrap. Source for the generated public/theme-init.js.
// This classic external script also runs under the extension's strict MV3 CSP.
;(() => {
  let theme = "system"
  const root = document.documentElement
  const namespace = root.dataset?.appNamespace
  const key = namespace ? `browser-client-theme:${namespace}` : "browser-client-theme"
  try {
    let saved = window.localStorage.getItem(key)
    if (saved === null && namespace && root.dataset.appLegacy === "true") {
      const legacy = window.localStorage.getItem("browser-client-theme")
      if (["light", "dark", "system"].includes(legacy)) {
        saved = legacy
        try {
          window.localStorage.setItem(key, legacy)
          window.localStorage.removeItem("browser-client-theme")
        } catch {
          /* Retain the existing preference when storage is full. */
        }
      }
    }
    if (saved === "light" || saved === "dark") theme = saved
  } catch {
    // A blocked localStorage must not prevent the page from rendering.
  }
  const dark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
  root.classList.remove("light", "dark")
  root.classList.add(theme === "system" ? (dark ? "dark" : "light") : theme)
})()
