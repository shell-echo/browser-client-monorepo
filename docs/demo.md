# Browser Agent demo

[中文指南](zh-CN/demo.md) · [Browser Agent capability](browser-agent.md) · [Extension communication](extension-communication.md)

[Download the privacy-safe real-Chrome visual-control video](browser-agent-demo.mp4) · 12 seconds · 1280×720 · MP4

The `/extension` route is a live demo of the real Chrome implementation. It does not simulate Agent responses: the page uses `@browser-client/extension-sdk`, requests access through the extension Service Worker, and invokes the shared Agent contract. The public contract also includes `browser_page_observe`, `browser_page_click`, `browser_page_scroll`, `browser_page_type`, `browser_page_keypress`, and `browser_page_navigate` for an integration that supplies its own multimodal Agent loop.

## Run the demo locally

```sh
pnpm install --frozen-lockfile
pnpm dev
```

1. Open `http://127.0.0.1:3000/extension` in Chrome.
2. Enable Developer mode at `chrome://extensions` and load `apps/extension/dist-dev`.
3. Copy the extension ID from the extension Connections screen into the demo.
4. Approve the pending request for the exact demo origin.
5. Click **Run browser_page_read** and select text on the demo page before running it. For the visual control loop, use the SDK tools from `docs/browser-agent.md`: observe a fresh viewport, execute one bounded action, then observe again.
6. Revoke access or navigate away to see the document-scoped grant end.

The panel also shows the same shared tool definitions exposed to MCP, OpenAI function calling, and LangChain. The adapters share the capability catalog and do not add those frameworks to the extension runtime.

## What the video shows

This clip was captured from a real, isolated Chrome session rendering the local demo page. It is a viewport recording rather than a desktop recording, so it contains no other tabs, bookmarks, accounts, extension IDs, real sites, or personal page data. The page is fictional and the browser profile is disposable.

The actions are real browser DOM events: a fresh viewport observation, a pointer move and bounded click, focused text input, smooth bounded scrolling in small wheel increments, and a second observation that verifies the result. The side panel makes the transport boundary visible: SDK → Service Worker → Chrome Native Port → isolated page agent. The badges call out origin-scoped access, the native Port, and the absence of raw `eval`. This is a deterministic capability showcase; a production integration supplies its own multimodal Agent loop through the public SDK contract.

Follow the local steps above for a live run with the real extension approval and `browser_page_read` response, then use the visual tools from `docs/browser-agent.md` to implement the same observe → bounded action → observe-again loop.

## Recording a live integration

Use one continuous screen recording with this sequence:

1. Show the `/extension` page and the three-step **Ask → Approve → Act** explanation.
2. Submit the extension ID and approve the pending request for the exact origin in **Connections**.
3. Ask the Agent for a fresh `browser_page_observe` frame and show the returned viewport metadata.
4. Execute one bounded `browser_page_click`, `browser_page_scroll`, or `browser_page_type` action from the Agent decision.
5. Observe again and show the verified result; keep the action log visible so the route is auditable.
6. Revoke the grant or navigate away, then show the next request fail with `NOT_AUTHORIZED`.

Keep the extension ID and any personal page content out of published recordings. A hosted demo can use the same route after the extension is published or distributed as a signed unpacked build; the browser permission prompt remains a user action.
