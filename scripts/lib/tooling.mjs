import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { parse } from "jsonc-parser"

export async function readConfig(file) {
  const errors = []
  const config = parse(await readFile(file, "utf8"), errors, { allowTrailingComma: true })
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) throw new Error(`无法解析配置：${file}`)
  return config
}

const writeConfig = (file, config) => writeFile(file, JSON.stringify(config, null, 2) + "\n")
const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value])

// Read our presets before installing the staged workspace's dependencies.
async function inherited(file, field, seen = new Set()) {
  file = resolve(file)
  if (seen.has(file)) throw new Error(`共享配置存在循环继承：${file}`)
  const config = await readConfig(file)
  const result = {}
  for (const parent of list(config.extends)) {
    if (!parent.startsWith("./")) throw new Error(`共享预设必须使用包内相对继承：${parent}`)
    Object.assign(result, await inherited(resolve(dirname(file), parent), field, new Set([...seen, file])))
  }
  return { ...result, ...config[field] }
}

function sameCompilerOption(key, a, b) {
  // TypeScript's enum values and lib names are case insensitive.
  const normalize = (value) =>
    Array.isArray(value) ? value.map(normalize) : typeof value === "string" ? value.toLowerCase() : value
  return isDeepStrictEqual(
    ...[a, b].map((value) => (["target", "module", "moduleResolution", "jsx", "lib"].includes(key) ? normalize(value) : value)),
  )
}

export async function shareTypeScript(root, app, filename, preset) {
  const file = join(app, filename)
  const config = await readConfig(file)
  const shared = `@browser-client/typescript-config/${preset}.json`
  const parents = list(config.extends).filter((parent) => !parent.startsWith("@browser-client/typescript-config/"))
  const defaults = await inherited(join(root, "packages/typescript-config", `${preset}.json`), "compilerOptions")
  // These options belong to the project preset. Reinit must not reinstate an
  // official default over a deliberate edit to that shared preset.
  for (const [key, value] of Object.entries(config.compilerOptions ?? {})) {
    if (!Object.hasOwn(defaults, key)) continue
    if (!sameCompilerOption(key, value, defaults[key]))
      console.log(`${filename}: ${key} 使用共享预设；官方模板值有差异，请按需核对。`)
    delete config.compilerOptions[key]
  }
  config.extends = parents.length ? [...parents, shared] : shared
  if (config.compilerOptions && !Object.keys(config.compilerOptions).length) delete config.compilerOptions
  await writeConfig(file, config)
}

async function shareOxlint(root, app, preset) {
  const file = join(app, ".oxlintrc.json")
  const config = await readConfig(file)
  const shared = `./node_modules/@browser-client/oxlint-config/${preset}.json`
  const parents = list(config.extends).filter((parent) => !parent.startsWith("./node_modules/@browser-client/oxlint-config/"))
  const presetFile = join(root, "packages/oxlint-config", `${preset}.json`)
  const rules = await inherited(presetFile, "rules")
  // Find the nearest explicit plugin list in our shared preset chain.
  async function plugins(file) {
    const value = await readConfig(file)
    if (value.plugins) return value.plugins
    const parent = list(value.extends).at(-1)
    return parent ? plugins(resolve(dirname(file), parent)) : undefined
  }
  if (!parents.length && isDeepStrictEqual(config.plugins, await plugins(presetFile))) delete config.plugins
  for (const [key, value] of Object.entries(config.rules ?? {})) {
    if (!Object.hasOwn(rules, key)) continue
    if (!isDeepStrictEqual(value, rules[key]))
      console.log(`.oxlintrc.json: ${key} 使用共享规则；官方模板值有差异，请按需核对。`)
    delete config.rules[key]
  }
  if (config.rules && !Object.keys(config.rules).length) delete config.rules
  config.extends = [...parents, shared]
  await writeConfig(file, config)
}

export async function integrateTooling(root, target) {
  const app = join(root, target === "ui" ? "packages/ui" : `apps/${target}`)
  if (target === "web") {
    await shareTypeScript(root, app, "tsconfig.json", "nextjs")
    const file = join(app, "eslint.config.mjs")
    let config = await readFile(file, "utf8")
    if (!config.includes('"@browser-client/eslint-config/base"')) {
      if (!config.includes("defineConfig([")) throw new Error(`官方模板结构已变化，无法接入 ${file} 的共享 ESLint 配置。`)
      config =
        'import sharedConfig from "@browser-client/eslint-config/base";\n' +
        config.replace("defineConfig([", "defineConfig([\n  ...sharedConfig,")
      await writeFile(file, config)
    }
  } else {
    if (target === "ui") await shareTypeScript(root, app, "tsconfig.json", "react")
    else {
      await shareTypeScript(root, app, "tsconfig.app.json", "vite")
      await shareTypeScript(root, app, "tsconfig.node.json", "vite-node")
    }
    await shareOxlint(root, app, target === "ui" ? "react" : "react-app")
  }
}
