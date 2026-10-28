import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createClient } from "../../packages/extension-sdk/src/client.mts"
import { createBroker, identify } from "../../packages/extension-sdk/src/broker.mts"
import { attachPageAgent, createPageAgent } from "../../packages/extension-sdk/src/agent.mts"
import {
  boundedJson,
  decodeIncoming,
  decodeResult,
  decodeSnapshot,
  PORT_NAME,
} from "../../packages/extension-sdk/src/protocol.mts"
import type { Port } from "../../packages/extension-sdk/src/protocol.mts"
import type { BrokerOptions, Sender } from "../../packages/extension-sdk/src/broker.mts"

const extensionId = "a".repeat(32)
const origin = "http://127.0.0.1:3000"
const web: Sender = {
  url: `${origin}/extension`,
  origin,
  documentId: "document-one",
  documentLifecycle: "active",
  frameId: 0,
  tab: { id: 7, incognito: false },
}
const ui: Sender = { id: extensionId, url: `chrome-extension://${extensionId}/options.html` }
function pair() {
  let stopped = false
  const messages = [new Set<(value: unknown) => void>(), new Set<(value: unknown) => void>()]
  const disconnects = [new Set<() => void>(), new Set<() => void>()]
  const delivered = [0, 0]
  const ports: Port[] = [0, 1].map((index) => ({
    postMessage(value) {
      if (stopped) throw new Error("Port disconnected")
      const wire = JSON.parse(JSON.stringify(value))
      queueMicrotask(() => {
        if (!stopped) {
          delivered[index]++
          for (const listener of messages[1 - index]) listener(wire)
        }
      })
    },
    disconnect() {
      if (!stopped) {
        stopped = true
        queueMicrotask(() => {
          for (const group of disconnects) for (const listener of [...group]) listener()
        })
      }
    },
    onMessage: {
      addListener: (fn) => {
        messages[index].add(fn)
      },
      removeListener: (fn) => {
        messages[index].delete(fn)
      },
    },
    onDisconnect: {
      addListener: (fn) => {
        disconnects[index].add(fn)
      },
      removeListener: (fn) => {
        disconnects[index].delete(fn)
      },
    },
  }))
  return { client: ports[0], server: ports[1], delivered, stopped: () => stopped }
}
function fixture(t: import("node:test").TestContext, overrides: Partial<BrokerOptions> = {}) {
  let stored: unknown
  let name = "Workspace"
  const options: BrokerOptions = {
    instance: extensionId,
    policy: { extensionId, origins: [origin], incognito: false },
    loadGrants: async () => structuredClone(stored),
    saveGrants: async (value) => {
      stored = structuredClone(value)
    },
    workspace: async () => name,
    setWorkspace: async (value) => {
      name = value
    },
    activeTab: async () => 7,
    authorizeOrigin: async () => true,
    preparePage: async () => "document-one",
    ...overrides,
  }
  const broker = createBroker(options)
  const clients: ReturnType<typeof createClient>[] = []
  t.after(() => {
    for (const client of clients) client.close()
    broker.close()
  })
  function client(sender = web, external = true) {
    const sdk = createClient({
      connect: () => {
        const connection = pair()
        broker.attach(connection.server, sender, external)
        return connection.client
      },
      timeoutMs: 1000,
    })
    clients.push(sdk)
    return sdk
  }
  const admin = client(ui, false)
  async function approve(
    sdk: ReturnType<typeof createClient>,
    requested: ("workspace.read" | "page.read")[] = ["workspace.read", "page.read"],
  ) {
    const request = await sdk.request("access.request", { capabilities: requested })
    await admin.request("access.decide", { id: request.id, allow: true })
  }
  return { broker, client, admin, approve, options }
}

test("protocol rejects extra authority fields, unknown methods, non-JSON and oversized/deep payloads", () => {
  const request = { v: 1, kind: "request", id: "id", method: "page.read", params: {}, deadline: Date.now() + 1000 }
  assert.equal(decodeIncoming(request).kind, "request")
  for (const invalid of [
    { ...request, role: "ui" },
    { ...request, method: "debugger.sendCommand" },
    { ...request, params: { frameId: 0 } },
    { ...request, v: 2 },
  ])
    assert.throws(() => decodeIncoming(invalid))
  assert.equal(boundedJson({ function: () => 1 }), false)
  assert.equal(boundedJson({ value: "x".repeat(33_000) }), false)
  let deep: unknown = null
  for (let depth = 0; depth < 20; depth++) deep = { child: deep }
  assert.equal(boundedJson(deep), false)
  assert.throws(() =>
    decodeIncoming({ ...request, method: "access.request", params: { capabilities: ["page.read", "page.read"] } }),
  )
  assert.throws(() => decodeResult("workspace.get", { name: 1 }))
  assert.throws(() => decodeResult("access.grants", { grants: [{ id: "forged" }] }))
  assert.throws(() => decodeSnapshot("access", { capabilities: ["debugger"] }))
})

