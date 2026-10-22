import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync, execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { copySource } from "../lib/workspace.mts"
import { readConfig, shareTypeScript, integrateTooling } from "../lib/tooling.mts"

const root = fileURLToPath(new URL("../../", import.meta.url))
const lintTimeout = 60_000
const oxlint = (app: string) =>
  join(dirname(createRequire(join(root, app, "package.json")).resolve("oxlint/package.json")), "bin/oxlint")

async function fixture(t: import("node:test").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "browser-client-tooling-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const name of ["typescript-config", "oxlint-config"])
    await copySource(join(root, "packages", name), join(dir, "packages", name))
  return dir
}

test("reinit preserves shared policy edits and new upstream TS options; integration is idempotent", async (t) => {
  const dir = await fixture(t)
  const app = join(dir, "apps/admin")
  await mkdir(app, { recursive: true })
  const file = join(app, "tsconfig.app.json")
  const options = {
    strict: true,
    module: "esnext",
    target: "esnext",
    noUncheckedIndexedAccess: true,
    types: ["vite/client", "custom-env"],
    paths: { "@/*": ["./src/*"] },
    tsBuildInfoFile: "./node_modules/.tmp/app.tsbuildinfo",
  }
  await writeFile(file, JSON.stringify({ compilerOptions: options, include: ["src", "custom"], exclude: ["fixtures"] }))
  await shareTypeScript(dir, app, "tsconfig.app.json", "vite")
  const actual = await readConfig(file)
  assert(actual.compilerOptions)
  assert.equal(actual.compilerOptions!.target, undefined)
  assert.equal(actual.compilerOptions!.noUncheckedIndexedAccess, true)
  assert.deepEqual(actual.compilerOptions!.types, options.types)
  assert.deepEqual(actual.compilerOptions!.paths, options.paths)
  assert.equal(actual.compilerOptions!.tsBuildInfoFile, options.tsBuildInfoFile)
  assert.deepEqual(actual.include, ["src", "custom"])
  assert.deepEqual(actual.exclude, ["fixtures"])
  assert.equal(actual.compilerOptions!.module, undefined)
  const first = await readFile(file, "utf8")
  await shareTypeScript(dir, app, "tsconfig.app.json", "vite")
  assert.equal(await readFile(file, "utf8"), first)

  // Changing a shared preset must survive rebuilding from the official defaults.
  const commonFile = join(dir, "packages/typescript-config/vite-common.json")
  const common = await readConfig(commonFile)
  common.compilerOptions!.target = "ES2022"
  await writeFile(commonFile, JSON.stringify(common))
  await writeFile(file, '{"compilerOptions":{"target":"ES2023"},"include":["src"]}')
  await mkdir(join(app, "src"))
  await writeFile(join(app, "src/index.ts"), "export const answer = 42")
  await mkdir(join(app, "node_modules/@browser-client"), { recursive: true })
  await symlink(join(dir, "packages/typescript-config"), join(app, "node_modules/@browser-client/typescript-config"), "dir")
  await shareTypeScript(dir, app, "tsconfig.app.json", "vite")
  const ts: typeof import("typescript") = createRequire(join(root, "packages/ui/package.json"))("typescript")
  const parsed = ts.getParsedCommandLineOfConfigFile(
    file,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (error) => assert.fail(ts.flattenDiagnosticMessageText(error.messageText, "\n")),
    },
  )
  assert(parsed)
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.options.target, ts.ScriptTarget.ES2022)

  // Preserve a new upstream parent, with explicit project policy taking priority.
  await writeFile(file, JSON.stringify({ extends: "./upstream.json", compilerOptions: { strict: true } }))
  await shareTypeScript(dir, app, "tsconfig.app.json", "vite")
  const inherited = await readConfig(file)
  assert.deepEqual(inherited.extends, ["./upstream.json", "@browser-client/typescript-config/vite.json"])
  assert.equal(inherited.compilerOptions, undefined)
})

test("reinit preserves upstream lint additions while shared rules override template defaults", async (t) => {
  const dir = await fixture(t)
  const app = join(dir, "packages/ui")
  await mkdir(app, { recursive: true })
  await writeFile(join(app, "tsconfig.json"), '{"compilerOptions":{},"include":["src"]}')
  const config = {
    plugins: ["react", "typescript", "oxc"],
    rules: { "react/rules-of-hooks": "warn", "no-alert": "error" },
    overrides: [{ files: ["tests/*"], rules: { "no-alert": "off" } }],
    ignorePatterns: ["generated/**"],
  }
  const file = join(app, ".oxlintrc.json")
  await writeFile(file, JSON.stringify(config))
  await integrateTooling(dir, "ui")
  const actual = await readConfig(file)
  assert.equal(actual.rules!["no-alert"], "error")
  assert.deepEqual(actual.overrides, config.overrides)
  assert.deepEqual(actual.ignorePatterns, config.ignorePatterns)
  assert.equal(actual.rules!["react/rules-of-hooks"], undefined)
  const first = await readFile(file, "utf8")
  await integrateTooling(dir, "ui")
  assert.equal(await readFile(file, "utf8"), first)
})

