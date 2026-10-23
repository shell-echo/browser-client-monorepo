"use client"

import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, type PropsWithChildren } from "react"
import { normalizeTheme, THEME_STORAGE_KEY, THEME_STORAGE_SCRIPT } from "../lib/theme"
import { ThemeContext } from "./theme-context"

function ThemeBridge({ children }: PropsWithChildren) {
  const { theme, setTheme } = useTheme()
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
      try {
        if (event.storageArea !== window.localStorage) {
          // Returning alone still lets next-themes consume sessionStorage
          // events from same-origin frames as if they were local preferences.
          if (event.key === THEME_STORAGE_KEY) event.stopImmediatePropagation()
          return
        }
      } catch {
        if (event.key === THEME_STORAGE_KEY) event.stopImmediatePropagation()
        return
      }
      if (event.key === null) {
        setTheme("system")
        return
      }
      if (event.newValue !== null && event.newValue !== normalizeTheme(event.newValue)) {
        // next-themes accepts raw storage events. Intercept invalid values
        // before its listener applies them as DOM class names.
        event.stopImmediatePropagation()
        setTheme("system")
      }
    }
    window.addEventListener("storage", update, true)
    return () => window.removeEventListener("storage", update, true)
  }, [setTheme])
  return <ThemeContext.Provider value={{ theme: normalizeTheme(theme), setTheme }}>{children}</ThemeContext.Provider>
}

export function NextThemeProvider({ children }: PropsWithChildren) {
  return (
    <>
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_STORAGE_SCRIPT }} />
      <ThemeProvider
        attribute="class"
        storageKey={THEME_STORAGE_KEY}
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <ThemeBridge>{children}</ThemeBridge>
      </ThemeProvider>
    </>
  )
}
