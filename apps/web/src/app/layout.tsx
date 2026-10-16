import type { Metadata } from "next"
import { NextThemeProvider } from "@browser-client/ui/components/next-theme-provider"
import "./globals.css"

export const metadata: Metadata = {
  title: "Browser Client",
  description: "Web、管理台和浏览器扩展的共享工作区",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <NextThemeProvider>{children}</NextThemeProvider>
      </body>
    </html>
  )
}
