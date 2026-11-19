import { browserAgentCapabilities } from "@browser-client/browser-agent"
import type { BrowserAgentCapability } from "@browser-client/browser-agent"

export const VERSION = 1
export const PORT_NAME = "browser-client/v1"
// The bridge carries small JSON envelopes and an optional, compressed viewport
// image.  Keep the cap finite so an Agent cannot turn a Port into an unbounded
// memory queue.
export const MAX_BYTES = 131_072
export const MAX_SCREENSHOT_CHARS = 100_000
export const capabilities = browserAgentCapabilities
export type Capability = BrowserAgentCapability
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
export interface PageViewport {
  width: number
  height: number
  scrollX: number
  scrollY: number
  devicePixelRatio: number
}
export interface PageScreenshot {
  dataUrl: string
  // Encoded image dimensions; the Chrome adapter may downscale a native frame.
  width: number
  height: number
  // Encoded image width divided by the CSS viewport width, not necessarily DPR.
  pixelRatio: number
  mimeType: "image/jpeg" | "image/png"
}
export interface PageObservation {
  page: PageInfo
  viewport: PageViewport
  sensitiveFields: boolean
  screenshot?: PageScreenshot
  screenshotSuppressedReason?: "sensitive-fields" | "unavailable" | "too-large"
}
export type PageAction =
  | { action: "click"; x: number; y: number; confirm?: boolean }
  | { action: "scroll"; deltaX: number; deltaY: number }
  | { action: "type"; text: string; replace?: boolean }
  | { action: "keypress"; key: string; confirm?: boolean }
