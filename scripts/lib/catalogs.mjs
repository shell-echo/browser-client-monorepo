import { readFile } from "node:fs/promises"
import { join } from "node:path"
import semver from "semver"
import { parseDocument } from "yaml"

export async function readCatalogs(root) {
  let source
  try {
    source = await readFile(join(root, "pnpm-workspace.yaml"), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return {}
    throw error
  }
  const document = parseDocument(source)
  if (document.errors.length) throw new Error(`Cannot parse pnpm-workspace.yaml: ${document.errors[0].message}`)
  return document.toJS()
}

export function catalogRange(workspace, name, specifier) {
  const catalog = specifier.slice("catalog:".length) || "default"
  const range = (catalog === "default" ? workspace.catalog : workspace.catalogs?.[catalog])?.[name]
  if (!range || !semver.validRange(range)) throw new Error(`catalog has no valid version: ${name} (${specifier})`)
  return range
}

export function applyCatalogs(manifest, workspace, target) {
  const toolchain = target === "web" ? "next" : "vite"
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, previous] of Object.entries(manifest[field] ?? {})) {
      const specifier = Object.hasOwn(workspace.catalog ?? {}, name)
        ? "catalog:"
        : Object.hasOwn(workspace.catalogs?.[toolchain] ?? {}, name)
          ? `catalog:${toolchain}`
          : undefined
      if (!specifier) {
        if (previous.startsWith("catalog:")) catalogRange(workspace, name, previous)
        continue
      }
      const shared = catalogRange(workspace, name, specifier)
      const required = previous.startsWith("catalog:") ? catalogRange(workspace, name, previous) : previous
      // Every version allowed by project policy must satisfy the new template.
      // An intersection alone can still reuse an incompatible locked version.
      if (!semver.validRange(required) || !semver.subset(shared, required)) {
        throw new Error(
          `Shared dependency is incompatible with the template: ${name}, template ${required}, ${specifier} ${shared}. The full catalog range must satisfy template requirements; update the catalog and retry.`,
        )
      }
      manifest[field][name] = specifier
    }
  }
  return manifest
}
