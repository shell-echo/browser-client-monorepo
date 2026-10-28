export const VERSION = 1
export const PORT_NAME = "browser-client/v1"
export const MAX_BYTES = 32_768
export const capabilities = ["workspace.read", "page.read"] as const
export type Capability = (typeof capabilities)[number]
export type Topic = "workspace" | "access"
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface Port {
  postMessage(message: unknown): void
  disconnect(): void
  onMessage: {
    addListener(listener: (message: unknown) => void): void
    removeListener(listener: (message: unknown) => void): void
  }
  onDisconnect: { addListener(listener: () => void): void; removeListener(listener: () => void): void }
}
export interface PageInfo {
  title: string
  url: string
  selection: string
}
export interface AccessRequest {
  id: string
  origin: string
  tabId: number
  documentId: string
  capabilities: Capability[]
  expiresAt: number
}
export interface Methods {
  "bridge.info": {
    params: Record<string, never>
    result: { version: number; epoch: string; instance: string; context: string }
  }
  "workspace.get": { params: Record<string, never>; result: { name: string } }
  "workspace.set": { params: { name: string }; result: { name: string } }
  "page.read": { params: { tabId?: number }; result: PageInfo }
  "access.request": { params: { capabilities: Capability[] }; result: { id: string; status: "pending" | "granted" } }
  "access.pending": { params: Record<string, never>; result: { requests: AccessRequest[] } }
  "access.decide": { params: { id: string; allow: boolean }; result: { accepted: boolean } }
  "access.grants": { params: Record<string, never>; result: { grants: AccessRequest[] } }
  "access.revoke": { params: { id: string }; result: { accepted: boolean } }
}
export type Method = keyof Methods
export type Request = { v: 1; kind: "request"; id: string; method: Method; params: Record<string, unknown>; deadline: number }
export type Incoming =
  Request | { v: 1; kind: "subscribe" | "unsubscribe"; topic: Topic } | { v: 1; kind: "cancel"; id: string }
export type Outgoing =
  | { v: 1; kind: "result"; id: string; value: Json }
  | { v: 1; kind: "error"; id: string; code: string; message: string }
  | { v: 1; kind: "event"; topic: Topic; epoch: string; revision: number; value: Json }
  | { v: 1; kind: "agent.read"; id: string }
  | { v: 1; kind: "agent.result"; id: string; value: PageInfo }

export class BridgeError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "BridgeError"
    this.code = code
  }
}
export function fail(code: string, message: string): never {
  throw new BridgeError(code, message)
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
export function boundedJson(value: unknown): boolean {
  try {
    let nodes = 0
    const visit = (item: unknown, depth: number): boolean => {
      if (++nodes > 4096 || depth > 12) return false
      if (typeof item === "string") return item.length <= MAX_BYTES
      if (item === null || typeof item === "boolean") return true
      if (typeof item === "number") return Number.isFinite(item)
      if (Array.isArray(item)) return item.every((child) => visit(child, depth + 1))
      return (
        record(item) &&
        Object.getPrototypeOf(item) === Object.prototype &&
        Object.entries(item).every(
          ([key, child]) => !["__proto__", "constructor", "prototype"].includes(key) && visit(child, depth + 1),
        )
      )
    }
    return visit(value, 0) && new TextEncoder().encode(JSON.stringify(value)).length <= MAX_BYTES
  } catch {
    return false
  }
}
export function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
}
export function topic(value: unknown): value is Topic {
  return value === "workspace" || value === "access"
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key))
}
export function decodeIncoming(value: unknown): Incoming {
  if (!boundedJson(value) || !record(value) || value.v !== VERSION) fail("PROTOCOL", "Unsupported or invalid bridge message")
  if (
    (value.kind === "subscribe" || value.kind === "unsubscribe") &&
    topic(value.topic) &&
    exact(value, ["v", "kind", "topic"])
  )
    return value as Incoming
  if (value.kind === "cancel" && identifier(value.id) && exact(value, ["v", "kind", "id"])) return value as Incoming
  if (
    value.kind !== "request" ||
    !identifier(value.id) ||
    !record(value.params) ||
    !Number.isSafeInteger(value.deadline) ||
    !exact(value, ["v", "kind", "id", "method", "params", "deadline"])
  )
    fail("PROTOCOL", "Invalid bridge request")
  const p = value.params
  const empty = () => Object.keys(p).length === 0
  let valid = false
  switch (value.method) {
    case "bridge.info":
    case "workspace.get":
    case "access.pending":
    case "access.grants":
      valid = empty()
      break
    case "workspace.set":
      valid = exact(p, ["name"]) && typeof p.name === "string" && p.name.trim().length > 0 && p.name.length <= 80
      break
    case "page.read":
      valid = exact(p, ["tabId"]) && (p.tabId === undefined || (Number.isSafeInteger(p.tabId) && Number(p.tabId) >= 0))
      break
    case "access.request":
      valid =
        exact(p, ["capabilities"]) &&
        Array.isArray(p.capabilities) &&
        p.capabilities.length > 0 &&
        p.capabilities.length <= capabilities.length &&
        new Set(p.capabilities).size === p.capabilities.length &&
        p.capabilities.every((c) => capabilities.includes(c as Capability))
      break
    case "access.decide":
      valid = exact(p, ["id", "allow"]) && identifier(p.id) && typeof p.allow === "boolean"
      break
    case "access.revoke":
      valid = exact(p, ["id"]) && identifier(p.id)
      break
  }
  if (!valid) fail("PROTOCOL", "Unknown method or invalid parameters")
  return value as Request
}
export function decodePage(value: unknown): PageInfo {
  if (
    !record(value) ||
    !boundedJson(value) ||
    !exact(value, ["title", "url", "selection"]) ||
    typeof value.title !== "string" ||
    value.title.length > 512 ||
    typeof value.url !== "string" ||
    value.url.length > 2048 ||
    typeof value.selection !== "string" ||
    value.selection.length > 4096
  )
    fail("PROTOCOL", "Invalid page response")
  return value as unknown as PageInfo
}

