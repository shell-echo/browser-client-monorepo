import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, realpath, symlink, lstat, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { promote, recoverPromotion, fingerprint } from "../lib/workspace.mts"
import { createCommandRunner } from "../lib/commands.mts"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { recoverMaintenance } from "../lib/recovery.mts"
import { inspectCommandScope } from "../lib/command-scopes.mts"
import { setTimeout as delay } from "node:timers/promises"
import { exists } from "../lib/workspace.mts"

test(
  "recovery ownership survives the outer controller exiting after a killed final validator",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "browser-client-retained-recovery-")))
    const bin = join(root, "bin"),
      ready = join(root, ".reinit/ready.json")
    for (const directory of [bin, join(root, "apps"), join(root, "packages")]) await mkdir(directory)
    await writeFile(join(root, "package.json"), '{"name":"retained-recovery-fixture"}')
    await writeFile(join(root, "apps.config.json"), '{"schemaVersion":1,"apps":{}}')
    await writeFile(join(root, "template-versions.json"), '{"schemaVersion":2,"applications":{}}')
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n")
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages: {}\nsnapshots: {}\n")
    await writeFile(join(bin, "git"), `#!${process.execPath}\nprocess.exit(0)\n`, { mode: 0o755 })
    // Fixture gates avoid builds/network; the real transaction, process groups,
    // SIGKILL, ownership lifetime and recovery CLI remain under test.
    await writeFile(
      join(bin, "pnpm"),
      `#!${process.execPath}\nconst fs=require('node:fs');
if(process.argv.includes('install'))fs.mkdirSync('node_modules',{recursive:true});
if(process.cwd()===${JSON.stringify(root)}&&process.argv.includes('--frozen-lockfile')) {
const owner=JSON.parse(fs.readFileSync('.reinit/lock/owner.json','utf8'));
fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({ownerScope:owner.scope,pid:process.pid,scope:JSON.parse(process.env.BROWSER_CLIENT_COMMAND_SCOPE)}));
setInterval(()=>{},1000);
} else process.exit(0);\n`,
      { mode: 0o755 },
    )
    const before = await fingerprint(root)
    const runner = createCommandRunner({
      cwd: root,
      timeoutMs: 15_000,
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        npm_execpath: undefined,
        BROWSER_CLIENT_COMMAND_SCOPE: undefined,
      },
    })
    const retainedScopes = new Set<string>()
    t.after(async () => {
      await runner.close()
      for (const scope of retainedScopes) await rm(scope, { recursive: true, force: true })
      await rm(root, { recursive: true, force: true })
    })
    const maintenance = new URL("../lib/maintenance.mts", import.meta.url).href
    const handle = runner.start(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {runMaintenance} from ${JSON.stringify(maintenance)};await runMaintenance(${JSON.stringify(root)},{kind:'reinit',ids:[]},true)`,
      ],
      { stdio: "ignore" },
    )
    let diagnostic = ""
    handle.child.stdout?.on("data", (chunk) => {
      diagnostic += chunk
    })
    handle.child.stderr?.on("data", (chunk) => {
      diagnostic += chunk
    })
    const deadline = Date.now() + 10000
    while (!(await exists(ready))) {
      assert.equal(handle.child.exitCode, null, diagnostic)
      assert(Date.now() < deadline, "Fixture did not reach final validation: " + diagnostic)
      await delay(10)
    }
    const live: { ownerScope: string; pid: number; scope: { root: string } } = JSON.parse(await readFile(ready, "utf8"))
    retainedScopes.add(live.scope.root)
    const owner = JSON.parse(await readFile(join(root, ".reinit/lock/owner.json"), "utf8"))
    assert.equal(owner.processesStopped, false)
    process.kill(handle.child.pid!, "SIGKILL")
    assert.equal((await handle.done).signal, "SIGKILL")
    assert(await exists(live.ownerScope), "The outer controller discarded ownership needed for recovery")
    assert(inspectCommandScope(live.ownerScope).some((record) => record.pid === owner.pid))
    const recovery = new URL("../lib/recovery.mts", import.meta.url).href
    await runner.run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {recoverMaintenance} from ${JSON.stringify(recovery)};await recoverMaintenance(${JSON.stringify(root)},${JSON.stringify(owner.id)},true)`,
      ],
      { stdio: "ignore" },
    )
    assert.equal(await fingerprint(root), before)
    assert.equal(await exists(join(root, ".reinit/lock")), false)
    assert.equal(await exists(live.scope.root), false, "Successful recovery did not release retained ownership")
  },
)

