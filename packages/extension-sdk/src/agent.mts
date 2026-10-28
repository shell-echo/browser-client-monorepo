import { boundedJson, decodePage, identifier, record, VERSION } from "./protocol.mts"
import type { PageInfo, Port } from "./protocol.mts"

// An isolated content script receives broker requests only. It never trusts window messages.
export function attachPageAgent(port: Port, read: () => PageInfo) {
  const disconnect = () => {
    try {
      port.disconnect()
    } catch {
      /* Extension context already invalidated. */
    }
  }
  const receive = (value: unknown) => {
    if (!record(value) || !boundedJson(value) || value.v !== VERSION || value.kind !== "agent.read" || !identifier(value.id)) {
      disconnect()
      return
    }
    try {
      port.postMessage({ v: VERSION, kind: "agent.result", id: value.id, value: decodePage(read()) })
    } catch {
      disconnect()
    }
  }
  const dispose = () => {
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
export function createPageAgent(options: { connect(): Port; read(): PageInfo }) {
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
        connection.dispose = attachPageAgent(port, options.read)
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
