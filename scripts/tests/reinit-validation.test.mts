import type { PreflightOptions } from "../lib/reinit-validation.mts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { validateBeforePromotion } from "../lib/reinit-validation.mts"
import { exists, fingerprint, promote } from "../lib/workspace.mts"
import { createCommandRunner } from "../lib/commands.mts"
import { reinitTimeouts, timeoutForCommand } from "../lib/reinit-timeouts.mts"

async function put(root: string, path: string, content: string) {
  const file = join(root, path)
  await mkdir(join(file, ".."), { recursive: true })
  await writeFile(file, content)
}

async function fixture(t: import("node:test").TestContext) {
  const root = await mkdtemp(join(tmpdir(), "browser-client-preflight-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const stage = join(root, ".reinit/staging/test"),
    backup = join(root, ".reinit/backups/test")
  const asset = "apps/web/public/dist/vendor.js"
  await put(root, asset, "original asset")
  await put(root, "pnpm-lock.yaml", "original lock")
  await put(root, "node_modules/cache", "original dependencies")
  await put(stage, asset, "candidate asset")
  await put(stage, "pnpm-lock.yaml", "candidate lock")
  const baseline = await fingerprint(root),
    calls: { command: string; cwd: string; env?: NodeJS.ProcessEnv }[] = []
  let promoted = false
  const options: PreflightOptions = {
    root,
    stage,
    baseline,
    offline: true,
    selected: ["extension"],
    run: async (args: string[], cwd, capture, env) => {
      calls.push({ command: args.join(" "), cwd, env })
    },
    promote: async () => {
      promoted = true
      await promote({ root, stage, backup, paths: ["apps", "pnpm-lock.yaml"], validate: async () => {} })
    },
  }
  return { root, stage, backup, asset, baseline, calls, options, promoted: () => promoted }
}

test("online preflight completes both browser suites before replacing the original project", async (t) => {
  const f = await fixture(t)
  await validateBeforePromotion({ ...f.options, offline: false })
  assert.deepEqual(
    f.calls.map(({ command }) => command),
    [
      "install --frozen-lockfile --strict-peer-dependencies",
      "exec node scripts/format-reinit.mts extension",
      "check",
      "audit:security",
      "exec playwright install chromium",
      "test:web-admin",
      "test:extension",
    ],
  )
  for (const call of f.calls) assert.equal(call.cwd, f.stage)
  for (const call of f.calls.filter(({ command }) => command.startsWith("test:"))) {
    assert.equal(call.env!.BROWSER_TEST_OUTPUT_ROOT, join(f.root, ".reinit/verification"))
  }
  assert.equal(f.promoted(), true)
  assert.equal(await readFile(join(f.root, f.asset), "utf8"), "candidate asset")
  assert.equal(await readFile(join(f.backup, f.asset), "utf8"), "original asset")
  assert.equal(await readFile(join(f.root, "pnpm-lock.yaml"), "utf8"), "candidate lock")
})

test("offline preflight runs browser verification without downloading browsers or auditing online", async (t) => {
  const f = await fixture(t)
  await validateBeforePromotion(f.options)
  assert.deepEqual(
    f.calls.map(({ command }) => command),
    ["exec node scripts/format-reinit.mts extension", "check", "test:web-admin", "test:extension"],
  )
  assert.equal(f.promoted(), true)
})

test("failed candidate checks never promote and preserve the original source, lock and dependencies", async (t) => {
  const sequence = [
    "install --frozen-lockfile --strict-peer-dependencies",
    "exec node scripts/format-reinit.mts extension",
    "check",
    "audit:security",
    "exec playwright install chromium",
    "test:web-admin",
    "test:extension",
  ]
  for (const failure of sequence)
    await t.test(failure, async (t) => {
      const f = await fixture(t)
      let report: string | undefined
      const calls: string[] = []
      await assert.rejects(
        validateBeforePromotion({
          ...f.options,
          offline: false,
          run: async (args, cwd, capture, env) => {
            const command = args.join(" ")
            calls.push(command)
            if (command !== failure) return
            if (command.startsWith("test:")) {
              assert(env?.BROWSER_TEST_OUTPUT_ROOT)
              report = join(env.BROWSER_TEST_OUTPUT_ROOT, "failed/report.json")
              await put(
                env.BROWSER_TEST_OUTPUT_ROOT,
                "failed/report.json",
                JSON.stringify({ status: "failed", failure: command }),
              )
            }
            throw new Error(`failed: ${command}`)
          },
        }),
        /failed:/,
      )
      assert.deepEqual(calls, sequence.slice(0, sequence.indexOf(failure) + 1))
      assert.equal(f.promoted(), false)
      assert.equal(await exists(f.backup), false)
      assert.equal(await fingerprint(f.root), f.baseline)
      assert.equal(await readFile(join(f.root, f.asset), "utf8"), "original asset")
      assert.equal(await readFile(join(f.root, "pnpm-lock.yaml"), "utf8"), "original lock")
      assert.equal(await readFile(join(f.root, "node_modules/cache"), "utf8"), "original dependencies")
      if (report) assert.equal(JSON.parse(await readFile(report, "utf8")).status, "failed")
    })
})

test("editing a generated-looking business asset during browser verification prevents promotion", async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    validateBeforePromotion({
      ...f.options,
      run: async (args) => {
        if (args[0] === "test:web-admin") await put(f.root, f.asset, "user edit")
      },
    }),
    /Workspace changed/,
  )
  assert.equal(f.promoted(), false)
  assert.equal(await exists(f.backup), false)
  assert.equal(await readFile(join(f.root, f.asset), "utf8"), "user edit")
})

