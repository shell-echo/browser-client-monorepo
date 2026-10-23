import { toError } from "../lib/contracts.mts"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { once } from "node:events"
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { test } from "node:test"
import { createCommandRunner } from "../lib/commands.mts"
import { exists, fingerprint, promote } from "../lib/workspace.mts"

const commands = new URL("../lib/commands.mts", import.meta.url).href
const gone = (pid: number | undefined) => {
  try {
    assert(pid)
    process.kill(pid, 0)
    return false
  } catch (caught) {
    const error = toError(caught)
    if (error.code === "ESRCH") return true
    throw error
  }
}

async function fixture(t: import("node:test").TestContext, { graceMs = 5000 } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "browser-client-nested-")))
  const root = join(base, "root"),
    stage = join(base, "stage"),
    backup = join(base, "backup")
  // Successful startup / ownership scenarios are not three-second timing
  // tests. Timeout cases opt into their shorter deadline explicitly.
  const runner = createCommandRunner({ timeoutMs: 15000, graceMs })
  t.after(async () => {
    await runner.close().catch(() => {})
    // Failing regression assertions must not leave the fixture's writer alive.
    const pid = Number(await readFile(join(base, "writer.pid"), "utf8").catch(() => "0"))
    if (pid && !gone(pid)) {
      process.kill(pid, "SIGKILL")
      for (let i = 0; !gone(pid) && i < 100; i++) await delay(20)
      assert(gone(pid))
    }
    const scope = await readFile(join(base, "scope.json"), "utf8")
      .then(JSON.parse)
      .catch(() => undefined)
    // The uncertain-registration fixture creates no process for this marker.
    // Its actual direct process has exited before this test-only cleanup.
    if (scope) await rm(scope.path, { recursive: true, force: true })
    await rm(base, { recursive: true, force: true })
  })
  for (const directory of [root, stage]) await mkdir(join(directory, "apps"), { recursive: true })
  await writeFile(join(root, "apps/data"), "original")
  await writeFile(join(stage, "apps/data"), "candidate")
  return { base, root, stage, backup, runner }
}

