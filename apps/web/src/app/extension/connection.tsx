"use client"

import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react"
import {
  createLangChainBrowserAgentTools,
  createMcpBrowserAgentTools,
  createOpenAiBrowserAgentTools,
  invokeBrowserAgentTool,
} from "@browser-client/browser-agent"
import {
  chromeTransport,
  createClient,
  type BridgeClient,
  type PageInfo,
  type PageObservation,
} from "@browser-client/extension-sdk"
import { Button } from "@browser-client/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@browser-client/ui/components/card"
import { Input } from "@browser-client/ui/components/input"
import { Label } from "@browser-client/ui/components/label"

const mcpTools = createMcpBrowserAgentTools()
const openAiTools = createOpenAiBrowserAgentTools()
const langChainTools = createLangChainBrowserAgentTools(async () => undefined)
const agentAdapters = [
  { name: "MCP", tools: mcpTools, example: mcpTools[2]?.name ?? "" },
  { name: "OpenAI", tools: openAiTools, example: openAiTools[2]?.function.name ?? "" },
  { name: "LangChain", tools: langChainTools, example: langChainTools[2]?.name ?? "" },
] as const

export function ExtensionConnection() {
  const current = useRef<BridgeClient | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const generation = useRef(0)
  const accessRevision = useRef(0)
  const focusedTarget = useRef<HTMLInputElement | null>(null)
  const logSequence = useRef(0)
  const [extensionId, setExtensionId] = useState("")
  const [status, setStatus] = useState("Disconnected")
  const [access, setAccess] = useState<string[]>([])
  const [workspace, setWorkspace] = useState("")
  const [page, setPage] = useState<PageInfo | null>(null)
  const [observation, setObservation] = useState<PageObservation | null>(null)
  const [x, setX] = useState("320")
  const [y, setY] = useState("420")
  const [scrollY, setScrollY] = useState("480")
  const [text, setText] = useState("Agent input from the real browser bridge")
  const [fixtureMessage, setFixtureMessage] = useState("Waiting for a real browser action")
  const [actionLog, setActionLog] = useState<{ id: number; text: string }[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [lastTool, setLastTool] = useState("No Agent tool has run yet.")
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
    setObservation(null)
    setActionLog([])
    setLastTool("No Agent tool has run yet.")
    try {
      const sdk = createClient({ connect: chromeTransport(extensionId.trim()), reconnect: true })
      current.current = sdk
      let stopWorkspace: (() => void) | undefined
      const stopState = sdk.onState((next) => {
        if (current.current === sdk) {
          setStatus(next)
          if (next !== "connected") {
            accessRevision.current++
            setAccess([])
            setWorkspace("")
            setPage(null)
            setObservation(null)
          }
        }
      })
      const stopAccess = sdk.subscribe("access", (value) => {
        if (current.current !== sdk || !value || typeof value !== "object" || Array.isArray(value)) return
        accessRevision.current++
        const granted = Array.isArray(value.capabilities)
          ? value.capabilities.filter((c): c is string => typeof c === "string")
          : []
        setAccess(granted)
        if (!granted.includes("page.read")) setPage(null)
        if (!granted.includes("page.observe")) setObservation(null)
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
      await sdk.request("access.request", {
        capabilities: ["workspace.read", "page.read", "page.observe", "page.click", "page.scroll", "page.type"],
      })
    } catch (reason) {
      if (generation.current === requestGeneration) setError(reason instanceof Error ? reason.message : "Unable to connect")
    } finally {
      if (generation.current === requestGeneration) setBusy(false)
    }
  }
  async function readPage() {
    const sdk = current.current
    if (!sdk) return
    const revision = accessRevision.current
    setBusy(true)
    setError("")
    try {
      const value = (await invokeBrowserAgentTool((method, _params, options) => {
        if (method !== "page.read") throw new Error(`Demo adapter cannot invoke ${method}`)
        return sdk.request("page.read", {}, options)
      }, "browser_page_read")) as PageInfo
      if (current.current === sdk && accessRevision.current === revision) {
        setPage(value)
        setLastTool("browser_page_read → page.read completed")
      }
    } catch (reason) {
      if (current.current === sdk && accessRevision.current === revision)
        setError(reason instanceof Error ? reason.message : "Unable to read this page")
    } finally {
      if (current.current === sdk) setBusy(false)
    }
  }
  async function runTool(name: string, input: Record<string, unknown> = {}) {
    const sdk = current.current
    if (!sdk) return
    const revision = accessRevision.current
    setBusy(true)
    setError("")
    try {
      const value = await invokeBrowserAgentTool((method, params, options) => sdk.request(method, params, options), name, input)
      if (current.current !== sdk || accessRevision.current !== revision) return
      if (name === "browser_page_observe") {
        setObservation(value as PageObservation)
        setPage((value as PageObservation).page)
      }
      const frame = name === "browser_page_observe" ? (value as PageObservation) : null
      const detail = frame
        ? frame.screenshot
          ? "viewport screenshot received"
          : `metadata received; screenshot ${frame.screenshotSuppressedReason ?? "unavailable"}`
        : `${JSON.stringify(input)} · accepted; observe again to verify`
      setLastTool(`${name} → ${detail}`)
      const entry = { id: ++logSequence.current, text: `${new Date().toLocaleTimeString()}  ${name}` }
      setActionLog((previous) => [entry, ...previous].slice(0, 8))
    } catch (reason) {
      if (current.current === sdk && accessRevision.current === revision)
        setError(reason instanceof Error ? reason.message : "Browser Agent action failed")
    } finally {
      if (current.current === sdk) setBusy(false)
    }
  }
  function pickCoordinate(event: MouseEvent<HTMLButtonElement>) {
    if (!observation?.screenshot) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = observation.screenshot.width / observation.screenshot.height
    const imageWidth = Math.min(bounds.width, bounds.height * ratio)
    const imageHeight = imageWidth / ratio
    const left = bounds.left + (bounds.width - imageWidth) / 2
    const top = bounds.top + (bounds.height - imageHeight) / 2
    if (event.clientX < left || event.clientX > left + imageWidth || event.clientY < top || event.clientY > top + imageHeight)
      return
    const xValue = Math.max(
      0,
      Math.min(observation.viewport.width - 1, ((event.clientX - left) / imageWidth) * observation.viewport.width),
    )
    const yValue = Math.max(
      0,
      Math.min(observation.viewport.height - 1, ((event.clientY - top) / imageHeight) * observation.viewport.height),
    )
    setX(String(Math.round(xValue)))
    setY(String(Math.round(yValue)))
    setLastTool(`coordinate picked → ${Math.round(xValue)},${Math.round(yValue)}`)
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
    setObservation(null)
    setActionLog([])
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
      <p className="min-h-6">
        {workspace && (
          <>
            Shared workspace: <strong>{workspace}</strong>
          </>
        )}
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <div className="space-y-4">
          <Card className="overflow-hidden bg-muted/20">
            <CardHeader>
              <CardTitle className="text-base">Real viewport observation</CardTitle>
              <CardDescription>
                The image below comes from Chrome&apos;s visible tab through the installed extension. It is not a page mock or a
                screenshot baked into the site.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="aspect-video overflow-hidden rounded-lg border bg-background">
                {observation?.screenshot ? (
                  <button
                    type="button"
                    className="block h-full w-full cursor-crosshair overflow-hidden text-left"
                    onClick={pickCoordinate}
                    aria-label="Pick a click coordinate from the current Chrome viewport"
                  >
                    {/* The extension returns a bounded runtime data URL; Next Image cannot optimize this browser-owned payload. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={observation.screenshot.dataUrl}
                      alt="Current Chrome viewport returned by the Browser Agent extension; click to pick a coordinate"
                      className="block h-full w-full object-contain"
                    />
                  </button>
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                    {observation
                      ? `Screenshot not returned: ${observation.screenshotSuppressedReason ?? "unavailable"}.`
                      : "Connect the extension and request an observation to receive a real viewport image."}
                  </div>
                )}
              </div>
              <dl className="grid min-h-12 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-foreground">Viewport</dt>
                  <dd>
                    {observation
                      ? `${observation.viewport.width} × ${observation.viewport.height} · scroll ${observation.viewport.scrollX}, ${observation.viewport.scrollY}`
                      : "Awaiting observation"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Screenshot policy</dt>
                  <dd>
                    {observation?.screenshot
                      ? "captured by Chrome"
                      : (observation?.screenshotSuppressedReason ?? "Awaiting observation")}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !access.includes("page.observe")}
                  onClick={() => void runTool("browser_page_observe", { includeScreenshot: true })}
                >
                  Observe real viewport
                </Button>
                <Button variant="outline" disabled={busy || !access.includes("page.read")} onClick={() => void readPage()}>
                  Read page metadata
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-muted/20" aria-label="Real browser fixture">
            <CardHeader>
              <CardTitle className="text-base">Local fixture inside this real tab</CardTitle>
              <CardDescription>
                This is only a safe target page. The click, input, and scroll below are handled by the installed extension in
                Chrome.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  aria-label="Real browser target input"
                  defaultValue=""
                  onFocus={(event) => {
                    focusedTarget.current = event.currentTarget
                  }}
                  onChange={(event) => setFixtureMessage(`Input changed in Chrome: ${event.target.value || "(empty)"}`)}
                  placeholder="Click here through the extension, then use Type"
                />
                <Button onClick={() => setFixtureMessage("The real Chrome click reached this button")}>
                  Mark fixture action
                </Button>
              </div>
              <p role="status" className="rounded-md border p-3 text-sm">
                {fixtureMessage}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 8 }, (_, index) => (
                  <div key={index} className="rounded-md border bg-background p-4 text-sm text-muted-foreground">
                    Scroll target {index + 1}: this content makes the real viewport movement visible.
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <Card className="self-start bg-muted/20 lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle className="text-base">Agent actions</CardTitle>
            <CardDescription>Each control calls the public Browser Agent tool through the real Chrome bridge.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              className="w-full"
              variant="outline"
              disabled={busy || !access.includes("page.observe")}
              onClick={() => void runTool("browser_page_observe", { includeScreenshot: true })}
            >
              Observe after action
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="agent-x">X</Label>
                <Input id="agent-x" inputMode="numeric" value={x} onChange={(event) => setX(event.target.value)} />
              </div>
              <div>
                <Label htmlFor="agent-y">Y</Label>
                <Input id="agent-y" inputMode="numeric" value={y} onChange={(event) => setY(event.target.value)} />
              </div>
            </div>
            <Button
              className="w-full"
              disabled={busy || !access.includes("page.click")}
              onClick={() => void runTool("browser_page_click", { x: Number(x), y: Number(y) })}
            >
              Click viewport coordinate
            </Button>
            <div>
              <Label htmlFor="agent-scroll">Vertical scroll delta</Label>
              <Input
                id="agent-scroll"
                inputMode="numeric"
                value={scrollY}
                onChange={(event) => setScrollY(event.target.value)}
              />
            </div>
            <Button
              className="w-full"
              variant="outline"
              disabled={busy || !access.includes("page.scroll")}
              onClick={() => void runTool("browser_page_scroll", { deltaX: 0, deltaY: Number(scrollY) })}
            >
              Scroll the real page
            </Button>
            <div>
              <Label htmlFor="agent-text">Text for the focused page field</Label>
              <Input id="agent-text" value={text} onChange={(event) => setText(event.target.value)} />
            </div>
            <Button
              className="w-full"
              variant="outline"
              disabled={busy || !access.includes("page.type")}
              onClick={() => {
                // Restore only the demo field previously focused by the user or
                // a real extension click; the SDK still performs the text action.
                focusedTarget.current?.focus({ preventScroll: true })
                void runTool("browser_page_type", { text, replace: true })
              }}
            >
              Type into focused page field
            </Button>
          </CardContent>
        </Card>
      </div>
      <p className="text-sm text-muted-foreground" role="status">
        Agent action: {lastTool}
      </p>
      {actionLog.length > 0 && (
        <ul
          className="rounded-lg border bg-muted/20 p-3 font-mono text-xs text-muted-foreground"
          aria-label="Browser Agent action log"
        >
          {actionLog.map((entry) => (
            <li key={entry.id}>{entry.text}</li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground" role="status">
        The controls above call the same bounded tools exposed to MCP, OpenAI function calling, and LangChain adapters.
      </p>
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
      <Card aria-label="Agent tool adapters" className="bg-muted/30">
        <CardHeader>
          <CardTitle className="text-base">One capability, three adapters</CardTitle>
          <CardDescription>
            The demo invokes the same bounded capabilities through the shared contract. No framework is installed in the
            extension runtime.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {agentAdapters.map(({ name, tools, example }) => (
            <div key={name} className="rounded-lg border bg-background p-3">
              <p className="font-medium">{name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{tools.length} shared tools</p>
              <code className="mt-3 block text-xs break-all text-muted-foreground">{example}</code>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
