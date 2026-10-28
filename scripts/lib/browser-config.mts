import type { BrowserConfig, HmrConfig } from "./contracts.mts"
import assert from "node:assert/strict"
import { readFile, realpath, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { ignored } from "./workspace.mts"
import { exists } from "./workspace.mts"
import type { Application } from "./apps.mts"

export function browserUrl(origin: string, path: unknown) {
  assert(typeof path === "string" && path.startsWith("/") && !path.startsWith("//"), "Browser paths must start with /")
  const url = new URL(path, origin)
  assert.equal(url.origin, new URL(origin).origin, "Browser paths must stay on the local application origin")
  return url.href
}

export function accessibilityPaths(config: { path: string; accessibilityPaths?: string[] }) {
  const paths = config.accessibilityPaths ?? []
  assert(Array.isArray(paths) && paths.length <= 20, "Accessibility paths must be a bounded list")
  const result = [...new Set([config.path, ...paths])]
  for (const path of result) browserUrl("http://127.0.0.1:3150", path)
  return result
}

export function validateCommunication(config: BrowserConfig["extension"]) {
  if (!config.verifyConnections) return
  const url = new URL(config.communicationOrigin ?? "")
  assert(
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.protocol === "http:" &&
      url.origin === config.communicationOrigin &&
      Number(url.port) >= 1024,
    "Communication fixtures require an exact local HTTP origin and explicit unprivileged port",
  )
}

export function validateBrowserConfig(candidate: unknown): BrowserConfig {
  const config = candidate as BrowserConfig
  for (const name of ["web", "admin"] as const) {
    browserUrl("http://127.0.0.1:3150", config?.[name]?.path)
    accessibilityPaths(config[name])
    assert.equal(typeof config[name].verify, "function", `${name}.verify must provide business assertions`)
  }
  assert.equal(typeof config.admin.verifyRoutes, "function", "admin.verifyRoutes must provide route assertions")
  for (const name of ["verifyPage", "verifyBackground"] as const)
    assert.equal(typeof config?.extension?.[name], "function", `extension.${name} must provide business assertions`)
  for (const name of ["verifyInteractions", "verifyPreview", "verifyConnections"] as const)
    if (config.extension[name] !== undefined)
      assert.equal(typeof config.extension[name], "function", `extension.${name} must be a function`)
  validateCommunication(config.extension)
  const hmr = config.extension.hmr
  assert(typeof hmr?.file === "string" && hmr.file.startsWith("apps/extension/"), "HMR must target extension source")
  assert(!hmr.file.includes("\\") && !hmr.file.split("/").some((part) => ["..", ".", ""].includes(part)), "Invalid HMR path")
  assert(!ignored(hmr.file.split("/").slice(0, 3).join("/")), "HMR must not target dependencies or generated output")
  assert.equal(typeof hmr.update, "function", "extension.hmr.update is required")
  assert.equal(typeof hmr.verify, "function", "extension.hmr.verify is required")
  return config
}

export async function loadBrowserConfig(root: string) {
  // Import after installing the candidate so custom hooks use its dependencies.
  const { default: config } = await import(pathToFileURL(join(root, "browser-tests.config.mts")).href)
  return validateBrowserConfig(config)
}

export async function loadApplicationBrowserConfig(root: string, app: Application) {
  const overrides = (await import(pathToFileURL(join(root, "browser-tests.config.mts")).href)).default as Record<
    string,
    unknown
  >
  assert(overrides && typeof overrides === "object" && !Array.isArray(overrides), "Browser overrides must be an object")
  const candidate =
    overrides[app.id] ?? (await import(pathToFileURL(join(root, app.path, "browser-tests.config.mts")).href)).default
  assert(candidate && typeof candidate === "object", `Browser assertions are missing: ${app.id}`)
  if (app.type !== "extension") {
    const config = candidate as BrowserConfig["admin"]
    browserUrl("http://127.0.0.1:3150", config.path)
    accessibilityPaths(config)
    assert.equal(typeof config.verify, "function", `${app.id}.verify is required`)
    if (app.type === "admin") assert.equal(typeof config.verifyRoutes, "function", `${app.id}.verifyRoutes is required`)
    return { page: config, extension: undefined }
  }
  const config = candidate as BrowserConfig["extension"]
  for (const name of ["verifyPage", "verifyBackground"] as const)
    assert.equal(typeof config[name], "function", `${app.id}.${name} is required`)
  for (const name of ["verifyInteractions", "verifyPreview", "verifyConnections"] as const)
    if (config[name] !== undefined) assert.equal(typeof config[name], "function", `${app.id}.${name} must be a function`)
  validateCommunication(config)
  assert(config.hmr && typeof config.hmr.file === "string", `${app.id}.hmr is required`)
  const file = config.hmr.file.startsWith(`${app.path}/`) ? config.hmr.file : `${app.path}/${config.hmr.file}`
  assert(
    file.startsWith(`${app.path}/`) && !file.includes("\\") && !file.split("/").some((part) => ["..", ".", ""].includes(part)),
    "Invalid instance HMR path",
  )
  assert(!ignored(file.split("/").slice(0, 3).join("/")), "HMR must not target generated output")
  assert(await exists(join(root, file)), `HMR source is missing: ${file}`)
  assert.equal(typeof config.hmr.update, "function")
  assert.equal(typeof config.hmr.verify, "function")
  return { page: undefined, extension: { ...config, hmr: { ...config.hmr, file } } }
}

export async function prepareHmrUpdate(workspace: string, hmr: HmrConfig, appPath = "apps/extension") {
  const root = await realpath(workspace)
  const file = await realpath(resolve(root, hmr.file))
  const path = relative(root, file)
  assert(path && !isAbsolute(path) && !path.startsWith(".."), "HMR target must stay inside the verification workspace")
  assert(path.startsWith(`${appPath}/`), "HMR target must stay inside the selected extension source")
  const original = await readFile(file, "utf8")
  const updated = await hmr.update(original)
  assert(typeof updated === "string" && updated !== original, "HMR update must change the configured source file")
  return { apply: () => writeFile(file, updated), restore: () => writeFile(file, original) }
}
