interface CleanupMetadata {
  state?: string
  root?: string
  stage?: string
  status?: string
  runDir?: string
}
interface CleanupRecord {
  id: string
  path: string
  marker: string
  digest?: string
  metadata?: CleanupMetadata
  time: number
}
export interface CleanupOptions {
  keep?: number
  days?: number
  lockOwner?: string
  sizes?: boolean
  signal?: AbortSignal
  apply?: boolean
}
export interface CleanupPlan {
  candidates: (CleanupRecord & { kind: string })[]
  protected: { path: string; reason: string }[]
  usage?: Awaited<ReturnType<typeof summarizeMaintenance>>
}
import { toError } from "./lib/contracts.mts"
import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { exists } from "./lib/workspace.mts"
import { handleCancellation } from "./lib/commands.mts"
import { formatBytes, summarizeMaintenance } from "./lib/maintenance-report.mts"

const help =
  "Usage: pnpm reinit:clean [--keep=3] [--days=7] [--sizes] [--dry-run|--apply]\nPreview only by default; keeps the latest N records per category and directories from the last N days. Failed, unknown or active workspaces are protected; browser reports and logs are retained. --sizes scans logical file sizes without following symbolic links."
const digest = (value: string) => createHash("sha256").update(value).digest("hex")

export function parseCleanupArgs(args: string[]) {
  const options = { keep: 3, days: 7, apply: false, help: false, sizes: false }
  if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("--apply and --dry-run cannot be used together")
  for (const arg of args) {
    if (arg === "--apply") options.apply = true
    else if (arg === "--dry-run") options.apply = false
    else if (arg === "--help") options.help = true
    else if (arg === "--sizes") options.sizes = true
    else {
      const match = /^--(keep|days)=(\d+)$/.exec(arg)
      if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error(`Unknown or invalid option: ${arg}`)
      options[match[1] as "keep" | "days"] = Number(match[2])
    }
  }
  if (options.keep < 1) throw new Error("Keep at least 1 recent record")
  return options
}

async function directory(path: string) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isDirectory() || (await realpath(path)) !== resolve(path))
    throw new Error(`Cleanup target must be a real directory inside the project: ${path}`)
  return stat
}

async function records(state: string, group: string, filename: string) {
  const base = join(state, group)
  if (!(await exists(base))) return []
  await directory(base)
  const result: CleanupRecord[] = []
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(base, entry.name)
    const stat = await directory(path)
    const marker = join(path, filename)
    let content: string | undefined, metadata: CleanupMetadata | undefined
    try {
      content = await readFile(marker, "utf8")
      metadata = JSON.parse(content)
    } catch {
      /* Unknown records are protected. */
    }
    result.push({
      id: entry.name,
      path,
      marker,
      digest: content === undefined ? undefined : digest(content),
      metadata,
      time: stat.mtimeMs,
    })
  }
  return result.sort((a, b) => b.time - a.time || b.id.localeCompare(a.id))
}

