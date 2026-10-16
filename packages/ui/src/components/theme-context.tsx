"use client"

import { createContext, useContext } from "react"
import type { Theme } from "../lib/theme"

export const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error("ThemeSwitcher must be inside a theme provider")
  return context
}
