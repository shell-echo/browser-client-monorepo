import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { exists } from "./lib/workspace.mjs"
import { handleCancellation } from "./lib/commands.mjs"

const help = "用法：pnpm reinit:clean [--keep=3] [--days=7] [--dry-run|--apply]\n默认只预览；保留每类最近 N 份记录和最近 N 天的目录。失败、未知和正在使用的现场不清理；浏览器报告及日志保留。"
const digest = (value) => createHash("sha256").update(value).digest("hex")

export function parseCleanupArgs(args) {
  const options = { keep: 3, days: 7, apply: false, help: false }
  if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("--apply 与 --dry-run 不能同时使用")
  for (const arg of args) {
    if (arg === "--apply") options.apply = true
    else if (arg === "--dry-run") options.apply = false
    else if (arg === "--help") options.help = true
    else {
      const match = /^--(keep|days)=(\d+)$/.exec(arg)
      if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error(`未知或无效选项：${arg}`)
      options[match[1]] = Number(match[2])
    }
  }
  if (options.keep < 1) throw new Error("至少保留最近 1 份记录")
  return options
}

async function directory(path) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(path) !== resolve(path)) throw new Error(`清理目标必须是项目内的真实目录：${path}`)
  return stat
}

async function records(state, group, filename) {
  const base = join(state, group)
  if (!await exists(base)) return []
  await directory(base)
  const result = []
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(base, entry.name)
    const stat = await directory(path)
    const marker = join(path, filename)
    let content, metadata
    try { content = await readFile(marker, "utf8"); metadata = JSON.parse(content) } catch { /* Unknown records are protected. */ }
    result.push({ id: entry.name, path, marker, digest: content === undefined ? undefined : digest(content), metadata, time: stat.mtimeMs })
  }
  return result.sort((a, b) => b.time - a.time || b.id.localeCompare(a.id))
}

export async function planCleanup(root, { keep = 3, days = 7, lockOwner } = {}) {
  const state = join(root, ".reinit")
  if (!await exists(state)) return { candidates: [], protected: [] }
  await directory(state)
  const lock = join(state, "lock")
  if (await exists(lock)) {
    const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8").catch(() => "null"))
    if (!lockOwner || owner?.id !== lockOwner || owner.operation !== "cleanup") throw new Error("已有维护锁，拒绝清理；先确认 reinit、清理或恢复已结束。")
  }
  const plan = { candidates: [], protected: [] }
  const cutoff = Date.now() - days * 86_400_000
  const backups = await records(state, "backups", "journal.json")
  const successful = backups.filter((record) => record.metadata?.state === "complete" && record.metadata.root === root && record.metadata.stage === join(state, "staging", record.id))
  const retained = new Set(successful.slice(0, keep).map((record) => record.id))
  for (const record of backups) {
    if (!successful.includes(record) || retained.has(record.id) || record.time > cutoff) {
      plan.protected.push({ path: record.path, reason: "近期、失败或未知备份" })
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
      plan.protected.push({ path: record.path, reason: "近期、失败或未知验证" })
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
  return plan
}

export async function cleanReinit(root, options) {
  const checkInterrupted = () => options.signal?.throwIfAborted()
  checkInterrupted()
  if (!options.apply) return planCleanup(root, options)
  const state = join(root, ".reinit")
  if (!await exists(state)) return { candidates: [], protected: [] }
  await directory(state)
  const lock = join(state, "lock")
  const id = randomUUID()
  try { await mkdir(lock, { mode: 0o700 }) } catch (error) {
    if (error.code === "EEXIST") throw new Error("已有维护锁，拒绝清理", { cause: error })
    throw error
  }
  try {
    await writeFile(join(lock, "owner.json"), JSON.stringify({ id, pid: process.pid, operation: "cleanup" }))
    checkInterrupted()
    const plan = await planCleanup(root, { ...options, lockOwner: id })
    // Verify every marker before deleting any part of a backup or candidate.
    for (const candidate of plan.candidates) {
      checkInterrupted()
      if (digest(await readFile(candidate.marker, "utf8")) !== candidate.digest) throw new Error("清理计划生成后现场发生变化，停止清理")
    }
    for (const candidate of plan.candidates) {
      checkInterrupted()
      await directory(candidate.path)
      checkInterrupted()
      await rm(candidate.path, { recursive: true })
    }
    checkInterrupted()
    return plan
  } finally { await rm(lock, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCleanupArgs(process.argv.slice(2))
    if (options.help) console.log(help)
    else {
      const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
      const controller = new AbortController()
      const dispose = handleCancellation({ cancel: (reason) => controller.abort(reason) }, () => console.error("已请求取消；完成当前删除后停止清理并释放维护锁。"))
      let plan
      try { plan = await cleanReinit(root, { ...options, signal: controller.signal }) }
      finally { dispose() }
      console.log(`${options.apply ? "已清理" : "待清理"} ${plan.candidates.length} 个目录；保护 ${plan.protected.length} 份记录。`)
      for (const candidate of plan.candidates) console.log(`${candidate.kind}: ${candidate.path}`)
      if (!options.apply) console.log("预览完成，未删除文件。确认计划后追加 --apply。")
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
