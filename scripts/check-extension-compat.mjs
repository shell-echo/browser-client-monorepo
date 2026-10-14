import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import semver from "semver"

export function assertCompatible(vite, crx) {
  const range = crx.peerDependencies?.vite
  assert(range && semver.satisfies(vite.version, range),
    `CRXJS ${crx.version} 不支持 Vite ${vite.version}（要求 ${range ?? "未知"}）。请先更新 CRXJS 接入，reinit 不会替换原应用。`)
}

export async function checkCompatibility(root) {
  const require = createRequire(resolve(root, "apps/extension/package.json"))
  const read = async (name) => JSON.parse(await readFile(require.resolve(`${name}/package.json`), "utf8"))
  const [vite, crx] = await Promise.all([read("vite"), read("@crxjs/vite-plugin")])
  assertCompatible(vite, crx)
  console.log(`扩展兼容性检查通过：Vite ${vite.version} / CRXJS ${crx.version}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkCompatibility(fileURLToPath(new URL("../", import.meta.url)))
}
