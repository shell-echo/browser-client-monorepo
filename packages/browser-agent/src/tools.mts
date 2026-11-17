import type { BrowserAgentCapability } from "./capabilities.mts"

export type BrowserAgentToolName =
  | "browser_bridge_info"
  | "browser_workspace_get"
  | "browser_page_read"
  | "browser_page_observe"
  | "browser_page_click"
  | "browser_page_scroll"
  | "browser_page_type"
  | "browser_page_keypress"
  | "browser_page_navigate"

export interface BrowserAgentJsonSchema {
  type: "object"
  properties: Record<string, Record<string, unknown>>
  required?: readonly string[]
  additionalProperties: false
}

export interface BrowserAgentToolDefinition {
  name: BrowserAgentToolName
  description: string
  capability: BrowserAgentCapability
  method:
    | "bridge.info"
    | "workspace.get"
    | "page.read"
    | "page.observe"
    | "page.click"
    | "page.scroll"
    | "page.type"
    | "page.keypress"
    | "page.navigate"
  inputSchema: BrowserAgentJsonSchema
}

export interface BrowserAgentRequestOptions {
  signal?: AbortSignal
}

export type BrowserAgentRequest = (
  method: BrowserAgentToolDefinition["method"],
  params: Record<string, unknown>,
  options?: BrowserAgentRequestOptions,
) => Promise<unknown>

export interface McpBrowserAgentTool {
  name: BrowserAgentToolName
  description: string
  inputSchema: BrowserAgentJsonSchema
}

export interface OpenAiBrowserAgentTool {
  type: "function"
  function: {
    name: BrowserAgentToolName
    description: string
    parameters: BrowserAgentJsonSchema
  }
}

export interface LangChainBrowserAgentTool {
  name: BrowserAgentToolName
  description: string
  schema: BrowserAgentJsonSchema
  invoke(input: unknown, options?: BrowserAgentRequestOptions): Promise<unknown>
}

const emptySchema = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  additionalProperties: false,
} satisfies BrowserAgentJsonSchema)
const observeSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    includeScreenshot: { type: "boolean", description: "Include a compressed viewport image when safe." },
  }),
  additionalProperties: false,
} satisfies BrowserAgentJsonSchema)
const clickSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    x: { type: "number", minimum: 0, maximum: 32768 },
    y: { type: "number", minimum: 0, maximum: 32768 },
    confirm: { type: "boolean", description: "Required for submit, send, purchase, delete and other high-impact controls." },
  }),
  required: ["x", "y"],
  additionalProperties: false,
} satisfies BrowserAgentJsonSchema)
const scrollSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    deltaX: { type: "integer", minimum: -2000, maximum: 2000 },
    deltaY: { type: "integer", minimum: -2000, maximum: 2000 },
  }),
  required: ["deltaX", "deltaY"],
  additionalProperties: false,
} satisfies BrowserAgentJsonSchema)
const typeSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({ text: { type: "string", maxLength: 4096 }, replace: { type: "boolean" } }),
  required: ["text"],
  additionalProperties: false,
} satisfies BrowserAgentJsonSchema)
const keypressSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    key: { type: "string", minLength: 1, maxLength: 32 },
    confirm: { type: "boolean", description: "Required when Enter would submit a high-impact form." },
  }),
  required: ["key"],
  additionalProperties: false,
} satisfies BrowserAgentJsonSchema)
const navigateSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({
    url: { type: "string", format: "uri", maxLength: 2048 },
    confirm: { type: "boolean", description: "Navigation always requires explicit confirmation." },
  }),
  required: ["url", "confirm"],
  additionalProperties: false,
} satisfies BrowserAgentJsonSchema)

export const browserAgentToolDefinitions: readonly BrowserAgentToolDefinition[] = Object.freeze([
  Object.freeze({
    name: "browser_bridge_info",
    description: "Inspect the connected browser bridge version and execution context.",
    capability: "workspace.read",
    method: "bridge.info",
    inputSchema: emptySchema,
  }),
  Object.freeze({
    name: "browser_workspace_get",
    description: "Read the bounded workspace value from the approved browser extension.",
    capability: "workspace.read",
    method: "workspace.get",
    inputSchema: emptySchema,
  }),
  Object.freeze({
    name: "browser_page_read",
    description: "Read the title, URL and current selection from the approved top-level document.",
    capability: "page.read",
    method: "page.read",
    inputSchema: emptySchema,
  }),
  Object.freeze({
    name: "browser_page_observe",
    description:
      "Observe the approved page viewport, scroll position and a compressed screenshot when no sensitive fields are present.",
    capability: "page.observe",
    method: "page.observe",
    inputSchema: observeSchema,
  }),
  Object.freeze({
    name: "browser_page_click",
    description: "Click a viewport coordinate in the approved page. High-impact controls require confirm=true.",
    capability: "page.click",
    method: "page.click",
    inputSchema: clickSchema,
  }),
  Object.freeze({
    name: "browser_page_scroll",
    description: "Scroll the approved page by bounded viewport deltas.",
    capability: "page.scroll",
    method: "page.scroll",
    inputSchema: scrollSchema,
  }),
  Object.freeze({
    name: "browser_page_type",
    description: "Type into the currently focused non-sensitive text field in the approved page.",
    capability: "page.type",
    method: "page.type",
    inputSchema: typeSchema,
  }),
  Object.freeze({
    name: "browser_page_keypress",
    description: "Dispatch a bounded keyboard key to the focused approved page control.",
    capability: "page.keypress",
    method: "page.keypress",
    inputSchema: keypressSchema,
  }),
  Object.freeze({
    name: "browser_page_navigate",
    description: "Navigate the approved tab to an allowed origin; confirm=true is mandatory and web sessions stay same-origin.",
    capability: "page.navigate",
    method: "page.navigate",
    inputSchema: navigateSchema,
  }),
])