test(
  "SIGKILL of maintenance or recovery cannot hide a live command from the next recovery",
  { skip: process.platform === "win32" },
  async (t) => {
    for (const operation of ["maintenance", "recovery"] as const) {
      await t.test(operation, async (t) => {
        const root = await realpath(await mkdtemp(join(tmpdir(), "browser-client-recovery-live-")))
        const bin = join(root, "bin"),
          lock = join(root, ".reinit/lock"),
          id = "live-command-fixture"
        for (const directory of [bin, join(root, "apps"), join(root, "packages")]) await mkdir(directory)
        await writeFile(join(root, "package.json"), '{"name":"live-command-fixture"}')
        await writeFile(join(root, "apps.config.json"), '{"schemaVersion":1,"apps":{}}')
        await writeFile(join(root, "template-versions.json"), '{"schemaVersion":2,"applications":{}}')
        await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n")
        const ready = join(root, ".reinit/ready.json")
        // These executables isolate the real maintenance/recovery ownership
        // boundary. They never install packages or modify business source.
        const service = `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,scope:JSON.parse(process.env.BROWSER_CLIENT_COMMAND_SCOPE)}));setInterval(()=>{},1000);setTimeout(()=>process.exit(0),60000);\n`
        await writeFile(join(bin, operation === "maintenance" ? "git" : "pnpm"), service, { mode: 0o755 })
        if (operation === "recovery") {
          const previous = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
          await new Promise<void>((resolve, reject) => {
            previous.once("error", reject)
            previous.once("close", () => resolve())
          })
          await mkdir(lock, { recursive: true })
          await writeFile(
            join(lock, "owner.json"),
            JSON.stringify({
              id,
              pid: previous.pid,
              stage: join(root, ".reinit/staging", id),
              backup: join(root, ".reinit/backups", id),
              processesStopped: true,
            }),
          )
        }
        const module = new URL(`../lib/${operation === "maintenance" ? "maintenance" : "recovery"}.mts`, import.meta.url).href
        const code =
          operation === "maintenance"
            ? `import {runMaintenance} from ${JSON.stringify(module)};await runMaintenance(${JSON.stringify(root)},{kind:'reinit',ids:[]},true)`
            : `import {recoverMaintenance} from ${JSON.stringify(module)};await recoverMaintenance(${JSON.stringify(root)},${JSON.stringify(id)},true)`
        const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` }
        delete env.BROWSER_CLIENT_COMMAND_SCOPE
        const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
          cwd: root,
          env,
          stdio: ["ignore", "ignore", "pipe"],
        })
        let stderr = ""
        child.stderr.on("data", (chunk) => {
          stderr += chunk
        })
        const closed = new Promise<NodeJS.Signals | null>((resolve, reject) => {
          child.once("error", reject)
          // Detached commands still inherit the stderr pipe after their parent
          // dies. Waiting for close would wait for the very child being tested.
          child.once("exit", (_code, signal) => resolve(signal))
        })
        let live: { pid: number; scope: { root: string } } | undefined
        t.after(async () => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
          await closed
          if (!live && (await exists(ready))) live = JSON.parse(await readFile(ready, "utf8"))
          if (live) {
            try {
              process.kill(-live.pid, "SIGKILL")
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
            }
            let exited = false
            let transientProbeExercised = false
            let realProbeExercised = false
            for (let attempt = 0; attempt < 100; attempt++) {
              try {
                // macOS can briefly return EPERM for a just-exited group.
                // Exercise that transition on every platform; only a real
                // ESRCH below may establish that cleanup has completed.
                if (!transientProbeExercised) {
                  transientProbeExercised = true
                  throw Object.assign(new Error("Transient process-group probe"), { code: "EPERM" })
                }
                realProbeExercised = true
                process.kill(-live.pid, 0)
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ESRCH") {
                  exited = true
                  break
                }
                if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error
              }
              await delay(20)
            }
            assert(exited, "The fixture's owned command group did not exit during cleanup")
            assert(realProbeExercised, "EPERM was incorrectly treated as evidence that the process group exited")
            await rm(live.scope.root, { recursive: true, force: true })
          }
          await rm(root, { recursive: true, force: true })
        })
        const deadline = Date.now() + 10000
        while (!(await exists(ready))) {
          assert.equal(child.exitCode, null, stderr)
          assert.equal(child.signalCode, null, stderr)
          assert(Date.now() < deadline, `Owned command did not become ready: ${stderr}`)
          await delay(20)
        }
        live = JSON.parse(await readFile(ready, "utf8"))
        assert(live)
        child.kill("SIGKILL")
        assert.equal(await closed, "SIGKILL", stderr)
        const ownerBytes = await readFile(join(lock, "owner.json"), "utf8")
        const owner = JSON.parse(ownerBytes)
        const before = await fingerprint(root)
        const claims = await readdir(lock)
        assert.equal(owner.processesStopped, false)
        assert(
          inspectCommandScope(owner.scope).some((record) => record.pid === live!.pid),
          "The killed owner's process record omitted its live child",
        )
        process.kill(-live.pid, 0)
        await assert.rejects(recoverMaintenance(root, owner.id, true), /owned process group is still running/)
        assert.equal(await readFile(join(lock, "owner.json"), "utf8"), ownerBytes)
        assert.deepEqual(await readdir(lock), claims)
        assert.equal(await fingerprint(root), before)
        process.kill(-live.pid, 0)
      })
    }
  },
)

async function fixture(t: import("node:test").TestContext) {
  const base = await mkdtemp(join(tmpdir(), "browser-client-recovery-"))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = join(base, "root"),
    stage = join(base, "stage"),
    backup = join(base, "backup")
  for (const directory of [root, stage]) await mkdir(join(directory, "apps"), { recursive: true })
  await writeFile(join(root, "apps/data"), "original")
  await writeFile(join(stage, "apps/data"), "candidate")
  await writeFile(join(stage, "new.json"), "new file")
  return { root, stage, backup }
}
async function killed(code: string) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  child.stderr.on("data", (chunk) => {
    output += chunk
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, 15_000)
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  }).finally(() => clearTimeout(timer))
  assert.equal(timedOut, false, "The child did not reach the injected interruption boundary")
  assert.equal(result.signal, "SIGKILL", output)
}
const library = new URL("../lib/workspace.mts", import.meta.url).href

test("concurrent recoveries claim each owner generation once, including an interrupted recovery generation", async (t) => {
  for (const generation of [undefined, randomUUID()])
    await t.test(generation ?? "initial", async (t) => {
      const root = await realpath(await mkdtemp(join(tmpdir(), "browser-client-recovery-claim-")))
      t.after(() => rm(root, { recursive: true, force: true }))
      const bin = join(root, "bin"),
        lock = join(root, ".reinit/lock"),
        id = "claim-fixture"
      await mkdir(bin)
      await mkdir(lock, { recursive: true })
      // A delayed fixture checker isolates claim serialization; real pnpm checks
      // and filesystem restoration are covered by the CLI acceptance suite.
      await writeFile(join(bin, "pnpm"), `#!${process.execPath}\nsetTimeout(()=>{},300)\n`, { mode: 0o755 })
      const previousPath = process.env.PATH
      process.env.PATH = `${bin}:${previousPath ?? ""}`
      t.after(() => {
        process.env.PATH = previousPath
      })
      const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
      assert(child.pid)
      const pid = child.pid
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject)
        child.once("close", () => resolve())
      })
      await writeFile(
        join(lock, "owner.json"),
        JSON.stringify({
          id,
          pid,
          stage: join(root, ".reinit/staging", id),
          backup: join(root, ".reinit/backups", id),
          processesStopped: true,
          ...(generation ? { recoveryGeneration: generation } : {}),
        }),
      )
      if (generation) await mkdir(join(lock, "recovery-initial"))
      let release!: () => void,
        arrivals = 0
      const barrier = new Promise<void>((resolve) => {
        release = resolve
      })
      const timer = setTimeout(release, 2000)
      const hooks = {
        boundary: async () => {
          if (++arrivals === 2) release()
          await barrier
        },
      }
      const results = await Promise.allSettled([
        recoverMaintenance(root, id, true, hooks),
        recoverMaintenance(root, id, true, hooks),
      ])
      clearTimeout(timer)
      assert.equal(arrivals, 2, "Both contenders must read the same dead owner before claiming")
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1)
      const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult
      assert.match(String(rejected.reason), /already claimed/)
      await assert.rejects(lstat(lock), /ENOENT/)
    })
})

