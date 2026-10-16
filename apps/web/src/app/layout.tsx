import type { Metadata } from "next"
import { NextThemeProvider } from "@browser-client/ui/components/next-theme-provider"
import "./globals.css"

export const metadata: Metadata = {
  title: "Browser Client",
  description: "A shared workspace for web, admin, and browser extension clients.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <NextThemeProvider>{children}</NextThemeProvider>
      </body>
    </html>
  )
}
