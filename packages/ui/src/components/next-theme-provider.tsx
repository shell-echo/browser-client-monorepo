"use client"

import { ThemeProvider, useTheme } from "next-themes"
import type { PropsWithChildren } from "react"
import { normalizeTheme, THEME_STORAGE_KEY } from "../lib/theme"
import { ThemeContext } from "./theme-context"

function ThemeBridge({ children }: PropsWithChildren) {
  const { theme, setTheme } = useTheme()
  return <ThemeContext.Provider value={{ theme: normalizeTheme(theme), setTheme }}>{children}</ThemeContext.Provider>
}

export function NextThemeProvider({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      attribute="class"
      storageKey={THEME_STORAGE_KEY}
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeBridge>{children}</ThemeBridge>
    </ThemeProvider>
  )
}
