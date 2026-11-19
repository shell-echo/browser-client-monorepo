import { BridgeError, MAX_SCREENSHOT_CHARS } from "@browser-client/extension-sdk/protocol"

interface ViewportFrame {
  dataUrl: string
  width: number
  height: number
}

// Re-encode one native frame; return the real encoded dimensions for CSS mapping.
// Taking another native frame for each quality level exceeds Chrome's 2/s quota.
async function compressViewport(dataUrl: string) {
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (char) => char.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }))
  let canvas: OffscreenCanvas | undefined
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    if (scale === 1 && dataUrl.length <= MAX_SCREENSHOT_CHARS) return { dataUrl, width, height }
    canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Viewport encoder is unavailable")
    context.drawImage(bitmap, 0, 0, width, height)
    for (const quality of [0.4, 0.25, 0.15]) {
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality })
      // Reject oversized blobs before allocating their base64 representation.
      if (23 + 4 * Math.ceil(blob.size / 3) > MAX_SCREENSHOT_CHARS) continue
      const encoded = new Uint8Array(await blob.arrayBuffer())
      let binary = ""
      for (let offset = 0; offset < encoded.length; offset += 32768)
        binary += String.fromCharCode(...encoded.subarray(offset, offset + 32768))
      return { dataUrl: `data:image/jpeg;base64,${btoa(binary)}`, width, height }
    }
    throw new BridgeError("PAYLOAD_TOO_LARGE", "Viewport image exceeds bridge limits")
  } finally {
    bitmap.close()
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}

export function createViewportCapture({
  compress = compressViewport,
  now = Date.now,
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  compress?: (dataUrl: string) => Promise<ViewportFrame>
  now?: () => number
  wait?: (ms: number) => Promise<void>
} = {}) {
  let tail: Promise<unknown> = Promise.resolve()
  let nextCaptureAt = 0
  let pending = 0
  return (capture: () => Promise<string>, signal?: AbortSignal): Promise<ViewportFrame> => {
    if (signal?.aborted) return Promise.reject(new BridgeError("CANCELLED", "Observation cancelled"))
    if (pending >= 4) return Promise.reject(new BridgeError("BUSY", "Viewport capture capacity exceeded"))
    pending++
    const assertActive = () => {
      if (signal?.aborted) throw new BridgeError("CANCELLED", "Observation cancelled")
    }
    const result = tail.then(async () => {
      assertActive()
      const delay = nextCaptureAt - now()
      if (delay > 0) await wait(delay)
      assertActive()
      nextCaptureAt = now() + 600
      const original = await capture()
      assertActive()
      const frame = await compress(original)
      assertActive()
      if (frame.dataUrl.length > MAX_SCREENSHOT_CHARS)
        throw new BridgeError("PAYLOAD_TOO_LARGE", "Viewport image exceeds bridge limits")
      return frame
    })
    // A failed capture must not poison subsequent observations.
    tail = result.catch(() => undefined).finally(() => pending--)
    return result
  }
}
