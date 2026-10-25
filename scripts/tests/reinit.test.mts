import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, lstat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { integrate, mergeManifest } from "../lib/integrate.mts"
import { parseArgs } from "../reinit.mts"
import { copySource, exists, fingerprint, preserveApp, promote } from "../lib/workspace.mts"

async function fixture(t: import("node:test").TestContext) {
  const root = await mkdtemp(join(tmpdir(), "browser-client-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
async function put(root: string, path: string, value: string) {
  const file = join(root, path)
  await mkdir(join(file, ".."), { recursive: true })
  await writeFile(file, value)
}

async function sharedConfigs(root: string) {
  for (const name of ["typescript-config", "oxlint-config"]) {
    await copySource(fileURLToPath(new URL(`../../packages/${name}`, import.meta.url)), join(root, "packages", name))
  }
}

test("default is read-only; unknown targets and conflicting flags fail closed", () => {
  assert.equal(parseArgs([]).apply, false)
  assert.equal(parseArgs(["--apply", "--offline"]).offline, true)
  assert.deepEqual(parseArgs(["web", "--apply"]).selected, ["web"])
  assert.throws(() => parseArgs(["../../elsewhere", "--apply"]))
  assert.throws(() => parseArgs(["--force"]))
  assert.throws(() => parseArgs(["--dry-run", "--apply"]))
})

test("official versions win while custom dependencies and scripts survive", () => {
  const previous = {
    dependencies: { next: "old", custom: "^1", typescript: "old" },
    scripts: { build: "old", seed: "custom" },
    version: "1.2.3",
  }
  const template = { dependencies: { next: "new" }, devDependencies: { typescript: "new" }, scripts: { build: "next build" } }
  const result = mergeManifest(template, previous, "web")
  assert.equal(result.dependencies.next, "new")
  assert.equal(result.dependencies.custom, "^1")
  assert.equal(result.dependencies.typescript, undefined)
  assert.equal(result.devDependencies.typescript, "new")
  assert.equal(result.scripts.seed, "custom")
  assert.equal(result.scripts.build, "next build")
  assert.equal(result.dependencies["@browser-client/ui"], "workspace:*")
  assert.equal(result.version, "1.2.3")
  assert.equal(result.devDependencies["@browser-client/typescript-config"], "workspace:*")
  assert.equal(result.devDependencies["@browser-client/eslint-config"], "workspace:*")
})

test("source, agent instructions, untracked files, env and manifest survive; generated configs refresh", async (t) => {
  const root = await fixture(t)
  const old = join(root, "old"),
    stage = join(root, "stage")
  await put(old, "src/feature.ts", "business")
  await put(old, "AGENTS.md", "# Existing application instructions\n\nKeep the official managed block and custom rules.\n")
  await put(old, ".env.local", "test-only")
  await put(old, "public/manifest.json", "manifest")
  await put(old, "manifest.config.ts", "typed-business-manifest")
  await put(old, "dist-dev/manifest.json", "generated-dev-manifest")
  await put(old, "options.html", "options")
  await put(old, "vite.config.ts", "old-config")
  await put(old, "pnpm-workspace.yaml", "nested-workspace")
  await put(old, "node_modules/cache", "ignored")
  await put(stage, "src/demo.ts", "upstream-demo")
  await put(stage, "AGENTS.md", "upstream instructions")
  await put(stage, "vite.config.ts", "new-config")
  await preserveApp(old, stage)
  for (const [file, value] of [
    ["src/feature.ts", "business"],
    ["AGENTS.md", "# Existing application instructions\n\nKeep the official managed block and custom rules.\n"],
    [".env.local", "test-only"],
    ["public/manifest.json", "manifest"],
    ["options.html", "options"],
    ["vite.config.ts", "new-config"],
  ]) {
    assert.equal(await readFile(join(stage, file), "utf8"), value)
  }
  assert.equal(await exists(join(stage, "src/demo.ts")), false)
  assert.equal(await exists(join(stage, "node_modules")), false)
  assert.equal(await exists(join(stage, "pnpm-workspace.yaml")), false)
  assert.equal(await readFile(join(stage, "manifest.config.ts"), "utf8"), "typed-business-manifest")
  assert.equal(await exists(join(stage, "dist-dev")), false)
  assert.equal(await readFile(join(old, "vite.config.ts"), "utf8"), "old-config")
})

test("business trees retain generated-looking names while app build outputs stay excluded", async (t) => {
  const root = await fixture(t),
    original = join(root, "original"),
    stage = join(root, "stage")
  const business = [
    "public/dist/vendor.js",
    "public/dist-dev/config.json",
    "public/.next/icon.svg",
    "public/.turbo/data.json",
    "public/.reinit/fixture.json",
    "public/node_modules/vendor.css",
    "public/.git/fixture.txt",
    "src/dist/feature.ts",
    "src/cache.tsbuildinfo",
  ]
  for (const file of business) await put(original, file, `business:${file}`)
  for (const file of [
    "dist/bundle.js",
    "dist-dev/manifest.json",
    ".next/cache",
    ".turbo/log",
    "node_modules/cache",
    "app.tsbuildinfo",
  ]) {
    await put(original, file, "generated")
  }
  await preserveApp(original, stage)
  for (const file of business) assert.equal(await readFile(join(stage, file), "utf8"), `business:${file}`)
  for (const name of ["dist", "dist-dev", ".next", ".turbo", "node_modules", "app.tsbuildinfo"])
    assert.equal(await exists(join(stage, name)), false)
})

test("Admin routes, block components and router dependencies survive an official template refresh", async (t) => {
  const root = await fixture(t)
  const previous = join(root, "previous")
  const candidate = join(root, "candidate")
  const admin = fileURLToPath(new URL("../../templates/admin/", import.meta.url))
  await copySource(join(admin, "src"), join(previous, "src"))
  await put(candidate, "src/App.tsx", "official demo")
  await put(candidate, "src/demo.ts", "official demo")
  await put(candidate, "vite.config.ts", "new official config")
  await preserveApp(previous, candidate)
  assert.equal(await fingerprint(join(candidate, "src")), await fingerprint(join(previous, "src")))
  assert.equal(await exists(join(candidate, "src/demo.ts")), false)
  const manifest = JSON.parse(await readFile(join(admin, "package.json"), "utf8"))
  const merged = mergeManifest({ dependencies: { react: "new stable" } }, manifest, "admin")
  for (const name of ["react-router", "lucide-react", "@browser-client/ui"])
    assert.equal(merged.dependencies[name], manifest.dependencies[name], name)
  assert.equal(merged.dependencies.react, "new stable")
  assert.equal(await readFile(join(candidate, "vite.config.ts"), "utf8"), "new official config")
})

test("Welcome, Overview, Workspace and Settings pages and browser hooks survive template refreshes", async (t) => {
  const root = await fixture(t)
  const source = fileURLToPath(new URL("../../", import.meta.url))
  for (const target of ["web", "admin", "extension"]) {
    const previous = join(root, "previous", target)
    const candidate = join(root, "candidate", target)
    const original = join(source, "templates", target)
    await copySource(original, previous)
    const pages =
      target === "web"
        ? ["src/app/page.tsx"]
        : target === "admin"
          ? ["src/pages/home.tsx"]
          : ["src/pages/popup.tsx", "src/pages/options.tsx"]
    for (const page of pages) await put(candidate, page, "upstream starter title")
    await put(candidate, "src/official-demo.tsx", "upstream demo")
    await put(candidate, target === "web" ? "next.config.ts" : "vite.config.ts", "new framework configuration")
    await preserveApp(previous, candidate)
    for (const tree of ["src", "public"])
      assert.equal(await fingerprint(join(candidate, tree)), await fingerprint(join(previous, tree)), `${target}/${tree}`)
    assert.equal(await exists(join(candidate, "src/official-demo.tsx")), false)
    if (target !== "web")
      assert.equal(await readFile(join(candidate, "index.html"), "utf8"), await readFile(join(original, "index.html"), "utf8"))
    if (target === "extension") {
      for (const file of ["index.html", "options.html", "manifest.config.ts"])
        assert.equal(await readFile(join(candidate, file), "utf8"), await readFile(join(original, file), "utf8"))
    }
    const manifest = await readFile(join(original, "package.json"), "utf8").then(JSON.parse)
    const merged = mergeManifest({ dependencies: { react: "latest stable" } }, manifest, target)
    assert.equal(merged.dependencies["@browser-client/ui"], "workspace:*")
    assert.equal(merged.dependencies.react, "latest stable")
    if (target === "extension") assert.equal(merged.scripts["preview:ui"], "vite --mode preview-ui")
  }
  for (const path of [
    "packages/ui",
    "packages/eslint-config",
    "browser-tests.config.mts",
    "scripts/lib/web-verification.mts",
    "scripts/lib/admin-verification.mts",
    "scripts/lib/extension-verification.mts",
    "scripts/lib/theme-verification.mts",
    "scripts/tests/lint-scopes.test.mts",
    "scripts/tests/sidebar-state.test.mts",
    "scripts/tests/security.test.mts",
  ]) {
    await copySource(join(source, path), join(root, "candidate", path), { root: source })
    assert.equal(await fingerprint(join(root, "candidate", path)), await fingerprint(join(source, path)), path)
  }
})

test("workspace copies preserve nested business assets in apps and shared packages", async (t) => {
  const root = await fixture(t),
    stage = join(root, ".reinit/stage")
  const business = [
    "apps/web/public/dist/vendor.js",
    "apps/dist/src/dist/feature.ts",
    "packages/ui/src/dist/component.tsx",
    "docs/dist/example.json",
  ]
  const generated = [
    "apps/web/dist/bundle.js",
    "apps/web/.next/cache",
    "apps/web/app.tsbuildinfo",
    "packages/ui/.turbo/log",
    "packages/ui/node_modules/cache",
  ]
  for (const file of business) await put(root, file, `business:${file}`)
  for (const file of generated) await put(root, file, "generated")
  for (const name of ["apps", "packages", "docs"]) await copySource(join(root, name), join(stage, name), { root })
  for (const file of business) assert.equal(await readFile(join(stage, file), "utf8"), `business:${file}`)
  for (const file of generated) assert.equal(await exists(join(stage, file)), false)
})

test("fingerprints detect edits, additions and deletions inside generated-looking business paths", async (t) => {
  const root = await fixture(t)
  const asset = "apps/web/public/dist/vendor.js",
    component = "packages/ui/src/dist/component.tsx"
  await put(root, asset, "original")
  await put(root, component, "component")
  const before = await fingerprint(root)
  for (const file of [
    ".reinit/stage/file",
    "apps/web/dist/bundle.js",
    "apps/web/.next/cache",
    "packages/ui/.turbo/log",
    "packages/ui/ui.tsbuildinfo",
  ]) {
    await put(root, file, "generated")
  }
  assert.equal(await fingerprint(root), before)
  await put(root, asset, "edited")
  assert.notEqual(await fingerprint(root), before)
  await put(root, asset, "original")
  assert.equal(await fingerprint(root), before)
  await put(root, "apps/web/public/dist-dev/new.json", "new")
  assert.notEqual(await fingerprint(root), before)
  await rm(join(root, "apps/web/public/dist-dev"), { recursive: true })
  assert.equal(await fingerprint(root), before)
  await rm(join(root, component))
  assert.notEqual(await fingerprint(root), before)
})

test("Next adapter retains upstream CSS settings and removes the nested workspace", async (t) => {
  const root = await fixture(t)
  await sharedConfigs(root)
  await put(
    root,
    "packages/ui/components.json",
    JSON.stringify({
      style: "base-nova",
      menuColor: "default",
      menuAccent: "subtle",
      rtl: false,
      iconLibrary: "lucide",
      tailwind: { css: "src/styles/globals.css", baseColor: "neutral" },
    }),
  )
  await put(root, "apps/web/package.json", JSON.stringify({ version: "0.1.0", scripts: {}, dependencies: {} }))
  await put(root, "apps/web/pnpm-workspace.yaml", "allowBuilds: {}")
  await put(root, "apps/web/.gitignore", ".next/\n*.tsbuildinfo\n.env*\n/custom-output/\n")
  await put(
    root,
    "apps/web/next.config.ts",
    'const nextConfig: NextConfig = { turbopack: { rules: { "*.css": { loaders: ["upstream-loader"] } } } }; export default nextConfig;',
  )
  await put(
    root,
    "apps/web/tsconfig.json",
    '{"compilerOptions":{"strict":true,"plugins":[{"name":"next"}]},"include":[".next/types/**/*.ts"]}',
  )
  await put(
    root,
    "apps/web/eslint.config.mjs",
    'import { defineConfig } from "eslint/config";\nexport default defineConfig([{ rules: { "no-debugger": "error" } }]);',
  )
  await integrate(root, "web")
  const config = await readFile(join(root, "apps/web/next.config.ts"), "utf8")
  assert(config.includes("upstream-loader"))
  assert(config.includes('transpilePackages: ["@browser-client/ui"]'))
  assert(config.includes('import { withVerificationResources } from "../../scripts/lib/verification-resources.mts"'))
  assert(config.includes("export default withVerificationResources(nextConfig)"))
  assert.equal(await exists(join(root, "apps/web/pnpm-workspace.yaml")), false)
  const gitignore = await readFile(join(root, "apps/web/.gitignore"), "utf8")
  assert(gitignore.includes("/.next/\n"))
  assert(gitignore.includes("/*.tsbuildinfo\n"))
  assert(gitignore.includes("/custom-output/\n"))
  assert(gitignore.endsWith("!.env.example\n!.env.*.example\n"))
  assert.equal(
    JSON.parse(await readFile(join(root, "apps/web/components.json"), "utf8")).aliases.ui,
    "@browser-client/ui/components",
  )
  const componentConfig = JSON.parse(await readFile(join(root, "apps/web/components.json"), "utf8"))
  assert.equal(componentConfig.menuColor, "default")
  assert.equal(componentConfig.menuAccent, "subtle")
  assert.equal(componentConfig.rtl, false)
  assert.equal(componentConfig.iconLibrary, "lucide")
  assert.equal(componentConfig.tailwind.baseColor, "neutral")
  const ts = JSON.parse(await readFile(join(root, "apps/web/tsconfig.json"), "utf8"))
  assert.equal(ts.extends, "@browser-client/typescript-config/nextjs.json")
  assert.deepEqual(ts.compilerOptions.plugins, [{ name: "next" }])
  assert.deepEqual(ts.include, [".next/types/**/*.ts"])
  const eslint = await readFile(join(root, "apps/web/eslint.config.mjs"), "utf8")
  assert(eslint.includes('"@browser-client/eslint-config/base"'))
  assert(eslint.includes('"no-debugger": "error"'))
})

test("unsupported upstream layout fails instead of silently omitting integration", async (t) => {
  const root = await fixture(t)
  await put(root, "packages/ui/components.json", JSON.stringify({ tailwind: {} }))
  await put(root, "apps/admin/package.json", JSON.stringify({ scripts: {}, dependencies: {} }))
  await put(root, "apps/admin/vite.config.ts", "export default newConfigAPI()")
  await assert.rejects(integrate(root, "admin"), /Official template structure changed/)
})

test("extension reinit reapplies CRXJS and shared UI while preserving the manifest", async (t) => {
  const root = await fixture(t)
  await sharedConfigs(root)
  const app = join(root, "apps/extension")
  await put(root, "packages/ui/components.json", JSON.stringify({ tailwind: {} }))
  await put(root, "pnpm-workspace.yaml", 'catalog:\n  react: 19.3.0\n  tailwindcss: ^4.1.0\n  "@tailwindcss/vite": ^4.1.0\n')
  await put(
    app,
    "package.json",
    JSON.stringify({
      scripts: { dev: "vite", build: "tsc -b && vite build" },
      dependencies: { react: "^19.2.8" },
      devDependencies: { vite: "^8.3.0" },
    }),
  )
  await put(
    app,
    "vite.config.ts",
    "import react from '@vitejs/plugin-react'\nimport { defineConfig } from 'vite'\nexport default defineConfig({\n  plugins: [react()],\n})\n",
  )
  for (const file of ["tsconfig.json", "tsconfig.app.json", "tsconfig.node.json"])
    await put(app, file, '{"compilerOptions":{}}')
  await put(app, ".oxlintrc.json", '{"plugins":["react","typescript","oxc"],"rules":{"react/rules-of-hooks":"error"}}')
  await put(app, ".gitignore", "node_modules\ndist\n.env*\n")
  const previous = { devDependencies: { "@crxjs/vite-plugin": "3.0.0" }, scripts: { "preview:ui": "vite" } }
  await integrate(root, "extension", previous)
  const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8"))
  assert.equal(pkg.devDependencies["@crxjs/vite-plugin"], "3.0.0")
  assert.equal(pkg.scripts.dev, "vite")
  assert.equal(pkg.scripts["preview:ui"], "vite --mode preview-ui")
  assert.equal(pkg.dependencies["@browser-client/ui"], "workspace:*")
  assert.equal(pkg.dependencies.react, "catalog:")
  assert.equal(pkg.devDependencies.tailwindcss, "catalog:")
  assert.equal(pkg.devDependencies["@browser-client/oxlint-config"], "workspace:*")
  assert.equal(
    await readFile(join(app, ".gitignore"), "utf8"),
    "/node_modules/\n/dist/\n.env*\n!.env.example\n!.env.*.example\n",
  )
  const config = await readFile(join(app, "vite.config.ts"), "utf8")
  assert(config.includes('import manifest from "./manifest.config.ts"'))
  assert(config.includes("crx({ manifest })"))
  assert(config.includes('outDir: command === "serve" ? "dist-dev" : "dist"'))
  assert(config.includes("ws: { clientPort: port }"))
  assert(config.includes('name: "browser-client:theme-bootstrap"'))
  assert(config.includes('if (id === "/theme-init.js")'))
  assert(config.includes('new URL("../../packages/ui/src/lib/theme-init.js", import.meta.url)'))
  assert(!config.includes("rollupOptions"))
  assert.deepEqual(JSON.parse(await readFile(join(app, "tsconfig.app.json"), "utf8")).compilerOptions.types, ["chrome"])
  assert.equal(
    JSON.parse(await readFile(join(app, "tsconfig.app.json"), "utf8")).extends,
    "@browser-client/typescript-config/vite.json",
  )
  assert.equal(
    JSON.parse(await readFile(join(app, "tsconfig.node.json"), "utf8")).extends,
    "@browser-client/typescript-config/vite-node.json",
  )
  assert.deepEqual(JSON.parse(await readFile(join(app, ".oxlintrc.json"), "utf8")).extends, [
    "./node_modules/@browser-client/oxlint-config/react-app.json",
  ])
})

test("cancellation between moves restores the original tree", async (t) => {
  const base = await fixture(t)
  const root = join(base, "root"),
    stage = join(base, "stage"),
    backup = join(base, "backup")
  await put(root, "apps/data", "original")
  await put(stage, "apps/data", "candidate")
  let checks = 0
  await assert.rejects(
    promote({
      root,
      stage,
      backup,
      paths: ["apps"],
      validate: async () => assert.fail("must not validate"),
      checkInterrupted: () => {
        if (++checks === 2) throw new Error("cancelled")
      },
    }),
    /cancelled/,
  )
  assert.equal(await readFile(join(root, "apps/data"), "utf8"), "original")
})

test("fingerprint detects edits, additions and deletions but ignores build caches", async (t) => {
  const root = await fixture(t)
  await put(root, "src/a.ts", "original")
  const initial = await fingerprint(root)
  await put(root, ".reinit/staging/file", "internal")
  await put(root, "node_modules/file", "cache")
  await put(root, "dist-dev/manifest.json", "generated")
  assert.equal(await fingerprint(root), initial)
  await put(root, "src/a.ts", "edited")
  assert.notEqual(await fingerprint(root), initial)
  await put(root, "src/a.ts", "original")
  await put(root, "src/untracked.ts", "new")
  assert.notEqual(await fingerprint(root), initial)
  await rm(join(root, "src/untracked.ts"))
  assert.equal(await fingerprint(root), initial)
  await rm(join(root, "src/a.ts"))
  assert.notEqual(await fingerprint(root), initial)
})

test("source symlinks are rejected instead of copying outside the workspace", async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, "src"))
  await put(root, "outside.txt", "private")
  await symlink(join(root, "outside.txt"), join(root, "src/link"))
  await assert.rejects(copySource(join(root, "src"), join(root, "copy")), /symbolic link/)
  await assert.rejects(fingerprint(join(root, "src")), /symbolic link/)
})

