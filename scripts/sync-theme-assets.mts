import { toError } from "./lib/contracts.mts"
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join, resolve } from "node:path"
import { readApplications } from "./lib/apps.mts"

export async function syncThemeAssets(root: string) {
  const source = await readFile(join(root, "packages/ui/src/lib/theme-init.js"), "utf8")
  const paths = [
    "templates/admin/public/theme-init.js",
    "templates/extension/public/theme-init.js",
    ...(await readApplications(root)).filter((app) => app.type !== "web").map((app) => `${app.path}/public/theme-init.js`),
  ]
  // Validate every destination before writing, including independent seeds in
  // an empty composition. Never overwrite custom assets or follow links.
  for (const path of paths) {
    let current = root
    const parts = path.split("/")
    for (const [index, part] of parts.entries()) {
      current = join(current, part)
      try {
        const stat = await lstat(current)
        if (stat.isSymbolicLink()) throw new Error(`Refusing a symbolic link in a theme asset path: ${current}`)
        if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`Expected a theme asset directory: ${current}`)
        if (
          index === parts.length - 1 &&
          (!stat.isFile() || !(await readFile(current, "utf8")).startsWith("// browser-client theme bootstrap."))
        )
          throw new Error(`Refusing to overwrite an existing application asset: ${current}`)
      } catch (caught) {
        if (toError(caught).code !== "ENOENT") throw caught
      }
    }
  }
  for (const path of paths) {
    await mkdir(join(root, path, ".."), { recursive: true })
    await writeFile(join(root, path), source)
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncThemeAssets(fileURLToPath(new URL("../", import.meta.url)))
  console.log("Admin / Extension instances and template theme bootstrap scripts synchronized.")
}
