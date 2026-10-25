import { runBrowserSuite } from "./lib/browser-suite.mts"
await runBrowserSuite(["web", "admin", "extension"], "browser")