export async function planCleanup(
  root: string,
  { keep = 3, days = 7, lockOwner, sizes = false, signal }: CleanupOptions = {},
): Promise<CleanupPlan> {
  const state = join(root, ".reinit")
  if (!(await exists(state))) return { candidates: [], protected: [] }
  await directory(state)
  const lock = join(state, "lock")
  if (await exists(lock)) {
    const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8").catch(() => "null"))
    if (!lockOwner || owner?.id !== lockOwner || owner.operation !== "cleanup")
      throw new Error("Maintenance lock exists; cleanup refused. Confirm reinit, cleanup or recovery has finished first.")
  }
  const plan: CleanupPlan = { candidates: [], protected: [] }
  const cutoff = Date.now() - days * 86_400_000
  const backups = await records(state, "backups", "journal.json")
  const successful = backups.filter(
    (record) =>
      record.metadata?.state === "complete" &&
      record.metadata.root === root &&
      record.metadata.stage === join(state, "staging", record.id),
  )
  const retained = new Set(successful.slice(0, keep).map((record) => record.id))
  for (const record of backups) {
    if (!successful.includes(record) || retained.has(record.id) || record.time > cutoff) {
      plan.protected.push({ path: record.path, reason: "Recent, failed or unknown backup" })
      continue
    }
    const stage = join(state, "staging", record.id)
    if (await exists(stage)) {
      await directory(stage)
      plan.candidates.push({ ...record, path: stage, kind: "staging" })
    }
    plan.candidates.push({ ...record, kind: "backup" })
  }
  const verification = await records(state, "verification", "report.json")
  const passed = verification.filter((record) => record.metadata?.status === "passed" && record.metadata.runDir === record.path)
  const recent = new Set(passed.slice(0, keep).map((record) => record.id))
  for (const record of verification) {
    if (!passed.includes(record) || recent.has(record.id) || record.time > cutoff) {
      plan.protected.push({ path: record.path, reason: "Recent, failed or unknown verification" })
      continue
    }
    for (const child of ["workspace", "profile-dev", "profile-production"]) {
      const path = join(record.path, child)
      if (await exists(path)) {
        await directory(path)
        plan.candidates.push({ ...record, path, kind: "verification" })
      }
    }
  }
  if (sizes) plan.usage = await summarizeMaintenance(state, plan.candidates, { signal })
  return plan
}

export async function cleanReinit(root: string, options: CleanupOptions): Promise<CleanupPlan> {
  const checkInterrupted = () => options.signal?.throwIfAborted()
  checkInterrupted()
  if (!options.apply) return planCleanup(root, options)
  const state = join(root, ".reinit")
  if (!(await exists(state))) return { candidates: [], protected: [] }
  await directory(state)
  const lock = join(state, "lock")
  const id = randomUUID()
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch (caught) {
    const error = toError(caught)
    if (error.code === "EEXIST") throw new Error("Maintenance lock exists; cleanup refused", { cause: caught })
    throw error
  }
  try {
    await writeFile(join(lock, "owner.json"), JSON.stringify({ id, pid: process.pid, operation: "cleanup" }))
    checkInterrupted()
    const plan = await planCleanup(root, { ...options, lockOwner: id })
    // Verify every marker before deleting any part of a backup or candidate.
    for (const candidate of plan.candidates) {
      checkInterrupted()
      if (digest(await readFile(candidate.marker, "utf8")) !== candidate.digest)
        throw new Error("Workspace changed after the cleanup plan was generated; stopping cleanup")
    }
    for (const candidate of plan.candidates) {
      checkInterrupted()
      await directory(candidate.path)
      checkInterrupted()
      await rm(candidate.path, { recursive: true })
    }
    checkInterrupted()
    return plan
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCleanupArgs(process.argv.slice(2))
    if (options.help) console.log(help)
    else {
      const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
      const controller = new AbortController()
      const dispose = handleCancellation({ cancel: (reason) => controller.abort(reason) }, () =>
        console.error("Cancellation requested; stopping after the current deletion and releasing the maintenance lock."),
      )
      let plan
      try {
        plan = await cleanReinit(root, { ...options, signal: controller.signal })
      } finally {
        dispose()
      }
      console.log(
        `${options.apply ? "Removed" : "Will remove"} ${plan.candidates.length} directories; protecting ${plan.protected.length} records.`,
      )
      for (const candidate of plan.candidates) console.log(`${candidate.kind}: ${candidate.path}`)
      if (plan.usage) {
        const { totalBytes, eligibleBytes, retainedBytes, categories } = plan.usage
        console.log(
          `Logical data before cleanup: ${formatBytes(totalBytes)}; eligible: ${formatBytes(eligibleBytes)}; retained: ${formatBytes(retainedBytes)}.`,
        )
        for (const [name, bytes] of Object.entries(categories)) console.log(`${name}: ${formatBytes(bytes)}`)
        console.log("Logical sizes are estimates; hard links and shared filesystem blocks can reduce actual space reclaimed.")
      }
      if (!options.apply) console.log("Preview complete; no files deleted. Review the plan, then add --apply to proceed.")
    }
  } catch (caught) {
    const error = toError(caught)
    console.error(error.message)
    process.exitCode = 1
  }
}
