import type { Metadata } from "next"
import { NextThemeProvider } from "@browser-client/ui/components/next-theme-provider"
import "./globals.css"
import identity from "../../app-identity.json"

export const metadata: Metadata = {
  title: "Browser Client",
  description: "A shared workspace for web, admin, and browser extension clients.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-app-namespace={identity.instanceId} data-app-legacy={String(identity.legacy)} suppressHydrationWarning>
      <body>
        <NextThemeProvider>{children}</NextThemeProvider>
      </body>
    </html>
  )
}
