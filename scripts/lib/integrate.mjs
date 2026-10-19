import { readFile, writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { integrateTooling, readConfig } from "./tooling.mjs"
import { applyCatalogs, readCatalogs } from "./catalogs.mjs"
import { integrateGitignore } from "./gitignore.mjs"

export const targets = ["web", "admin", "extension"]
export const readJson = async (path) => JSON.parse(await readFile(path, "utf8"))
export const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n")

// Official template dependencies win; app-only dependencies/scripts are retained.
export function mergeManifest(template, previous, target) {
  const merged = {
    ...previous,
    ...template,
    version: previous?.version ?? template.version,
    name: `@browser-client/${target}`,
    private: true,
  }
  for (const field of ["dependencies", "devDependencies", "scripts"]) {
    merged[field] = { ...previous?.[field], ...template[field] }
  }
  for (const field of ["dependencies", "devDependencies"]) {
    const other = field === "dependencies" ? "devDependencies" : "dependencies"
    for (const name of Object.keys(template[field] ?? {})) delete merged[other][name]
  }
  delete merged.packageManager
  merged.dependencies["@browser-client/ui"] = "workspace:*"
  merged.devDependencies["@browser-client/typescript-config"] = "workspace:*"
  merged.devDependencies[target === "web" ? "@browser-client/eslint-config" : "@browser-client/oxlint-config"] = "workspace:*"
  if (target === "web") {
    merged.scripts.dev = "next dev --hostname 127.0.0.1 --port 3000"
    merged.scripts.start = "next start --hostname 127.0.0.1 --port 3000"
    merged.scripts.typecheck = "next typegen && tsc --noEmit"
  } else {
    merged.devDependencies["@tailwindcss/vite"] = "^4.1.0"
    merged.devDependencies.tailwindcss = "^4.1.0"
    merged.scripts.typecheck = "tsc -b"
    if (target === "extension") {
      merged.devDependencies["@types/chrome"] = "^0.3.5"
      merged.devDependencies["@crxjs/vite-plugin"] = previous.devDependencies?.["@crxjs/vite-plugin"] ?? "3.0.0"
      merged.scripts.dev = "vite"
      merged.scripts["preview:ui"] = "vite --mode preview-ui"
    }
  }
  return merged
}

function replaceRequired(text, from, to, filename) {
  if (!text.includes(from))
    throw new Error(
      `Official template structure changed; cannot integrate ${filename}. Update scripts/lib/integrate.mjs; the original app has not been replaced.`,
    )
  return text.replace(from, to)
}

async function patchJsonc(path, edit) {
  const value = await readConfig(path)
  edit(value)
  await writeJson(path, value)
}

export async function integrate(root, target, previous = {}, prepared) {
  const app = join(root, "apps", target)
  await integrateGitignore(app)
  // create-next-app may emit a standalone pnpm workspace. Keep one root only,
  // otherwise adding a dependency from apps/web cannot resolve workspace:*.
  await rm(join(app, "pnpm-workspace.yaml"), { force: true })
  const template = await readJson(join(app, "package.json"))
  await writeJson(
    join(app, "package.json"),
    applyCatalogs(prepared ?? mergeManifest(template, previous, target), await readCatalogs(root), target),
  )
  const ui = await readJson(join(root, "packages/ui/components.json"))
  await writeJson(join(app, "components.json"), {
    ...ui,
    rsc: target === "web",
    tailwind: { ...ui.tailwind, css: "../../packages/ui/src/styles/globals.css" },
    aliases: {
      components: "@/components",
      hooks: "@/hooks",
      lib: "@/lib",
      utils: "@browser-client/ui/lib/utils",
      ui: "@browser-client/ui/components",
    },
  })
  if (target === "web") {
    const file = join(app, "next.config.ts")
    let config = await readFile(file, "utf8")
    config = 'import { resolve } from "node:path";\n' + config
    config = replaceRequired(
      config,
      "const nextConfig: NextConfig = {",
      'const nextConfig: NextConfig = {\n  transpilePackages: ["@browser-client/ui"],',
      file,
    )
    // Retain the current official CSS loader and any future template settings.
    if (config.includes("turbopack: {")) {
      config = config.replace("turbopack: {", 'turbopack: {\n    root: resolve(process.cwd(), "../.."),')
    } else {
      config = config.replace(
        "const nextConfig: NextConfig = {",
        'const nextConfig: NextConfig = {\n  turbopack: { root: resolve(process.cwd(), "../..") },',
      )
    }
    await writeFile(file, config)
  } else {
    const file = join(app, "vite.config.ts")
    let config = await readFile(file, "utf8")
    config = 'import tailwindcss from "@tailwindcss/vite"\nimport { fileURLToPath, URL } from "node:url"\n' + config
    const extension = target === "extension"
    config = replaceRequired(
      config,
      "plugins: [react()]",
      extension
        ? `plugins: [
  {
    name: "browser-client:theme-bootstrap",
    apply: "serve",
    enforce: "pre",
    resolveId(id) {
      if (id === "/theme-init.js") {
        return fileURLToPath(new URL("../../packages/ui/src/lib/theme-init.js", import.meta.url))
      }
    },
  },
  react(), tailwindcss(), ...(mode === "preview-ui" ? [] : [crx({ manifest })])
]`
        : "plugins: [react(), tailwindcss()]",
      file,
    )
    if (extension) {
      config = 'import { crx } from "@crxjs/vite-plugin"\nimport manifest from "./manifest.config.ts"\n' + config
      config = replaceRequired(config, "\n})", "\n}))", file)
      config = replaceRequired(
        config,
        "export default defineConfig",
        "const port = Number(process.env.EXTENSION_DEV_PORT ?? 5174)\n\nexport default defineConfig",
        file,
      )
    }
    config = replaceRequired(
      config,
      "defineConfig({",
      `${extension ? "defineConfig(({ command, mode }) => ({" : "defineConfig({"}
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", ${extension ? "port, strictPort: true, ws: { clientPort: port }" : "port: 5173, strictPort: true"} },${extension ? '\n  build: { outDir: command === "serve" ? "dist-dev" : "dist" },' : ""}`,
      file,
    )
    await writeFile(file, config)
    for (const filename of ["tsconfig.json", "tsconfig.app.json"]) {
      await patchJsonc(join(app, filename), (ts) => {
        ts.compilerOptions ??= {}
        ts.compilerOptions.paths = { ...ts.compilerOptions.paths, "@/*": ["./src/*"] }
        if (filename === "tsconfig.app.json") {
          ts.compilerOptions.strict = true
          if (target === "extension") ts.compilerOptions.types = [...new Set([...(ts.compilerOptions.types ?? []), "chrome"])]
        }
      })
    }
  }
  await integrateTooling(root, target)
  await mkdir(join(app, "src/components"), { recursive: true })
}