test("fingerprint distinguishes file bytes from a following file record", async (t) => {
  const root = await fixture(t)
  await put(root, "a.ts", "")
  const mode = (await lstat(join(root, "a.ts"))).mode
  const prefix = "// original source "
  const added = "export const added = 42;\n"
  // These trees produced identical input bytes for the old streaming hash.
  await put(root, "a.ts", prefix + JSON.stringify(["/b.ts", mode]) + added)
  const before = await fingerprint(root)
  await put(root, "a.ts", prefix)
  await put(root, "b.ts", added)
  assert.notEqual(await fingerprint(root), before, "an added file must invalidate the reinit snapshot")
  await rm(join(root, "b.ts"))
  await put(root, "a.ts", prefix + JSON.stringify(["/b.ts", mode]) + added)
  assert.equal(await fingerprint(root), before)
})

test("successful promotion keeps an exact backup including untracked files", async (t) => {
  const base = await fixture(t)
  const root = join(base, "root"),
    stage = join(base, "stage"),
    backup = join(base, "backup")
  await put(root, "apps/custom.txt", "old-untracked")
  await put(root, "pnpm-lock.yaml", "old-lock")
  await put(stage, "apps/custom.txt", "new")
  await put(stage, "pnpm-lock.yaml", "new-lock")
  await promote({
    root,
    stage,
    backup,
    paths: ["apps", "pnpm-lock.yaml"],
    validate: async () => {
      assert.equal(await readFile(join(root, "apps/custom.txt"), "utf8"), "new")
    },
  })
  assert.equal(await readFile(join(backup, "apps/custom.txt"), "utf8"), "old-untracked")
  assert.equal(await readFile(join(backup, "pnpm-lock.yaml"), "utf8"), "old-lock")
  assert.equal(JSON.parse(await readFile(join(backup, "journal.json"), "utf8")).state, "complete")
})

