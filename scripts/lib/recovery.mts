import assert from "node:assert/strict"
import { readFile, lstat, rm, mkdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import { recoverPromotion, exists, writeAtomicJson, type PromotionJournal } from "./workspace.mts"
import { inspectCommandScope, createCommandScope, releaseRetainedCommandScope } from "./command-scopes.mts"
import { createCommandRunner, handleCancellation } from "./commands.mts"

function processOrGroupExists(pid: number, group: boolean) {
  assert(Number.isSafeInteger(pid) && pid > 1, "Invalid recovery process identifier")
  try {
    process.kill(group && process.platform !== "win32" ? -pid : pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false
    throw error
  }
}
export async function recoverMaintenance(
  root: string,
  id: string,
  apply: boolean,
  hooks: { boundary?: (name: string) => void | Promise<void> } = {},
) {
  assert(/^[a-z0-9-]{1,100}$/.test(id), "Invalid recovery identifier")
  const state = join(root, ".reinit"),
    lock = join(state, "lock"),
    backup = join(state, "backups", id)
  for (const path of [state, lock]) assert(!(await lstat(path)).isSymbolicLink(), "Recovery paths must not be symbolic links")
  const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"))
  assert.equal(owner.id, id, "Recovery identifier does not match the maintenance lock")
  assert.equal(owner.stage, join(state, "staging", id), "Unexpected recovery staging path")
  assert.equal(owner.backup, backup, "Unexpected recovery backup path")
  const hasJournal = await exists(join(backup, "journal.json"))
  if (hasJournal) {
    for (const path of [join(state, "backups"), backup])
      assert(!(await lstat(path)).isSymbolicLink(), "Recovery backup must not be a symbolic link")
    const journal: PromotionJournal = JSON.parse(await readFile(join(backup, "journal.json"), "utf8"))
    assert.equal(resolve(journal.root), resolve(root), "Recovery journal belongs to another project")
    assert.equal(journal.stage, owner.stage, "Recovery staging path differs from its lock")
  }
  console.log(JSON.stringify({ operation: "recover", id, backup: hasJournal ? backup : null, apply }, null, 2))
  if (!apply) return
  assert(!processOrGroupExists(owner.pid, false), "The maintenance owner is still running")
  if (owner.processesStopped !== true) {
    assert(typeof owner.scope === "string", "Process ownership cannot be established; preserve the lock for manual inspection")
    for (const record of inspectCommandScope(owner.scope)) {
      assert(record.state !== "starting", "A child process registration is unresolved; preserve the recovery state")
      if (record.pid !== null && record.pid !== owner.pid)
        assert(!processOrGroupExists(record.pid, true), "An owned process group is still running; stop it before recovery")
    }
  }
  await hooks.boundary?.("before-claim")
  const generation = owner.recoveryGeneration === undefined ? "initial" : owner.recoveryGeneration
  assert(typeof generation === "string" && /^[a-z0-9-]{1,80}$/.test(generation), "Invalid recovery owner generation")
  const claim = join(lock, `recovery-${generation}`)
  try {
    await mkdir(claim, { mode: 0o700 })
  } catch (error) {
    throw new Error(`Recovery owner generation is already claimed or cannot be acquired; inspect ${claim} before retrying`, {
      cause: error,
    })
  }
  assert.deepEqual(
    JSON.parse(await readFile(join(lock, "owner.json"), "utf8")),
    owner,
    "Recovery owner changed before its claim was acquired",
  )
  const scope = createCommandScope()
  scope.attach(process.pid)
  scope.retain()
  const recoveryOwner = {
    ...owner,
    pid: process.pid,
    scope: scope.path,
    operation: "recovery",
    processesStopped: false,
    recoveryGeneration: randomUUID(),
  }
  await writeAtomicJson(join(lock, "owner.json"), recoveryOwner)
  const runner = createCommandRunner({ cwd: root, timeoutMs: 600_000, env: scope.env })
  const dispose = handleCancellation(runner)
  let success = false
  let failure: unknown
  try {
    if (hasJournal) await recoverPromotion(backup, root)
    await runner.run("pnpm", ["check"])
    success = true
  } catch (error) {
    failure = error
  } finally {
    try {
      await runner.close()
      await writeAtomicJson(join(lock, "owner.json"), { ...recoveryOwner, processesStopped: true })
    } catch (error) {
      success = false
      failure ??= error
    } finally {
      dispose()
      if (success) {
        if (typeof owner.scope === "string" && (await exists(owner.scope))) releaseRetainedCommandScope(owner.scope)
        scope.settle()
        await rm(lock, { recursive: true })
      }
    }
  }
  if (failure) throw failure
  console.log("Recovery checks passed; the maintenance lock was released. Diagnostics and candidates were retained.")
}
