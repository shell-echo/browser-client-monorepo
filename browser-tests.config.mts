// Optional per-instance overrides. Prefer each application's browser-tests.config.mts.
import type { BrowserConfig } from "./scripts/lib/contracts.mts"
export default {} satisfies Record<string, BrowserConfig[keyof BrowserConfig]>
