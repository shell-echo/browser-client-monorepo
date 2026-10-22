import { toError } from "./lib/contracts.mts"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const source = await readFile(new URL("packages/ui/src/lib/theme-init.js", root), "utf8")
for (const target of ["admin", "extension"]) {
  const publicDir = new URL(`apps/${target}/public/`, root)
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