test("failed final validation restores source and lockfile without deleting the candidate", async (t) => {
  const base = await fixture(t)
  const root = join(base, "root"),
    stage = join(base, "stage"),
    backup = join(base, "backup")
  await put(root, "apps/data", "original")
  await put(root, "pnpm-lock.yaml", "original-lock")
  await put(stage, "apps/data", "candidate")
  await put(stage, "pnpm-lock.yaml", "candidate-lock")
  await assert.rejects(
    promote({
      root,
      stage,
      backup,
      paths: ["apps", "pnpm-lock.yaml"],
      validate: async () => {
        throw new Error("build failed")
      },
    }),
    /build failed/,
  )
  assert.equal(await readFile(join(root, "apps/data"), "utf8"), "original")
  assert.equal(await readFile(join(root, "pnpm-lock.yaml"), "utf8"), "original-lock")
  assert.equal(await readFile(join(backup, "failed-replacement/apps/data"), "utf8"), "candidate")
  assert.equal(JSON.parse(await readFile(join(backup, "journal.json"), "utf8")).state, "rolled-back")
})

test("partial rename failure rolls back paths already moved", async (t) => {
  const base = await fixture(t)
  const root = join(base, "root"),
    stage = join(base, "stage"),
    backup = join(base, "backup")
  await put(root, "apps/data", "original")
  await put(root, "pnpm-lock.yaml", "original-lock")
  await put(stage, "apps/data", "candidate")
  await assert.rejects(promote({ root, stage, backup, paths: ["apps", "pnpm-lock.yaml"], validate: async () => {} }), /ENOENT/)
  assert.equal(await readFile(join(root, "apps/data"), "utf8"), "original")
  assert.equal(await readFile(join(root, "pnpm-lock.yaml"), "utf8"), "original-lock")
})

test("unconfirmed process termination retains the promoted tree for manual recovery", async (t) => {
  const base = await fixture(t)
  const root = join(base, "root"),
    stage = join(base, "stage"),
    backup = join(base, "backup")
  await put(root, "apps/data", "original")
  await put(stage, "apps/data", "candidate")
  await assert.rejects(
    promote({
      root,
      stage,
      backup,
      paths: ["apps"],
      validate: async () => {
        throw Object.assign(new Error("process still writing"), { unsafeToRestore: true })
      },
    }),
    /still writing/,
  )
  assert.equal(await readFile(join(root, "apps/data"), "utf8"), "candidate")
  assert.equal(await readFile(join(backup, "apps/data"), "utf8"), "original")
  assert.equal(JSON.parse(await readFile(join(backup, "journal.json"), "utf8")).state, "recovery-required")
})
