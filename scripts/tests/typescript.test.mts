import assert from "node:assert/strict"
import { test } from "node:test"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { ESLint } from "eslint"
import { createCommandRunner } from "../lib/commands.mts"
import { toError } from "../lib/contracts.mts"
import { promote } from "../lib/workspace.mts"

const root = fileURLToPath(new URL("../../", import.meta.url))

test("native TypeScript child commands run without a compiler, loader or installed dependencies", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "browser-client-native-typescript-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const name of ["commands", "command-scopes", "command-diagnostics", "contracts"])
    await cp(join(root, "scripts/lib", name + ".mts"), join(directory, name + ".mts"))
  const file = join(directory, "probe.mts")
  await writeFile(
    file,
    `
    import { createCommandRunner } from "./commands.mts"
    import type { CommandResult } from "./contracts.mts"
    const runner = createCommandRunner({ timeoutMs: 5000 })
    try {
      const result: CommandResult = await runner.start(process.execPath, ["-e", "console.log('native child')"], { capture: true }).done
      if (result.code !== 0 || result.reason || result.error) throw new Error("Nested command failed")
      console.log(result.output)
    } finally { await runner.close() }
  `,
  )
  const runner = createCommandRunner({ timeoutMs: 10000 })
  t.after(() => runner.close())
  assert.equal(await runner.run(process.execPath, [file], { capture: true }), "native child")
})

test("the script typecheck rejects invalid process, dependency and browser contracts and non-erasable syntax", async (t) => {
  const directory = join(root, ".reinit/verification")
  await mkdir(directory, { recursive: true })
  const fixture = await mkdtemp(join(directory, "typescript-contracts-"))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const config = ts.getParsedCommandLineOfConfigFile(
    join(root, "scripts/tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (error) => assert.fail(ts.flattenDiagnosticMessageText(error.messageText, "\n")),
    },
  )
  assert(config)
  assert.deepEqual(config.errors, [])
  const imports = relative(fixture, join(root, "scripts/lib")).replaceAll("\\", "/")
  const prelude = `
    import { createCommandRunner } from "${imports}/commands.mts"
    import { updateDependencies } from "${imports}/updates.mts"
    import type { DependencyDecision, HmrConfig } from "${imports}/contracts.mts"
  `
  const source = {
    "valid.mts": `
      ${prelude}
      const runner = createCommandRunner({ timeoutMs: 1000 })
      const decision: DependencyDecision = { id: "tool", name: "tool", version: "1.0.0" }
      const hmr: HmrConfig = { file: "apps/extension/src/App.tsx", update: source => source + "!", verify: async () => {} }
      void updateDependencies({ root: ".", templates: {}, previous: {}, offline: true })
      void [runner, decision, hmr]
    `,
    "invalid.mts": `
      ${prelude}
      createCommandRunner({ timeoutMs: "slow" })
      const decision: DependencyDecision = { id: "tool", name: "tool", version: 1 }
      const hmr: HmrConfig = { file: "apps/extension/src/App.tsx", update: () => 123, verify: async () => {} }
      void updateDependencies({ root: ".", templates: {}, previous: {} })
      enum Unsupported { Value }
      void [decision, hmr]
    `,
  }
  for (const [name, text] of Object.entries(source)) {
    const path = join(fixture, name)
    await writeFile(path, text)
    const program: ts.Program = ts.createProgram([path], config.options)
    const errors: ts.Diagnostic[] = ts
      .getPreEmitDiagnostics(program)
      .filter((error) => error.category === ts.DiagnosticCategory.Error)
    if (name === "valid.mts")
      assert.deepEqual(
        errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")),
        [],
      )
    else {
      assert(
        errors.every((error) => error.file?.fileName === path),
        "Invalid imports or toolchain setup caused the errors",
      )
      assert.equal(errors.filter((error) => error.code === 2322).length, 3, "Invalid timeout, version and HMR result must fail")
      assert(
        errors.some((error) => error.code === 2345),
        "Online planning must require a registry",
      )
      assert(
        errors.some((error) => error.code === 1294),
        "Runtime-transforming syntax must fail the Node preset",
      )
    }
  }
})

