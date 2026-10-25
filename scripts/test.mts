import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { readApplications } from "./lib/apps.mts"
import { createCommandRunner, handleCancellation } from "./lib/commands.mts"
import { exists } from "./lib/workspace.mts"
import { verificationTestConcurrency } from "./lib/verification-resources.mts"

const root = fileURLToPath(new URL("../", import.meta.url))
const directories = ["scripts/tests", ...(await readApplications(root)).map((app) => `${app.path}/tests`)]
const files: string[] = []
for (const path of directories) {
  if (!(await exists(join(root, path)))) continue
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Test symlink is not supported: ${path}/${entry.name}`)
    if (entry.isFile() && entry.name.endsWith(".test.mts")) files.push(`${path}/${entry.name}`)
  }
}
const runner = createCommandRunner({ cwd: root, timeoutMs: 600_000 })
const dispose = handleCancellation(runner)
try {
  await runner.run(process.execPath, [
    "--test",
    `--test-concurrency=${verificationTestConcurrency()}`,
    "--test-timeout=180000",
    ...files.sort(),
  ])
} finally {
  await runner.close()
  dispose()
}
