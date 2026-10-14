import { createHash } from "node:crypto"
import { cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

export const ignored = (name) => ["node_modules", ".git", ".next", "dist", "dist-dev", ".turbo", ".reinit", ".DS_Store"].includes(name) || name.endsWith(".tsbuildinfo")
export const managed = (name) => ["package.json", "components.json", "next-env.d.ts", "README.md", ".gitignore", ".oxlintrc.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"].includes(name) || /^(tsconfig.*\.json|(?:next|vite|eslint|postcss)\.config\.[cm]?[jt]s)$/.test(name)

export async function exists(path) {
  try { await lstat(path); return true } catch (error) { if (error.code === "ENOENT") return false; throw error }
}

export async function copySource(from, to) {
  await cp(from, to, {
    recursive: true,
    filter: async (source) => {
      if (ignored(basename(source))) return false
      if ((await lstat(source)).isSymbolicLink()) throw new Error(`拒绝迁移符号链接：${source}`)
      return true
    },
  })
}

export async function preserveApp(from, to) {
  for (const entry of await readdir(from)) {
    if (ignored(entry) || managed(entry)) continue
    // Replace whole source/public trees so removed upstream demo files stay removed.
    await rm(join(to, entry), { force: true, recursive: true })
    await copySource(join(from, entry), join(to, entry))
  }
}

export async function fingerprint(root) {
  const hash = createHash("sha256")
  async function visit(path, relative = "") {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`拒绝迁移符号链接：${path}`)
    hash.update(JSON.stringify([relative, stat.mode]))
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        if (!ignored(name)) await visit(join(path, name), `${relative}/${name}`)
      }
    } else if (stat.isFile()) hash.update(await readFile(path))
    else throw new Error(`不支持的文件类型：${path}`)
  }
  await visit(root)
  return hash.digest("hex")
}

// All replaced paths have an original backup; a failing final check restores it.
export async function promote({ root, stage, backup, paths, validate, checkInterrupted = () => {} }) {
  await mkdir(backup, { recursive: true, mode: 0o700 })
  const moved = []
  const journal = async (state) => writeFile(join(backup, "journal.json"), JSON.stringify({ state, root, stage, paths, moved }, null, 2) + "\n")
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