test("real TypeScript resolves shared presets while keeping consumer-relative paths and environments", () => {
  for (const [app, filename] of [
    ["apps/web", "tsconfig.json"],
    ["apps/admin", "tsconfig.app.json"],
    ["apps/extension", "tsconfig.app.json"],
    ["packages/ui", "tsconfig.json"],
    ["apps/admin", "tsconfig.node.json"],
    ["apps/extension", "tsconfig.node.json"],
  ]) {
    const directory = join(root, app)
    const ts: typeof import("typescript") = createRequire(join(directory, "package.json"))("typescript")
    const config = ts.getParsedCommandLineOfConfigFile(
      join(directory, filename),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (error) => assert.fail(ts.flattenDiagnosticMessageText(error.messageText, "\n")),
      },
    )
    assert(config)
    assert.deepEqual(config.errors, [])
    assert.equal(config.options.strict, true)
    assert.equal(config.options.noEmit, true)
    assert(config.fileNames.length > 0)
    if (filename === "tsconfig.node.json") {
      assert.equal(config.options.module, ts.ModuleKind.NodeNext)
      assert.deepEqual(config.options.types, ["node"])
      assert(!config.options.lib!.some((lib) => lib.includes("dom")))
    } else {
      assert.equal(config.options.jsx, ts.JsxEmit.ReactJSX)
      assert.equal(config.options.pathsBasePath, directory)
    }
    if (config.options.tsBuildInfoFile) assert(config.options.tsBuildInfoFile.startsWith(join(directory, "node_modules")))
    if (app === "apps/extension" && filename === "tsconfig.app.json") assert(config.options.types!.includes("chrome"))
    if (app === "apps/web") assert((config.options.plugins as { name: string }[]).some((plugin) => plugin.name === "next"))
  }
})

test("real Oxlint rejects invalid React Hooks in both applications and the shared UI", async (t) => {
  const dir = await fixture(t)
  const file = join(dir, "Broken.tsx")
  await writeFile(
    file,
    'import { useState } from "react";\nexport function Broken({ enabled }: { enabled: boolean }) { if (enabled) useState(0); return null; }\n',
  )
  for (const app of ["apps/admin", "apps/extension", "packages/ui"]) {
    const result = spawnSync(process.execPath, [oxlint(app), "--config", join(root, app, ".oxlintrc.json"), file], {
      cwd: join(root, app),
      encoding: "utf8",
      timeout: lintTimeout,
    })
    assert.equal(result.status, 1, `${app}: ${result.error ?? result.stdout + result.stderr}`)
    assert.match(result.stdout + result.stderr, /rules-of-hooks/)
  }
  // Options must survive JSON inheritance too, not just rule severity.
  await writeFile(file, "export const answer = 42;\nexport function Probe() { return <div />; }\n")
  for (const app of ["apps/admin", "apps/extension"]) {
    const result = spawnSync(
      process.execPath,
      [oxlint(app), "--config", join(root, app, ".oxlintrc.json"), "--deny-warnings", file],
      { cwd: join(root, app), encoding: "utf8", timeout: lintTimeout },
    )
    assert.equal(result.status, 0, result.error ?? result.stdout + result.stderr)
  }
})

test("real ESLint combines shared policy with Next rules and ignores generated extension output", () => {
  const app = join(root, "apps/web")
  // Match the real CLI's cwd so eslint-plugin-react can detect the app's React.
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict"
    import { ESLint } from "eslint"
    const eslint = new ESLint()
    const config = await eslint.calculateConfigForFile("src/app/page.tsx")
    assert.equal(config.linterOptions.reportUnusedDisableDirectives, 2)
    assert(config.rules["@next/next/no-html-link-for-pages"])
    assert(config.rules["@typescript-eslint/no-unused-vars"])
    assert.equal(await eslint.isPathIgnored("dist-dev/generated.js"), true)
    const [result] = await eslint.lintText("// eslint-disable-next-line no-debugger\\nexport const value = 1;", { filePath: "src/config-probe.ts" })
    assert(result.messages.some((message) => message.severity === 2 && /Unused eslint-disable directive/.test(message.message)))
  `,
    ],
    { cwd: app, encoding: "utf8", timeout: lintTimeout },
  )
})
