import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { normalizeAppGitignore } from "../lib/gitignore.mts"

const source = fileURLToPath(new URL("../../", import.meta.url))

async function fixture(t: import("node:test").TestContext) {
  const root = await mkdtemp(join(tmpdir(), "browser-client-gitignore-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return root
}

function ignored(root: string, path: string) {
  const result = spawnSync("git", ["-c", "core.excludesFile=/dev/null", "check-ignore", "--no-index", "--quiet", "--", path], {
    cwd: root,
    encoding: "utf8",
  })
  assert(result.status !== null)
  assert([0, 1].includes(result.status), result.stderr)
  return result.status === 0
}

test("Git preserves generated-looking business paths and environment examples at every workspace", async (t) => {
  const root = await fixture(t)
  for (const path of [".", "apps/web", "apps/admin", "apps/extension"]) {
    await mkdir(join(root, path), { recursive: true })
    await writeFile(join(root, path, ".gitignore"), await readFile(join(source, path, ".gitignore")))
  }
  for (const workspace of [".", "apps/web", "apps/admin", "apps/extension", "packages/ui"]) {
    for (const path of [
      "public/dist/vendor.js",
      "public/dist-dev/config.json",
      "public/.next/icon.svg",
      "public/.turbo/data.json",
      "public/.reinit/fixture.json",
      "public/node_modules/vendor.css",
      "src/dist/feature.ts",
      "src/cache.tsbuildinfo",
      "src/next-env.d.ts",
      ".env.example",
      ".env.production.example",
    ]) {
      assert.equal(ignored(root, join(workspace, path)), false, `${workspace}/${path} must remain committable`)
    }
    for (const path of [
      "node_modules/cache",
      "dist/bundle.js",
      "dist-dev/manifest.json",
      "dist-ssr/server.js",
      ".next/cache",
      ".turbo/log",
      ".reinit/private.json",
      "coverage/report.json",
      "app.tsbuildinfo",
      ".env",
      ".env.local",
      ".env.production",
    ]) {
      assert.equal(ignored(root, join(workspace, path)), true, `${workspace}/${path} must stay ignored`)
    }
  }
  assert.equal(ignored(root, "docs/dist/example.json"), false)
  assert.equal(ignored(root, "apps/web/next-env.d.ts"), true)
})

test("fresh official ignore rules are normalized without dropping upstream custom exclusions", async (t) => {
  const root = await fixture(t)
  const upstream =
    "# upstream\nnode_modules\ndist\ndist-dev\n.next/\n*.tsbuildinfo\nnext-env.d.ts\n!.env.example\n.env*\n/scratch/\nliteral\\ "
  const normalized = normalizeAppGitignore(upstream)
  assert.equal(normalizeAppGitignore(normalized), normalized)
  await writeFile(join(root, ".gitignore"), normalized)
  for (const path of [
    "public/dist/a.js",
    "src/.next/data.json",
    "src/cache.tsbuildinfo",
    "src/next-env.d.ts",
    ".env.example",
    ".env.test.example",
  ])
    assert.equal(ignored(root, path), false, path)
  for (const path of [
    "node_modules/a.js",
    "dist/b.js",
    "dist-dev/c.js",
    ".next/data.json",
    "app.tsbuildinfo",
    "next-env.d.ts",
    ".env.local",
    "scratch/a.txt",
  ])
    assert.equal(ignored(root, path), true, path)
  assert(normalized.includes("# upstream"))
  assert.equal(ignored(root, "literal "), true, "A final escaped space must retain its literal meaning")
  assert.equal(ignored(root, "literal"), false, "Normalizing a rule must not change the excluded filename")
})
