"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@browser-client/ui/components/button"
import { RepositoryLink } from "@browser-client/ui/components/repository-link"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@browser-client/ui/components/sheet"
import { ThemeSwitcher } from "@browser-client/ui/components/theme-switcher"
import { useIsMobile } from "@browser-client/ui/hooks/use-mobile"

const links = [
  { href: "#overview", label: "Overview" },
  { href: "#features", label: "Features" },
  { href: "#resources", label: "Resources" },
  { href: "/extension", label: "Connect extension" },
]

export function SiteHeader() {
  const isMobile = useIsMobile()

  return (
    <header className="border-b">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="shrink-0 rounded-sm text-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring"
        >
          Browser Client
        </Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-6 md:flex">
          {links.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-1.5">
          <RepositoryLink />
          <ThemeSwitcher />
          {isMobile && <MobileNavigation />}
        </div>
      </div>
    </header>
  )
}

// Unmounting at the desktop breakpoint also discards the open dialog state.
function MobileNavigation() {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" size="icon" className="md:hidden" />} aria-label="Open navigation">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Explore the starter.</SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile navigation" className="grid gap-1 px-4">
          {links.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {label}
            </a>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
