import { toError } from "./contracts.mts"
import { createHash, randomUUID } from "node:crypto"
import { cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

// Paths are relative to the repository (or an individual workspace) root.
// Generated names inside business trees such as public/dist are source data.
export function ignored(path: string) {
  const parts = path.split(/[\\/]/).filter((part) => part && part !== ".")
  const boundary = parts.length === 1 || (parts.length === 3 && ["apps", "packages"].includes(parts[0]))
  const name = parts.at(-1) ?? ""
  return (
    boundary &&
    (["node_modules", ".git", ".next", "dist", "dist-dev", ".turbo", ".reinit", ".DS_Store"].includes(name) ||
      name.endsWith(".tsbuildinfo"))
  )
}
export const managed = (name: string) =>
  [
    "package.json",
    "app-identity.json",
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

export async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (caught) {
    const error = toError(caught)
    if (error.code === "ENOENT") return false
    throw error
  }
}

export async function ensureRealDirectory(path: string, mode = 0o700) {
  try {
    await mkdir(path, { mode })
  } catch (error) {
    if (toError(error).code !== "EEXIST") throw error
  }
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Maintenance path must be a real directory: ${path}`)
}

export async function copySource(from: string, to: string, { root = from } = {}) {
  await cp(from, to, {
    recursive: true,
    filter: async (source) => {
      if (ignored(relative(root, source))) return false
      if ((await lstat(source)).isSymbolicLink()) throw new Error(`Refusing to migrate a symbolic link: ${source}`)
      return true
    },
  })
}

export async function preserveApp(from: string, to: string) {
  for (const entry of await readdir(from)) {
    if (ignored(entry) || managed(entry)) continue
    // Replace whole source/public trees so removed upstream demo files stay removed.
    await rm(join(to, entry), { force: true, recursive: true })
    await copySource(join(from, entry), join(to, entry), { root: from })
  }
}

export async function fingerprint(root: string) {
  const hash = createHash("sha256")
  hash.update("browser-client-source-tree-v3\n")
  async function visit(path: string, relative = "") {
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

export interface PathSnapshot {
  hash: string
  device: number
  inode: number
}
export interface PromotionStep {
  path: string
  original: PathSnapshot | null
  candidate: PathSnapshot
  validationWrites: string[]
}
export interface PromotionJournal {
  schemaVersion: 2
  state: string
  root: string
  stage: string
  paths: string[]
  steps: PromotionStep[]
}
async function pathSnapshot(
  root: string,
  path: string,
  validationWrites: readonly string[] = [],
): Promise<PathSnapshot | null> {
  const absolute = join(root, path)
  if (!(await exists(absolute))) return null
  const stat = await lstat(absolute)
  if (stat.isSymbolicLink()) throw new Error(`Refusing a symbolic promotion path: ${path}`)
  const hash = createHash("sha256")
  // Installed dependencies are generated and can legitimately be relinked by
  // the final frozen install. Their directory identity is still checked.
  if (path === "node_modules") {
    if (!stat.isDirectory()) throw new Error("Installed dependency path must be a directory")
    hash.update(`${stat.dev}:${stat.ino}`)
  } else {
    async function visit(file: string, logical: string) {
      if (validationWrites.includes(logical)) return
      const info = await lstat(file)
      if (info.isSymbolicLink()) throw new Error(`Refusing a symbolic promotion entry: ${logical}`)
      const type = info.isDirectory() ? "directory" : info.isFile() ? "file" : undefined
      if (!type) throw new Error(`Unsupported promotion entry: ${logical}`)
      const content =
        type === "file"
          ? createHash("sha256")
              .update(await readFile(file))
              .digest("hex")
          : null
      hash.update(JSON.stringify([logical, type, info.mode, content]) + "\n")
      if (info.isDirectory())
        for (const name of (await readdir(file)).sort()) {
          const child = `${logical}/${name}`
          if (!ignored(child)) await visit(join(file, name), child)
        }
    }
    await visit(absolute, path)
  }
  return { hash: hash.digest("hex"), device: stat.dev, inode: stat.ino }
}
export async function writeAtomicJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" })
  await rename(temporary, path)
}
async function saveJournal(backup: string, journal: PromotionJournal) {
  await writeAtomicJson(join(backup, "journal.json"), journal)
}
const sameContent = (left: PathSnapshot | null, right: PathSnapshot | null) =>
  left === null || right === null ? left === right : left.hash === right.hash
const sameIdentity = (left: PathSnapshot | null, right: PathSnapshot | null) =>
  left !== null && right !== null && left.device === right.device && left.inode === right.inode

// Reconcile observed paths with the write-ahead plan, rather than trusting a
// completion flag that may not have been persisted after an atomic rename.
export async function recoverPromotion(
  backup: string,
  expectedRoot?: string,
  boundary?: (name: string, path: string) => void | Promise<void>,
) {
  const journal: PromotionJournal = JSON.parse(await readFile(join(backup, "journal.json"), "utf8"))
  if (journal.schemaVersion !== 2 || !Array.isArray(journal.steps))
    throw new Error("Unsupported recovery journal; preserve it for manual inspection")
  if (
    !["preparing", "promoting", "validating", "rolling-back", "recovery-required", "rolled-back", "complete"].includes(
      journal.state,
    )
  )
    throw new Error("Unknown recovery journal state")
  if (expectedRoot && resolve(journal.root) !== resolve(expectedRoot))
    throw new Error("Recovery journal belongs to another workspace")
  if (
    new Set(journal.steps.map((step) => step.path)).size !== journal.steps.length ||
    JSON.stringify(journal.paths) !== JSON.stringify(journal.steps.map((step) => step.path))
  )
    throw new Error("Invalid recovery step list")
  if (journal.state === "complete" || journal.state === "rolled-back") return journal.state
  const invalid = (message: string) => Object.assign(new Error(message), { unsafeToRestore: true })
  for (const step of journal.steps) {
    if (!step.path || step.path.startsWith("/") || step.path.split(/[\\/]/).some((part) => ["..", ".", ""].includes(part)))
      throw invalid("Invalid recovery path")
    const live = await pathSnapshot(journal.root, step.path, step.validationWrites)
    const saved = await pathSnapshot(backup, step.path)
    const originalLive = await pathSnapshot(journal.root, step.path)
    if (sameContent(originalLive, step.original)) continue
    if (
      step.path !== "node_modules" &&
      live !== null &&
      (!sameContent(live, step.candidate) || !sameIdentity(live, step.candidate))
    )
      throw invalid(`Recovery conflict at ${step.path}; current files and backup were preserved`)
    if (!sameContent(saved, step.original)) throw invalid(`Original backup is missing or changed: ${step.path}`)
  }
  await ensureRealDirectory(join(backup, "failed-replacement"))
  journal.state = "rolling-back"
  await saveJournal(backup, journal)
  for (const step of [...journal.steps].reverse()) {
    if (sameContent(await pathSnapshot(journal.root, step.path), step.original)) continue
    const current = await pathSnapshot(journal.root, step.path, step.validationWrites)
    if (
      step.path !== "node_modules" &&
      current !== null &&
      (!sameContent(current, step.candidate) || !sameIdentity(current, step.candidate))
    )
      throw invalid(`Recovery conflict at ${step.path}`)
    if (!sameContent(await pathSnapshot(backup, step.path), step.original))
      throw invalid(`Original backup changed: ${step.path}`)
    if (current !== null) {
      const failed = join(backup, "failed-replacement", step.path)
      if (await exists(failed)) throw invalid(`Recovery destination is occupied: ${step.path}`)
      let parent = join(backup, "failed-replacement")
      for (const part of step.path.split("/").slice(0, -1)) {
        parent = join(parent, part)
        await ensureRealDirectory(parent)
      }
      await rename(join(journal.root, step.path), failed)
      await boundary?.("candidate-preserved", step.path)
    }
    if (step.original !== null) {
      await mkdir(join(journal.root, step.path, ".."), { recursive: true })
      await rename(join(backup, step.path), join(journal.root, step.path))
      await boundary?.("original-restored", step.path)
    }
    await saveJournal(backup, journal)
  }
  journal.state = "rolled-back"
  await saveJournal(backup, journal)
  return journal.state
}

export async function promote({
  root,
  stage,
  backup,
  paths,
  validate,
  checkInterrupted = () => {},
  validationWrites = [],
  boundary,
  expectedFingerprint,
  expectedCandidateFingerprint,
}: {
  root: string
  stage: string
  backup: string
  paths: string[]
  validate: () => Promise<unknown>
  checkInterrupted?: () => void
  validationWrites?: string[]
  boundary?: (name: string, path: string) => void | Promise<void>
  expectedFingerprint?: string
  expectedCandidateFingerprint?: string
}) {
  if (expectedFingerprint && (await fingerprint(root)) !== expectedFingerprint)
    throw new Error("Workspace changed before promotion")
  await mkdir(backup, { recursive: true, mode: 0o700 })
  const journal: PromotionJournal = { schemaVersion: 2, state: "preparing", root, stage, paths, steps: [] }
  // Persist the full plan before the first move. Missing candidates fail while
  // the entire original workspace is still in place.
  for (const path of paths) {
    if (!path || path.startsWith("/") || path.split(/[\\/]/).some((part) => ["..", ".", ""].includes(part)))
      throw new Error("Invalid promotion path")
    const candidate = await pathSnapshot(stage, path, validationWrites)
    if (!candidate) throw Object.assign(new Error(`ENOENT: Candidate is missing: ${path}`), { code: "ENOENT" })
    journal.steps.push({ path, original: await pathSnapshot(root, path), candidate, validationWrites })
  }
  if (
    paths.some((path, index) =>
      paths.some((other, second) => index !== second && (path === other || path.startsWith(other + "/"))),
    )
  )
    throw new Error("Promotion paths must not overlap")
  if (expectedFingerprint && (await fingerprint(root)) !== expectedFingerprint)
    throw new Error("Workspace changed while preparing promotion")
  await saveJournal(backup, journal)
  let moved = false
  try {
    journal.state = "promoting"
    await saveJournal(backup, journal)
    for (const step of journal.steps) {
      checkInterrupted()
      if (!sameContent(await pathSnapshot(root, step.path), step.original))
        throw new Error(`Source changed before moving ${step.path}`)
      if (step.original !== null) {
        await mkdir(join(backup, step.path, ".."), { recursive: true })
        await rename(join(root, step.path), join(backup, step.path))
        moved = true
        await boundary?.("original-moved", step.path)
      }
      await rename(join(stage, step.path), join(root, step.path))
      moved = true
      await boundary?.("candidate-moved", step.path)
      await saveJournal(backup, journal)
    }
    checkInterrupted()
    journal.state = "validating"
    await saveJournal(backup, journal)
    await validate()
    checkInterrupted()
    for (const step of journal.steps)
      if (step.path !== "node_modules" && !sameContent(await pathSnapshot(root, step.path, validationWrites), step.candidate))
        throw Object.assign(new Error(`Source changed during final validation: ${step.path}; preserving recovery state`), {
          unsafeToRestore: true,
        })
    for (const step of journal.steps)
      if (!sameContent(await pathSnapshot(backup, step.path), step.original))
        throw Object.assign(new Error(`Original backup changed during validation: ${step.path}`), { unsafeToRestore: true })
    if (expectedCandidateFingerprint && (await fingerprint(root)) !== expectedCandidateFingerprint)
      throw new Error(
        "Workspace changed outside the replacement paths during final validation; preserving edits and restoring original paths",
      )
    checkInterrupted()
    journal.state = "complete"
    await saveJournal(backup, journal)
  } catch (caught) {
    const error = toError(caught)
    if (!moved) {
      journal.state = "rolled-back"
      await saveJournal(backup, journal)
      throw error
    }
    if (error.unsafeToRestore) {
      journal.state = "recovery-required"
      await saveJournal(backup, journal)
      throw error
    }
    try {
      await recoverPromotion(backup, root)
    } catch (recoveryError) {
      journal.state = "recovery-required"
      await saveJournal(backup, journal)
      throw Object.assign(new AggregateError([error, recoveryError], "Recovery is incomplete; preserve the lock and journal"), {
        unsafeToRestore: true,
      })
    }
    throw error
  }
}
