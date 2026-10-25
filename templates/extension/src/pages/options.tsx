import { useState, type FormEvent } from "react"
import { Button } from "@browser-client/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader } from "@browser-client/ui/components/card"
import { Input } from "@browser-client/ui/components/input"
import { Label } from "@browser-client/ui/components/label"
import { RepositoryLink } from "@browser-client/ui/components/repository-link"
import { ThemeSwitcher } from "@browser-client/ui/components/theme-switcher"
import { useWorkspaceName } from "../hooks/use-workspace-name"
import { isExtensionContext, validateWorkspaceName, WORKSPACE_NAME_LIMIT } from "../lib/settings"

export function OptionsPage() {
  const { name, loading, error, reload, save } = useWorkspaceName()
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [message, setMessage] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaveError("")
    setMessage("")
    let value: string
    try {
      value = validateWorkspaceName(draft ?? name)
    } catch (error) {
      setSaveError((error as Error).message)
      return
    }
    setSaving(true)
    try {
      await save(value)
      setDraft(null)
      setMessage("Settings saved.")
    } catch {
      setSaveError("Unable to save your settings. Your changes are still here. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <span className="text-sm font-semibold">Browser Client</span>
          <RepositoryLink />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">A few preferences to make this workspace yours.</p>
        </div>
        {!isExtensionContext() && (
          <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            Browser preview. Settings are saved in this browser, separately from the installed extension.
          </p>
        )}
        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">Workspace</h2>
            <CardDescription>Choose the name shown in your extension popup.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading settings…
              </p>
            ) : error ? (
              <div className="space-y-3">
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
                <Button variant="outline" onClick={() => void reload()}>
                  Try again
                </Button>
              </div>
            ) : (
              <form onSubmit={(event) => void submit(event)} className="space-y-4" aria-label="Workspace settings">
                <div className="space-y-2">
                  <Label htmlFor="workspace-name">Workspace name</Label>
                  <Input
                    id="workspace-name"
                    name="workspaceName"
                    required
                    maxLength={WORKSPACE_NAME_LIMIT}
                    value={draft ?? name}
                    disabled={saving}
                    aria-invalid={Boolean(saveError)}
                    aria-describedby={`workspace-hint${saveError ? " workspace-error" : ""}`}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      setSaveError("")
                      setMessage("")
                    }}
                  />
                  <p id="workspace-hint" className="text-xs leading-5 text-muted-foreground">
                    Use up to {WORKSPACE_NAME_LIMIT} characters. Changes appear in your popup after saving.
                  </p>
                </div>
                {saveError && (
                  <p id="workspace-error" role="alert" className="text-sm text-destructive">
                    {saveError}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                  <p role="status" className="text-sm text-muted-foreground">
                    {message}
                  </p>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">Appearance</h2>
            <CardDescription>Keep it light, go dark, or follow your system.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <span className="text-sm">Color theme</span>
            <ThemeSwitcher />
          </CardContent>
        </Card>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <span>Your settings stay on this device.</span>
          {!isExtensionContext() && (
            <a
              className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
              href="./index.html"
            >
              Back to popup preview
            </a>
          )}
        </div>
      </footer>
    </div>
  )
}
