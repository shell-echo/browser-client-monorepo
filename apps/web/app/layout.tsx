import type { Metadata } from "next";

import "@workspace/ui/globals.css";
import Notice from "@workspace/components/notice";
import React from "react";

import ExtensionProvider from "~/components/provider/extension";
import ThemeProvider from "~/components/provider/theme";

export const metadata: Metadata = {
  title: "Browser Client Monorepo",
  description: "Including web, extension, and admin.",
};

function Provider({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ExtensionProvider>{children}</ExtensionProvider>
      <Notice.Toaster />
    </ThemeProvider>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
