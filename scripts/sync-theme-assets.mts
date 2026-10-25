import { toError } from "./lib/contracts.mts"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { readApplications } from "./lib/apps.mts"

const root = new URL("../", import.meta.url)
const source = await readFile(new URL("packages/ui/src/lib/theme-init.js", root), "utf8")
for (const target of (await readApplications(fileURLToPath(root))).filter((app) => app.type !== "web")) {
  const publicDir = new URL(`${target.path}/public/`, root)
  await mkdir(publicDir, { recursive: true })
  const path = new URL("theme-init.js", publicDir)
  try {
    const previous = await readFile(path, "utf8")
    if (!previous.startsWith("// browser-client theme bootstrap."))
      throw new Error(`Refusing to overwrite an existing application asset: ${fileURLToPath(path)}`)
  } catch (caught) {
    const error = toError(caught)
    if (error.code !== "ENOENT") throw error
  }
  await writeFile(path, source)
}
console.log("Admin / Extension theme bootstrap scripts synchronized.")
