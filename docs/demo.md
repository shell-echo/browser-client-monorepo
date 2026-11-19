# Browser Agent demo

[简体中文](zh-CN/demo.md) · [Browser Agent capability](browser-agent.md) · [Extension communication](extension-communication.md)

[Watch the real extension demo](browser-agent-demo.mp4) · 81.0 seconds · 1440×900 · MP4

The video shows the current Codex Agent reading actual screenshots from a production MV3 extension in an isolated, headless Chrome instance. It chooses the Ready release candidate with zero failures, enters a release note, saves a local draft, scrolls to Activity, and reads a new screenshot to verify the result. Every target-page action goes through the public SDK. The extension's real installation, exact-document approval, and revocation UI are also shown.

The business page and the read-only Agent console are separate pages. The console displays the selected tool, observable decision, actual returned image, and tool receipt. The opening explains how the reusable template, independent capability contract, and Chrome SDK fit together, followed by a minimal integration example. Revoking the real document grant clears the console image through the access event; the next observation returns `NOT_AUTHORIZED`.

The website contains fictional data and saves only a local draft. Recording uses a disposable profile and browser viewports, so it contains no personal desktop, existing tabs, bookmarks, accounts, or browsing history. The edit places the simultaneous target and console recordings side by side, shortens setup holds, removes the Agent's decision waiting time, and keeps recorded action speed. The published Chrome installation scene keeps the real extension card's English product name and description from the isolated capture, while the localized Chrome shell and controls are cropped out and replaced with English labels for a consistent product presentation. This is a post-production crop and layout; it does not claim that the test machine's Chrome locale was changed. The first and final SDK screenshots briefly appear in a separate right-side viewport panel at a larger size; the panel is an editorial enlargement of the actual returned image and does not cover the target page or tool result. It crops the console's nonessential footer and recorder padding; the separate bottom-right **RECORDING NOTE** area is an editorial caption outside the footage, not a tool response. Approval clips retain real extension UI. No browser frames or tool outcomes are fabricated.

This take is driven by Codex inspecting each returned image and writing the next decision to a private recording coordinator. It does not simulate an OpenAI API response or run a hosted MCP service. Integrations provide their own model and use the same screenshot → action → screenshot contract. The film demonstrates this core loop and revocation; it does not cover every supported tool or replace browser and security acceptance.

## Connect your agent

```ts
import { createClient, chromeTransport, type PageObservation } from "@browser-client/extension-sdk"
import { invokeBrowserAgentTool, type BrowserAgentRequest } from "@browser-client/browser-agent/tools"

const client = createClient({ connect: chromeTransport(extensionId) })
await client.connect()
await client.request("access.request", {
  capabilities: ["page.observe", "page.click", "page.type", "page.scroll"],
})
// The user approves this exact document in the extension Connections UI.
const request: BrowserAgentRequest = (method, params, options) => client.request(method, params, options)
const frame = (await invokeBrowserAgentTool(request, "browser_page_observe", {
  includeScreenshot: true,
})) as PageObservation
// Give frame.screenshot to your model, then invoke its selected bounded action.
// Observe again to check the visible result. Close the client when finished.
```

The shared tool definitions also expose MCP, OpenAI function-calling, and LangChain adapters. Those frameworks are not bundled into the extension. See the [integration contract](browser-agent.md) for the typed interfaces, screenshot suppression, confirmation requirements, and coordinate mapping.

## Try the interactive page

```sh
pnpm install --frozen-lockfile
pnpm dev
```

1. Open `http://127.0.0.1:3000/extension` in Chrome.
2. Enable Developer mode at `chrome://extensions` and load `apps/extension/dist-dev`.
3. Copy the extension ID from Connections into the page and request access.
4. Approve the exact page in Connections. Activate the extension's toolbar action on the target tab when Chrome requires `activeTab` permission for screenshot capture.
5. Use **Observe real viewport**, choose a coordinate on the returned image, and invoke click, type, or scroll. Observe again to check the result.
6. Revoke access or navigate away to end the document-scoped grant.

A suppressed screenshot is reported as suppressed. An accepted action still needs an observation to verify its visible outcome. Actions are bounded page operations; they do not provide arbitrary JavaScript execution, operating-system input, or unrestricted browser control.

## Reproduce the recording

`scripts/record-browser-agent-demo.mts` serves the small fictional fixture and the real SDK sources, then launches a disposable headless browser with a production extension. It does not start Next.js, Vite development services, or an existing browser profile.

The recording pages read the website's dark theme directly from `packages/ui/src/styles/globals.css` and load its bundled Inter font. Their cards, buttons, inputs, and console use those shared neutral tokens rather than a separate demo color palette.

For the default registered Extension instance, build once into a new private recording directory:

```sh
record_dir="$PWD/.reinit/verification/agent-demo-$(date +%s)"
mkdir -p "$record_dir"
pnpm exec playwright install chromium --no-shell
pnpm --filter @browser-client/extension exec vite build --outDir "$record_dir/extension"
node scripts/record-browser-agent-demo.mts "$record_dir"
```

Use the selected instance's package name when the registry differs. The recorder uses Playwright's installed Chromium by default. `BROWSER_CLIENT_DEMO_BROWSER` can select a current Chrome executable that supports the test-only `Extensions.loadUnpacked` and `Extensions.triggerAction` DevTools commands. These commands only prepare the isolated test browser; they are not capabilities exposed to agents.

The recorder saves `frame-001.jpg`, its geometry JSON, and `ready.json`. An Agent inspects that actual image, then atomically writes `decisions/001.json`, `002.json`, and so on, one at a time:

```json
{
  "sourceFrame": "frame-001",
  "tool": "browser_page_click",
  "input": { "x": 360, "y": 720 },
  "decision": "The release-summary field is visible; focus it before typing."
}
```

The coordinates above illustrate the format; choose coordinates from the actual image and convert them with the recorded viewport and encoded-image dimensions. Wait for the corresponding `receipt-N.json` before continuing. After every click, type, or scroll, the next decision must be `browser_page_observe` with `includeScreenshot: true`. Read its new `frame-NNN.jpg` before choosing another action. Finish with `sourceFrame`, a short observable `decision`, and `finish: true` only after a fresh screenshot confirms the saved Activity entry. Stale frames, geometry mismatches, unsupported tools, and completion without a final observation are rejected.

The recorder writes the actual `trace.json`, observation JPEGs, raw viewport videos, edit segments, and assertions in `report.json`. Its file coordinator is a recording utility, not a production Agent server. Only the public SDK performs target-page clicks, typing, and scrolling; Playwright prepares the browser, approves/revokes access through the extension UI, records frames, and reads independent outcome assertions. Before Agent decisions, it measures real capture geometry and adjusts only the private native window when headless Chrome's content dimensions differ. The original calibration images are retained. All pages use the same CSS viewport; the 900/540px side-by-side layout is a video edit. A scroll decision is divided into at most 35 bounded SDK calls for recording, with every call retained in the trace and one console update at completion.

Keep recording, encoding, and other heavy tasks serial, use low priority, and respect available machine resources. A video is demonstration evidence for this path, not a substitute for the full browser and security acceptance suite.
