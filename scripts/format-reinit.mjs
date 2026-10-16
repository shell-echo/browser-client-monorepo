import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { formatReinitFiles } from "./lib/formatting.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  formatReinitFiles(root, process.argv.length > 2 ? process.argv.slice(2) : undefined)
    .then((files) =>
      console.log(`Formatted ${files.length} reinit-generated configuration files; application source is unchanged.`),
    )
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
