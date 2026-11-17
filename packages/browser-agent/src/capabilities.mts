/**
 * Public capability names shared by Agent adapters and template runtimes.
 *
 * Keep this list deliberately small. A template may implement more local
 * features, but it must not advertise a capability until the runtime has
 * authorization, identity binding, limits, and tests for it.
 */
export const browserAgentCapabilities = Object.freeze([
  "workspace.read",
  "page.read",
  "page.observe",
  "page.click",
  "page.scroll",
  "page.type",
  "page.keypress",
  "page.navigate",
] as const)

export type BrowserAgentCapability = (typeof browserAgentCapabilities)[number]

export type BrowserAgentTransport = "chrome-port"

export interface BrowserAgentDescriptor {
  apiVersion: 1
  capabilities: readonly BrowserAgentCapability[]
  transports: readonly BrowserAgentTransport[]
  authorization: "document-scoped"
}

export const browserAgentDescriptor: BrowserAgentDescriptor = Object.freeze({
  apiVersion: 1,
  capabilities: browserAgentCapabilities,
  transports: Object.freeze(["chrome-port"] as const),
  authorization: "document-scoped",
})