function nestedWriter(f: Awaited<ReturnType<typeof fixture>>, exitParent = false) {
  // Stay alive beyond the command deadline plus both cleanup grace windows;
  // a natural exit must never satisfy the process-ownership assertions.
  const writer = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    const path = ${JSON.stringify(join(f.root, "apps/data"))};
    const update = () => { fs.writeFileSync(path + '.pending', 'still-writing'); fs.renameSync(path + '.pending', path); };
    update();
    fs.writeFileSync(${JSON.stringify(join(f.base, "writer.pid"))}, String(process.pid));
    setInterval(update, 10);
    setTimeout(() => process.exit(0), 60000);
    console.log('ready');
  `
  return `
    import {once} from 'node:events';
    import {createCommandRunner} from ${JSON.stringify(commands)};
    const runner = createCommandRunner({timeoutMs: 15000});
    const handle = runner.start(process.execPath, ['-e', ${JSON.stringify(writer)}], {capture:true});
    await once(handle.child.stdout, 'data');
    console.log(handle.child.pid);
    ${exitParent ? "process.exit(0);" : "try { await handle.done; } finally { await runner.close(); }"}
  `
}

test(
  "nested detached writer is stopped before a validation timeout rolls back",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t)
    await assert.rejects(
      promote({
        root: f.root,
        stage: f.stage,
        backup: f.backup,
        paths: ["apps"],
        validate: () =>
          f.runner.run(process.execPath, ["--input-type=module", "-e", nestedWriter(f)], {
            capture: true,
            timeoutMs: 3000,
          }),
      }),
      /Timed out/,
    )
    const pid = Number(await readFile(join(f.base, "writer.pid"), "utf8"))
    assert(gone(pid), "Rollback started while the nested writer was still alive")
    await delay(120)
    assert.equal(await readFile(join(f.root, "apps/data"), "utf8"), "original")
    assert.equal(await readFile(join(f.backup, "failed-replacement/apps/data"), "utf8"), "still-writing")
    assert.equal(JSON.parse(await readFile(join(f.backup, "journal.json"), "utf8")).state, "rolled-back")
  },
)

test("a normally exiting middle process cannot hide its detached writer", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t)
  await f.runner.run(process.execPath, ["--input-type=module", "-e", nestedWriter(f, true)], { capture: true })
  const pid = Number(await readFile(join(f.base, "writer.pid"), "utf8"))
  assert(gone(pid))
  const before = await readFile(join(f.root, "apps/data"), "utf8")
  await delay(120)
  assert.equal(await readFile(join(f.root, "apps/data"), "utf8"), before)
})

test(
  "stopping one nested command cleans its branch and leaves a sibling service running",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t)
    const sibling = f.runner.start(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", timeoutMs: 0 })
    const parent = f.runner.start(process.execPath, ["--input-type=module", "-e", nestedWriter(f)], { capture: true })
    await Promise.race([once(parent.child.stdout!, "data"), parent.done.then(() => assert.fail("Writer did not become ready"))])
    const cause = new Error("cancel nested branch")
    await parent.stop(cause)
    assert.equal((await parent.done).reason, cause)
    assert(gone(Number(await readFile(join(f.base, "writer.pid"), "utf8"))))
    assert.equal(gone(sibling.child.pid), false, "A sibling command was terminated")
    await sibling.stop()
  },
)

test("unconfirmed nested registration retains both versions and prohibits rollback", async (t) => {
  for (const record of [
    { pid: null, state: "starting" },
    { pid: 1, state: "running" },
  ])
    await t.test(record.state, async (t) => {
      if (record.pid === 1) {
        const kill = process.kill.bind(process)
        t.mock.method(process, "kill", (...args: Parameters<typeof process.kill>) => {
          assert.notEqual(args[0], -1, "Regression test blocked a signal to all processes")
          return kill(...args)
        })
      }
      const f = await fixture(t, { graceMs: 100 })
      const code = `
    import {mkdirSync,writeFileSync} from 'node:fs';
    import {join} from 'node:path';
    const scope = JSON.parse(process.env.BROWSER_CLIENT_COMMAND_SCOPE);
    writeFileSync(${JSON.stringify(join(f.base, "scope.json"))}, JSON.stringify(scope));
    const path = join(scope.path, 'child-interrupted');
    mkdirSync(path);
    writeFileSync(join(path, 'owner.json'), JSON.stringify({version:1,token:scope.token,...${JSON.stringify(record)}}));
  `
      await assert.rejects(
        promote({
          root: f.root,
          stage: f.stage,
          backup: f.backup,
          paths: ["apps"],
          validate: () => f.runner.run(process.execPath, ["--input-type=module", "-e", code], { capture: true }),
        }),
        (error) =>
          toError(error).unsafeToRestore === true &&
          /Cannot confirm|Invalid owned process identifier/.test(toError(error).message),
      )
      assert.equal(JSON.parse(await readFile(join(f.backup, "journal.json"), "utf8")).state, "recovery-required")
      assert.equal(await readFile(join(f.root, "apps/data"), "utf8"), "candidate")
      assert.equal(await readFile(join(f.backup, "apps/data"), "utf8"), "original")
    })
})

test("a stopping ancestor prevents new nested commands and marks restoration unsafe", async (t) => {
  const f = await fixture(t)
  const code = `
    import assert from 'node:assert/strict';
    import {readFileSync,writeFileSync,existsSync} from 'node:fs';
    import {join} from 'node:path';
    import {createCommandRunner} from ${JSON.stringify(commands)};
    const scope = JSON.parse(process.env.BROWSER_CLIENT_COMMAND_SCOPE);
    const path = join(scope.path,'owner.json');
    const original = readFileSync(path,'utf8');
    const owner = JSON.parse(original);
    writeFileSync(path,JSON.stringify({...owner,state:'stopping'}));
    const runner = createCommandRunner();
    try {
      assert.throws(() => runner.start(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(join(f.base, "unexpected"))},'spawned')`)}]),error => error.unsafeToRestore === true && /Parent command is stopping/.test(error.message));
      assert.equal(existsSync(${JSON.stringify(join(f.base, "unexpected"))}),false);
    } finally { writeFileSync(path,original); await runner.close(); }
  `
  await f.runner.run(process.execPath, ["--input-type=module", "-e", code], { capture: true })
})

test("the real reinit CLI retains its lock when ownership fails before a child handle exists", async (t) => {
  const f = await fixture(t)
  const repository = fileURLToPath(new URL("../../", import.meta.url))
  await mkdir(join(f.root, "scripts"))
  await cp(join(repository, "scripts/lib"), join(f.root, "scripts/lib"), { recursive: true })
  await cp(join(repository, "scripts/reinit.mts"), join(f.root, "scripts/reinit.mts"))
  await symlink(
    join(repository, "node_modules"),
    join(f.root, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  )
  await writeFile(join(f.root, "package.json"), JSON.stringify({ name: "browser-client", private: true, type: "module" }))
  const parent = join(f.base, "stopping-scope"),
    token = "ownership-regression"
  await mkdir(parent, { mode: 0o700 })
  await writeFile(join(parent, "owner.json"), JSON.stringify({ version: 1, token, pid: process.pid, state: "stopping" }))
  const before = await fingerprint(f.root)
  const result = await promisify(execFile)(
    process.execPath,
    [join(f.root, "scripts/reinit.mts"), "extension", "--apply", "--offline"],
    {
      cwd: f.root,
      timeout: 30_000,
      env: { ...process.env, BROWSER_CLIENT_COMMAND_SCOPE: JSON.stringify({ root: parent, path: parent, token }) },
    },
  ).then(
    () => assert.fail("Unsafe ownership context was accepted"),
    (error) => error,
  )
  assert.equal(result.code, 1, result.stderr)
  assert.match(result.stderr, /Parent command is stopping/)
  assert.equal(
    await exists(join(f.root, ".reinit/lock/owner.json")),
    true,
    "Unconfirmed ownership released the maintenance lock",
  )
  const reports = await readdir(join(f.root, ".reinit/reports"))
  const report = JSON.parse(await readFile(join(f.root, ".reinit/reports", reports[0]), "utf8"))
  assert.equal(report.status, "recovery-required")
  assert.equal(report.lockRetained, true)
  assert.equal(await fingerprint(f.root), before)
})
