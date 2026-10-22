import assert from "node:assert/strict"
import { readFile, realpath, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { ignored } from "./workspace.mjs"

export function browserUrl(origin, path) {
  assert(typeof path === "string" && path.startsWith("/") && !path.startsWith("//"), "Browser paths must start with /")
  const url = new URL(path, origin)
  assert.equal(url.origin, new URL(origin).origin, "Browser paths must stay on the local application origin")
  return url.href
}

export function validateBrowserConfig(config) {
  for (const name of ["web", "admin"]) {
    browserUrl("http://127.0.0.1:3150", config?.[name]?.path)
    assert.equal(typeof config[name].verify, "function", `${name}.verify must provide business assertions`)
  }
  assert.equal(typeof config.admin.verifyRoutes, "function", "admin.verifyRoutes must provide route assertions")
  for (const name of ["verifyPage", "verifyBackground"])
    assert.equal(typeof config?.extension?.[name], "function", `extension.${name} must provide business assertions`)
  for (const name of ["verifyInteractions", "verifyPreview"])
    if (config.extension[name] !== undefined)
      assert.equal(typeof config.extension[name], "function", `extension.${name} must be a function`)
  const hmr = config.extension.hmr
  assert(typeof hmr?.file === "string" && hmr.file.startsWith("apps/extension/"), "HMR must target extension source")
  assert(!hmr.file.includes("\\") && !hmr.file.split("/").some((part) => ["..", ".", ""].includes(part)), "Invalid HMR path")
  assert(!ignored(hmr.file.split("/").slice(0, 3).join("/")), "HMR must not target dependencies or generated output")
  assert.equal(typeof hmr.update, "function", "extension.hmr.update is required")
  assert.equal(typeof hmr.verify, "function", "extension.hmr.verify is required")
  return config
}

export async function loadBrowserConfig(root) {
  // Import after installing the candidate so custom hooks use its dependencies.
  const { default: config } = await import(pathToFileURL(join(root, "browser-tests.config.mjs")).href)
  return validateBrowserConfig(config)
}

export async function prepareHmrUpdate(workspace, hmr) {
  const root = await realpath(workspace)
  const file = await realpath(resolve(root, hmr.file))
  const path = relative(root, file)
  assert(path && !isAbsolute(path) && !path.startsWith(".."), "HMR target must stay inside the verification workspace")
  assert(path.startsWith("apps/extension/"), "HMR target must stay inside extension source")
  const original = await readFile(file, "utf8")
  const updated = await hmr.update(original)
  assert(typeof updated === "string" && updated !== original, "HMR update must change the configured source file")
  return { apply: () => writeFile(file, updated), restore: () => writeFile(file, original) }
}
