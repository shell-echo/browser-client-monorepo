import type { CommandResult, GeneratorRecord, TemplateVersions } from "./contracts.mts"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ignored, managed } from "./workspace.mts"
import { targets } from "./integrate.mts"
import { readApplications } from "./apps.mts"
import { exists } from "./workspace.mts"

export async function preservedSnapshot(root: string) {
  const managedIds = (await exists(join(root, "apps.config.json")))
    ? (await readApplications(root)).map((app) => app.id)
    : targets
  const files: [string, number, string][] = []
  async function visit(path = "") {
    for (const name of (await readdir(join(root, path))).sort()) {
      const child = path ? `${path}/${name}` : name
      if (ignored(child)) continue
      const parts = child.split("/")
      if (!path && ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "template-versions.json"].includes(name)) continue
      if (parts.length === 3 && parts[0] === "apps" && managedIds.some((target) => target === parts[1]) && managed(name))
        continue
      if (parts.length === 3 && parts[0] === "packages" && name === "package.json") continue
      const stat = await lstat(join(root, child))
      assert(!stat.isSymbolicLink(), `Unexpected symbolic link in source: ${child}`)
      if (stat.isDirectory()) await visit(child)
      else {
        assert(stat.isFile(), `Unsupported preserved file: ${child}`)
        files.push([
          child,
          stat.mode,
          createHash("sha256")
            .update(await readFile(join(root, child)))
            .digest("hex"),
        ])
      }
    }
  }
  await visit()
  return files
}

export async function seedReinitAcceptance(workspace: string) {
  const apps = (await exists(join(workspace, "apps.config.json")))
    ? await readApplications(workspace)
    : targets.map((id) => ({ id, type: id, path: `apps/${id}` }))
  // These untracked probes do not depend on starter routes, titles or modules.
  for (const path of [
    ...apps.flatMap((app) =>
      app.type === "admin"
        ? [`${app.path}/src/dist/reinit-business.txt`, `${app.path}/.env.reinit-verification`]
        : [`${app.path}/public/${app.type === "web" ? "dist/" : ""}reinit-business.txt`],
    ),
    "packages/ui/src/reinit-business.txt",
  ]) {
    await mkdir(join(workspace, path, ".."), { recursive: true })
    await writeFile(join(workspace, path), "REINIT_PRESERVATION_PROBE=business-source\n", { mode: 0o600, flag: "wx" })
  }
}

export function dependencyVersions(records: { dependencies?: { entries?: { id: string; version: string }[] } }) {
  return (records.dependencies?.entries ?? [])
    .map(({ id, version }): [string, string] => [id, version])
    .sort(([a], [b]) => a.localeCompare(b))
}

export function generatorVersions(
  records: TemplateVersions | Partial<Record<"web" | "admin" | "extension", Partial<GeneratorRecord>>>,
) {
  if ("applications" in records && records.applications)
    return Object.entries(records.applications)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, record]) => [name, record.generator, record.version])
  return (["web", "admin", "extension"] as const).map((name) => [name, records[name]?.generator, records[name]?.version])
}

export function assertEslintFloorRejection(result: Pick<CommandResult, "code"> & Partial<CommandResult>, log: string) {
  assert(!result.error && !result.reason, "Rejection test failed to execute normally")
  assert.equal(result.code, 1, "Invalid offline ESLint receipt was not rejected")
  // The help text also mentions ESLint 10; it cannot prove the rejection cause.
  assert.match(log, /Project minimum version policy requires eslint >=10\.0\.0, actual version is 9\.39\.0/)
}
