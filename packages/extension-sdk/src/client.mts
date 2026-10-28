import {
  boundedJson,
  BridgeError,
  decodeResult,
  decodeSnapshot,
  identifier,
  PORT_NAME,
  record,
  topic,
  VERSION,
} from "./protocol.mts"
import type { Json, Method, Methods, Port, Topic } from "./protocol.mts"
export { BridgeError } from "./protocol.mts"
export type { AccessRequest, Capability, PageInfo } from "./protocol.mts"

export type ConnectionState = "disconnected" | "connecting" | "connected" | "closed"
export interface ClientOptions {
  connect: () => Port
  timeoutMs?: number
  reconnect?: boolean
}
type Pending = {
  method: Method
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  abort?: () => void
}
export function createClient(options: ClientOptions) {
  let port: Port | undefined
  let binding: { receive(value: unknown): void; disconnected(): void } | undefined
  let workerEpoch: string | undefined
  let connecting: Promise<void> | undefined
  let state: ConnectionState = "disconnected"
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let counter = 0
  let requests = 0
  let observedConnection: Promise<void> | undefined
  const connectionWaiters = new Set<{ resolve(): void; reject(error: Error): void }>()
  const prefix = crypto.randomUUID().replaceAll("-", "")
  const pending = new Map<string, Pending>()
  const subscriptions = new Map<Topic, Set<(value: Json) => void>>()
  const revisions = new Map<Topic, { epoch: string; revision: number }>()
  const states = new Set<(value: ConnectionState) => void>()
  function getState(): ConnectionState {
    return state
  }
  function notifyState(next: ConnectionState) {
    state = next
    for (const listener of states) {
      try {
        listener(next)
      } catch {
        /* Observer errors cannot break routing. */
      }
    }
  }
  function settle(id: string, value: unknown, error?: Error) {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    clearTimeout(entry.timer)
    entry.abort?.()
    if (error) entry.reject(error)
    else entry.resolve(value)
  }
  function schedule() {
    if (!options.reconnect || !subscriptions.size || state === "closed" || reconnectTimer || attempts >= 5) return
    const wait = Math.min(1000 * 2 ** attempts++, 16_000) * (0.8 + Math.random() * 0.4)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void connect().catch(schedule)
    }, wait)
  }
  function detach(error: Error) {
    const old = port
    const oldBinding = binding
    port = undefined
    binding = undefined
    workerEpoch = undefined
    if (old) {
      try {
        if (oldBinding) old.onMessage.removeListener(oldBinding.receive)
      } catch {
        /* Reload can invalidate event objects too. */
      }
      try {
        if (oldBinding) old.onDisconnect.removeListener(oldBinding.disconnected)
      } catch {
        /* Still settle all local waiting below. */
      }
      try {
        old.disconnect()
      } catch {
        /* Already disconnected. */
      }
    }
    for (const id of [...pending.keys()]) settle(id, undefined, error)
    revisions.clear()
    if (state !== "closed") {
      notifyState("disconnected")
      schedule()
    }
  }
  function disconnected() {
    detach(new BridgeError("DISCONNECTED", "Extension connection closed; reconnect to obtain a fresh snapshot"))
  }
  function receive(value: unknown) {
    if (!record(value) || !boundedJson(value) || value.v !== VERSION) {
      detach(new BridgeError("PROTOCOL", "Invalid extension response"))
      return
    }
    if ((value.kind === "result" || value.kind === "error") && identifier(value.id)) {
      if (value.kind === "result" && Object.hasOwn(value, "value")) {
        const entry = pending.get(value.id)
        if (!entry) return
        try {
          settle(value.id, decodeResult(entry.method, value.value))
        } catch {
          detach(new BridgeError("PROTOCOL", "Invalid method response"))
        }
      } else if (value.kind === "error" && typeof value.code === "string" && typeof value.message === "string")
        settle(value.id, undefined, new BridgeError(value.code, value.message))
      else detach(new BridgeError("PROTOCOL", "Invalid response envelope"))
    } else if (
      value.kind === "event" &&
      topic(value.topic) &&
      identifier(value.epoch) &&
      Number.isSafeInteger(value.revision) &&
      Number(value.revision) >= 0 &&
      Object.hasOwn(value, "value")
    ) {
      if (state !== "connected") return
      if (value.epoch !== workerEpoch) {
        detach(new BridgeError("PROTOCOL", "Worker epoch changed without negotiation"))
        return
      }
      const previous = revisions.get(value.topic)
      if (previous?.epoch === value.epoch && previous.revision >= Number(value.revision)) return
      let snapshot: Json
      try {
        snapshot = decodeSnapshot(value.topic, value.value)
      } catch {
        detach(new BridgeError("PROTOCOL", "Invalid subscription snapshot"))
        return
      }
      revisions.set(value.topic, { epoch: value.epoch, revision: Number(value.revision) })
      for (const listener of subscriptions.get(value.topic) ?? []) {
        try {
          listener(snapshot)
        } catch {
          /* Local observers never echo messages. */
        }
      }
    } else detach(new BridgeError("PROTOCOL", "Unexpected extension message"))
  }
  function send(method: Method, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!port) return Promise.reject(new BridgeError("DISCONNECTED", "Extension is not connected"))
    if (pending.size >= 32) return Promise.reject(new BridgeError("BUSY", "Too many pending extension requests"))
    if (signal?.aborted) return Promise.reject(new BridgeError("CANCELLED", "Request cancelled"))
    const id = `${prefix}_${++counter}`
    const timeout = Math.min(Math.max(options.timeoutMs ?? 10_000, 100), 30_000)
    const message = { v: VERSION, kind: "request", id, method, params, deadline: Date.now() + timeout }
    if (!boundedJson(message)) return Promise.reject(new BridgeError("PROTOCOL", "Request exceeds the bridge limits"))
    return new Promise((resolve, reject) => {
      const cancel = (code: string) => {
        try {
          port?.postMessage({ v: VERSION, kind: "cancel", id })
        } catch {
          /* Disconnect also settles local waiting. */
        }
        settle(id, undefined, new BridgeError(code, code === "TIMEOUT" ? "Extension request timed out" : "Request cancelled"))
      }
      const onAbort = () => cancel("CANCELLED")
      const entry: Pending = {
        method,
        resolve,
        reject,
        timer: setTimeout(() => cancel("TIMEOUT"), timeout),
        abort: () => signal?.removeEventListener("abort", onAbort),
      }
      pending.set(id, entry)
      signal?.addEventListener("abort", onAbort, { once: true })
      try {
        port!.postMessage(message)
      } catch {
        detach(new BridgeError("DISCONNECTED", "Unable to send extension request"))
      }
    })
  }
  async function connect(): Promise<void> {
    if (state === "closed") throw new BridgeError("CLOSED", "This SDK client has been disposed")
    if (connecting) return connecting
    if (state === "connected") return
    notifyState("connecting")
    connecting = (async () => {
      // Assign the shared promise before even a synchronous transport failure settles it.
      await Promise.resolve()
      try {
        if (getState() === "closed") throw new BridgeError("CLOSED", "SDK client disposed")
        const opened = options.connect()
        port = opened
        binding = {
          receive(value) {
            if (port === opened) receive(value)
          },
          disconnected() {
            if (port === opened) disconnected()
          },
        }
        opened.onMessage.addListener(binding.receive)
        opened.onDisconnect.addListener(binding.disconnected)
        const info = await send("bridge.info", {})
        if (
          !record(info) ||
          info.version !== VERSION ||
          !identifier(info.epoch) ||
          typeof info.instance !== "string" ||
          !["ui", "web"].includes(String(info.context))
        )
          throw new BridgeError("PROTOCOL", "Extension protocol negotiation failed")
        if (!port || getState() === "closed") throw new BridgeError("DISCONNECTED", "Extension disconnected during negotiation")
        workerEpoch = info.epoch
        notifyState("connected")
        for (const name of subscriptions.keys()) port.postMessage({ v: VERSION, kind: "subscribe", topic: name })
      } catch (error) {
        detach(error instanceof Error ? error : new BridgeError("UNAVAILABLE", "Extension is unavailable"))
        throw error
      } finally {
        connecting = undefined
      }
    })()
    return connecting
  }
  function waitForConnection(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new BridgeError("CANCELLED", "Request cancelled"))
    if (state === "closed") return Promise.reject(new BridgeError("CLOSED", "SDK client disposed"))
    if (state === "connected") return Promise.resolve()
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        connectionWaiters.delete(waiter)
        signal?.removeEventListener("abort", cancel)
        if (error) reject(error)
        else resolve()
      }
      const cancel = () => {
        finish(new BridgeError("CANCELLED", "Request cancelled"))
      }
      const waiter = { resolve: () => finish(), reject: (error: Error) => finish(error) }
      connectionWaiters.add(waiter)
      signal?.addEventListener("abort", cancel, { once: true })
      if (!observedConnection) {
        const pendingConnection = connect()
        observedConnection = pendingConnection
        // One observer per negotiation. Cancelled callers are removed from the
        // bounded Set rather than retained by an unremovable Promise.then chain.
        void pendingConnection
          .then(
            () => {
              for (const entry of [...connectionWaiters]) entry.resolve()
            },
            (reason: unknown) => {
              for (const entry of [...connectionWaiters])
                entry.reject(reason instanceof Error ? reason : new BridgeError("UNAVAILABLE", "Extension connection failed"))
            },
          )
          .finally(() => {
            if (observedConnection === pendingConnection) observedConnection = undefined
          })
      }
    })
  }
  return {
    connect() {
      attempts = 0
      return connect()
    },
    getState,
    diagnostics: () => ({ requests, pending: pending.size, connectionWaiters: connectionWaiters.size }),
    onState(listener: (value: ConnectionState) => void) {
      if (state === "closed") throw new BridgeError("CLOSED", "SDK client disposed")
      if (states.size >= 16) throw new BridgeError("BUSY", "Too many connection observers")
      states.add(listener)
      return () => {
        states.delete(listener)
      }
    },
    async request<M extends Method>(
      method: M,
      params: Methods[M]["params"],
      options: { signal?: AbortSignal } = {},
    ): Promise<Methods[M]["result"]> {
      if (options.signal?.aborted) throw new BridgeError("CANCELLED", "Request cancelled")
      if (requests >= 32) throw new BridgeError("BUSY", "Too many queued extension requests")
      requests++
      try {
        if (state === "disconnected") attempts = 0
        await waitForConnection(options.signal)
        // Commands are never retried automatically: disconnect can leave their outcome unknown.
        return (await send(method, params, options.signal)) as Methods[M]["result"]
      } finally {
        requests--
      }
    },
    subscribe(name: Topic, listener: (value: Json) => void) {
      if (!topic(name) || state === "closed") throw new BridgeError("CLOSED", "Subscription is unavailable")
      const listeners = subscriptions.get(name) ?? new Set<(value: Json) => void>()
      if (listeners.size >= 16) throw new BridgeError("BUSY", "Too many local observers")
      const first = !listeners.size
      listeners.add(listener)
      subscriptions.set(name, listeners)
      if (first && state === "connected") port?.postMessage({ v: VERSION, kind: "subscribe", topic: name })
      else void connect().catch(schedule)
      return () => {
        listeners.delete(listener)
        if (!listeners.size) {
          subscriptions.delete(name)
          revisions.delete(name)
          try {
            port?.postMessage({ v: VERSION, kind: "unsubscribe", topic: name })
          } catch {
            /* No live subscription remains. */
          }
          if (!subscriptions.size && reconnectTimer) {
            clearTimeout(reconnectTimer)
            reconnectTimer = undefined
          }
        }
      }
    },
    close() {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      notifyState("closed")
      for (const waiter of [...connectionWaiters]) waiter.reject(new BridgeError("CLOSED", "SDK client disposed"))
      subscriptions.clear()
      detach(new BridgeError("CLOSED", "SDK client disposed"))
      states.clear()
    },
  }
}
export type BridgeClient = ReturnType<typeof createClient>

// No Chrome typings or globals are required to import the SDK in an SSR application.
export function chromeTransport(extensionId?: string): () => Port {
  if (extensionId !== undefined && !/^[a-p]{32}$/.test(extensionId))
    throw new BridgeError("CONFIGURATION", "Enter a valid extension ID")
  return () => {
    const runtime = (
      globalThis as unknown as { chrome?: { runtime?: { connect: (...args: unknown[]) => Port; lastError?: unknown } } }
    ).chrome?.runtime
    if (!runtime?.connect) throw new BridgeError("UNAVAILABLE", "This browser cannot connect to the extension")
    const port = extensionId ? runtime.connect(extensionId, { name: PORT_NAME }) : runtime.connect({ name: PORT_NAME })
    // Chrome reports connection refusal through lastError in onDisconnect.
    port.onDisconnect.addListener(() => {
      try {
        void runtime.lastError
      } catch {
        /* The extension may have reloaded. */
      }
    })
    return port
  }
}