export interface PageActionResult {
  accepted: true
  action: PageAction["action"] | "navigate"
  url?: string
  scrollX?: number
  scrollY?: number
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
  "page.observe": { params: { tabId?: number; includeScreenshot?: boolean }; result: PageObservation }
  "page.click": { params: { x: number; y: number; confirm?: boolean }; result: PageActionResult }
  "page.scroll": { params: { deltaX: number; deltaY: number }; result: PageActionResult }
  "page.type": { params: { text: string; replace?: boolean }; result: PageActionResult }
  "page.keypress": { params: { key: string; confirm?: boolean }; result: PageActionResult }
  "page.navigate": { params: { url: string; confirm?: boolean }; result: PageActionResult }
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
  | { v: 1; kind: "agent.read" | "agent.observe"; id: string }
  | { v: 1; kind: "agent.action"; id: string; action: PageAction }
  | { v: 1; kind: "agent.cancel"; id: string }
  | { v: 1; kind: "agent.result"; id: string; value: PageInfo | PageObservation | PageActionResult }
  | { v: 1; kind: "agent.error"; id: string; code: string; message: string }

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
    case "page.observe":
      valid =
        exact(p, ["tabId", "includeScreenshot"]) &&
        (p.tabId === undefined || (Number.isSafeInteger(p.tabId) && Number(p.tabId) >= 0)) &&
        (p.includeScreenshot === undefined || typeof p.includeScreenshot === "boolean")
      break
    case "page.click":
      valid =
        exact(p, ["x", "y", "confirm"]) &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Number(p.x) >= 0 &&
        Number(p.x) <= 32_768 &&
        Number(p.y) >= 0 &&
        Number(p.y) <= 32_768 &&
        (p.confirm === undefined || typeof p.confirm === "boolean")
      break
    case "page.scroll":
      valid =
        exact(p, ["deltaX", "deltaY"]) &&
        Number.isSafeInteger(p.deltaX) &&
        Number.isSafeInteger(p.deltaY) &&
        Math.abs(Number(p.deltaX)) <= 2_000 &&
        Math.abs(Number(p.deltaY)) <= 2_000 &&
        (Number(p.deltaX) !== 0 || Number(p.deltaY) !== 0)
      break
    case "page.type":
      valid =
        exact(p, ["text", "replace"]) &&
        typeof p.text === "string" &&
        p.text.length <= 4_096 &&
        (p.replace === undefined || typeof p.replace === "boolean")
      break
    case "page.keypress":
      valid =
        exact(p, ["key", "confirm"]) &&
        typeof p.key === "string" &&
        p.key.length >= 1 &&
        p.key.length <= 32 &&
        /^[\p{L}\p{N}\p{P}\p{S} ]+$/u.test(p.key) &&
        (p.confirm === undefined || typeof p.confirm === "boolean")
      break
    case "page.navigate":
      valid =
        exact(p, ["url", "confirm"]) &&
        typeof p.url === "string" &&
        p.url.length <= 2_048 &&
        (p.confirm === undefined || typeof p.confirm === "boolean") &&
        (() => {
          try {
            const url = new URL(p.url)
            return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
          } catch {
            return false
          }
        })()
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

function decodeViewport(value: unknown): PageViewport {
  if (
    !record(value) ||
    !exact(value, ["width", "height", "scrollX", "scrollY", "devicePixelRatio"]) ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    Number(value.width) < 1 ||
    Number(value.width) > 8_192 ||
    Number(value.height) < 1 ||
    Number(value.height) > 8_192 ||
    !Number.isFinite(value.scrollX) ||
    !Number.isFinite(value.scrollY) ||
    !Number.isFinite(value.devicePixelRatio) ||
    Number(value.devicePixelRatio) <= 0 ||
    Number(value.devicePixelRatio) > 8
  )
    fail("PROTOCOL", "Invalid viewport response")
  return value as unknown as PageViewport
}
function decodeScreenshot(value: unknown): PageScreenshot {
  if (
    !record(value) ||
    !exact(value, ["dataUrl", "width", "height", "pixelRatio", "mimeType"]) ||
    typeof value.dataUrl !== "string" ||
    value.dataUrl.length > MAX_SCREENSHOT_CHARS ||
    !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value.dataUrl) ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    Number(value.width) < 1 ||
    Number(value.width) > 8_192 ||
    Number(value.height) < 1 ||
    Number(value.height) > 8_192 ||
    !Number.isFinite(value.pixelRatio) ||
    Number(value.pixelRatio) <= 0 ||
    Number(value.pixelRatio) > 8 ||
    !["image/jpeg", "image/png"].includes(String(value.mimeType))
  )
    fail("PROTOCOL", "Invalid screenshot response")
  return value as unknown as PageScreenshot
}
export function decodeObservation(value: unknown): PageObservation {
  if (
    !record(value) ||
    !boundedJson(value) ||
    !exact(value, ["page", "viewport", "sensitiveFields", "screenshot", "screenshotSuppressedReason"])
  )
    fail("PROTOCOL", "Invalid page observation")
  const page = decodePage(value.page)
  const viewport = decodeViewport(value.viewport)
  if (typeof value.sensitiveFields !== "boolean") fail("PROTOCOL", "Invalid sensitive field marker")
  if (value.screenshot !== undefined) decodeScreenshot(value.screenshot)
  if (
    value.screenshotSuppressedReason !== undefined &&
    !["sensitive-fields", "unavailable", "too-large"].includes(String(value.screenshotSuppressedReason))
  )
    fail("PROTOCOL", "Invalid screenshot suppression reason")
  return { ...value, page, viewport } as PageObservation
}
export function decodeAction(value: unknown): PageAction {
  if (!record(value) || !boundedJson(value) || typeof value.action !== "string") fail("PROTOCOL", "Invalid page action")
  switch (value.action) {
    case "click":
      if (
        !exact(value, ["action", "x", "y", "confirm"]) ||
        !Number.isFinite(value.x) ||
        !Number.isFinite(value.y) ||
        Number(value.x) < 0 ||
        Number(value.x) > 32_768 ||
        Number(value.y) < 0 ||
        Number(value.y) > 32_768 ||
        (value.confirm !== undefined && typeof value.confirm !== "boolean")
      )
        fail("PROTOCOL", "Invalid click action")
      return value as PageAction
    case "scroll":
      if (
        !exact(value, ["action", "deltaX", "deltaY"]) ||
        !Number.isSafeInteger(value.deltaX) ||
        !Number.isSafeInteger(value.deltaY) ||
        Math.abs(Number(value.deltaX)) > 2_000 ||
        Math.abs(Number(value.deltaY)) > 2_000 ||
        (Number(value.deltaX) === 0 && Number(value.deltaY) === 0)
      )
        fail("PROTOCOL", "Invalid scroll action")
      return value as PageAction
    case "type":
      if (
        !exact(value, ["action", "text", "replace"]) ||
        typeof value.text !== "string" ||
        value.text.length > 4_096 ||
        (value.replace !== undefined && typeof value.replace !== "boolean")
      )
        fail("PROTOCOL", "Invalid type action")
      return value as PageAction
    case "keypress":
      if (
        !exact(value, ["action", "key", "confirm"]) ||
        typeof value.key !== "string" ||
        value.key.length < 1 ||
        value.key.length > 32 ||
        !/^[\p{L}\p{N}\p{P}\p{S} ]+$/u.test(value.key) ||
        (value.confirm !== undefined && typeof value.confirm !== "boolean")
      )
        fail("PROTOCOL", "Invalid keypress action")
      return value as PageAction
    default:
      fail("PROTOCOL", "Unsupported page action")
  }
}
export function decodeActionResult(value: unknown): PageActionResult {
  if (
    !record(value) ||
    !boundedJson(value) ||
    !exact(value, ["accepted", "action", "url", "scrollX", "scrollY"]) ||
    value.accepted !== true ||
    !["click", "scroll", "type", "keypress", "navigate"].includes(String(value.action)) ||
    (value.url !== undefined && (typeof value.url !== "string" || value.url.length > 2_048)) ||
    (value.scrollX !== undefined && !Number.isFinite(value.scrollX)) ||
    (value.scrollY !== undefined && !Number.isFinite(value.scrollY))
  )
    fail("PROTOCOL", "Invalid action result")
  return value as unknown as PageActionResult
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
    case "page.observe":
      return decodeObservation(value)
    case "page.click":
    case "page.scroll":
    case "page.type":
    case "page.keypress":
    case "page.navigate":
      return decodeActionResult(value)
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