export class BrowserAgentToolError extends Error {
  readonly code: "UNKNOWN_TOOL" | "INVALID_INPUT"

  constructor(code: "UNKNOWN_TOOL" | "INVALID_INPUT", message: string) {
    super(message)
    this.name = "BrowserAgentToolError"
    this.code = code
  }
}

function definition(name: string) {
  const value = browserAgentToolDefinitions.find((item) => item.name === name)
  if (!value) throw new BrowserAgentToolError("UNKNOWN_TOOL", `Unknown browser Agent tool: ${name}`)
  return value
}

function objectInput(input: unknown): Record<string, unknown> {
  if (input === undefined) return {}
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new BrowserAgentToolError("INVALID_INPUT", "Browser Agent tool input must be an object")
  return input as Record<string, unknown>
}
function exact(input: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(input).every((key) => allowed.includes(key))
}
function validateInput(item: BrowserAgentToolDefinition, input: unknown): Record<string, unknown> {
  const value = objectInput(input)
  switch (item.name) {
    case "browser_bridge_info":
    case "browser_workspace_get":
    case "browser_page_read":
      if (Object.keys(value).length)
        throw new BrowserAgentToolError("INVALID_INPUT", "This browser Agent tool does not accept parameters")
      break
    case "browser_page_observe":
      if (
        !exact(value, ["includeScreenshot"]) ||
        (value.includeScreenshot !== undefined && typeof value.includeScreenshot !== "boolean")
      )
        throw new BrowserAgentToolError("INVALID_INPUT", "Invalid observation options")
      break
    case "browser_page_click":
      if (
        !exact(value, ["x", "y", "confirm"]) ||
        !Number.isFinite(value.x) ||
        !Number.isFinite(value.y) ||
        Number(value.x) < 0 ||
        Number(value.y) < 0 ||
        (value.confirm !== undefined && typeof value.confirm !== "boolean")
      )
        throw new BrowserAgentToolError("INVALID_INPUT", "Invalid click coordinates")
      break
    case "browser_page_scroll":
      if (
        !exact(value, ["deltaX", "deltaY"]) ||
        !Number.isSafeInteger(value.deltaX) ||
        !Number.isSafeInteger(value.deltaY) ||
        (Number(value.deltaX) === 0 && Number(value.deltaY) === 0) ||
        Math.abs(Number(value.deltaX)) > 2000 ||
        Math.abs(Number(value.deltaY)) > 2000
      )
        throw new BrowserAgentToolError("INVALID_INPUT", "Invalid scroll delta")
      break
    case "browser_page_type":
      if (
        !exact(value, ["text", "replace"]) ||
        typeof value.text !== "string" ||
        value.text.length > 4096 ||
        (value.replace !== undefined && typeof value.replace !== "boolean")
      )
        throw new BrowserAgentToolError("INVALID_INPUT", "Invalid text input")
      break
    case "browser_page_keypress":
      if (
        !exact(value, ["key", "confirm"]) ||
        typeof value.key !== "string" ||
        value.key.length < 1 ||
        value.key.length > 32 ||
        (value.confirm !== undefined && typeof value.confirm !== "boolean")
      )
        throw new BrowserAgentToolError("INVALID_INPUT", "Invalid keypress")
      break
    case "browser_page_navigate":
      if (
        !exact(value, ["url", "confirm"]) ||
        typeof value.url !== "string" ||
        value.url.length > 2048 ||
        value.confirm !== true
      )
        throw new BrowserAgentToolError("INVALID_INPUT", "Navigation requires a URL and confirm=true")
      break
  }
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

export function createMcpBrowserAgentTools(): readonly McpBrowserAgentTool[] {
  return browserAgentToolDefinitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}

export function createOpenAiBrowserAgentTools(): readonly OpenAiBrowserAgentTool[] {
  return browserAgentToolDefinitions.map(({ name, description, inputSchema }) => ({
    type: "function",
    function: { name, description, parameters: inputSchema },
  }))
}

export function createLangChainBrowserAgentTools(request: BrowserAgentRequest): readonly LangChainBrowserAgentTool[] {
  return browserAgentToolDefinitions.map((item) => ({
    name: item.name,
    description: item.description,
    schema: item.inputSchema,
    invoke(input, options) {
      return request(item.method, validateInput(item, input), options)
    },
  }))
}

export async function invokeBrowserAgentTool(
  request: BrowserAgentRequest,
  name: string,
  input: unknown = {},
  options?: BrowserAgentRequestOptions,
) {
  const item = definition(name)
  return request(item.method, validateInput(item, input), options)
}
