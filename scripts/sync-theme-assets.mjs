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
      throw new Error(`拒绝覆盖现有业务资源：${fileURLToPath(path)}`)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  await writeFile(path, source)
}
console.log("Admin / Extension 的主题首屏脚本已同步。")
