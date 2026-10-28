import Link from "next/link"
import { ThemeSwitcher } from "@browser-client/ui/components/theme-switcher"
import { ExtensionConnection } from "./connection"

export default function ExtensionPage() {
  return (
    <main className="mx-auto min-h-svh max-w-2xl space-y-6 px-4 py-12">
      <div className="flex items-center justify-between gap-4">
        <Link className="underline underline-offset-4" href="/">
          Back to home
        </Link>
        <ThemeSwitcher />
      </div>
      <h1 className="text-3xl font-semibold">Connect your browser</h1>
      <p className="text-sm leading-7 text-muted-foreground">
        Use your extension without leaving this page. You decide which information is shared, and can revoke access in the
        extension at any time.
      </p>
      <ExtensionConnection />
    </main>
  )
}