test("recovery refuses symbolic candidate-preservation paths", async (t) => {
  const f = await fixture(t)
  await killed(
    `import {promote} from ${JSON.stringify(library)};await promote({...${JSON.stringify(f)},paths:["apps"],validate:async()=>process.kill(process.pid,"SIGKILL")})`,
  )
  const external = join(f.root, "external")
  await mkdir(external)
  const before = await fingerprint(external)
  await symlink(external, join(f.backup, "failed-replacement"))
  await assert.rejects(recoverPromotion(f.backup, f.root), /real directory/)
  assert.equal(await fingerprint(external), before)
  assert.equal(await readFile(join(f.root, "apps/data"), "utf8"), "candidate")
  assert.equal(await readFile(join(f.backup, "apps/data"), "utf8"), "original")
})

test("SIGKILL in each rename/journal gap restores original files and preserves newly created candidates", async (t) => {
  for (const boundary of ["original-moved", "candidate-moved"])
    await t.test(boundary, async (t) => {
      const f = await fixture(t)
      await killed(
        `import {promote} from ${JSON.stringify(library)}; await promote({...${JSON.stringify(f)}, paths:["apps","new.json"], validate:async()=>{}, boundary(name){if(name===${JSON.stringify(boundary)})process.kill(process.pid,"SIGKILL")}})`,
      )
      assert.equal(await recoverPromotion(f.backup, f.root), "rolled-back")
      assert.equal(await readFile(join(f.root, "apps/data"), "utf8"), "original")
      await assert.rejects(readFile(join(f.root, "new.json")), /ENOENT/)
      assert.equal(await recoverPromotion(f.backup, f.root), "rolled-back")
    })
})

