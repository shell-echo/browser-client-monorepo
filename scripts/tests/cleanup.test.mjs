import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink, utimes, copyFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { cleanReinit, parseCleanupArgs, planCleanup } from "../clean-reinit.mjs"
import { exists } from "../lib/workspace.mjs"
import { createCommandRunner } from "../lib/commands.mjs"

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "browser-client-cleanup-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function backup(root, id, state, age) {
  const path = join(root, ".reinit/backups", id)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, "journal.json"), JSON.stringify({ root, stage: join(root, ".reinit/staging", id), state }))
  await mkdir(join(root, ".reinit/staging", id), { recursive: true })
  const time = new Date(Date.now() - age * 86_400_000)
  await utimes(path, time, time)
  return path
}

async function verification(root, id, status, age) {
  const path = join(root, ".reinit/verification", id)
  for (const dir of ["workspace", "profile-dev", "profile-production"]) await mkdir(join(path, dir), { recursive: true })
  await writeFile(join(path, "report.json"), JSON.stringify({ status, runDir: path }))
  await writeFile(join(path, "dev.log"), "retained log")
  const time = new Date(Date.now() - age * 86_400_000)
  await utimes(path, time, time)
  return path
}

test("cleanup defaults to preview and refuses ambiguous or unsafe retention flags", () => {
  assert.equal(parseCleanupArgs([]).apply, false)
  assert.deepEqual(parseCleanupArgs(["--keep=1", "--days=0", "--apply"]), { keep: 1, days: 0, apply: true, help: false })
  for (const args of [["--keep=0"], ["--days=-1"], ["--all"], ["--apply", "--dry-run"]])
    assert.throws(() => parseCleanupArgs(args))
})

test("cleanup preserves recent, failed and unknown records; preview is read-only", async (t) => {
  const root = await fixture(t)
  const old = await backup(root, "old", "complete", 20)
  await backup(root, "new", "complete", 1)
  const failed = await backup(root, "failed", "recovery-required", 30)
  const unknown = join(root, ".reinit/backups/unknown")
  await mkdir(unknown)
  const browser = await verification(root, "old", "passed", 20)
  await verification(root, "new", "passed", 1)
  const browserFailed = await verification(root, "failed", "failed", 30)
  const options = { keep: 1, days: 7, apply: false }
  const plan = await cleanReinit(root, options)
  assert.equal(plan.candidates.length, 5)
  assert.equal(await exists(old), true)
  assert.equal(await exists(join(browser, "workspace")), true)
  assert.equal(await exists(join(root, ".reinit/lock")), false)
  await cleanReinit(root, { ...options, apply: true })
  assert.equal(await exists(old), false)
  assert.equal(await exists(join(root, ".reinit/staging/old")), false)
  assert.equal(await exists(failed), true)
  assert.equal(await exists(unknown), true)
  assert.equal(await exists(join(browserFailed, "workspace")), true)
  assert.equal(await exists(join(browser, "workspace")), false)
  assert.equal(await readFile(join(browser, "dev.log"), "utf8"), "retained log")
  assert.equal(JSON.parse(await readFile(join(browser, "report.json"))).status, "passed")
  assert.equal(await exists(join(root, ".reinit/lock")), false)
})

test("an active maintenance lock blocks preview and deletion", async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, ".reinit/lock"), { recursive: true })
  await writeFile(join(root, ".reinit/lock/owner.json"), JSON.stringify({ operation: "reinit", id: "active" }))
  await assert.rejects(planCleanup(root), /Maintenance lock/)
  await assert.rejects(cleanReinit(root, { apply: true }), /Maintenance lock/)
  assert.equal(await exists(join(root, ".reinit/lock/owner.json")), true)
})

test("cleanup rejects symlinked state or a symlinked verification workspace", async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, "outside"))
  await symlink(join(root, "outside"), join(root, ".reinit"), "dir")
  await assert.rejects(planCleanup(root), /real directory/)
  await rm(join(root, ".reinit"))
  const old = await verification(root, "old", "passed", 20)
  await verification(root, "new", "passed", 1)
  await rm(join(old, "workspace"), { recursive: true })
  await symlink(join(root, "outside"), join(old, "workspace"), "dir")
  const oldTime = new Date(Date.now() - 20 * 86_400_000)
  await utimes(old, oldTime, oldTime)
  await assert.rejects(planCleanup(root, { keep: 1, days: 0 }), /real directory/)
  assert.equal(await exists(join(root, "outside")), true)
})

test("SIGINT during cleanup releases the owned lock and keeps pending backups", async (t) => {
  const root = await fixture(t)
  // Run the actual CLI against a disposable project, never the user's backups.
  await mkdir(join(root, "scripts/lib"), { recursive: true })
  for (const file of ["clean-reinit.mjs", "lib/workspace.mjs", "lib/commands.mjs"]) {
    await copyFile(new URL(`../${file}`, import.meta.url), join(root, "scripts", file))
  }
  const oldest = await backup(root, "oldest", "complete", 30)
  for (let i = 0; i < 100; i++) await backup(root, `record-${i}`, "complete", 20)
  const runner = createCommandRunner({ timeoutMs: 30_000 })
  t.after(() => runner.close())
  let handle,
    signalled = false
  const poll = setInterval(() => {
    if (handle && !signalled && existsSync(join(root, ".reinit/lock"))) {
      signalled = true
      handle.child.kill("SIGINT")
    }
  }, 1)
  t.after(() => clearInterval(poll))
  handle = runner.start(process.execPath, [join(root, "scripts/clean-reinit.mjs"), "--apply", "--keep=1", "--days=0"], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  handle.child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const result = await handle.done
  assert.equal(signalled, true, stderr)
  assert.equal(result.code, 1, stderr)
  assert.match(stderr, /Operation cancelled \(SIGINT\)/)
  assert.equal(await exists(join(root, ".reinit/lock")), false)
  assert.equal(await exists(oldest), true)
})
