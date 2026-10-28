import type { PackageManifest, VersionMap, Target } from "./contracts.mts"
import type { ToolConfig } from "./tooling.mts"
import { readFile, writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { integrateTooling, readConfig } from "./tooling.mts"
import { applyCatalogs, readCatalogs } from "./catalogs.mts"
import { integrateGitignore } from "./gitignore.mts"
import { appTypes, type Application } from "./apps.mts"

export const targets: Target[] = ["web", "admin", "extension"]
export const readJson = async <T = PackageManifest,>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8"))
export const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n")

// Official template dependencies win; app-only dependencies/scripts are retained.
export function mergeManifest(
  template: PackageManifest,
  previous: PackageManifest = {},
  target: string,
  type = templateType(target),
) {
  const merged: PackageManifest & { dependencies: VersionMap; devDependencies: VersionMap; scripts: VersionMap } = {
    dependencies: {},
    devDependencies: {},
    scripts: {},
    ...previous,
    ...template,
    version: previous?.version ?? template.version,
    name: `@browser-client/${target}`,
    private: true,
  }
  for (const field of ["dependencies", "devDependencies", "scripts"] as const) {
    merged[field] = { ...previous?.[field], ...template[field] }
  }
  for (const field of ["dependencies", "devDependencies"] as const) {
    const other = field === "dependencies" ? "devDependencies" : "dependencies"
    for (const name of Object.keys(template[field] ?? {})) delete merged[other][name]
  }
  delete merged.packageManager
  merged.dependencies["@browser-client/ui"] = "workspace:*"
  if (type === "web" || type === "extension") merged.dependencies["@browser-client/extension-sdk"] = "workspace:*"
  merged.devDependencies["@browser-client/typescript-config"] = "workspace:*"
  merged.devDependencies[type === "web" ? "@browser-client/eslint-config" : "@browser-client/oxlint-config"] = "workspace:*"
  if (type === "web") {
    merged.scripts.dev = "node ../../scripts/run-app.mts dev"
    merged.scripts.start = "node ../../scripts/run-app.mts start"
    merged.scripts.typecheck = "next typegen && tsc --noEmit"
  } else {
    merged.devDependencies["@tailwindcss/vite"] = "^4.1.0"
    merged.devDependencies.tailwindcss = "^4.1.0"
    merged.scripts.typecheck = "tsc -b"
    if (type === "extension") {
      merged.devDependencies["@types/chrome"] = "^0.3.5"
      merged.devDependencies["@crxjs/vite-plugin"] = previous.devDependencies?.["@crxjs/vite-plugin"] ?? "3.0.0"
      merged.scripts.dev = "vite"
      merged.scripts["preview:ui"] = "vite --mode preview-ui"
    }
  }
  return merged
}

export function templateType(value: string): Target {
  if (!appTypes.some((type) => type === value)) throw new Error(`Explicit template type is required for ${value}`)
  return value as Target
}

function replaceRequired(text: string, from: string, to: string, filename: string) {
  if (!text.includes(from))
    throw new Error(
      `Official template structure changed; cannot integrate ${filename}. Update scripts/lib/integrate.mts; the original app has not been replaced.`,
    )
  return text.replace(from, to)
}

async function patchJsonc(path: string, edit: (value: ToolConfig) => void) {
  const value = await readConfig(path)
  edit(value)
  await writeJson(path, value)
}

export async function integrate(
  root: string,
  target: string,
  previous: PackageManifest = {},
  prepared?: PackageManifest,
  definition?: Application,
) {
  const type = definition?.type ?? templateType(target)
  const app = join(root, "apps", target)
  await integrateGitignore(app)
  // create-next-app may emit a standalone pnpm workspace. Keep one root only,
  // otherwise adding a dependency from apps/web cannot resolve workspace:*.
  await rm(join(app, "pnpm-workspace.yaml"), { force: true })
  const template = await readJson(join(app, "package.json"))
  await writeJson(
    join(app, "package.json"),
    applyCatalogs(prepared ?? mergeManifest(template, previous, target, type), await readCatalogs(root), type),
  )
  const ui = await readJson<{ tailwind?: Record<string, unknown> }>(join(root, "packages/ui/components.json"))
  await writeJson(join(app, "components.json"), {
    ...ui,
    rsc: type === "web",
    tailwind: { ...ui.tailwind, css: "../../packages/ui/src/styles/globals.css" },
    aliases: {
      components: "@/components",
      hooks: "@/hooks",
      lib: "@/lib",
      utils: "@browser-client/ui/lib/utils",
      ui: "@browser-client/ui/components",
    },
  })
  if (type === "web") {
    const file = join(app, "next.config.ts")
    let config = await readFile(file, "utf8")
    config =
      'import { withVerificationResources } from "../../scripts/lib/verification-resources.mts";\nimport { resolve } from "node:path";\n' +
      config
    config = replaceRequired(
      config,
      "const nextConfig: NextConfig = {",
      'const nextConfig: NextConfig = {\n  transpilePackages: ["@browser-client/ui", "@browser-client/extension-sdk"],',
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
    config = replaceRequired(config, "export default nextConfig", "export default withVerificationResources(nextConfig)", file)
    await writeFile(file, config)
  } else {
    const file = join(app, "vite.config.ts")
    let config = await readFile(file, "utf8")
    config = 'import tailwindcss from "@tailwindcss/vite"\nimport { fileURLToPath, URL } from "node:url"\n' + config
    const extension = type === "extension"
    if (definition)
      config =
        'import { applicationSettings, identityPlugin } from "../../scripts/lib/app-runtime.mts"\nconst application = applicationSettings(import.meta.url)\n' +
        config
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
        `${definition ? "const port = application.port" : "const port = Number(process.env.EXTENSION_DEV_PORT ?? 5174)"}\n\nexport default defineConfig`,
        file,
      )
    }
    config = replaceRequired(
      config,
      "defineConfig({",
      `${extension ? "defineConfig(({ command, mode }) => ({" : "defineConfig({"}
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", ${extension ? "port, strictPort: true, ws: { clientPort: port }" : `port: ${definition ? "application.port" : "5173"}, strictPort: true`} },${extension ? '\n  build: { outDir: command === "serve" ? "dist-dev" : "dist" },' : ""}`,
      file,
    )
    if (definition) config = config.replace("plugins: [", "plugins: [identityPlugin(application), ")
    await writeFile(file, config)
    for (const filename of ["tsconfig.json", "tsconfig.app.json"]) {
      await patchJsonc(join(app, filename), (ts) => {
        ts.compilerOptions ??= {}
        ts.compilerOptions.paths = { ...ts.compilerOptions.paths, "@/*": ["./src/*"] }
        if (filename === "tsconfig.app.json") {
          ts.compilerOptions.strict = true
          if (type === "extension") ts.compilerOptions.types = [...new Set([...(ts.compilerOptions.types ?? []), "chrome"])]
        }
      })
    }
  }
  await integrateTooling(root, target, type)
  await mkdir(join(app, "src/components"), { recursive: true })
}
