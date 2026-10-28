# Extension communication

[English documentation](README.md) · [简体中文](zh-CN/extension-communication.md)

Web, popup, options and side panel use `@browser-client/extension-sdk`. An isolated content script provides a small page agent. Each installed extension has its own Service Worker broker; Chrome native Ports are the default transport. There is no server, WebRTC dependency, global page event bus, all-tab broadcast or background heartbeat.

## Try the complete flow

1. Build and load an Extension instance using the normal extension instructions. Open its popup or options and copy the Extension ID from **Connections**.
2. Visit `/extension` in a Web instance, enter that ID, and choose **Connect and request access**.
3. In the extension, check the requesting origin, tab and capabilities, then choose **Allow this page**. The Web page can now read the shared workspace name and explicitly request its own selected text. Selection is not streamed automatically.
4. Change the existing workspace setting to see the subscription update. Revoke the grant in the extension, navigate the Web document, or close its tab to end access. **Disconnect** closes the SDK connection; it is not the same as revoking a document grant.

The popup's **Open side panel** button opens the same controls alongside the selected tab. **Read selected page** is an explicit user action and depends on Chrome's `activeTab` access. Restricted browser pages cannot be inspected. The first version exposes title, origin/path and selected text; it does not expose page HTML, cookies, arbitrary script execution, debugger commands, network proxies, screenshots or downloads.

## Configure trusted websites

Each extension's `src/bridge-policy.ts` owns its allowlist. The independent Extension seed has its own copy. Defaults permit only `http://127.0.0.1:3000` and `http://localhost:3000`. A custom Web port or production HTTPS origin must be added deliberately and the extension rebuilt. Do not automatically trust every registered instance or use wildcard production origins.

The manifest derives its `externally_connectable.matches` and initial `content_scripts.matches` from this list. Chrome match patterns are broader than an exact origin, especially for ports. The broker independently checks the exact `MessageSender.origin`, URL, top-level frame, tab, active document ID and profile. Matching a manifest pattern alone never grants a capability. Browser permissions and business consent are both required. Content agents cannot call UI management methods even though their sender has the same extension ID.

Grant approval happens inside packaged extension UI, not in a webpage dialog. Grants live in `chrome.storage.session`, scoped to extension installation/profile, exact origin, tab and document ID, with a one-hour maximum. Navigation invalidates them; permissions removal revokes all grants. Approval requests expire after two minutes and disappear on disconnect. They are not durable jobs. Same-origin website scripts share the website's authority: an allowlist does not protect a site from its own XSS. Incognito uses split extension contexts and a separate grant key; Chrome must first allow the extension in incognito.

## SDK

```ts
import { chromeTransport, createClient } from "@browser-client/extension-sdk"

// Web supplies the installed extension ID. Extension UI omits this argument.
const sdk = createClient({ connect: chromeTransport(extensionId), reconnect: true })
await sdk.request("access.request", { capabilities: ["workspace.read", "page.read"] })
// After the user approves inside the extension:
const page = await sdk.request("page.read", {})
const stop = sdk.subscribe("workspace", (snapshot) => render(snapshot))
// Component teardown:
stop()
sdk.close()
```

Use one client per mounted application context and dispose it on teardown. `diagnostics()` reports bounded request/waiter counts without document IDs or payload data. The SDK is safe to import during SSR; calling Chrome is deferred until connecting. Next.js integrations keep it in `transpilePackages`. `apps/web/src/app/extension` is a client-component example. Web capabilities are read-only. `workspace.set` and all `access.*` management methods except `access.request` require packaged UI identity. A Web `page.read` cannot name a different tab. UI reads are limited to the currently selected tab, and code injection uses the packaged, isolated agent, never an arbitrary string supplied by a webpage.

`request` supports an `AbortSignal`. Timeouts, cancellation and disconnect stop local waiting and cancel page-agent reads; they cannot undo a browser or storage side effect that already happened. Commands are never automatically replayed. After an ambiguous `workspace.set`, query the current value. This version has no general durable write/job API and makes no exactly-once guarantee.

## Recovery and traffic limits

Wire envelopes are versioned and runtime-validated; TypeScript types do not replace validation. Requests carry bounded IDs and deadlines. Each broker boot has a new epoch. Subscriptions receive revisioned snapshots, not a promise to replay every event missed while disconnected. Duplicate responses/events are ignored and received events are never emitted back into the broker.

The worker registers listeners synchronously and can be terminated normally. Document grants reload from session storage. Clients with live subscriptions can attempt at most five exponential/jittered reconnects; there is no polling or keepalive. A manual request can reconnect afterwards. A disconnected page agent is bootstrapped on an explicit authorized read. Browser-trusted pagehide suspends its Port; a cached document retains its bootstrap hook and reconnects on a trusted persisted pageshow. Synthetic website lifecycle events cannot trigger reconnection or teardown. Popup closure is normal teardown.

Limits are intentional: 32 KiB JSON envelopes, depth 12, 4,096 JSON nodes, 32 pending client calls (including callers waiting for negotiation), 16 connection observers, 8 in-flight calls per broker connection, 64 total connections, 4 per identity, 20 pending approvals and 64 stored grants. Token buckets allow a burst of 30 messages and replenish 5/second per connection and document identity; a global budget permits 120 burst and 100/second. Flooding closes the offending connection. Workspace/access events coalesce for 100 ms, with at most one in-flight snapshot per connection and a bounded set of dirty topics. No subscribers means no delivery. Navigation persistence is coalesced, and unknown or malformed authority is rejected.

Do not use these logical limits as a process memory cap or a guarantee against a compromised browser. Optional future bulk-data transports must preserve the same authorization, document binding and backpressure; a P2P mesh would not improve the default control path.

## Templates, maintenance and verification

`packages/extension-sdk` has no external dependencies. Web and Extension manifests reference it with `workspace:*`; reinit restores that dependency and Next's transpilation setting. Source trees, manifest, side-panel HTML and the shared package survive the existing preservation chain. Seeds are synchronized explicitly; adding an instance does not clone an existing business app. No maintenance command may broaden an origin allowlist automatically.

`scripts/tests/extension-sdk.test.mts` covers protocol attacks, origin/frame/document identity, consent, revocation, worker-state reconstruction, selected-document routing, duplicates, deadlines, disconnect cleanup and message bursts/slow consumers. Production manifest checks include the external entry policy, content-agent assets and side-panel HTML. Real Chromium acceptance additionally verifies Web→worker→agent→Web, popup/options/side-panel subscriptions, revoked/navigated documents and worker termination/recovery. Mock Ports and modeled trusted lifecycle callbacks verify protocol behavior; they do not substitute for actual browser lifecycle acceptance or Chrome/Edge manual checks.

Run validation with enough host headroom; the project's resource guard is available for local verification. See [testing](testing.md) and [deployment](deployment.md). This feature's implementation, unit tests and real-browser acceptance must be reported separately until each has actually run.

Chrome references: [messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging), [worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [external connections](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable), [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [side panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
