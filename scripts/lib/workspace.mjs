import { createHash } from "node:crypto"
import { cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"

// Paths are relative to the repository (or an individual workspace) root.
// Generated names inside business trees such as public/dist are source data.
export function ignored(path) {
  const parts = path.split(/[\\/]/).filter((part) => part && part !== ".")
  const boundary = parts.length === 1 || (parts.length === 3 && ["apps", "packages"].includes(parts[0]))
  const name = parts.at(-1) ?? ""
  return (
    boundary &&
    (["node_modules", ".git", ".next", "dist", "dist-dev", ".turbo", ".reinit", ".DS_Store"].includes(name) ||
      name.endsWith(".tsbuildinfo"))
  )
}
export const managed = (name) =>
  [
    "package.json",
    "components.json",
    "next-env.d.ts",
    "README.md",
    ".gitignore",
    ".oxlintrc.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
  ].includes(name) || /^(tsconfig.*\.json|(?:next|vite|eslint|postcss)\.config\.[cm]?[jt]s)$/.test(name)

export async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
}

export async function copySource(from, to, { root = from } = {}) {
  await cp(from, to, {
    recursive: true,
    filter: async (source) => {
      if (ignored(relative(root, source))) return false
      if ((await lstat(source)).isSymbolicLink()) throw new Error(`Refusing to migrate a symbolic link: ${source}`)
      return true
    },
  })
}

export async function preserveApp(from, to) {
  for (const entry of await readdir(from)) {
    if (ignored(entry) || managed(entry)) continue
    // Replace whole source/public trees so removed upstream demo files stay removed.
    await rm(join(to, entry), { force: true, recursive: true })
    await copySource(join(from, entry), join(to, entry), { root: from })
  }
}

export async function fingerprint(root) {
  const hash = createHash("sha256")
  hash.update("browser-client-source-tree-v3\n")
  async function visit(path, relative = "") {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`Refusing to migrate a symbolic link: ${path}`)
    // Hash file bytes separately, so content cannot impersonate the next
    // path/mode record. JSON lines also preserve filename and type boundaries.
    const type = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : undefined
    if (!type) throw new Error(`Unsupported file type: ${path}`)
    const content =
      type === "file"
        ? createHash("sha256")
            .update(await readFile(path))
            .digest("hex")
        : null
    hash.update(JSON.stringify([relative, type, stat.mode, content]) + "\n")
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        const child = `${relative}/${name}`
        if (!ignored(child)) await visit(join(path, name), child)
      }
    }
  }
  await visit(root)
  return hash.digest("hex")
}

// All replaced paths have an original backup; a failing final check restores it.
export async function promote({ root, stage, backup, paths, validate, checkInterrupted = () => {} }) {
  await mkdir(backup, { recursive: true, mode: 0o700 })
  const moved = []
  const journal = async (state) =>
    writeFile(join(backup, "journal.json"), JSON.stringify({ state, root, stage, paths, moved }, null, 2) + "\n")
  await journal("promoting")
  try {
    for (const path of paths) {
      checkInterrupted()
      const step = { path, original: false, replacement: false }
      moved.push(step)
      await journal("promoting")
      if (await exists(join(root, path))) {
        await rename(join(root, path), join(backup, path))
        step.original = true
        await journal("promoting")
      }
      await rename(join(stage, path), join(root, path))
      step.replacement = true
      await journal("promoting")
    }
    checkInterrupted()
    await validate()
    checkInterrupted()
    await journal("complete")
  } catch (error) {
    if (error.unsafeToRestore) {
      await journal("recovery-required")
      throw error
    }
    // Never delete either version while rolling back.
    const failed = join(backup, "failed-replacement")
    await mkdir(failed, { recursive: true })
    for (const step of [...moved].reverse()) {
      if (step.replacement) await rename(join(root, step.path), join(failed, step.path))
      if (step.original) await rename(join(backup, step.path), join(root, step.path))
    }
    await journal("rolled-back")
    throw error
  }
}
