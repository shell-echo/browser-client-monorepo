#!/usr/bin/env node
import { randomUUID } from "node:crypto"
import { mkdir, readdir, lstat, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { integrate, readJson, writeJson, targets } from "./lib/integrate.mjs"
import { copySource, exists, fingerprint, ignored, preserveApp, promote } from "./lib/workspace.mjs"
import { createCommandRunner, handleCancellation, positiveTimeout } from "./lib/commands.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const help = `用法：pnpm reinit [all|web|admin|extension] [--dry-run|--apply] [--offline]

默认只显示计划，不联网、不写文件。--apply 才开始重建。
使用官方 latest 脚手架，在隔离目录生成并通过完整检查后替换。
保留应用源码、public、环境文件、业务依赖和 packages/。
重建框架配置及标准脚本；原始目录与锁文件保存到 .reinit/backups/。
执行前请停止开发/构建进程，并暂停编辑此项目。
--offline 使用 template-versions.json 已记录且缓存的版本，不查询 latest。
`

export function parseArgs(args) {
  const positional = args.filter((arg) => !arg.startsWith("--"))
  for (const arg of args.filter((arg) => arg.startsWith("--"))) {
    if (!["--apply", "--dry-run", "--help", "--offline"].includes(arg)) throw new Error(`未知选项：${arg}`)
  }
  if (positional.length > 1 || (positional[0] && !["all", ...targets].includes(positional[0]))) throw new Error("目标必须为 all、web、admin 或 extension")
  if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("--apply 与 --dry-run 不能同时使用")
  return { selected: !positional[0] || positional[0] === "all" ? targets : positional, apply: args.includes("--apply"), help: args.includes("--help"), offline: args.includes("--offline") }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) { console.log(help); return }
  const pkg = await readJson(join(root, "package.json"))
  if (pkg.name !== "browser-client") throw new Error("项目根目录标识不匹配")
  console.log(`项目：${root}\n重建：${options.selected.join(", ")}\n${help}`)
  if (!options.apply) return
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("请使用 Node.js 24 LTS")

  const commandTimeout = positiveTimeout(process.env.REINIT_COMMAND_TIMEOUT_MS, 600_000, "REINIT_COMMAND_TIMEOUT_MS")
  const runner = createCommandRunner({ timeoutMs: commandTimeout, env: {
    CI: "1", NEXT_TELEMETRY_DISABLED: "1", TURBO_TELEMETRY_DISABLED: "1", pnpm_config_update_notifier: "false",
    pnpm_config_fetch_retries: process.env.pnpm_config_fetch_retries ?? "0",
    pnpm_config_fetch_timeout: process.env.pnpm_config_fetch_timeout ?? "30000",
    ...(options.offline ? { pnpm_config_offline: "true" } : {}),
  } })
  const state = join(root, ".reinit")
  if (await exists(state) && (await lstat(state)).isSymbolicLink()) throw new Error(".reinit 不允许是符号链接")
  await mkdir(state, { recursive: true, mode: 0o700 })
  const lock = join(state, "lock")
  try { await mkdir(lock) } catch (error) {
    if (error.code === "EEXIST") throw new Error("已有 reinit 锁。先检查 .reinit/lock/owner.json 和相关进程；若曾被强制中断，检查备份 journal 后再手工解除锁。")
    throw error
  }
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`
  const stage = join(state, "staging", id)
  const backup = join(state, "backups", id)
  let leaveLock = false
  const removeSignalHandlers = handleCancellation(runner, () => console.error("已请求取消；正在停止当前命令及子进程，退出后恢复现场。"))
  const checkInterrupted = runner.check
  const run = (args, cwd, capture = false) => {
    // npm_execpath pins the active pnpm implementation; PATH is the fallback for node scripts/reinit.mjs.
    const pnpm = process.env.npm_execpath
    const command = pnpm ? process.execPath : "pnpm"
    const commandArgs = pnpm ? [pnpm, ...args] : args
    return runner.run(command, commandArgs, { cwd, capture })
  }

  try {
    await writeJson(join(lock, "owner.json"), { pid: process.pid, operation: "reinit", id, stage, backup })
    const baseline = await fingerprint(root)
    await mkdir(stage, { recursive: true, mode: 0o700 })
    // A real repository boundary prevents parent .gitignore from hiding the
    // entire staging tree from Oxlint. No commits, hooks or remotes are created.
    await runner.run("git", ["init", "--quiet", stage], { capture: true })
    for (const entry of await readdir(root)) {
      if (!ignored(entry) && entry !== "apps") await copySource(join(root, entry), join(stage, entry))
    }
    await mkdir(join(stage, "apps"))
    const versions = await exists(join(root, "template-versions.json")) ? await readJson(join(root, "template-versions.json")) : {}
    const resolved = {}
    for (const target of options.selected) {
      const generator = target === "web" ? "create-next-app" : "create-vite"
      if (options.offline) {
        const saved = versions[target]
        if (saved?.generator !== generator || !/^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(saved.version)) throw new Error(`缺少 ${target} 的官方模板版本记录，无法离线重建`)
        continue
      }
      if (!resolved[generator]) {
        resolved[generator] = JSON.parse(await run(["view", `${generator}@latest`, "version", "--json"], stage, true))
        if (!/^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(resolved[generator])) throw new Error("脚手架版本响应无效")
      }
    }
    for (const target of targets) {
      const original = join(root, "apps", target)
      if (!options.selected.includes(target)) {
        await copySource(original, join(stage, "apps", target))
        continue
      }
      const generator = target === "web" ? "create-next-app" : "create-vite"
      const version = options.offline ? versions[target].version : resolved[generator]
      console.log(`\n生成 ${target}：${generator}@${version}`)
      const flags = target === "web"
        ? ["--ts", "--eslint", "--tailwind", "--app", "--src-dir", "--import-alias", "@/*", "--use-pnpm", "--skip-install", "--disable-git", "--no-agents-md", "--no-agent-feedback", "--no-react-compiler", "--no-cache-components", "--yes"]
        : ["--template", "react-ts", "--no-interactive"]
      await run(["dlx", `${generator}@${version}`, `apps/${target}`, ...flags], stage)
      await integrate(stage, target, await readJson(join(original, "package.json")))
      await preserveApp(original, join(stage, "apps", target))
      versions[target] = { generator, version, generatedAt: new Date().toISOString() }
    }
    // Additional user workspaces under apps/ remain intact.
    for (const entry of await readdir(join(root, "apps"))) {
      if (!targets.includes(entry) && !ignored(entry)) await copySource(join(root, "apps", entry), join(stage, "apps", entry))
    }
    await writeJson(join(stage, "template-versions.json"), versions)
    await run(["install", ...(options.offline ? ["--offline"] : []), "--no-frozen-lockfile"], stage)
    await run(["check"], stage)
    if (await fingerprint(root) !== baseline) throw new Error("生成期间工作区发生变化，停止替换。原项目完整保留，请停止编辑后重试。")
    checkInterrupted()
    console.log(`\n验证通过，保存原始目录到 ${backup}`)
    try {
      await promote({ root, stage, backup, paths: ["apps", "packages", "node_modules", "pnpm-lock.yaml", "template-versions.json"], checkInterrupted,
        validate: async () => {
          await run(["install", "--offline", "--frozen-lockfile"], root)
          await run(["check"], root)
        },
      })
    } catch (error) {
      const journal = await readJson(join(backup, "journal.json")).catch(() => null)
      leaveLock = journal?.state !== "rolled-back"
      if (leaveLock) console.error(`恢复未完成，保留锁与现场。请检查 ${backup}/journal.json`)
      else console.error("最终验证失败，原始目录与依赖已恢复。")
      throw error
    }
    console.log(`\n重建完成。备份：${backup}\n脚手架版本：template-versions.json`)
  } catch (error) {
    console.error(`\n${error.message}\n诊断目录：${stage}`)
    process.exitCode = 1
  } finally {
    try { await runner.close() } catch (error) {
      leaveLock = true
      console.error(`进程退出未确认，保留锁与现场：${error.message}`)
      process.exitCode = 1
    }
    removeSignalHandlers()
    if (!leaveLock) await rm(lock, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
