import { ConnectionPanel } from "./connections"
import { useState } from "react"
import { Button } from "@browser-client/ui/components/button"
import { Card, CardContent, CardHeader } from "@browser-client/ui/components/card"
import { RepositoryLink } from "@browser-client/ui/components/repository-link"
import { Skeleton } from "@browser-client/ui/components/skeleton"
import { ThemeSwitcher } from "@browser-client/ui/components/theme-switcher"
import { useWorkspaceName } from "../hooks/use-workspace-name"
import { isExtensionContext } from "../lib/settings"

export function PopupPage() {
  const { name, loading, error, reload } = useWorkspaceName()
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState("")

  async function openSettings() {
    setOpening(true)
    setOpenError("")
    try {
      if (isExtensionContext()) await chrome.runtime.openOptionsPage()
      else window.location.assign("./options.html")
    } catch {
      setOpenError("Unable to open settings. Please try again.")
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[360px] w-[360px] max-w-full flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <span className="text-sm font-semibold">Browser Client</span>
        <ThemeSwitcher />
      </header>
      <main className="flex flex-1 flex-col gap-5 p-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your workspace, close at hand.</p>
        </div>
        <Card size="sm">
          <CardHeader>
            <h2 className="text-xs font-medium text-muted-foreground">Current workspace</h2>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton aria-label="Loading workspace" className="h-5 w-36" />
            ) : error ? (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
                <Button variant="outline" size="sm" onClick={() => void reload()}>
                  Try again
                </Button>
              </div>
            ) : (
              <p className="font-medium [overflow-wrap:anywhere]" data-workspace-name>
                {name}
              </p>
            )}
          </CardContent>
        </Card>
        <Button onClick={() => void openSettings()} disabled={opening} className="w-full">
          {opening ? "Opening settings…" : "Open settings"}
        </Button>
        {openError && (
          <p role="alert" className="text-sm text-destructive">
            {openError}
          </p>
        )}
        <Button
          variant="outline"
          onClick={() => {
            if (!isExtensionContext()) {
              window.location.assign("./sidepanel.html")
              return
            }
            void chrome.windows
              .getCurrent()
              .then((window) => chrome.sidePanel.open({ windowId: window.id! }))
              .catch(() => setOpenError("Unable to open the side panel."))
          }}
        >
          Open side panel
        </Button>
        <ConnectionPanel />
      </main>
      <footer className="flex items-center justify-between gap-3 border-t px-5 py-3">
        <span className="text-xs text-muted-foreground">
          {isExtensionContext() ? "Make yourself at home." : "Browser preview"}
        </span>
        <RepositoryLink />
      </footer>
    </div>
  )
}
