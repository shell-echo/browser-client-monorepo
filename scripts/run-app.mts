import { pathToFileURL } from "node:url"
import { join } from "node:path"
import assert from "node:assert/strict"
import { applicationSettings } from "./lib/app-runtime.mts"
import { createCommandRunner, handleCancellation } from "./lib/commands.mts"

const app = applicationSettings(pathToFileURL(join(process.cwd(), "package.json")))
const mode = process.argv[2]
assert(app.type === "web" && ["dev", "start"].includes(mode ?? ""), "Expected a Web dev/start command")
const runner = createCommandRunner({ timeoutMs: 0 })
const dispose = handleCancellation(runner)
try {
  await runner.run("pnpm", [
    "exec",
    "next",
    mode!,
    "--hostname",
    "127.0.0.1",
    "--port",
    String(app.port),
    ...process.argv.slice(3),
  ])
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await runner.close()
  dispose()
}