test("Chrome sender identity rejects iframe, opaque, stale, cross-extension and mismatched origins", () => {
  const policy = { extensionId, origins: [origin], incognito: false }
  assert.equal(identify(web, true, policy).kind, "web")
  assert.equal(identify(ui, false, policy).kind, "ui")
  assert.equal(identify({ ...web, id: extensionId }, false, policy).kind, "agent")
  for (const sender of [
    { ...web, frameId: 1 },
    { ...web, origin: "null" },
    { ...web, url: `${origin.replace(":3000", ":3001")}/` },
    { ...web, id: extensionId },
    { ...web, documentId: undefined },
    { ...web, documentLifecycle: "cached" },
    { ...web, tab: { id: 7, incognito: true } },
    { ...web, url: "https://evil.example/" },
  ])
    assert.throws(() => identify(sender, true, policy))
  assert.throws(() => identify({ id: extensionId, url: `chrome-extension://${extensionId}/untrusted.html` }, false, policy))
})

test("Web cannot read or write until explicit UI approval; grants remain capability-scoped", async (t) => {
  const { client, approve, admin } = fixture(t)
  const site = client()
  await assert.rejects(site.request("workspace.get", {}), { code: "NOT_AUTHORIZED" })
  await assert.rejects(site.request("workspace.set", { name: "Hostile" }), { code: "FORBIDDEN" })
  await assert.rejects(site.request("access.decide", { id: "fake", allow: true }), { code: "FORBIDDEN" })
  await approve(site, ["workspace.read"])
  assert.deepEqual(await site.request("workspace.get", {}), { name: "Workspace" })
  await assert.rejects(site.request("page.read", {}), { code: "NOT_AUTHORIZED" })
  const { grants } = await admin.request("access.grants", {})
  await admin.request("access.revoke", { id: grants[0].id })
  await assert.rejects(site.request("workspace.get", {}), { code: "NOT_AUTHORIZED" })
})

test("page replies are routed only from the authorized document agent", async (t) => {
  const { client, approve, broker } = fixture(t)
  const site = client()
  await approve(site)
  const connection = pair()
  broker.attach(connection.server, { ...web, id: extensionId }, false)
  const dispose = attachPageAgent(connection.client, () => ({
    title: "Page",
    url: `${origin}/extension`,
    selection: "Selected text",
  }))
  t.after(dispose)
  assert.equal((await site.request("page.read", {})).selection, "Selected text")
  await assert.rejects(site.request("page.read", { tabId: 8 }), { code: "FORBIDDEN" })
  const otherDocument = client({ ...web, documentId: "document-two" })
  await assert.rejects(otherDocument.request("page.read", {}), { code: "NOT_AUTHORIZED" })
  await broker.invalidateTab(7)
  assert.equal(broker.counts().reads, 0)
  const next = client({ ...web, documentId: "document-three" })
  await assert.rejects(next.request("workspace.get", {}), { code: "NOT_AUTHORIZED" })
})

test("grant receipts survive a worker restart but do not authorize new documents or instances", async (t) => {
  const { options, client, approve, broker } = fixture(t)
  const site = client()
  await approve(site, ["workspace.read"])
  broker.close()
  const restarted = createBroker(options)
  t.after(() => restarted.close())
  const sdk = createClient({
    connect: () => {
      const ports = pair()
      restarted.attach(ports.server, web, true)
      return ports.client
    },
  })
  t.after(() => sdk.close())
  assert.deepEqual(await sdk.request("workspace.get", {}), { name: "Workspace" })
  const separate = createBroker({ ...options, loadGrants: async () => undefined })
  t.after(() => separate.close())
  const isolated = createClient({
    connect: () => {
      const ports = pair()
      separate.attach(ports.server, web, true)
      return ports.client
    },
  })
  t.after(() => isolated.close())
  await assert.rejects(isolated.request("workspace.get", {}), { code: "NOT_AUTHORIZED" })
})

