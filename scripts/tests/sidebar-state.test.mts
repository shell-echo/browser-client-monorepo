import assert from "node:assert/strict"
import { test } from "node:test"
import { readSidebarState, writeSidebarState } from "../../packages/ui/src/lib/sidebar-state.ts"

function cookieDocument(t: import("node:test").TestContext, descriptor: PropertyDescriptor) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document")
  Object.defineProperty(globalThis, "document", { configurable: true, value: Object.defineProperty({}, "cookie", descriptor) })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous)
    else Reflect.deleteProperty(globalThis, "document")
  })
}

test("sidebar preferences restore both states and reject unrelated or invalid cookie values", (t) => {
  let cookie = ""
  cookieDocument(t, { get: () => cookie })
  for (const [value, expected] of [
    ["other=keep; sidebar_state=false; another=value", false],
    ["sidebar_state=true", true],
    ["other_sidebar_state=false", true],
    ["sidebar_state=invalid", true],
    ["sidebar_state=", true],
    ["", true],
  ] as const) {
    cookie = value
    assert.equal(readSidebarState(), expected, value)
  }
  for (const value of ["", "sidebar_state=invalid"]) {
    cookie = value
    assert.equal(readSidebarState(false), false, "Invalid preferences must respect the caller's default")
  }
})

test("sidebar writes persist both states with a root path and a bounded lifetime", (t) => {
  const writes: string[] = []
  cookieDocument(t, { set: (value: string) => writes.push(value) })
  for (const value of [false, true]) writeSidebarState(value)
  assert.equal(writes.length, 2)
  for (const [index, value] of [false, true].entries()) {
    assert(writes[index].startsWith(`sidebar_state=${value};`))
    assert.match(writes[index], /; path=\/;/)
    assert.match(writes[index], /; max-age=604800;/)
    assert.match(writes[index], /; SameSite=Lax$/)
  }
})

test("unavailable cookies and non-browser execution retain safe sidebar defaults", (t) => {
  assert.equal(readSidebarState(), true)
  assert.equal(readSidebarState(false), false)
  assert.doesNotThrow(() => writeSidebarState(false))
  cookieDocument(t, {
    get() {
      throw new DOMException("Cookies blocked", "SecurityError")
    },
    set() {
      throw new DOMException("Cookies blocked", "SecurityError")
    },
  })
  assert.equal(readSidebarState(), true)
  assert.equal(readSidebarState(false), false)
  assert.doesNotThrow(() => writeSidebarState(true))
})
