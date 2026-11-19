import assert from "node:assert/strict"
import { test } from "node:test"
import { BridgeError, MAX_SCREENSHOT_CHARS } from "@browser-client/extension-sdk/protocol"
import { createViewportCapture } from "../src/lib/viewport-capture.ts"

const frame = (dataUrl: string) => ({ dataUrl, width: 1280, height: 720 })

test("large native frames are compressed locally without a second native capture", async () => {
  let captures = 0
  const large = "x".repeat(MAX_SCREENSHOT_CHARS + 1)
  const capture = createViewportCapture({
    compress: async (native) => {
      assert.equal(native, large)
      return frame("data:image/jpeg;base64,fixture")
    },
  })
  assert.deepEqual(
    await capture(async () => {
      captures++
      return large
    }),
    frame("data:image/jpeg;base64,fixture"),
  )
  assert.equal(captures, 1)
})

test("concurrent observations share Chrome's native capture budget and recover after failure", async () => {
  let clock = 1000
  const starts: number[] = []
  const capture = createViewportCapture({
    now: () => clock,
    wait: async (ms) => {
      clock += ms
    },
    compress: async (dataUrl) => frame(dataUrl),
  })
  const nativeFrame = async () => {
    starts.push(clock)
    return "data:image/jpeg;base64,fixture"
  }
  const rejected = capture(async () => {
    starts.push(clock)
    throw new Error("Native capture denied")
  })
  const next = capture(nativeFrame)
  await assert.rejects(rejected, /Native capture denied/)
  await next
  await Promise.all([capture(nativeFrame), capture(nativeFrame)])
  assert.deepEqual(starts, [1000, 1600, 2200, 2800])
})

test("the image limit is inclusive and oversized encoder results still fail closed", async () => {
  const capture = createViewportCapture({
    compress: async (dataUrl) => frame(dataUrl),
    wait: async () => undefined,
  })
  const boundary = "x".repeat(MAX_SCREENSHOT_CHARS)
  assert.deepEqual(await capture(async () => boundary), frame(boundary))
  await assert.rejects(
    capture(async () => `${boundary}x`),
    (error: unknown) => {
      assert(error instanceof BridgeError)
      assert.equal(error.code, "PAYLOAD_TOO_LARGE")
      return true
    },
  )
})

test("cancelled queued observations never call the native capture and capacity is bounded", async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const capture = createViewportCapture({ wait: async () => undefined, compress: async (dataUrl) => frame(dataUrl) })
  const active = capture(async () => {
    await blocked
    return "frame"
  })
  const abort = new AbortController()
  let staleCaptures = 0
  const queued = capture(async () => {
    staleCaptures++
    return "stale"
  }, abort.signal)
  const cancelled = assert.rejects(queued, { code: "CANCELLED" })
  const third = capture(async () => "third")
  const fourth = capture(async () => "fourth")
  await assert.rejects(
    capture(async () => assert.fail("Full queue cannot capture")),
    { code: "BUSY" },
  )
  abort.abort()
  release()
  await Promise.all([active, cancelled, third, fourth])
  assert.equal(staleCaptures, 0)
  assert.deepEqual(await capture(async () => "recovered"), frame("recovered"))
})

test("the viewport encoder bounds the long edge, returns encoded dimensions and releases image resources", async (t) => {
  const previous = ["createImageBitmap", "OffscreenCanvas"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  let closed = false
  let canvas: { width: number; height: number } | undefined
  Object.assign(globalThis, {
    createImageBitmap: async () => ({
      width: 2940,
      height: 1670,
      close() {
        closed = true
      },
    }),
    OffscreenCanvas: class {
      width: number
      height: number
      constructor(width: number, height: number) {
        this.width = width
        this.height = height
        canvas = this
      }
      getContext() {
        return {
          drawImage(_bitmap: unknown, x: number, y: number, width: number, height: number) {
            assert.deepEqual([x, y, width, height], [0, 0, 1280, 727])
          },
        }
      }
      async convertToBlob() {
        return new Blob([new Uint8Array(50_000)], { type: "image/jpeg" })
      }
    },
  })
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const result = await createViewportCapture()(async () => "data:image/jpeg;base64,YWJj")
  assert.equal(result.width, 1280)
  assert.equal(result.height, 727)
  assert(result.dataUrl.length <= MAX_SCREENSHOT_CHARS)
  assert.equal(closed, true)
  assert.deepEqual([canvas?.width, canvas?.height], [0, 0])
})