test("unsubscribed events do not fan out; rapid changes coalesce and stop on unsubscribe", async (t) => {
  const { admin, broker } = fixture(t)
  const quiet = pair()
  broker.attach(quiet.server, ui, false)
  const values: unknown[] = []
  const stop = admin.subscribe("workspace", (value) => values.push(value))
  await admin.connect()
  await delay(130)
  values.length = 0
  for (let index = 0; index < 500; index++) broker.workspaceChanged()
  await admin.request("workspace.set", { name: "Newest value" })
  await delay(150)
  assert.deepEqual(values, [{ name: "Newest value" }])
  assert.equal(quiet.delivered[1], 0, "Unsubscribed endpoint received a broadcast")
  stop()
  broker.workspaceChanged()
  await delay(130)
  assert.equal(values.length, 1)
})

test("a slow snapshot never creates an unbounded queue of storage reads", async (t) => {
  let resolve: ((value: string) => void) | undefined
  let calls = 0
  const { admin, broker } = fixture(t, {
    workspace: () => {
      calls++
      return new Promise<string>((done) => {
        resolve = done
      })
    },
  })
  const stop = admin.subscribe("workspace", () => undefined)
  await admin.connect()
  await delay(120)
  for (let index = 0; index < 1000; index++) broker.workspaceChanged()
  await delay(250)
  assert.equal(calls, 1)
  stop()
  resolve!("Ready")
})

test("flooding a connection disconnects it without flooding unrelated observers", async (t) => {
  const { broker, admin } = fixture(t)
  await admin.connect()
  const ports = pair()
  broker.attach(ports.server, web, true)
  for (let index = 0; index < 500; index++) ports.client.postMessage({ v: 1, kind: "subscribe", topic: "access" })
  await delay(20)
  assert.equal(ports.stopped(), true)
  assert(broker.counts().sessions <= 1)
  assert.deepEqual(await admin.request("workspace.get", {}), { name: "Workspace" })
})

test("document rate limits span Ports, isolate other documents and refill", async (t) => {
  let now = Date.now()
  t.mock.method(Date, "now", () => now)
  const { broker, client } = fixture(t)
  const original = client()
  await original.connect()
  const flood = pair()
  broker.attach(flood.server, web, true)
  for (let index = 0; index < 100; index++) flood.client.postMessage({ v: 1, kind: "subscribe", topic: "access" })
  await delay(0)
  assert.equal(flood.stopped(), true)
  await assert.rejects(original.request("bridge.info", {}), { code: "DISCONNECTED" })
  await assert.rejects(client().connect(), { code: "DISCONNECTED" }, "A fresh Port cannot reset the document budget")
  const unrelated = client({ ...web, tab: { id: 8, incognito: false }, documentId: "document-two" })
  assert.equal((await unrelated.request("bridge.info", {})).version, 1)
  now += 1000
  const recovered = client()
  await recovered.connect()
  assert.equal((await recovered.request("bridge.info", {})).version, 1)
})

test("duplicate and expired request IDs never re-execute a command", async (t) => {
  let writes = 0
  const { broker } = fixture(t, {
    setWorkspace: async () => {
      writes++
    },
  })
  const ports = pair()
  broker.attach(ports.server, ui, false)
  const replies: unknown[] = []
  ports.client.onMessage.addListener((value) => replies.push(value))
  const request = {
    v: 1,
    kind: "request",
    id: "once",
    method: "workspace.set",
    params: { name: "New" },
    deadline: Date.now() + 1000,
  }
  ports.client.postMessage(request)
  ports.client.postMessage(request)
  ports.client.postMessage({ ...request, id: "expired", deadline: Date.now() - 1 })
  await delay(20)
  assert.equal(writes, 1)
  assert(replies.some((value) => JSON.stringify(value).includes("DUPLICATE")))
  assert(replies.some((value) => JSON.stringify(value).includes("EXPIRED")))
})

test("closing SDK rejects in-flight operations; persistent write results are not automatically retried", async (t) => {
  let writes = 0
  let finish: (() => void) | undefined
  const { admin } = fixture(t, {
    setWorkspace: () => {
      writes++
      return new Promise<void>((done) => {
        finish = done
      })
    },
  })
  const result = admin.request("workspace.set", { name: "Saved once" })
  const rejected = assert.rejects(result, { code: "CLOSED" })
  await delay(10)
  admin.close()
  await rejected
  assert.equal(writes, 1)
  finish!()
})

