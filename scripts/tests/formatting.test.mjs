import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { format, getFileInfo, resolveConfig } from "prettier"
import { formatReinitFiles } from "../lib/formatting.mjs"

const repository = fileURLToPath(new URL("../../", import.meta.url))
const prettierCli = join(repository, "node_modules/prettier/bin/prettier.cjs")

async function put(root, path, text) {
  const file = join(root, path)
  await mkdir(join(file, ".."), { recursive: true })
  await writeFile(file, text)
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "browser-client-formatting-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await put(root, ".prettierrc.json", JSON.stringify({ semi: false, printWidth: 128 }))
  await put(root, ".prettierignore", await readFile(join(repository, ".prettierignore"), "utf8"))
  await put(root, ".gitignore", "dist/\n.reinit/\n")
  await put(root, "package.json", '{"name":"fixture","private":true}')
  await put(root, "pnpm-workspace.yaml", "packages: ['apps/*', 'packages/*']\n")
  await put(root, "apps/web/package.json", '{"name":"web"}')
  await put(root, "apps/extension/package.json", '{"name":"extension"}')
  await put(root, "apps/dist/package.json", '{"name":"extra-business-app"}')
  await put(root, "packages/ui/package.json", '{"name":"ui"}')
  return root
}

test("reinit formats generated configs and updated manifests without rewriting business or editor files", async (t) => {
  const root = await fixture(t)
  await put(root, "apps/extension/vite.config.ts", "export default {server:{port:3002}};")
  await put(root, "apps/extension/components.json", '{"rsc":false}')
  const preserved = {
    "apps/web/next.config.ts": "export default {reactStrictMode:true};",
    "apps/extension/manifest.config.ts": 'export default {name:"Business manifest"};',
    "apps/extension/src/dist/feature.ts": "export const feature={enabled:true};",
    "apps/extension/public/dist/vendor.js": "const vendor={keep:true};",
    "packages/ui/src/components/button.tsx": 'export const Button=()=> <button className="p-4 flex"/>;',
    ".vscode/settings.json": '{"editor.formatOnSave":true}',
    "AGENTS.md": "# protected\n",
  }
  for (const [path, value] of Object.entries(preserved)) await put(root, path, value)
  const changes = await formatReinitFiles(root, ["extension"])
  for (const path of [
    "package.json",
    "apps/web/package.json",
    "apps/dist/package.json",
    "packages/ui/package.json",
    "apps/extension/vite.config.ts",
    "apps/extension/components.json",
  ]) {
    assert(changes.includes(path), `${path} was not formatted`)
  }
  assert.equal(
    await readFile(join(root, "apps/extension/vite.config.ts"), "utf8"),
    "export default { server: { port: 3002 } }\n",
  )
  for (const [path, value] of Object.entries(preserved)) assert.equal(await readFile(join(root, path), "utf8"), value, path)
  assert.deepEqual(await formatReinitFiles(root, ["extension"]), [], "formatting must be idempotent")
})

test("invalid generated configuration fails before writing any candidate files", async (t) => {
  const root = await fixture(t)
  const original = await readFile(join(root, "package.json"), "utf8")
  await put(root, "apps/extension/vite.config.ts", "export default {broken:")
  await assert.rejects(formatReinitFiles(root, ["extension"]), /SyntaxError/)
  assert.equal(await readFile(join(root, "package.json"), "utf8"), original)
  await assert.rejects(formatReinitFiles(root, ["../../outside"]), /未知/)
})

test("format checks include nested business dist trees even when Git ignores dist", async (t) => {
  const root = await fixture(t)
  const check = (path) =>
    spawnSync(process.execPath, [prettierCli, "--ignore-path", ".prettierignore", "--check", path], {
      cwd: root,
      encoding: "utf8",
    })
  for (const path of ["apps/web/src/dist/feature.ts", "packages/ui/src/dist/feature.ts", "apps/dist/src/feature.ts"]) {
    await put(root, path, "export const feature={enabled:true};")
    const result = check(path)
    assert.equal(result.status, 1, `${path}: ${result.stdout}${result.stderr}`)
    assert.match(result.stderr, /Code style issues/)
  }
  for (const path of [
    "apps/extension/dist/bundle.js",
    "apps/web/.next/server.js",
    ".reinit/staging/source.js",
    "apps/web/public/dist/vendor.js",
    "AGENTS.md",
    "patches/fix.patch",
  ]) {
    await put(root, path, "intentionally invalid source {{{")
    const result = check(path)
    assert.equal(result.status, 0, `${path}: ${result.stdout}${result.stderr}`)
  }
})

test("the shared Tailwind v4 theme sorts JSX and cn/cva classes consistently", async () => {
  const file = join(repository, "apps/web/src/format-regression.tsx")
  const config = await resolveConfig(file)
  const result = await format(
    'export const C = () => <div className="p-4 bg-primary flex text-primary-foreground" />;\nexport const classes = cn("p-4 bg-primary flex");\nexport const variants = cva("p-4 bg-primary flex");',
    { ...config, filepath: file },
  )
  assert(result.includes('className="flex bg-primary p-4 text-primary-foreground"'), result)
  assert(result.includes('cn("flex bg-primary p-4")'), result)
  assert(result.includes('cva("flex bg-primary p-4")'), result)
  assert.equal(await format(result, { ...config, filepath: file }), result)
  const info = await getFileInfo(join(repository, "AGENTS.md"), { ignorePath: join(repository, ".prettierignore") })
  assert.equal(info.ignored, true)
})