function validCapabilities(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= capabilities.length &&
    new Set(value).size === value.length &&
    value.every((c) => capabilities.includes(c as Capability))
  )
}
function accessRecord(value: unknown) {
  if (
    !record(value) ||
    !exact(value, ["id", "origin", "tabId", "documentId", "capabilities", "expiresAt"]) ||
    !identifier(value.id) ||
    typeof value.origin !== "string" ||
    typeof value.documentId !== "string" ||
    value.documentId.length > 128 ||
    !Number.isSafeInteger(value.tabId) ||
    Number(value.tabId) < 0 ||
    !Number.isSafeInteger(value.expiresAt) ||
    !validCapabilities(value.capabilities)
  )
    return false
  try {
    const url = new URL(value.origin)
    return ["http:", "https:"].includes(url.protocol) && url.origin === value.origin
  } catch {
    return false
  }
}
export function decodeResult(method: Method, value: unknown): unknown {
  if (!record(value) || !boundedJson(value)) fail("PROTOCOL", "Invalid method result")
  let valid = false
  switch (method) {
    case "bridge.info":
      valid =
        exact(value, ["version", "epoch", "instance", "context"]) &&
        value.version === VERSION &&
        identifier(value.epoch) &&
        typeof value.instance === "string" &&
        value.instance.length <= 128 &&
        ["ui", "web"].includes(String(value.context))
      break
    case "workspace.get":
    case "workspace.set":
      valid = exact(value, ["name"]) && typeof value.name === "string" && value.name.length > 0 && value.name.length <= 80
      break
    case "page.read":
      return decodePage(value)
    case "access.request":
      valid = exact(value, ["id", "status"]) && identifier(value.id) && ["pending", "granted"].includes(String(value.status))
      break
    case "access.pending":
      valid =
        exact(value, ["requests"]) &&
        Array.isArray(value.requests) &&
        value.requests.length <= 20 &&
        value.requests.every(accessRecord)
      break
    case "access.grants":
      valid =
        exact(value, ["grants"]) && Array.isArray(value.grants) && value.grants.length <= 64 && value.grants.every(accessRecord)
      break
    case "access.decide":
    case "access.revoke":
      valid = exact(value, ["accepted"]) && typeof value.accepted === "boolean"
      break
  }
  if (!valid) fail("PROTOCOL", "Method result does not match its contract")
  return value
}
export function decodeSnapshot(name: Topic, value: unknown): Json {
  if (name === "workspace") return decodeResult("workspace.get", value) as Json
  if (!record(value) || !boundedJson(value)) fail("PROTOCOL", "Invalid access snapshot")
  if (exact(value, ["capabilities"]) && validCapabilities(value.capabilities)) return value as Json
  if (
    exact(value, ["pending", "grants"]) &&
    Number.isSafeInteger(value.pending) &&
    Number(value.pending) >= 0 &&
    Number(value.pending) <= 20 &&
    Number.isSafeInteger(value.grants) &&
    Number(value.grants) >= 0 &&
    Number(value.grants) <= 64
  )
    return value as Json
  fail("PROTOCOL", "Invalid access snapshot")
}
