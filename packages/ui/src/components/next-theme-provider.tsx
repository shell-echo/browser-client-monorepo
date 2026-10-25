"use client"

import type { PropsWithChildren } from "react"
import { THEME_STORAGE_SCRIPT, THEME_APPLY_SCRIPT } from "../lib/theme"
import { ThemeProvider } from "./theme-provider"

// One storage/event implementation serves all clients. The server-rendered
// script establishes the namespaced preference before hydration and paint.
export function NextThemeProvider({ children }: PropsWithChildren) {
  return (
    <>
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_STORAGE_SCRIPT + ";" + THEME_APPLY_SCRIPT }} />
      <ThemeProvider>{children}</ThemeProvider>
    </>
  )
}
