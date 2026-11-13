import type { BrowserAgentCapability } from "./capabilities.mts"

export type BrowserAgentToolName = "browser_bridge_info" | "browser_workspace_get" | "browser_page_read"

export interface BrowserAgentJsonSchema {
  type: "object"
  properties: Record<string, never>
  additionalProperties: false
}

export interface BrowserAgentToolDefinition {
  name: BrowserAgentToolName
  description: string
  capability: BrowserAgentCapability
  method: "bridge.info" | "workspace.get" | "page.read"
  inputSchema: BrowserAgentJsonSchema
}

export interface BrowserAgentRequestOptions {
  signal?: AbortSignal
}

export type BrowserAgentRequest = (
  method: BrowserAgentToolDefinition["method"],
  params: Record<string, never>,
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

function validateInput(input: unknown) {
  if (
    input === undefined ||
    (input !== null &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.keys(input as Record<string, unknown>).length === 0)
  )
    return
  throw new BrowserAgentToolError("INVALID_INPUT", "This browser Agent tool does not accept parameters")
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
  return browserAgentToolDefinitions.map(({ name, description, inputSchema }) => ({
    name,
    description,
    schema: inputSchema,
    invoke(input, options) {
      validateInput(input)
      return request(definition(name).method, {}, options)
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
  validateInput(input)
  return request(item.method, {}, options)
}