test("cancellation after browser verification prevents replacement", async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    validateBeforePromotion({
      ...f.options,
      checkInterrupted: () => {
        throw new Error("cancelled")
      },
    }),
    /cancelled/,
  )
  assert.equal(f.promoted(), false)
  assert.equal(await fingerprint(f.root), f.baseline)
})

test("post-promotion validation still restores the original project after browser checks pass", async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    validateBeforePromotion({
      ...f.options,
      promote: () =>
        promote({
          root: f.root,
          stage: f.stage,
          backup: f.backup,
          paths: ["apps", "pnpm-lock.yaml"],
          validate: async () => {
            assert.equal(await readFile(join(f.root, f.asset), "utf8"), "candidate asset")
            throw new Error("final validation failed")
          },
        }),
    }),
    /final validation failed/,
  )
  assert.equal(await fingerprint(f.root), f.baseline)
  assert.equal(await readFile(join(f.root, "pnpm-lock.yaml"), "utf8"), "original lock")
  assert.equal(JSON.parse(await readFile(join(f.backup, "journal.json"), "utf8")).state, "rolled-back")
})

test("a real browser-gate timeout stops its process and preserves the original project before promotion", async (t) => {
  const f = await fixture(t)
  const timeouts = reinitTimeouts({ REINIT_BROWSER_TIMEOUT_MS: "100" })
  const runner = createCommandRunner({ graceMs: 1000 })
  t.after(() => runner.close())
  let child: import("node:child_process").ChildProcess | undefined
  await assert.rejects(
    validateBeforePromotion({
      ...f.options,
      run: async (args) => {
        if (args[0] !== "test:web-admin") return
        const handle = runner.start(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          timeoutMs: timeoutForCommand(args, timeouts),
          stdio: "ignore",
        })
        child = handle.child
        const result = await handle.done
        if (result.reason) throw result.reason
        assert.fail("The browser gate exited without timing out")
      },
    }),
    /Timed out \(100ms\)/,
  )
  assert(child)
  assert(child.pid)
  assert(child.exitCode !== null || child.signalCode !== null)
  assert.equal(f.promoted(), false)
  assert.equal(await exists(f.backup), false)
  assert.equal(await fingerprint(f.root), f.baseline)
  assert.equal(await readFile(join(f.root, "pnpm-lock.yaml"), "utf8"), "original lock")
  assert.equal(await readFile(join(f.root, "node_modules/cache"), "utf8"), "original dependencies")
})
