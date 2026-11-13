# Browser Agent capability layer

[中文指南](zh-CN/browser-agent.md) · [Extension communication](extension-communication.md)

This repository is both a starter template and a reference implementation for a controlled browser capability layer. Keep those roles separate:

| Layer                 | Package / location              | Responsibility                                                                            |
| --------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| Capability contract   | `@browser-client/browser-agent` | Protocol version, public capability names, supported transport and authorization model    |
| Chrome implementation | `@browser-client/extension-sdk` | Native Port client, MV3 Service Worker broker, isolated page agent and runtime validation |
| Template experience   | `apps/*`, `templates/*`         | Web demo, popup, options, side panel, workspace storage, branding and manifest policy     |

The capability package is intentionally small. It does not import React, Chrome globals, the template's storage keys, or the starter pages. An Agent integration can use it to discover the contract while choosing its own tool adapter. The extension SDK is the implementation supplied by this repository's template.

## Current contract

`@browser-client/browser-agent` currently advertises:

- `workspace.read`: read the extension's bounded workspace value;
- `page.read`: read title, URL and the current selection from the approved top-level document;
- `chrome-port`: the default control transport;
- `document-scoped`: grants are bound to exact origin, tab and document identity.

The catalog is deliberately conservative. The template does not advertise arbitrary script execution, debugger access, cookies, network proxying, screenshots, downloads or durable write jobs. A future capability must be added to the catalog and implemented in the template runtime only after its permission, identity binding, limits, audit and browser coverage are defined.

## Agent integration boundary

An integration should own the Agent-facing adapter and keep the extension runtime as a local execution boundary:

```text
Agent / tool framework
        ↓ adapter chosen by the integrator
@browser-client/extension-sdk client
        ↓ Chrome native Port
Extension Service Worker broker
        ↓ authorized isolated page agent
Selected document
```

The template's `/extension` page is a reference UI for requesting access. A production product can replace it with its own consent and setup experience, but it must preserve the runtime requirements: explicit user approval inside the extension, exact document binding, revocation on navigation or permission removal, bounded messages, and no automatic replay of ambiguous writes.

## Tool adapters

The capability package includes dependency-free schemas for three common Agent integrations:

- `createMcpBrowserAgentTools()` returns MCP-style `name`, `description`, and `inputSchema` entries;
- `createOpenAiBrowserAgentTools()` returns OpenAI-compatible function tool definitions;
- `createLangChainBrowserAgentTools(request)` returns tool objects with a JSON schema and `invoke` method that can be wrapped by a LangChain `StructuredTool` without adding LangChain to the extension runtime.

All three adapters use the same read-only catalog. `invokeBrowserAgentTool` performs the name and empty-input checks before calling the SDK request function. The adapter does not grant access, retry commands, or bypass the extension's consent and quota checks.

## Minimal connection

The Chrome implementation remains the concrete adapter for this repository:

```ts
import { chromeTransport, createClient } from "@browser-client/extension-sdk"

const browser = createClient({
  connect: chromeTransport(extensionId),
  reconnect: true,
})

await browser.request("access.request", {
  capabilities: ["workspace.read", "page.read"],
})
const page = await browser.request("page.read", {})
browser.close()
```

The Web example must be approved in the packaged extension UI before a document can read. A tool adapter should surface `NOT_AUTHORIZED`, `DISCONNECTED`, `CANCELLED`, `TIMEOUT`, and `BUSY` as structured tool errors rather than retrying writes.

## Template contribution rules

- Add a public capability to `packages/browser-agent/src/capabilities.mts` first.
- Keep template-specific UI and storage in `apps/extension` or `templates/extension`.
- Keep Chrome sender checks, grants, quotas, and lifecycle handling in the SDK/runtime implementation.
- Add unit coverage for protocol and authorization boundaries, then add browser coverage for the real MV3 path.
- Update the English and Chinese guides together.

This separation lets the repository attract both template users and browser-runtime contributors: users can start from the screens and build setup, while runtime contributors can work against a small, reviewable capability contract.