test("disconnected approval requests and agent clients cannot escalate to trusted UI", async (t) => {
  const { client, admin, broker } = fixture(t)
  const site = client()
  const request = await site.request("access.request", { capabilities: ["page.read"] })
  site.close()
  await delay(10)
  await assert.rejects(admin.request("access.decide", { id: request.id, allow: true }), { code: "EXPIRED" })
  const ports = pair()
  broker.attach(ports.server, { ...web, id: extensionId }, false)
  ports.client.postMessage({
    v: 1,
    kind: "request",
    id: "escalate",
    method: "access.grants",
    params: {},
    deadline: Date.now() + 1000,
  })
  await delay(10)
  assert.equal(ports.stopped(), true)
  assert.equal((await admin.request("access.grants", {})).grants.length, 0)
})

test("malformed saved grants and wrong channel names fail closed", async (t) => {
  const { broker, client } = fixture(t, {
    loadGrants: async () => ({
      version: 1,
      grants: [{ ...web, key: "forged", capabilities: ["workspace.read"], expiresAt: Date.now() + 9999 }],
    }),
  })
  await assert.rejects(client().request("workspace.get", {}), { code: "NOT_AUTHORIZED" })
  const ports = pair()
  broker.attach(ports.server, ui, false, `${PORT_NAME}-wrong`)
  assert.equal(ports.stopped(), true)
})

test("a synchronous unavailable transport does not poison the next manual connection", async (t) => {
  const { broker } = fixture(t)
  let calls = 0
  const sdk = createClient({
    connect() {
      if (++calls === 1) throw new Error("Temporarily unavailable")
      const ports = pair()
      broker.attach(ports.server, ui, false)
      return ports.client
    },
  })
  t.after(() => sdk.close())
  await assert.rejects(sdk.connect(), /Temporarily unavailable/)
  assert.deepEqual(await sdk.request("workspace.get", {}), { name: "Workspace" })
  assert.equal(calls, 2)
})

test("cancellation clears an unresponsive page read and does not leak ownership", async (t) => {
  const { broker, client, approve } = fixture(t)
  const site = client()
  await approve(site)
  const ports = pair()
  broker.attach(ports.server, { ...web, id: extensionId }, false)
  const abort = new AbortController()
  const read = site.request("page.read", {}, { signal: abort.signal })
  const rejected = assert.rejects(read, { code: "CANCELLED" })
  await delay(10)
  assert.equal(broker.counts().reads, 1)
  abort.abort()
  await rejected
  await delay(10)
  assert.equal(broker.counts().reads, 0)
})

test("browser permissions and persisted approval must both succeed before Web access", async (t) => {
  let permitted = true
  let failSave = true
  const { client, admin, broker } = fixture(t, {
    authorizeOrigin: async () => permitted,
    saveGrants: async () => {
      if (failSave) throw new Error("Storage unavailable")
    },
  })
  const site = client()
  const request = await site.request("access.request", { capabilities: ["workspace.read"] })
  await assert.rejects(admin.request("access.decide", { id: request.id, allow: true }), { code: "INTERNAL" })
  await assert.rejects(site.request("workspace.get", {}), { code: "NOT_AUTHORIZED" })
  failSave = false
  await admin.request("access.decide", { id: request.id, allow: true })
  assert.equal((await site.request("workspace.get", {})).name, "Workspace")
  permitted = false
  await assert.rejects(site.request("workspace.get", {}), { code: "FORBIDDEN" })
  await broker.revokeAll()
  assert.deepEqual((await admin.request("access.grants", {})).grants, [])
})

test("SDK bounds requests queued before negotiation completes", async (t) => {
  const ports = pair()
  let connections = 0
  const sdk = createClient({
    connect: () => {
      connections++
      return ports.client
    },
    timeoutMs: 100,
  })
  t.after(() => sdk.close())
  const outcomes = Array.from({ length: 40 }, () =>
    sdk.request("workspace.get", {}).then(
      () => "UNEXPECTED_SUCCESS",
      (reason: { code: string }) => reason.code,
    ),
  )
  assert.equal(await outcomes[39], "BUSY")
  sdk.close()
  const all = await Promise.all(outcomes)
  assert.equal(all.filter((value) => value === "BUSY").length, 8)
  assert.equal(connections, 1, "Concurrent callers opened more than one transport")
})

test("a queued request can cancel without waiting for the connection timeout", async (t) => {
  const ports = pair()
  const sdk = createClient({ connect: () => ports.client, timeoutMs: 1000 })
  t.after(() => sdk.close())
  const controller = new AbortController()
  const pending = sdk.request("workspace.get", {}, { signal: controller.signal }).then(
    () => "UNEXPECTED_SUCCESS",
    (reason: { code: string }) => reason.code,
  )
  await delay(5)
  controller.abort()
  assert.equal(await Promise.race([pending, delay(100).then(() => "STILL_WAITING")]), "CANCELLED")
})

