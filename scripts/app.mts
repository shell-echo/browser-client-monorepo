#!/usr/bin/env node
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import type { AppDefinition } from "./lib/apps.mts"
import type { MaintenanceOperation } from "./lib/maintenance.mts"
import { createCommandRunner, handleCancellation } from "./lib/commands.mts"
import { exists } from "./lib/workspace.mts"
import { recoverMaintenance } from "./lib/recovery.mts"

const help = `Usage:
  pnpm app list | doctor
  pnpm app add INSTANCE --type web|admin|extension --port PORT [--apply]
  pnpm app remove INSTANCE [--apply] [--offline]
  pnpm app restore ARCHIVE [--apply] [--offline]
  pnpm app recover OPERATION [--apply]
  pnpm app dev|build|start|preview INSTANCE
  pnpm app run dev|build|lint|typecheck

Maintenance previews are read-only and do not query the network.
Add/remove/restore share reinit's isolated validation, lock and recovery.
Removal archives are protected from automatic reinit cleanup.
`
async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const [command, ...args] = process.argv.slice(2)
  if (!command || command === "--help") {
    console.log(help)
    return
  }
  if (command === "recover") {
    const ids = args.filter((arg) => !arg.startsWith("--"))
    assert.equal(ids.length, 1, "Expected one recovery identifier")
    assert(
      args.every((arg) => !arg.startsWith("--") || ["--apply", "--dry-run"].includes(arg)),
      "Unknown recovery option",
    )
    assert(!(args.includes("--apply") && args.includes("--dry-run")), "Conflicting recovery options")
    await recoverMaintenance(root, ids[0], args.includes("--apply"))
    return
  }
  // Recovery must also start while package.json or node_modules is between
  // its backup and replacement renames. Load external tooling only afterward.
  const { readApplications, selectApplications, appTypes, assertAppId } = await import("./lib/apps.mts")
  const { runMaintenance, readArchive, assertRemovable } = await import("./lib/maintenance.mts")
  const apps = await readApplications(root)
  if (command === "list" || command === "doctor") {
    assert.equal(args.length, 0, "Unexpected arguments")
    console.table(apps.map(({ id, type, port, path }) => ({ id, type, port, path })))
    console.log(`Application registry is consistent (${apps.length} managed instances).`)
    return
  }
  if (["dev", "build", "start", "preview", "preview-ui", "run"].includes(command)) {
    assert.equal(args.length, 1, "Expected one instance or task")
    const runner = createCommandRunner({ cwd: root, timeoutMs: command === "build" ? 600_000 : 0 })
    const dispose = handleCancellation(runner)
    try {
      if (command === "run") {
        assert(["dev", "build", "lint", "typecheck"].includes(args[0]), "Unknown workspace task")
        await runner.run("pnpm", ["exec", "turbo", "run", args[0]])
      } else {
        assertAppId(args[0])
        const app = selectApplications(apps, args[0])[0]
        assert(app)
        if (command === "preview-ui") assert.equal(app.type, "extension", "UI preview requires an extension instance")
        await runner.run("pnpm", ["--filter", app.packageName, command === "preview-ui" ? "preview:ui" : command])
      }
    } finally {
      await runner.close()
      dispose()
    }
    return
  }
  assert(["add", "remove", "restore"].includes(command), "Unknown application command")
  // Accept both --type=value and --type value without interpreting arbitrary
  // arguments as shell text. Values are validated before any write.
  const values = new Map<string, string>()
  const ids: string[] = []
  let apply = false,
    offline = false,
    dry = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--apply") apply = true
    else if (arg === "--dry-run") dry = true
    else if (arg === "--offline") offline = true
    else if (/^--(type|port)(=|$)/.test(arg)) {
      const equal = arg.indexOf("=")
      const name = equal === -1 ? arg : arg.slice(0, equal)
      const inline = equal === -1 ? undefined : arg.slice(equal + 1)
      assert(!values.has(name), `Duplicate option: ${name}`)
      const value = inline ?? args[++index]
      assert(value && !value.startsWith("--"), `Missing value: ${name}`)
      values.set(name, value)
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`)
    else ids.push(arg)
  }
  assert(!(apply && dry), "--apply and --dry-run cannot be combined")
  assert.equal(ids.length, 1, "Expected one application or archive identifier")
  let operation: MaintenanceOperation
  if (command === "add") {
    assertAppId(ids[0])
    const type = values.get("--type")
    assert(
      appTypes.some((entry) => entry === type),
      "Choose --type web, admin or extension",
    )
    const definition = { type, port: Number(values.get("--port")) } as AppDefinition
    assert(
      Number.isSafeInteger(definition.port) && definition.port >= 1024 && definition.port <= 65535,
      "Choose a valid --port",
    )
    assert(!apps.some((app) => app.id === ids[0] || app.port === definition.port), "Application name or port is occupied")
    assert(!(await exists(join(root, "apps", ids[0]))), "Application directory is occupied")
    operation = { kind: "add", id: ids[0], definition }
  } else {
    assert.equal(values.size, 0, "Type/port options only apply to app add")
    if (command === "remove") {
      assertAppId(ids[0])
      const app = selectApplications(apps, ids[0])[0]
      assert(app)
      await assertRemovable(root, app)
      operation = { kind: "remove", id: app.id }
    } else {
      const archive = await readArchive(root, ids[0])
      assert(
        !apps.some((app) => app.id === archive.metadata.id || app.port === archive.metadata.definition.port),
        "Restore name or port is occupied",
      )
      operation = { kind: "restore", archive: ids[0] }
    }
  }
  console.log(JSON.stringify({ operation, apply, offline }, null, 2))
  if (!apply) {
    console.log("Preview only; add --apply to run validated maintenance.")
    return
  }
  await runMaintenance(root, operation, offline)
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
