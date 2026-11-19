import {
  boundedJson,
  BridgeError,
  capabilities,
  decodeActionResult,
  decodeIncoming,
  decodeObservation,
  decodePage,
  fail,
  identifier,
  PORT_NAME,
  record,
  VERSION,
  MAX_SCREENSHOT_CHARS,
} from "./protocol.mts"
import type { AccessRequest, Capability, Incoming, Json, PageAction, Port, Request, Topic } from "./protocol.mts"

export interface Sender {
  id?: string
  url?: string
  origin?: string
  documentId?: string
  documentLifecycle?: string
  frameId?: number
  tab?: { id?: number; incognito?: boolean }
}
export interface Identity {
  kind: "ui" | "web" | "agent"
  key: string
  origin: string
  tabId: number
  documentId: string
}
export interface Policy {
  extensionId: string
  origins: string[]
  incognito: boolean
}
export function identify(sender: Sender | undefined, external: boolean, policy: Policy): Identity {
  if (!sender?.url || (sender.documentLifecycle && sender.documentLifecycle !== "active"))
    fail("FORBIDDEN", "Inactive or missing document identity")
  const url = new URL(sender.url)
  if (
    !external &&
    sender.id === policy.extensionId &&
    url.protocol === "chrome-extension:" &&
    url.hostname === policy.extensionId &&
    ["/index.html", "/options.html", "/sidepanel.html"].includes(url.pathname)
  ) {
    return {
      kind: "ui",
      key: `ui:${url.pathname}`,
      origin: `chrome-extension://${policy.extensionId}`,
      tabId: -1,
      documentId: "",
    }
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    sender.origin !== url.origin ||
    sender.frameId !== 0 ||
    !Number.isSafeInteger(sender.tab?.id) ||
    Number(sender.tab?.id) < 0 ||
    !sender.documentId ||
    sender.documentId.length > 128 ||
    Boolean(sender.tab?.incognito) !== policy.incognito
  )
    fail("FORBIDDEN", "Only an active top-level document may connect")
  if (external ? Boolean(sender.id) || !policy.origins.includes(url.origin) : sender.id !== policy.extensionId)
    fail("FORBIDDEN", "Origin is not allowed")
  const kind = external ? "web" : "agent"
  return {
    kind,
    key: `${kind}:${url.origin}:${sender.tab!.id}:${sender.documentId}`,
    origin: url.origin,
    tabId: sender.tab!.id!,
    documentId: sender.documentId,
  }
}
interface Grant extends AccessRequest {
  key: string
}
interface Session {
  port: Port
  identity: Identity
  topics: Set<Topic>
  pending: Map<string, AbortController>
  seen: Map<string, number>
  tokens: number
  tokenAt: number
  dirty: Set<Topic>
  flushing: boolean
  timer?: ReturnType<typeof setTimeout>
  dispose: () => void
}
export interface BrokerOptions {
  instance: string
  policy: Policy
  loadGrants(): Promise<unknown>
  saveGrants(value: unknown): Promise<void>
  workspace(): Promise<string>
  setWorkspace(name: string): Promise<void>
  activeTab(): Promise<number>
  preparePage(tabId: number): Promise<string>
  authorizeOrigin(origin: string): Promise<boolean>
  capturePage?(
    tabId: number,
    context: { signal: AbortSignal; assertAuthorized(): void },
  ): Promise<{ dataUrl: string; mimeType: "image/jpeg" | "image/png"; width?: number; height?: number }>
  navigatePage?(tabId: number, url: string): Promise<void>
}
export function createBroker(options: BrokerOptions) {
  const epoch = crypto.randomUUID()
  const sessions = new Set<Session>()
  const approvals = new Map<string, { request: AccessRequest; session: Session }>()
  const agents = new Map<string, Session>()
  const agentCalls = new Map<string, { session: Session; resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const actionTails = new Map<string, Promise<void>>()
  const buckets = new Map<string, { tokens: number; at: number }>()
  let grants: Grant[] = []
  let revision = 0
  let globalTokens = 120
  let globalAt = Date.now()
  let writes: Promise<unknown> = Promise.resolve()
  const invalidatedTabs = new Set<number>()
  let invalidation: Promise<void> | undefined
  let closed = false
  let revokedDuringLoad = false
  const ready = options.loadGrants().then((value) => {
    if (
      !revokedDuringLoad &&
      boundedJson(value) &&
      record(value) &&
      value.version === 1 &&
      Array.isArray(value.grants) &&
      value.grants.length <= 64
    ) {
      grants = value.grants.filter(
        (g): g is Grant =>
          record(g) &&
          identifier(g.id) &&
          typeof g.key === "string" &&
          g.key.length < 512 &&
          typeof g.origin === "string" &&
          options.policy.origins.includes(g.origin) &&
          Number.isSafeInteger(g.tabId) &&
          typeof g.documentId === "string" &&
          Array.isArray(g.capabilities) &&
          g.capabilities.length > 0 &&
          g.capabilities.every((c) => capabilities.includes(c as Capability)) &&
          typeof g.expiresAt === "number" &&
          g.expiresAt > Date.now() &&
          g.expiresAt <= Date.now() + 3_600_000 &&
          g.key === `web:${g.origin}:${g.tabId}:${g.documentId}`,
      )
    }
  })
  // Keep a rejected initialization observable to each request without an unhandled rejection.
  void ready.catch(() => undefined)
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = writes.then(action)
    writes = result.catch(() => undefined)
    return result
  }
  function persist() {
    const value = { version: 1, grants }
    if (!boundedJson(value)) fail("BUSY", "Stored authorization capacity exceeded")
    return options.saveGrants(value)
  }
  function granted(session: Session, capability: Capability) {
    return (
      session.identity.kind === "ui" ||
      (!invalidatedTabs.has(session.identity.tabId) &&
        grants.some(
          (grant) =>
            grant.key === session.identity.key && grant.expiresAt > Date.now() && grant.capabilities.includes(capability),
        ))
    )
  }
  function requireUI(session: Session) {
    if (session.identity.kind !== "ui") fail("FORBIDDEN", "Open the extension to manage access")
  }
  function requireCapability(session: Session, capability: Capability) {
    if (!granted(session, capability)) fail("NOT_AUTHORIZED", "Approve this capability in the extension first")
  }
  function send(session: Session, value: unknown) {
    if (!sessions.has(session)) return
    if (!boundedJson(value)) {
      session.dispose()
      return
    }
    try {
      session.port.postMessage(value)
    } catch {
      session.dispose()
    }
  }
  function error(session: Session, id: string, reason: unknown) {
    send(session, {
      v: VERSION,
      kind: "error",
      id,
      code: reason instanceof BridgeError ? reason.code : "INTERNAL",
      message: reason instanceof BridgeError ? reason.message : "Extension request failed",
    })
  }
  function accessSnapshot(session: Session): Json {
    if (session.identity.kind === "ui")
      return {
        pending: [...approvals.values()].filter((a) => a.request.expiresAt > Date.now()).length,
        grants: grants.filter((g) => g.expiresAt > Date.now()).length,
      }
    return { capabilities: capabilities.filter((c) => granted(session, c)) }
  }
  async function snapshot(session: Session, name: Topic): Promise<Json> {
    await ready
    if (session.identity.kind === "web" && !(await options.authorizeOrigin(session.identity.origin))) {
      if (name === "access") return { capabilities: [] }
      fail("FORBIDDEN", "Browser website access is unavailable")
    }
    if (name === "access") return accessSnapshot(session)
    requireCapability(session, "workspace.read")
    const nameValue = await options.workspace()
    requireCapability(session, "workspace.read")
    return { name: nameValue }
  }
  function queue(session: Session, name: Topic) {
    session.dirty.add(name)
    if (session.timer || session.flushing || !sessions.has(session)) return
    session.timer = setTimeout(() => {
      session.timer = undefined
      const dirty = [...session.dirty]
      session.dirty.clear()
      session.flushing = true
      void (async () => {
        for (const item of dirty) {
          if (!session.topics.has(item) || !sessions.has(session)) continue
          const currentRevision = revision
          try {
            const value = await snapshot(session, item)
            if (session.topics.has(item) && (item !== "workspace" || granted(session, "workspace.read")))
              send(session, { v: VERSION, kind: "event", topic: item, epoch, revision: currentRevision, value })
          } catch {
            session.topics.delete(item)
          }
        }
      })().finally(() => {
        session.flushing = false
        if (session.dirty.size && sessions.has(session)) queue(session, [...session.dirty][0])
      })
    }, 100)
  }
  function changed(name: Topic) {
    revision++
    for (const session of sessions) if (session.topics.has(name)) queue(session, name)
  }
  function cleanupApprovals() {
    for (const [id, entry] of approvals)
      if (entry.request.expiresAt <= Date.now() || !sessions.has(entry.session)) approvals.delete(id)
  }
  function agentKey(tabId: number, documentId: string) {
    return `${tabId}:${documentId}`
  }
  async function pageTarget(session: Session, params: Record<string, unknown>, signal: AbortSignal) {
    let tabId = session.identity.tabId
    let documentId = session.identity.documentId
    if (session.identity.kind === "ui") {
      tabId = await options.activeTab()
      if (params.tabId !== undefined && params.tabId !== tabId)
        fail("FORBIDDEN", "Only the selected active tab may be controlled")
      documentId = await options.preparePage(tabId)
    } else if (params.tabId !== undefined) fail("FORBIDDEN", "Web access is limited to its own document")
    if (signal.aborted || !sessions.has(session)) fail("CANCELLED", "Request cancelled")
    if (session.identity.kind === "web" && !agents.has(agentKey(tabId, documentId))) {
      const prepared = await options.preparePage(tabId)
      if (prepared !== documentId) fail("FORBIDDEN", "The approved page has navigated")
    }
    for (let attempt = 0; attempt < 40 && !agents.has(agentKey(tabId, documentId)); attempt++) {
      if (signal.aborted || !sessions.has(session)) fail("CANCELLED", "Request cancelled")
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const agent = agents.get(agentKey(tabId, documentId))
    if (!agent || agentCalls.size >= 32)
      fail("PAGE_UNAVAILABLE", "Page agent is unavailable; select a permitted page and try again")
    if (signal.aborted || !sessions.has(session)) fail("CANCELLED", "Request cancelled")
    if (session.identity.kind === "web" && agent.identity.origin !== session.identity.origin)
      fail("FORBIDDEN", "Page origin changed")
    return { tabId, documentId, agent }
  }
  async function requestAgent<T>(
    agent: Session,
    message:
      | { v: 1; kind: "agent.read" | "agent.observe"; id: string }
      | { v: 1; kind: "agent.action"; id: string; action: PageAction },
    decode: (value: unknown) => T,
    signal: AbortSignal,
  ): Promise<T> {
    const id = message.id
    const result = await new Promise<unknown>((resolve, reject) => {
      const finish = (value?: unknown, reason?: Error) => {
        clearTimeout(timer)
        signal.removeEventListener("abort", cancel)
        agentCalls.delete(id)
        if (reason) reject(reason)
        else resolve(value)
      }
      const cancel = () => {
        send(agent, { v: VERSION, kind: "agent.cancel", id })
        finish(undefined, new BridgeError("CANCELLED", "Request cancelled"))
      }
      const timer = setTimeout(() => finish(undefined, new BridgeError("TIMEOUT", "Page agent did not respond")), 4_000)
      agentCalls.set(id, { session: agent, resolve: (value) => finish(value), reject: (reason) => finish(undefined, reason) })
      signal.addEventListener("abort", cancel, { once: true })
      send(agent, message)
    })
    return decode(result)
  }
  async function pageRead(session: Session, params: Record<string, unknown>, signal: AbortSignal) {
    requireCapability(session, "page.read")
    const { agent } = await pageTarget(session, params, signal)
    const result = await requestAgent(agent, { v: VERSION, kind: "agent.read", id: crypto.randomUUID() }, decodePage, signal)
    if (new URL(result.url).origin !== agent.identity.origin) fail("FORBIDDEN", "Page identity changed")
    requireCapability(session, "page.read")
    return result
  }
  async function pageObserve(session: Session, params: Record<string, unknown>, signal: AbortSignal) {
    requireCapability(session, "page.observe")
    const { tabId, agent } = await pageTarget(session, params, signal)
    const assertAuthorized = () => {
      if (signal.aborted) fail("CANCELLED", "Observation cancelled")
      if (!sessions.has(session)) fail("DISCONNECTED", "The requesting document disconnected")
      requireCapability(session, "page.observe")
      if (agents.get(agentKey(tabId, agent.identity.documentId)) !== agent)
        fail("FORBIDDEN", "The approved page navigated during observation")
    }
    const observation = await requestAgent(
      agent,
      { v: VERSION, kind: "agent.observe", id: crypto.randomUUID() },
      decodeObservation,
      signal,
    )
    if (new URL(observation.page.url).origin !== agent.identity.origin) fail("FORBIDDEN", "Page identity changed")
    assertAuthorized()
    if (params.includeScreenshot === false) return observation
    if (observation.sensitiveFields) return { ...observation, screenshotSuppressedReason: "sensitive-fields" as const }
    if (!options.capturePage) return { ...observation, screenshotSuppressedReason: "unavailable" as const }
    const beforeCapture = await requestAgent(
      agent,
      { v: VERSION, kind: "agent.observe", id: crypto.randomUUID() },
      decodeObservation,
      signal,
    )
    assertAuthorized()
    if (beforeCapture.sensitiveFields) return { ...beforeCapture, screenshotSuppressedReason: "sensitive-fields" as const }
    if (agents.get(agentKey(tabId, agent.identity.documentId)) !== agent)
      fail("FORBIDDEN", "The approved page navigated during observation")
    try {
      const screenshot = await options.capturePage(tabId, { signal, assertAuthorized })
      assertAuthorized()
      if (agents.get(agentKey(tabId, agent.identity.documentId)) !== agent)
        fail("FORBIDDEN", "The approved page navigated during screenshot capture")
      if (screenshot.dataUrl.length > MAX_SCREENSHOT_CHARS)
        throw new BridgeError("PAYLOAD_TOO_LARGE", "Viewport image exceeds bridge limits")
      const afterCapture = await requestAgent(
        agent,
        { v: VERSION, kind: "agent.observe", id: crypto.randomUUID() },
        decodeObservation,
        signal,
      )
      assertAuthorized()
      if (afterCapture.sensitiveFields) return { ...afterCapture, screenshotSuppressedReason: "sensitive-fields" as const }
      if (new URL(afterCapture.page.url).origin !== agent.identity.origin)
        fail("FORBIDDEN", "Page identity changed during screenshot capture")
      for (const key of ["width", "height", "scrollX", "scrollY", "devicePixelRatio"] as const)
        if (beforeCapture.viewport[key] !== afterCapture.viewport[key])
          fail("PAGE_CHANGED", "The viewport changed during screenshot capture; observe again")
      if ((screenshot.width === undefined) !== (screenshot.height === undefined))
        fail("PROTOCOL", "Screenshot dimensions must be provided together")
      return decodeObservation({
        ...afterCapture,
        screenshot: {
          ...screenshot,
          width: screenshot.width ?? Math.round(afterCapture.viewport.width * afterCapture.viewport.devicePixelRatio),
          height: screenshot.height ?? Math.round(afterCapture.viewport.height * afterCapture.viewport.devicePixelRatio),
          pixelRatio:
            screenshot.width === undefined
              ? afterCapture.viewport.devicePixelRatio
              : screenshot.width / afterCapture.viewport.width,
        },
      })
    } catch (reason) {
      assertAuthorized()
      if (reason instanceof BridgeError && reason.code === "PAYLOAD_TOO_LARGE")
        return { ...observation, screenshotSuppressedReason: "too-large" as const }
      if (reason instanceof BridgeError) throw reason
      return { ...observation, screenshotSuppressedReason: "unavailable" as const }
    }
  }
  async function pageAction(session: Session, capability: Capability, action: PageAction, signal: AbortSignal) {
    requireCapability(session, capability)
    const selectedTab = session.identity.kind === "ui" ? await options.activeTab() : undefined
    const key = selectedTab !== undefined ? `tab:${selectedTab}` : agentKey(session.identity.tabId, session.identity.documentId)
    const previous = actionTails.get(key) ?? Promise.resolve()
    let release!: () => void
    const turn = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => turn)
    actionTails.set(key, tail)
    try {
      await previous
      if (signal.aborted) fail("CANCELLED", "Request cancelled")
      const { agent } = await pageTarget(session, selectedTab === undefined ? {} : { tabId: selectedTab }, signal)
      const result = await requestAgent(
        agent,
        { v: VERSION, kind: "agent.action", id: crypto.randomUUID(), action },
        decodeActionResult,
        signal,
      )
      requireCapability(session, capability)
      return result
    } finally {
      release()
      if (actionTails.get(key) === tail) actionTails.delete(key)
    }
  }
  async function pageNavigate(session: Session, params: Record<string, unknown>, signal: AbortSignal) {
    requireCapability(session, "page.navigate")
    if (params.confirm !== true) fail("CONFIRMATION_REQUIRED", "Navigation requires explicit confirmation")
    const target = new URL(String(params.url))
    if (session.identity.kind === "web" && target.origin !== session.identity.origin)
      fail("FORBIDDEN", "Web navigation is limited to the approved origin")
    if (!(await options.authorizeOrigin(target.origin))) fail("FORBIDDEN", "Navigation origin is not permitted")
    if (!options.navigatePage) fail("UNSUPPORTED", "Navigation is unavailable in this extension build")
    const { tabId } = await pageTarget(session, {}, signal)
    if (signal.aborted || !sessions.has(session)) fail("CANCELLED", "Request cancelled")
    await options.navigatePage(tabId, target.href)
    return { accepted: true as const, action: "navigate" as const, url: target.href }
  }
  async function handle(session: Session, request: Request, signal: AbortSignal): Promise<unknown> {
    await ready
    if (!sessions.has(session) || signal.aborted) fail("CANCELLED", "Request cancelled")
    const { method, params } = request
    if (
      method !== "bridge.info" &&
      session.identity.kind === "web" &&
      !(await options.authorizeOrigin(session.identity.origin))
    )
      fail("FORBIDDEN", "Browser website access is unavailable")
    switch (method) {
      case "bridge.info":
        return { version: VERSION, epoch, instance: options.instance, context: session.identity.kind }
      case "workspace.get": {
        requireCapability(session, "workspace.read")
        const name = await options.workspace()
        requireCapability(session, "workspace.read")
        return { name }
      }
      case "workspace.set":
        requireUI(session)
        return serial(async () => {
          if (signal.aborted) fail("CANCELLED", "Request cancelled")
          const name = String(params.name).trim()
          await options.setWorkspace(name)
          changed("workspace")
          return { name }
        })
      case "page.read":
        return pageRead(session, params, signal)
      case "page.observe":
        return pageObserve(session, params, signal)
      case "page.click":
        return pageAction(
          session,
          "page.click",
          {
            action: "click",
            x: Number(params.x),
            y: Number(params.y),
            ...(params.confirm === undefined ? {} : { confirm: params.confirm as boolean }),
          },
          signal,
        )
      case "page.scroll":
        return pageAction(
          session,
          "page.scroll",
          { action: "scroll", deltaX: Number(params.deltaX), deltaY: Number(params.deltaY) },
          signal,
        )
      case "page.type":
        return pageAction(
          session,
          "page.type",
          {
            action: "type",
            text: String(params.text),
            ...(params.replace === undefined ? {} : { replace: params.replace as boolean }),
          },
          signal,
        )
      case "page.keypress":
        return pageAction(
          session,
          "page.keypress",
          {
            action: "keypress",
            key: String(params.key),
            ...(params.confirm === undefined ? {} : { confirm: params.confirm as boolean }),
          },
          signal,
        )
      case "page.navigate":
        return pageNavigate(session, params, signal)
      case "access.request": {
        if (session.identity.kind !== "web") fail("FORBIDDEN", "Only a Web document requests access")
        const requested = params.capabilities as Capability[]
        if (requested.every((c) => granted(session, c))) return { id: "existing", status: "granted" }
        cleanupApprovals()
        const previous = [...approvals.values()].find((entry) => entry.session === session)
        if (previous) return { id: previous.request.id, status: "pending" }
        if (approvals.size >= 20) fail("BUSY", "Too many pending access requests")
        const requestValue: AccessRequest = {
          id: crypto.randomUUID(),
          origin: session.identity.origin,
          tabId: session.identity.tabId,
          documentId: session.identity.documentId,
          capabilities: requested,
          expiresAt: Date.now() + 120_000,
        }
        approvals.set(requestValue.id, { request: requestValue, session })
        changed("access")
        return { id: requestValue.id, status: "pending" }
      }
      case "access.pending":
        requireUI(session)
        cleanupApprovals()
        return { requests: [...approvals.values()].map((entry) => entry.request) }
      case "access.decide":
        requireUI(session)
        return serial(async () => {
          cleanupApprovals()
          const entry = approvals.get(String(params.id))
          if (!entry || !sessions.has(entry.session)) fail("EXPIRED", "The requesting document is no longer connected")
          if (params.allow) {
            if (!(await options.authorizeOrigin(entry.request.origin)))
              fail("FORBIDDEN", "Enable this website in the browser's extension permissions first")
            if (!sessions.has(entry.session) || signal.aborted) fail("EXPIRED", "The requesting document disconnected")
            grants = grants.filter((g) => g.expiresAt > Date.now() && g.key !== entry.session.identity.key)
            if (grants.length >= 64) fail("BUSY", "Revoke an existing grant first")
            const previous = [...grants]
            grants.push({ ...entry.request, key: entry.session.identity.key, expiresAt: Date.now() + 3_600_000 })
            try {
              await persist()
            } catch (reason) {
              grants = previous
              throw reason
            }
          }
          approvals.delete(String(params.id))
          changed("access")
          return { accepted: Boolean(params.allow) }
        })
      case "access.grants":
        requireUI(session)
        return {
          grants: grants
            .filter((g) => g.expiresAt > Date.now())
            .map((g) => ({
              id: g.id,
              origin: g.origin,
              tabId: g.tabId,
              documentId: g.documentId,
              capabilities: g.capabilities,
              expiresAt: g.expiresAt,
            })),
        }
      case "access.revoke":
        requireUI(session)
        return serial(async () => {
          grants = grants.filter((g) => g.id !== params.id)
          await persist()
          changed("access")
          return { accepted: true }
        })
    }
  }
  function budget(session: Session) {
    const now = Date.now()
    globalTokens = Math.min(120, globalTokens + (now - globalAt) / 10)
    globalAt = now
    const bucket = buckets.get(session.identity.key) ?? { tokens: 30, at: now }
    bucket.tokens = Math.min(30, bucket.tokens + (now - bucket.at) / 200)
    bucket.at = now
    buckets.set(session.identity.key, bucket)
    session.tokens = Math.min(30, session.tokens + (now - session.tokenAt) / 200)
    session.tokenAt = now
    if (globalTokens < 1 || bucket.tokens < 1 || session.tokens < 1) return false
    globalTokens--
    bucket.tokens--
    session.tokens--
    return true
  }
  function attach(port: Port, sender: Sender | undefined, external: boolean, name = PORT_NAME) {
    let identity: Identity
    try {
      if (closed || name !== PORT_NAME) fail("FORBIDDEN", "Unknown bridge channel")
      identity = identify(sender, external, options.policy)
    } catch {
      port.disconnect()
      return
    }
    if (sessions.size >= 64 || [...sessions].filter((s) => s.identity.key === identity.key).length >= 4) {
      port.disconnect()
      return
    }
    if (buckets.size >= 128 && !buckets.has(identity.key)) {
      for (const [key, bucket] of buckets) if (Date.now() - bucket.at > 60_000) buckets.delete(key)
      if (buckets.size >= 128) {
        port.disconnect()
        return
      }
    }
    const session: Session = {
      port,
      identity,
      topics: new Set(),
      pending: new Map(),
      seen: new Map(),
      tokens: 30,
      tokenAt: Date.now(),
      dirty: new Set(),
      flushing: false,
      dispose,
    }
    function dispose() {
      if (!sessions.delete(session)) return
      if (session.timer) clearTimeout(session.timer)
      port.onMessage.removeListener(receive)
      port.onDisconnect.removeListener(dispose)
      for (const controller of session.pending.values()) controller.abort()
      for (const [id, call] of agentCalls)
        if (call.session === session) {
          call.reject(new BridgeError("DISCONNECTED", "Page navigated or disconnected"))
          agentCalls.delete(id)
        }
      if (agents.get(agentKey(identity.tabId, identity.documentId)) === session)
        agents.delete(agentKey(identity.tabId, identity.documentId))
      let removedApproval = false
      for (const [id, entry] of approvals)
        if (entry.session === session) {
          approvals.delete(id)
          removedApproval = true
        }
      try {
        port.disconnect()
      } catch {
        /* Already gone. */
      }
      if (removedApproval) changed("access")
    }
    function receive(value: unknown) {
      if (!budget(session)) {
        dispose()
        return
      }
      if (identity.kind === "agent") {
        try {
          if (!record(value) || !boundedJson(value) || value.v !== VERSION || !identifier(value.id))
            fail("PROTOCOL", "Invalid agent response")
          if (value.kind !== "agent.result" && value.kind !== "agent.error") fail("PROTOCOL", "Invalid agent response")
          const pending = agentCalls.get(value.id)
          if (!pending || pending.session !== session) return
          if (value.kind === "agent.error") {
            if (typeof value.code !== "string" || typeof value.message !== "string") fail("PROTOCOL", "Invalid agent error")
            pending.reject(new BridgeError(value.code, value.message))
          } else if (value.kind === "agent.result") {
            pending.resolve(value.value)
          } else fail("PROTOCOL", "Invalid agent response")
        } catch (reason) {
          for (const [id, pending] of agentCalls)
            if (pending.session === session) {
              pending.reject(reason instanceof Error ? reason : new BridgeError("PROTOCOL", "Invalid agent response"))
              agentCalls.delete(id)
            }
          dispose()
        }
        return
      }
      let message: Incoming
      try {
        message = decodeIncoming(value)
      } catch {
        dispose()
        return
      }
      if (message.kind === "cancel") {
        session.pending.get(message.id)?.abort()
        return
      }
      if (message.kind === "subscribe" || message.kind === "unsubscribe") {
        if (message.kind === "unsubscribe") {
          session.topics.delete(message.topic)
          return
        }
        if (message.topic === "workspace" && !granted(session, "workspace.read")) return
        session.topics.add(message.topic)
        queue(session, message.topic)
        return
      }
      if (message.kind !== "request") return
      const now = Date.now()
      for (const [id, deadline] of session.seen) if (deadline < now) session.seen.delete(id)
      if (message.deadline < now || message.deadline > now + 30_000) {
        error(session, message.id, new BridgeError("EXPIRED", "Request deadline is invalid"))
        return
      }
      if (session.seen.has(message.id)) {
        error(session, message.id, new BridgeError("DUPLICATE", "Request ID already used"))
        return
      }
      if (session.pending.size >= 8 || session.seen.size >= 256) {
        error(session, message.id, new BridgeError("BUSY", "Request capacity exceeded"))
        return
      }
      session.seen.set(message.id, message.deadline)
      const controller = new AbortController()
      session.pending.set(message.id, controller)
      const timer = setTimeout(() => controller.abort(), message.deadline - now)
      void handle(session, message, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) fail("CANCELLED", "Request deadline elapsed or caller cancelled")
          send(session, { v: VERSION, kind: "result", id: message.id, value: result })
        })
        .catch((reason: unknown) => error(session, message.id, reason))
        .finally(() => {
          clearTimeout(timer)
          session.pending.delete(message.id)
        })
    }
    sessions.add(session)
    port.onMessage.addListener(receive)
    port.onDisconnect.addListener(dispose)
    if (identity.kind === "agent") {
      const key = agentKey(identity.tabId, identity.documentId)
      agents.get(key)?.dispose()
      agents.set(key, session)
    }
  }
  return {
    attach,
    workspaceChanged: () => changed("workspace"),
    invalidateTab(tabId: number) {
      for (const session of [...sessions]) if (session.identity.tabId === tabId) session.dispose()
      invalidatedTabs.add(tabId)
      // Browser navigation bursts share one pending write instead of growing a promise queue.
      invalidation ??= serial(async () => {
        await ready
        while (invalidatedTabs.size) {
          const batch = new Set(invalidatedTabs)
          invalidatedTabs.clear()
          const previousLength = grants.length
          grants = grants.filter((g) => !batch.has(g.tabId))
          if (previousLength !== grants.length) {
            await persist()
            changed("access")
          }
        }
      }).finally(() => {
        invalidation = undefined
      })
      return invalidation
    },
    revokeAll() {
      revokedDuringLoad = true
      grants = []
      return serial(async () => {
        await ready
        grants = []
        await persist()
        changed("access")
      })
    },
    close() {
      closed = true
      for (const session of [...sessions]) session.dispose()
    },
    // Bounded counters aid tests/diagnostics without exposing document or payload data.
    counts: () => ({ sessions: sessions.size, approvals: approvals.size, reads: agentCalls.size, buckets: buckets.size }),
  }
}