test("shared Node lint rules remain effective for TypeScript scripts", async () => {
  const eslint = new ESLint({ cwd: root })
  const [valid] = await eslint.lintText(
    'import type { CommandResult } from "./lib/contracts.mts"; export const output = (result: CommandResult): string => result.output',
    { filePath: "scripts/lint-contract.mts" },
  )
  assert.equal(valid.errorCount, 0, JSON.stringify(valid.messages))
  const [invalid] = await eslint.lintText("export function value(input: any) { return input; const unused = 1 }", {
    filePath: "scripts/lint-contract.mts",
  })
  for (const rule of ["@typescript-eslint/no-explicit-any", "@typescript-eslint/no-unused-vars", "no-unreachable"])
    assert(
      invalid.messages.some((message) => message.ruleId === rule),
      `TypeScript script lint lost ${rule}`,
    )
  for (const expression of ["document.title", "window.location.href", "chrome.runtime.id"]) {
    const [node] = await eslint.lintText("export const read = () => " + expression, {
      filePath: "scripts/context-contract.mts",
    })
    assert(
      node.messages.some((message) => message.ruleId === "no-restricted-globals"),
      "Node scripts must reject " + expression,
    )
  }
  const [browser] = await eslint.lintText("export const read = () => document.title", {
    filePath: "scripts/lib/web-verification.mts",
  })
  assert.equal(browser.errorCount, 0, JSON.stringify(browser.messages))
})

test("unknown failures retain recovery flags and real Error identity", () => {
  const original = Object.assign(new Error("process exit unconfirmed"), { unsafeToRestore: true, code: "EPERM" })
  assert.equal(toError(original), original)
  assert.equal(toError(original).unsafeToRestore, true)
  const serialized = toError({ message: "inherited ownership failure", code: "EACCES", unsafeToRestore: true })
  assert.equal(serialized.message, "inherited ownership failure")
  assert.equal(serialized.code, "EACCES")
  assert.equal(serialized.unsafeToRestore, true)
  assert.equal(toError("cancelled").message, "cancelled")
  assert.equal(toError(null).unsafeToRestore, undefined)
  const prototypeFree = Object.assign(Object.create(null), { unsafeToRestore: true })
  assert.equal(toError(prototypeFree).message, "Unknown failure")
  assert.equal(toError(prototypeFree).unsafeToRestore, true)
  for (const marker of [1, "unconfirmed", {}]) assert.equal(toError({ unsafeToRestore: marker }).unsafeToRestore, true)
  const unreadable = Object.defineProperty({}, "message", {
    get() {
      throw new Error("unreadable")
    },
  })
  assert.equal(toError(unreadable).unsafeToRestore, true)
  assert.match(toError(unreadable).message, /manual recovery/)
})

test("untrusted failure metadata retains both project versions and requires manual recovery", async (t) => {
  for (const kind of ["prototype-free marker", "unreadable metadata"])
    await t.test(kind, async (t) => {
      const directory = await mkdtemp(join(tmpdir(), "browser-client-unknown-recovery-"))
      t.after(() => rm(directory, { recursive: true, force: true }))
      const original = join(directory, "original"),
        stage = join(directory, "stage"),
        backup = join(directory, "backup")
      for (const path of [original, stage]) await mkdir(join(path, "apps"), { recursive: true })
      await writeFile(join(original, "apps/data"), "original")
      await writeFile(join(stage, "apps/data"), "candidate")
      const failure: unknown =
        kind === "prototype-free marker"
          ? Object.assign(Object.create(null), { unsafeToRestore: "unconfirmed" })
          : Object.defineProperty({}, "message", {
              get() {
                throw new Error("unreadable")
              },
            })
      await assert.rejects(
        promote({
          root: original,
          stage,
          backup,
          paths: ["apps"],
          validate: async () => {
            throw failure
          },
        }),
        (error) => toError(error).unsafeToRestore === true,
      )
      assert.equal(JSON.parse(await readFile(join(backup, "journal.json"), "utf8")).state, "recovery-required")
      assert.equal(await readFile(join(original, "apps/data"), "utf8"), "candidate")
      assert.equal(await readFile(join(backup, "apps/data"), "utf8"), "original")
    })
})
