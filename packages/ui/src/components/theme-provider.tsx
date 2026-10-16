"use client"

import { useEffect, useState, type PropsWithChildren } from "react"
import { applyTheme, DARK_MODE_QUERY, normalizeTheme, readTheme, THEME_STORAGE_KEY, type Theme } from "../lib/theme"
import { ThemeContext } from "./theme-context"

// Vite and MV3 pages share this provider. The external bootstrap applies the
// initial class before paint; effects keep it in sync with other pages and OS.
export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setThemeState] = useState(readTheme)

  useEffect(() => {
    const media = window.matchMedia(DARK_MODE_QUERY)
    const update = () => applyTheme(theme, media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [theme])

  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return
      } catch {
        return
      }
      setThemeState(normalizeTheme(event.newValue))
    }
    window.addEventListener("storage", update)
    return () => window.removeEventListener("storage", update)
  }, [])

  function setTheme(value: Theme) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, value)
    } catch {
      // Keep the current page usable when storage is unavailable.
    }
    applyTheme(value, window.matchMedia(DARK_MODE_QUERY).matches)
    setThemeState(value)
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}
