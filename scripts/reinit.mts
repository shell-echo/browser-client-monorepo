#!/usr/bin/env node
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { readApplications, selectApplications } from "./lib/apps.mts"
import { runMaintenance } from "./lib/maintenance.mts"

const help = `Usage: pnpm reinit [all|INSTANCE] [--dry-run|--apply] [--offline]

Preview only by default, without network access or file writes.
--apply regenerates selected official framework templates in isolation.
Online mode resolves latest stable frameworks and compatible shared dependencies.
Offline mode replays recorded versions and requires cached packages and Chromium.
ESLint must remain >=10. Business source, assets, instance tests and shared UI are preserved.
All workspace checks and registered browser assertions must pass before replacement.
Stop development/build services and pause editing before applying maintenance.
`
export function parseArgs(args: string[], available = ["web", "admin", "extension"]) {
  const positional = args.filter((arg) => !arg.startsWith("--"))
  for (const flag of args.filter((arg) => arg.startsWith("--")))
    if (!["--apply", "--dry-run", "--help", "--offline"].includes(flag)) throw new Error(`Unknown option: ${flag}`)
  if (positional.length > 1 || (positional[0] && !["all", ...available].includes(positional[0])))
    throw new Error("Unknown application target")
  if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("--apply and --dry-run cannot be used together")
  return {
    selected: !positional[0] || positional[0] === "all" ? available : positional,
    apply: args.includes("--apply"),
    help: args.includes("--help"),
    offline: args.includes("--offline"),
  }
}
async function main() {
  if (process.argv.includes("--help")) {
    console.log(help)
    return
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const apps = await readApplications(root)
  const options = parseArgs(
    process.argv.slice(2),
    apps.map((app) => app.id),
  )
  selectApplications(apps, options.selected.length === 1 ? options.selected[0] : "all")
  console.log(`Project: ${root}\nRebuild: ${options.selected.join(", ") || "none"}\n${help}`)
  if (options.apply) await runMaintenance(root, { kind: "reinit", ids: options.selected }, options.offline)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