test("page agent resumes a suspended document without stale disconnects clearing its new Port", async (t) => {
  const connections: ReturnType<typeof pair>[] = []
  const callbacks: (() => void)[][] = []
  const agent = createPageAgent({
    connect() {
      const ports = pair(),
        listeners: (() => void)[] = []
      const add = ports.client.onDisconnect.addListener
      ports.client.onDisconnect.addListener = (listener) => {
        listeners.push(listener)
        add(listener)
      }
      connections.push(ports)
      callbacks.push(listeners)
      return ports.client
    },
    read: () => ({ title: "Restored document", url: `${origin}/`, selection: "Restored selection" }),
  })
  t.after(() => agent.close())
  assert.equal(agent.connect(), true)
  agent.connect()
  assert.equal(connections.length, 1)
  agent.suspend()
  assert.equal(connections[0].stopped(), true)
  assert.equal(agent.connect(), true)
  assert.equal(connections.length, 2)
  for (const callback of callbacks[0]) callback()
  agent.connect()
  assert.equal(connections.length, 2)
  let result: unknown
  connections[1].server.onMessage.addListener((value) => {
    result = value
  })
  connections[1].server.postMessage({ v: 1, kind: "agent.read", id: "after-bfcache" })
  await delay(0)
  assert.deepEqual(result, {
    v: 1,
    kind: "agent.result",
    id: "after-bfcache",
    value: { title: "Restored document", url: `${origin}/`, selection: "Restored selection" },
  })
  agent.close()
  assert.equal(agent.connect(), false)
})

test("content entry retains its reconnect hook across persisted pagehide and pageshow", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "content-lifecycle-"))
  const keys = ["chrome", "window", "document", "location", "__browserClientPageAgent"] as const
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const connections: ReturnType<typeof pair>[] = []
  const events = new Map<string, Set<(event: PageTransitionEvent) => void>>()
  t.after(async () => {
    for (const connection of connections) connection.client.disconnect()
    await delay(0)
    for (const key of keys) {
      const descriptor = previous.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    await rm(root, { recursive: true, force: true })
  })
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        connect() {
          const ports = pair()
          connections.push(ports)
          return ports.client
        },
      },
    },
    window: {
      addEventListener(name: string, listener: (event: PageTransitionEvent) => void) {
        const listeners = events.get(name) ?? new Set()
        listeners.add(listener)
        events.set(name, listeners)
      },
      removeEventListener(name: string, listener: (event: PageTransitionEvent) => void) {
        events.get(name)?.delete(listener)
      },
      getSelection: () => null,
    },
    document: { title: "Cached page" },
    location: { origin, pathname: "/" },
  })
  Reflect.deleteProperty(globalThis, "__browserClientPageAgent")
  const sdk = join(root, "node_modules/@browser-client/extension-sdk")
  await mkdir(sdk, { recursive: true })
  await writeFile(
    join(sdk, "package.json"),
    JSON.stringify({ type: "module", exports: { "./agent": "./agent.mjs", "./protocol": "./protocol.mjs" } }),
  )
  for (const name of ["agent", "protocol"]) {
    await writeFile(
      join(sdk, `${name}.mjs`),
      `export * from ${JSON.stringify(new URL(`../../packages/extension-sdk/src/${name}.mts`, import.meta.url).href)}\n`,
    )
  }
  await writeFile(
    join(root, "content.ts"),
    await readFile(new URL("../../templates/extension/src/content.ts", import.meta.url)),
  )
  await import(pathToFileURL(join(root, "content.ts")).href)
  const scope = globalThis as typeof globalThis & { __browserClientPageAgent?: { connect(): void } }
  assert.equal(connections.length, 1)
  // Model browser-trusted lifecycle callbacks; synthetic DOM events are tested separately below.
  const transition = (name: string, persisted: boolean, isTrusted = true) => {
    for (const listener of events.get(name) ?? []) listener({ type: name, persisted, isTrusted } as PageTransitionEvent)
  }
  transition("pagehide", false, false)
  assert.equal(connections[0].stopped(), false, "An untrusted page event closed the agent")
  transition("pageshow", true, false)
  assert.equal(connections.length, 1)
  transition("pagehide", true)
  assert.equal(connections[0].stopped(), true)
  assert.equal(typeof scope.__browserClientPageAgent?.connect, "function", "A cached document lost its bootstrap hook")
  transition("pageshow", true)
  assert.equal(connections.length, 2)
  scope.__browserClientPageAgent!.connect()
  assert.equal(connections.length, 2)
  transition("pagehide", false)
  assert.equal(scope.__browserClientPageAgent, undefined)
  transition("pageshow", true)
  assert.equal(connections.length, 2)
})

