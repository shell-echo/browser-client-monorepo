import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink, utimes, copyFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { cleanReinit, parseCleanupArgs, planCleanup } from "../clean-reinit.mts"
import { exists } from "../lib/workspace.mts"
import { createCommandRunner } from "../lib/commands.mts"

async function fixture(t: import("node:test").TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "browser-client-cleanup-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function backup(root: string, id: string, state: string, age: number) {
  const path = join(root, ".reinit/backups", id)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, "journal.json"), JSON.stringify({ root, stage: join(root, ".reinit/staging", id), state }))
  await mkdir(join(root, ".reinit/staging", id), { recursive: true })
  const time = new Date(Date.now() - age * 86_400_000)
  await utimes(path, time, time)
  return path
}

async function verification(root: string, id: string, status: string, age: number) {
  const path = join(root, ".reinit/verification", id)
  for (const dir of ["workspace", "profile-dev", "profile-production"]) await mkdir(join(path, dir), { recursive: true })
  await writeFile(join(path, "report.json"), JSON.stringify({ status, runDir: path }))
  await writeFile(join(path, "dev.log"), "retained log")
  const time = new Date(Date.now() - age * 86_400_000)
  await utimes(path, time, time)
  return path
}

async function browserSuite(root: string, id: string, status = "passed", age = 20) {
  const path = join(root, ".reinit/verification", id)
  const instances = []
  for (const appId of ["console", "studio", "addon", "companion"]) {
    const runDir = join(path, appId)
    for (const child of ["workspace", "profile-dev", "profile-production"]) {
      await mkdir(join(runDir, child), { recursive: true })
      await writeFile(join(runDir, child, "probe"), "disposable data")
    }
    const report = { appId, runDir, status: "passed", sourceFingerprint: "fixture-source" }
    await writeFile(join(runDir, "report.json"), JSON.stringify(report))
    await writeFile(join(runDir, "server.log"), "retained instance log")
    await writeFile(join(runDir, "dark.png"), "retained screenshot")
    instances.push(report)
  }
  await writeFile(
    join(path, "report.json"),
    JSON.stringify({
      runDir: path,
      status,
      sourceFingerprint: "fixture-source",
      expected: instances.map((instance) => instance.appId),
      instances,
    }),
  )
  await writeFile(join(path, "console.log"), "retained suite log")
  const time = new Date(Date.now() - age * 86_400_000)
  await utimes(path, time, time)
  return path
}

test("cleanup removes expired multi-instance copies and profiles while retaining every report, log and screenshot", async (t) => {
  const root = await fixture(t)
  const old = await browserSuite(root, "browser-old")
  const recent = await browserSuite(root, "browser-recent", "passed", 1)
  const failed = await browserSuite(root, "browser-failed", "failed", 30)
  const unknown = join(old, "unlisted/workspace")
  await mkdir(unknown, { recursive: true })
  await writeFile(join(unknown, "business.txt"), "keep unknown data")
  const oldTime = new Date(Date.now() - 20 * 86_400_000)
  await utimes(old, oldTime, oldTime)
  const report = await readFile(join(old, "report.json"), "utf8")
  const options = { keep: 1, days: 7, apply: false }
  const plan = await cleanReinit(root, options)
  assert.equal(plan.candidates.length, 12)
  for (const candidate of plan.candidates) assert.equal(await exists(candidate.path), true, "Preview deleted data")
  await cleanReinit(root, { ...options, apply: true })
  for (const app of ["console", "studio", "addon", "companion"]) {
    for (const child of ["workspace", "profile-dev", "profile-production"]) {
      assert.equal(await exists(join(old, app, child)), false)
      assert.equal(await exists(join(recent, app, child)), true)
      assert.equal(await exists(join(failed, app, child)), true)
    }
    assert.equal(JSON.parse(await readFile(join(old, app, "report.json"), "utf8")).status, "passed")
    assert.equal(await readFile(join(old, app, "server.log"), "utf8"), "retained instance log")
    assert.equal(await readFile(join(old, app, "dark.png"), "utf8"), "retained screenshot")
  }
  assert.equal(await readFile(join(old, "report.json"), "utf8"), report)
  assert.equal(await readFile(join(old, "console.log"), "utf8"), "retained suite log")
  assert.equal(await readFile(join(unknown, "business.txt"), "utf8"), "keep unknown data")
  assert.equal(await exists(join(root, ".reinit/lock")), false)
})

