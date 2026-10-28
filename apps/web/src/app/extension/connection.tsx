"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { chromeTransport, createClient, type BridgeClient, type PageInfo } from "@browser-client/extension-sdk"
import { Button } from "@browser-client/ui/components/button"
import { Input } from "@browser-client/ui/components/input"
import { Label } from "@browser-client/ui/components/label"

export function ExtensionConnection() {
  const current = useRef<BridgeClient | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const generation = useRef(0)
  const [extensionId, setExtensionId] = useState("")
  const [status, setStatus] = useState("Disconnected")
  const [access, setAccess] = useState<string[]>([])
  const [workspace, setWorkspace] = useState("")
  const [page, setPage] = useState<PageInfo | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(
    () => () => {
      cleanup.current?.()
      current.current?.close()
      current.current = null
      generation.current++
    },
    [],
  )
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const requestGeneration = ++generation.current
    cleanup.current?.()
    current.current?.close()
    current.current = null
    setBusy(true)
    setStatus("Disconnected")
    setError("")
    setAccess([])
    setWorkspace("")
    setPage(null)
    try {
      const sdk = createClient({ connect: chromeTransport(extensionId.trim()), reconnect: true })
      current.current = sdk
      let stopWorkspace: (() => void) | undefined
      const stopState = sdk.onState((next) => {
        if (current.current === sdk) {
          setStatus(next)
          if (next !== "connected") {
            setAccess([])
            setWorkspace("")
            setPage(null)
          }
        }
      })
      const stopAccess = sdk.subscribe("access", (value) => {
        if (current.current !== sdk || !value || typeof value !== "object" || Array.isArray(value)) return
        const granted = Array.isArray(value.capabilities)
          ? value.capabilities.filter((c): c is string => typeof c === "string")
          : []
        setAccess(granted)
        if (!granted.includes("page.read")) setPage(null)
        if (granted.includes("workspace.read") && !stopWorkspace) {
          stopWorkspace = sdk.subscribe("workspace", (snapshot) => {
            if (
              current.current === sdk &&
              snapshot &&
              typeof snapshot === "object" &&
              !Array.isArray(snapshot) &&
              typeof snapshot.name === "string"
            )
              setWorkspace(snapshot.name)
          })
        } else if (!granted.includes("workspace.read")) {
          stopWorkspace?.()
          stopWorkspace = undefined
          setWorkspace("")
        }
      })
      cleanup.current = () => {
        stopState()
        stopAccess()
        stopWorkspace?.()
      }
      await sdk.request("access.request", { capabilities: ["workspace.read", "page.read"] })
    } catch (reason) {
      if (generation.current === requestGeneration) setError(reason instanceof Error ? reason.message : "Unable to connect")
    } finally {
      if (generation.current === requestGeneration) setBusy(false)
    }
  }
  async function readPage() {
    const sdk = current.current
    if (!sdk) return
    setBusy(true)
    setError("")
    try {
      const value = await sdk.request("page.read", {})
      if (current.current === sdk) setPage(value)
    } catch (reason) {
      if (current.current === sdk) setError(reason instanceof Error ? reason.message : "Unable to read this page")
    } finally {
      if (current.current === sdk) setBusy(false)
    }
  }
  function disconnect() {
    generation.current++
    cleanup.current?.()
    current.current?.close()
    current.current = null
    setStatus("Disconnected")
    setAccess([])
    setWorkspace("")
    setPage(null)
    setBusy(false)
  }
  return (
    <section className="space-y-5 rounded-xl border p-5" aria-label="Extension connection">
      <form onSubmit={(event) => void connect(event)} className="space-y-3">
        <Label htmlFor="extension-id">Extension ID</Label>
        <Input
          id="extension-id"
          value={extensionId}
          onChange={(event) => setExtensionId(event.target.value)}
          pattern="[a-p]{32}"
          required
          maxLength={32}
          aria-describedby="extension-id-help"
          autoComplete="off"
          spellCheck={false}
        />
        <p id="extension-id-help" className="text-sm text-muted-foreground">
          Copy the ID from Connections in your extension. Then approve this page in the extension.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} type="submit">
            {busy ? "Connecting…" : "Connect and request access"}
          </Button>
          <Button variant="outline" type="button" onClick={disconnect}>
            Disconnect
          </Button>
        </div>
      </form>
      <p role="status">
        Connection: {status}. {access.length ? "Page access approved." : "Page access has not been approved."}
      </p>
      {workspace && (
        <p>
          Shared workspace: <strong>{workspace}</strong>
        </p>
      )}
      <Button variant="outline" disabled={busy || !access.includes("page.read")} onClick={() => void readPage()}>
        Read this page selection
      </Button>
      {page && (
        <dl className="space-y-2 break-words">
          <dt className="font-medium">Page title</dt>
          <dd>{page.title}</dd>
          <dt className="font-medium">Selected text</dt>
          <dd className="whitespace-pre-wrap">{page.selection || "No text selected"}</dd>
        </dl>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
