# Browser Agent demo

[中文指南](zh-CN/demo.md) · [Browser Agent capability](browser-agent.md) · [Extension communication](extension-communication.md)

The `/extension` route is a live demo of the real Chrome implementation. It does not simulate Agent responses: the page uses `@browser-client/extension-sdk`, requests access through the extension Service Worker, and invokes `browser_page_read` through the shared Agent contract.

## Run the demo locally

```sh
pnpm install --frozen-lockfile
pnpm dev
```

1. Open `http://127.0.0.1:3000/extension` in Chrome.
2. Enable Developer mode at `chrome://extensions` and load `apps/extension/dist-dev`.
3. Copy the extension ID from the extension Connections screen into the demo.
4. Approve the pending request for the exact demo origin.
5. Click **Run browser_page_read** and select text on the demo page before running it.
6. Revoke access or navigate away to see the document-scoped grant end.

The panel also shows the same three read-only tool definitions exposed to MCP, OpenAI function calling, and LangChain. The adapters share the capability catalog and do not add those frameworks to the extension runtime.

## Recording a short demo

Use one continuous screen recording with this sequence:

1. Show the `/extension` page and the three-step **Ask → Approve → Act** explanation.
2. Submit the extension ID and show the pending request in **Connections**.
3. Approve `workspace.read` and `page.read`.
4. Select a sentence on the page and run `browser_page_read`.
5. Show the title, URL, and selected text returned by the real SDK.
6. Revoke the grant, then show the next request fail with `NOT_AUTHORIZED`.

Keep the extension ID and any personal page content out of published recordings. A hosted demo can use the same route after the extension is published or distributed as a signed unpacked build; the browser permission prompt remains a user action.