test("cleanup protects the whole suite when an instance report is missing, failed, stale, malformed or occupied", async (t) => {
  for (const change of ["missing", "failed", "stale", "malformed", "identity", "path", "duplicate", "traversal", "lock"]) {
    await t.test(change, async (t) => {
      const root = await fixture(t)
      const path = await browserSuite(root, "browser-old")
      await browserSuite(root, "browser-recent", "passed", 1)
      const marker = join(path, "addon/report.json")
      const report = JSON.parse(await readFile(marker, "utf8"))
      if (change === "missing") await rm(marker)
      else if (change === "malformed") await writeFile(marker, "{invalid")
      else if (change === "lock") await mkdir(join(path, "addon/workspace/.reinit/lock"), { recursive: true })
      else if (["duplicate", "traversal"].includes(change)) {
        const parent = JSON.parse(await readFile(join(path, "report.json"), "utf8"))
        parent.expected[0] = change === "duplicate" ? "studio" : "../outside"
        await writeFile(join(path, "report.json"), JSON.stringify(parent))
      } else {
        if (change === "failed") report.status = "failed"
        if (change === "stale") report.sourceFingerprint = "another-source"
        if (change === "identity") report.appId = "other"
        if (change === "path") report.runDir = join(root, "outside")
        await writeFile(marker, JSON.stringify(report))
      }
      const plan = await cleanReinit(root, { keep: 1, days: 7, apply: true })
      assert.equal(plan.candidates.length, 0)
      assert(plan.protected.some((record) => record.path === path))
      for (const app of ["console", "studio", "addon", "companion"])
        assert.equal(await readFile(join(path, app, "workspace/probe"), "utf8"), "disposable data")
      if (change === "lock") assert.equal(await exists(join(path, "addon/workspace/.reinit/lock")), true)
    })
  }
})

test("cleanup rejects linked instance directories and nested assets before deleting any candidate", async (t) => {
  for (const child of ["addon", "addon/workspace", "addon/profile-dev"]) {
    await t.test(child, async (t) => {
      const root = await fixture(t)
      const path = await browserSuite(root, "browser-old")
      await browserSuite(root, "browser-recent", "passed", 1)
      const outside = join(root, "outside")
      await mkdir(outside)
      await writeFile(join(outside, "business.txt"), "keep external data")
      await rm(join(path, child), { recursive: true })
      await symlink(outside, join(path, child), "dir")
      const oldTime = new Date(Date.now() - 20 * 86_400_000)
      await utimes(path, oldTime, oldTime)
      await assert.rejects(cleanReinit(root, { keep: 1, days: 7, apply: true }), /real directory/)
      assert.equal(await readFile(join(path, "console/workspace/probe"), "utf8"), "disposable data")
      assert.equal(await readFile(join(outside, "business.txt"), "utf8"), "keep external data")
      assert.equal(await exists(join(root, ".reinit/lock")), false)
    })
  }
})

test("cleanup defaults to preview and refuses ambiguous or unsafe retention flags", () => {
  assert.equal(parseCleanupArgs([]).apply, false)
  assert.deepEqual(parseCleanupArgs(["--keep=1", "--days=0", "--apply"]), {
    keep: 1,
    days: 0,
    apply: true,
    help: false,
    sizes: false,
  })
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
  assert.equal(JSON.parse(await readFile(join(browser, "report.json"), "utf8")).status, "passed")
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
  for (const file of [
    "clean-reinit.mts",
    "lib/workspace.mts",
    "lib/contracts.mts",
    "lib/commands.mts",
    "lib/command-scopes.mts",
    "lib/command-diagnostics.mts",
    "lib/maintenance-report.mts",
  ]) {
    await copyFile(new URL(`../${file}`, import.meta.url), join(root, "scripts", file))
  }
  const oldest = await backup(root, "oldest", "complete", 30)
  for (let i = 0; i < 100; i++) await backup(root, `record-${i}`, "complete", 20)
  const runner = createCommandRunner({ timeoutMs: 30_000 })
  t.after(() => runner.close())
  let signalled = false
  const poll = setInterval(() => {
    if (handle && !signalled && existsSync(join(root, ".reinit/lock"))) {
      signalled = true
      handle.child.kill("SIGINT")
    }
  }, 1)
  t.after(() => clearInterval(poll))
  const handle = runner.start(process.execPath, [join(root, "scripts/clean-reinit.mts"), "--apply", "--keep=1", "--days=0"], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  handle.child.stderr!.on("data", (chunk) => {
    stderr += chunk
  })
  const result = await handle.done
  assert.equal(signalled, true, stderr)
  assert.equal(result.code, 1, stderr)
  assert.match(stderr, /Operation cancelled \(SIGINT\)/)
  assert.equal(await exists(join(root, ".reinit/lock")), false)
  assert.equal(await exists(oldest), true)
})