test("invalidated Chrome event objects cannot prevent SDK pending-call cleanup", async (t) => {
  const ports = pair()
  const sdk = createClient({ connect: () => ports.client, timeoutMs: 1000 })
  t.after(() => sdk.close())
  const pending = sdk.request("workspace.get", {})
  const rejected = assert.rejects(pending, { code: "CLOSED" })
  await delay(0)
  ports.client.onMessage.removeListener = () => {
    throw new Error("Extension context invalidated")
  }
  ports.client.onDisconnect.removeListener = () => {
    throw new Error("Extension context invalidated")
  }
  assert.doesNotThrow(() => sdk.close())
  await rejected
  assert.equal(sdk.getState(), "closed")
})

test("cancelled negotiation waiters are pruned instead of accumulating on the shared connection", async (t) => {
  const ports = pair()
  const sdk = createClient({ connect: () => ports.client, timeoutMs: 30_000 })
  t.after(() => sdk.close())
  for (let index = 0; index < 100; index++) {
    const controller = new AbortController()
    const rejected = assert.rejects(sdk.request("workspace.get", {}, { signal: controller.signal }), { code: "CANCELLED" })
    controller.abort()
    await rejected
    assert.equal(sdk.diagnostics().connectionWaiters, 0)
    assert.equal(sdk.diagnostics().requests, 0)
  }
  assert.equal(sdk.diagnostics().pending, 1, "Only the shared handshake may remain")
})

test("page-agent suspension closes its Port even when event cleanup throws", (t) => {
  const connections: ReturnType<typeof pair>[] = []
  const agent = createPageAgent({
    connect() {
      const ports = pair()
      connections.push(ports)
      return ports.client
    },
    read: () => ({ title: "", url: `${origin}/`, selection: "" }),
  })
  t.after(() => agent.close())
  agent.connect()
  connections[0].client.onMessage.removeListener = () => {
    throw new Error("Context invalidated")
  }
  connections[0].client.onDisconnect.removeListener = () => {
    throw new Error("Context invalidated")
  }
  assert.doesNotThrow(() => agent.suspend())
  assert.equal(connections[0].stopped(), true)
  agent.connect()
  assert.equal(connections.length, 2)
})

test("late messages and disconnects from a retired transport cannot replace or close a new SDK session", async (t) => {
  const { broker } = fixture(t)
  const connections: ReturnType<typeof pair>[] = []
  const callbacks: { messages: ((value: unknown) => void)[]; disconnected: (() => void)[] }[] = []
  const sdk = createClient({
    connect() {
      const ports = pair(),
        saved = { messages: [] as ((value: unknown) => void)[], disconnected: [] as (() => void)[] }
      const addMessage = ports.client.onMessage.addListener,
        addDisconnect = ports.client.onDisconnect.addListener
      ports.client.onMessage.addListener = (listener) => {
        saved.messages.push(listener)
        addMessage(listener)
      }
      ports.client.onDisconnect.addListener = (listener) => {
        saved.disconnected.push(listener)
        addDisconnect(listener)
      }
      broker.attach(ports.server, ui, false)
      connections.push(ports)
      callbacks.push(saved)
      return ports.client
    },
  })
  t.after(() => sdk.close())
  const received: unknown[] = []
  sdk.subscribe("workspace", (value) => received.push(value))
  const info = await sdk.request("bridge.info", {})
  await delay(130)
  connections[0].client.disconnect()
  await delay(0)
  assert.deepEqual(await sdk.request("workspace.get", {}), { name: "Workspace" })
  await delay(130)
  received.length = 0
  for (const receive of callbacks[0].messages)
    receive({ v: 1, kind: "event", topic: "workspace", epoch: info.epoch, revision: 9999, value: { name: "Stale document" } })
  for (const disconnect of callbacks[0].disconnected) disconnect()
  assert.equal(sdk.getState(), "connected")
  assert.deepEqual(received, [])
  assert.equal(connections.length, 2)
  assert.deepEqual(await sdk.request("workspace.get", {}), { name: "Workspace" })
})
