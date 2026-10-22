import assert from "node:assert/strict"
import { test } from "node:test"
import {
  DEFAULT_WORKSPACE_NAME,
  isExtensionContext,
  readWorkspaceName,
  saveWorkspaceName,
  subscribeWorkspaceName,
  validateWorkspaceName,
} from "../../apps/extension/src/lib/settings.ts"

function environment(t, extension = true) {
  const previous = {
    chrome: Object.getOwnPropertyDescriptor(globalThis, "chrome"),
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  }
  const values = new Map()
  const listeners = new Set()
  const storage = {
    async get(key) {
      return { [key]: values.get(key) }
    },
    async set(settings) {
      for (const [key, value] of Object.entries(settings)) values.set(key, value)
    },
  }
  globalThis.chrome = extension
    ? {
        runtime: { id: "fixture" },
        storage: {
          local: storage,
          onChanged: {
            addListener: (listener) => listeners.add(listener),
            removeListener: (listener) => listeners.delete(listener),
          },
        },
      }
    : { runtime: {} }
  globalThis.window = {
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    addEventListener: (type, listener) => {
      assert.equal(type, "storage")
      listeners.add(listener)
    },
    removeEventListener: (type, listener) => {
      assert.equal(type, "storage")
      listeners.delete(listener)
    },
  }
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { values, listeners, storage }
}

test("extension settings read existing workspace values without rewriting them", async (t) => {
  const { values } = environment(t)
  assert(isExtensionContext())
  assert.equal(await readWorkspaceName(), DEFAULT_WORKSPACE_NAME)
  assert.equal(values.size, 0)
  values.set("workspaceName", "Existing workspace")
  assert.equal(await readWorkspaceName(), "Existing workspace")
  values.set("unrelated", "keep me")
  assert.equal(await saveWorkspaceName("  My workspace  "), "My workspace")
  assert.equal(values.get("workspaceName"), "My workspace")
  assert.equal(values.get("unrelated"), "keep me")
})

test("invalid names and storage write failures preserve existing settings", async (t) => {
  const { values, storage } = environment(t)
  values.set("workspaceName", "Keep this workspace")
  for (const value of ["", " ", "\n\t", "W".repeat(81)]) {
    assert.throws(() => validateWorkspaceName(value), /between 1 and 80/)
    await assert.rejects(saveWorkspaceName(value), /between 1 and 80/)
    assert.equal(values.get("workspaceName"), "Keep this workspace")
  }
  assert.equal(validateWorkspaceName("W".repeat(80)).length, 80)
  storage.set = async () => {
    throw Error("write denied")
  }
  await assert.rejects(saveWorkspaceName("New name"), /write denied/)
  assert.equal(values.get("workspaceName"), "Keep this workspace")
  storage.get = async () => {
    throw Error("read denied")
  }
  await assert.rejects(readWorkspaceName(), /read denied/)
})

test("extension subscriptions ignore unrelated keys and areas and detach on cleanup", (t) => {
  const { listeners } = environment(t)
  let changes = 0
  const stop = subscribeWorkspaceName(() => changes++)
  assert.equal(listeners.size, 1)
  const [notify] = listeners
  notify({ workspaceName: {} }, "sync")
  notify({ unrelated: {} }, "local")
  assert.equal(changes, 0)
  notify({ workspaceName: {} }, "local")
  assert.equal(changes, 1)
  stop()
  assert.equal(listeners.size, 0)
})

test("browser preview uses a separate local key and handles cleared storage", async (t) => {
  const { values, listeners } = environment(t, false)
  assert.equal(isExtensionContext(), false)
  values.set("workspaceName", "Extension data")
  assert.equal(await readWorkspaceName(), DEFAULT_WORKSPACE_NAME)
  await saveWorkspaceName("Preview workspace")
  assert.equal(await readWorkspaceName(), "Preview workspace")
  assert.equal(values.get("workspaceName"), "Extension data")
  let changes = 0
  const stop = subscribeWorkspaceName(() => changes++)
  const [notify] = listeners
  notify({ key: "unrelated" })
  assert.equal(changes, 0)
  notify({ key: "browser-client-workspace-name" })
  notify({ key: null })
  assert.equal(changes, 2)
  stop()
  assert.equal(listeners.size, 0)
  globalThis.window.localStorage.getItem = () => {
    throw Error("blocked")
  }
  await assert.rejects(readWorkspaceName(), /blocked/)
})
