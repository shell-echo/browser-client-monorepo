import type { RegistryMetadata } from "./lib/contracts.mts"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import semver from "semver"

export function assertCompatible(vite: RegistryMetadata, crx: RegistryMetadata) {
  const range = crx.peerDependencies?.vite
  assert(
    range && semver.satisfies(vite.version, range),
    `CRXJS ${crx.version} does not support Vite ${vite.version} (requires ${range ?? "unknown"}). Update the CRXJS integration first; reinit will preserve the original app.`,
  )
}

export async function checkCompatibility(root: string) {
  const require = createRequire(resolve(root, "apps/extension/package.json"))
  const read = async (name: string): Promise<RegistryMetadata> =>
    JSON.parse(await readFile(require.resolve(`${name}/package.json`), "utf8"))
  const [vite, crx] = await Promise.all([read("vite"), read("@crxjs/vite-plugin")])
  assertCompatible(vite, crx)
  console.log(`Extension compatibility check passed: Vite ${vite.version} / CRXJS ${crx.version}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkCompatibility(fileURLToPath(new URL("../", import.meta.url)))
}
