import {
  boundedJson,
  BridgeError,
  decodeAction,
  decodeActionResult,
  decodeObservation,
  decodePage,
  identifier,
  record,
  VERSION,
} from "./protocol.mts"
import type { PageAction, PageActionResult, PageInfo, PageObservation, Port } from "./protocol.mts"

export interface PageAgentHandlers {
  read(): PageInfo
  observe?(signal?: AbortSignal): PageObservation | Promise<PageObservation>
  action?(action: PageAction, signal?: AbortSignal): PageActionResult | Promise<PageActionResult>
}

function asHandlers(value: PageAgentHandlers | (() => PageInfo)): PageAgentHandlers {
  return typeof value === "function" ? { read: value } : value
}

// An isolated content script receives broker requests only. It never trusts window messages.
export function attachPageAgent(port: Port, value: PageAgentHandlers | (() => PageInfo)) {
  const handlers = asHandlers(value)
  const pending = new Map<string, AbortController>()
  const disconnect = () => {
    try {
      port.disconnect()
    } catch {
      /* Extension context already invalidated. */
    }
  }
  const sendError = (id: string, reason: unknown) => {
    try {
      const error = reason instanceof BridgeError ? reason : new BridgeError("ACTION_FAILED", "Page action failed")
      port.postMessage({
        v: VERSION,
        kind: "agent.error",
        id,
        code: error.code,
        message: error.message.slice(0, 256),
      })
    } catch {
      disconnect()
    }
  }
  const receive = (value: unknown) => {
    if (!record(value) || !boundedJson(value) || value.v !== VERSION || !identifier(value.id)) {
      disconnect()
      return
    }
    const id = value.id as string
    if (value.kind === "agent.cancel") {
      if (!Object.keys(value).every((key) => ["v", "kind", "id"].includes(key))) {
        disconnect()
        return
      }
      pending.get(id)?.abort()
      return
    }
    if (value.kind === "agent.read") {
      if (!Object.keys(value).every((key) => ["v", "kind", "id"].includes(key))) {
        disconnect()
        return
      }
      try {
        port.postMessage({ v: VERSION, kind: "agent.result", id: value.id, value: decodePage(handlers.read()) })
      } catch {
        disconnect()
      }
      return
    }
    if (value.kind === "agent.observe") {
      if (!Object.keys(value).every((key) => ["v", "kind", "id"].includes(key)) || !handlers.observe) {
        if (!handlers.observe) sendError(id, new BridgeError("UNSUPPORTED", "Page observation is unavailable"))
        else disconnect()
        return
      }
      const controller = new AbortController()
      pending.set(id, controller)
      void Promise.resolve()
        .then(() => {
          if (controller.signal.aborted) throw new BridgeError("CANCELLED", "Request cancelled")
          return handlers.observe!(controller.signal)
        })
        .then((observation) => {
          if (controller.signal.aborted) return
          port.postMessage({ v: VERSION, kind: "agent.result", id, value: decodeObservation(observation) })
        })
        .catch((reason) => {
          if (!controller.signal.aborted) sendError(id, reason)
        })
        .finally(() => pending.delete(id))
      return
    }
    if (value.kind === "agent.action") {
      if (!Object.keys(value).every((key) => ["v", "kind", "id", "action"].includes(key)) || !handlers.action) {
        if (!handlers.action) sendError(id, new BridgeError("UNSUPPORTED", "Page actions are unavailable"))
        else disconnect()
        return
      }
      let action: PageAction
      try {
        action = decodeAction(value.action)
      } catch {
        disconnect()
        return
      }
      const controller = new AbortController()
      pending.set(id, controller)
      void Promise.resolve()
        .then(() => {
          if (controller.signal.aborted) throw new BridgeError("CANCELLED", "Request cancelled")
          return handlers.action!(action, controller.signal)
        })
        .then((result) => {
          if (controller.signal.aborted) return
          port.postMessage({ v: VERSION, kind: "agent.result", id, value: decodeActionResult(result) })
        })
        .catch((reason) => {
          if (!controller.signal.aborted) sendError(id, reason)
        })
        .finally(() => pending.delete(id))
      return
    }
    disconnect()
  }
  const dispose = () => {
    for (const controller of pending.values()) controller.abort()
    pending.clear()
    try {
      port.onMessage.removeListener(receive)
    } catch {
      /* Context invalidated. */
    }
    try {
      port.onDisconnect.removeListener(dispose)
    } catch {
      /* Context invalidated. */
    }
  }
  port.onMessage.addListener(receive)
  port.onDisconnect.addListener(dispose)
  return () => {
    dispose()
    disconnect()
  }
}

// Own one live Port, with explicit suspension for pagehide/BFCache. The controller
// survives a cached document; it does not poll or keep the worker alive.
export function createPageAgent(options: { connect(): Port } & PageAgentHandlers) {
  let closed = false
  let current: { port: Port; dispose(): void; disconnected(): void } | undefined
  function suspend() {
    const previous = current
    current = undefined
    if (!previous) return
    try {
      previous.port.onDisconnect.removeListener(previous.disconnected)
    } catch {
      /* Context invalidated. */
    }
    try {
      previous.dispose()
    } catch {
      /* Invalidated extension context is already unusable. */
    }
  }
  return {
    connect() {
      if (closed) return false
      if (current) return true
      try {
        const port = options.connect()
        const connection = {
          port,
          dispose: () => port.disconnect(),
          disconnected() {
            // A delayed event from the suspended Port cannot clear a newer one.
            if (current !== connection) return
            current = undefined
            try {
              port.onDisconnect.removeListener(connection.disconnected)
            } catch {
              /* Context invalidated. */
            }
          },
        }
        current = connection
        port.onDisconnect.addListener(connection.disconnected)
        connection.dispose = attachPageAgent(port, options)
        return true
      } catch {
        suspend()
        return false
      }
    },
    suspend,
    close() {
      closed = true
      suspend()
    },
  }
}
