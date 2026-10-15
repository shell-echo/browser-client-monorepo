import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { formatReinitFiles } from "./lib/formatting.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  formatReinitFiles(root, process.argv.length > 2 ? process.argv.slice(2) : undefined)
    .then((files) => console.log(`已统一 ${files.length} 个 reinit 生成配置的格式；业务源码保持不变。`))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
