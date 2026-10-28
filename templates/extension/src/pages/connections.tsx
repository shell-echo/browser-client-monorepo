import { useEffect, useRef, useState } from "react"
import {
  chromeTransport,
  createClient,
  type AccessRequest,
  type BridgeClient,
  type PageInfo,
} from "@browser-client/extension-sdk"
import { Button } from "@browser-client/ui/components/button"
import { Card, CardContent, CardHeader } from "@browser-client/ui/components/card"
import { ThemeSwitcher } from "@browser-client/ui/components/theme-switcher"
import { isExtensionContext } from "../lib/settings"

export function ConnectionPanel() {
  const client = useRef<BridgeClient | null>(null)
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [grants, setGrants] = useState<AccessRequest[]>([])
  const [workspace, setWorkspace] = useState("")
  const [page, setPage] = useState<PageInfo | null>(null)
  const [error, setError] = useState("")
  const [status, setStatus] = useState("Disconnected")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!isExtensionContext()) return
    let current = true
    const sdk = createClient({ connect: chromeTransport(), reconnect: true })
    const refresh = async () => {
      try {
        const [pending, approved] = await Promise.all([sdk.request("access.pending", {}), sdk.request("access.grants", {})])
        if (current) {
          setRequests(pending.requests)
          setGrants(approved.grants)
        }
      } catch (reason) {
        if (current) setError(reason instanceof Error ? reason.message : "Unable to load connections")
      }
    }
    const stopState = sdk.onState((state) => {
      if (current) setStatus(state)
    })
    const stopAccess = sdk.subscribe("access", () => {
      void refresh()
    })
    const stopWorkspace = sdk.subscribe("workspace", (value) => {
      if (current && value && typeof value === "object" && !Array.isArray(value) && typeof value.name === "string")
        setWorkspace(value.name)
    })
    client.current = sdk
    return () => {
      current = false
      if (client.current === sdk) client.current = null
      stopAccess()
      stopWorkspace()
      stopState()
      sdk.close()
    }
  }, [])
  async function act(action: (sdk: BridgeClient) => Promise<unknown>) {
    const sdk = client.current
    if (!sdk) return
    setBusy(true)
    setError("")
    try {
      await action(sdk)
    } catch (reason) {
      if (client.current === sdk) setError(reason instanceof Error ? reason.message : "Extension request failed")
    } finally {
      if (client.current === sdk) setBusy(false)
    }
  }
  return (
    <Card id="connections">
      <CardHeader>
        <h2 className="text-base font-medium">Connections</h2>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p role="status">
          Connection: {status}
          {workspace ? ` · ${workspace}` : ""}
        </p>
        {!isExtensionContext() ? (
          <p>Load the extension to manage website access.</p>
        ) : (
          <>
            <p className="break-all">
              Extension ID: <code data-extension-id>{chrome.runtime.id}</code>
            </p>
            <p className="text-muted-foreground">
              Approve only a website you recognize. Access belongs to this page and expires within one hour. Navigation ends
              access.
            </p>
            {requests.length === 0 && <p>No pending access requests.</p>}
            {requests.map((request) => (
              <div key={request.id} className="space-y-2 rounded-lg border p-3">
                <p className="font-medium break-all">{request.origin}</p>
                <p>
                  Tab {request.tabId} requests: {request.capabilities.join(", ")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void act((sdk) => sdk.request("access.decide", { id: request.id, allow: true }))}
                  >
                    Allow this page
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void act((sdk) => sdk.request("access.decide", { id: request.id, allow: false }))}
                  >
                    Deny
                  </Button>
                </div>
              </div>
            ))}
            {grants.map((grant) => (
              <div key={grant.id} className="space-y-2 rounded-lg border p-3">
                <p className="break-all">
                  {grant.origin} · tab {grant.tabId}
                </p>
                <p>{grant.capabilities.join(", ")}</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act((sdk) => sdk.request("access.revoke", { id: grant.id }))}
                >
                  Revoke access
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(async (sdk) => {
                  const value = await sdk.request("page.read", {})
                  if (client.current === sdk) setPage(value)
                })
              }
            >
              Read selected page
            </Button>
            {page && (
              <dl className="space-y-2 break-words">
                <dt className="font-medium">Page title</dt>
                <dd>{page.title}</dd>
                <dt className="font-medium">Selected text</dt>
                <dd className="whitespace-pre-wrap">{page.selection || "No text selected"}</dd>
              </dl>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
export function ConnectionsPage() {
  return (
    <div className="min-h-svh bg-background p-4">
      <header className="mb-6 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Browser connection</h1>
        <ThemeSwitcher />
      </header>
      <main>
        <ConnectionPanel />
      </main>
    </div>
  )
}
