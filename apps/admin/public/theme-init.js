// browser-client theme bootstrap. Source for the generated public/theme-init.js.
// This classic external script also runs under the extension's strict MV3 CSP.
;(() => {
  let theme = "system"
  try {
    const saved = window.localStorage.getItem("browser-client-theme")
    if (saved === "light" || saved === "dark") theme = saved
  } catch {
    // A blocked localStorage must not prevent the page from rendering.
  }
  const dark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(theme === "system" ? (dark ? "dark" : "light") : theme)
})()
