"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useSyncExternalStore } from "react"
import { normalizeTheme } from "../lib/theme"
import { Button } from "./button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu"
import { useTheme } from "./theme-context"

const subscribe = () => () => undefined

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  // The server cannot read a browser preference. Match its first render before
  // showing the stored selection, while the bootstrap already colors the page.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon" className="relative shrink-0" />}
        aria-label="主题模式"
        title="切换主题"
        disabled={!mounted}
      >
        <Sun aria-hidden="true" className="size-4 scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
        <Moon
          aria-hidden="true"
          className="absolute size-4 scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-40" aria-label="主题模式选项">
        <DropdownMenuRadioGroup value={mounted ? theme : "system"} onValueChange={(value) => setTheme(normalizeTheme(value))}>
          <DropdownMenuRadioItem value="light" closeOnClick>
            <Sun aria-hidden="true" />
            浅色模式
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" closeOnClick>
            <Moon aria-hidden="true" />
            深色模式
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" closeOnClick>
            <Monitor aria-hidden="true" />
            跟随系统
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
