import assert from "node:assert/strict"
import type { Registry } from "../lib/contracts.mts"

const forbidden = async () => assert.fail("Offline replay queried the registry")
export const offlineRegistry: Registry = new Proxy(
  { read: forbidden, versions: forbidden, latest: forbidden },
  { get: () => assert.fail("Offline replay queried the registry") },
)

export function required<T>(value: T | undefined): T {
  assert(value !== undefined, "Expected fixture entry is missing")
  return value
}