test("recovery interrupted after preserving a candidate or restoring an original can safely resume", async (t) => {
  for (const boundary of ["candidate-preserved", "original-restored"])
    await t.test(boundary, async (t) => {
      const f = await fixture(t)
      await killed(
        `import {promote} from ${JSON.stringify(library)}; await promote({...${JSON.stringify(f)}, paths:["apps","new.json"], validate:async()=>{process.kill(process.pid,"SIGKILL")}})`,
      )
      await killed(
        `import {recoverPromotion} from ${JSON.stringify(library)}; await recoverPromotion(${JSON.stringify(f.backup)},${JSON.stringify(f.root)},(name)=>{if(name===${JSON.stringify(boundary)})process.kill(process.pid,"SIGKILL")})`,
      )
      assert.equal(await recoverPromotion(f.backup, f.root), "rolled-back")
      assert.equal(await readFile(join(f.root, "apps/data"), "utf8"), "original")
      assert.equal(await readFile(join(f.backup, "failed-replacement/apps/data"), "utf8"), "candidate")
    })
})

test("unexpected source writes keep both the live edits and original backup instead of overwriting either", async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    promote({
      ...f,
      paths: ["apps", "new.json"],
      validate: async () => {
        await writeFile(join(f.root, "apps/data"), "concurrent edit")
        throw new Error("validation failed")
      },
    }),
    (error) => Boolean((error as { unsafeToRestore?: boolean }).unsafeToRestore),
  )
  assert.equal(await readFile(join(f.root, "apps/data"), "utf8"), "concurrent edit")
  assert.equal(await readFile(join(f.backup, "apps/data"), "utf8"), "original")
  assert.equal(JSON.parse(await readFile(join(f.backup, "journal.json"), "utf8")).state, "recovery-required")
  await assert.rejects(recoverPromotion(f.backup, join(f.root, "other")), /another workspace/)
})

test("final validation detects edits outside promoted paths and rolls back without overwriting the edits", async (t) => {
  const f = await fixture(t)
  for (const directory of [f.root, f.stage]) await writeFile(join(directory, "README.md"), "original documentation")
  await assert.rejects(
    promote({
      ...f,
      paths: ["apps", "new.json"],
      expectedCandidateFingerprint: await fingerprint(f.stage),
      validate: async () => {
        await writeFile(join(f.root, "README.md"), "concurrent documentation edit")
      },
    }),
    /outside the replacement paths/,
  )
  assert.equal(await readFile(join(f.root, "README.md"), "utf8"), "concurrent documentation edit")
  assert.equal(await readFile(join(f.root, "apps/data"), "utf8"), "original")
  await assert.rejects(readFile(join(f.root, "new.json")), /ENOENT/)
})

test("recovery CLI starts without package.json, node_modules or application tooling during replacement gaps", async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "browser-client-bootstrap-")))
  t.after(() => rm(base, { recursive: true, force: true }))
  await mkdir(join(base, "scripts/lib"), { recursive: true })
  const source = fileURLToPath(new URL("../", import.meta.url))
  for (const path of [
    "app.mts",
    ...["recovery", "workspace", "commands", "command-scopes", "command-diagnostics", "contracts"].map(
      (name) => `lib/${name}.mts`,
    ),
  ])
    await cp(join(source, path), join(base, "scripts", path))
  const id = "interrupted-fixture"
  await mkdir(join(base, ".reinit/lock"), { recursive: true })
  await writeFile(
    join(base, ".reinit/lock/owner.json"),
    JSON.stringify({
      id,
      pid: process.pid,
      stage: join(base, ".reinit/staging", id),
      backup: join(base, ".reinit/backups", id),
    }),
  )
  const runner = createCommandRunner({ cwd: base, timeoutMs: 10_000 })
  t.after(() => runner.close())
  const output = await runner.run(process.execPath, ["scripts/app.mts", "recover", id, "--dry-run"], { capture: true })
  assert.match(output, /"operation": "recover"/)
  assert.match(output, /"apply": false/)
})
