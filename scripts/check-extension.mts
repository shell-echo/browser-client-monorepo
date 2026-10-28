import assert from "node:assert/strict"
import { readFile, access, readdir } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { init, parse } from "es-module-lexer"
import { readApplications, selectApplications } from "./lib/apps.mts"

export function assetPath(dist: string, path: unknown, from = dist) {
  assert(
    typeof path === "string" && path.length && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path),
    `Extension resource must use a local path: ${path}`,
  )
  assert(!/[\\%?#]/.test(path), `Ambiguous extension resource path: ${path}`)
  const file = path.startsWith("/") ? resolve(dist, path.slice(1)) : resolve(from, path)
  assert(file.startsWith(resolve(dist) + sep), `Resource path escapes the output directory: ${path}`)
  return file
}

export async function checkExtension(
  dist: string,
  source: Pick<
    chrome.runtime.ManifestV3,
    | "permissions"
    | "host_permissions"
    | "optional_permissions"
    | "optional_host_permissions"
    | "content_security_policy"
    | "externally_connectable"
    | "side_panel"
    | "content_scripts"
    | "incognito"
    | "minimum_chrome_version"
  >,
) {
  // v3 uses an init function and descriptive record fields. Keep the previous
  // API supported while an older installation is generating its replacement.
  await (typeof init === "function" ? init() : init)
  const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"))
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.background.type, "module")
  for (const field of ["permissions", "host_permissions", "optional_permissions", "optional_host_permissions"] as const) {
    assert.deepEqual(
      [...(manifest[field] ?? [])].sort(),
      [...(source[field] ?? [])].sort(),
      `Production permissions differ from source: ${field}`,
    )
  }
  assert.deepEqual(manifest.content_security_policy, source.content_security_policy, "Production CSP differs from source")
  for (const field of ["externally_connectable", "side_panel", "incognito", "minimum_chrome_version"] as const) {
    assert.deepEqual(manifest[field], source[field], `Production bridge policy differs from source: ${field}`)
  }
  assert.equal(
    (manifest.content_scripts ?? []).length,
    source.content_scripts?.length ?? 0,
    "Production content script count differs",
  )
  for (const [index, script] of (source.content_scripts ?? []).entries()) {
    for (const field of [
      "matches",
      "exclude_matches",
      "all_frames",
      "run_at",
      "world",
      "match_about_blank",
      "match_origin_as_fallback",
    ] as const) {
      assert.deepEqual(
        manifest.content_scripts[index][field],
        script[field],
        `Production content script policy differs: ${field}`,
      )
    }
  }
  const localAsset = async (path: string, from = dist) => {
    const file = assetPath(dist, path, from)
    await access(file)
    return file
  }
  await localAsset(manifest.background.service_worker)
  for (const script of manifest.content_scripts ?? []) {
    assert(script.js?.length > 0, "Content script has no entry")
    for (const path of [...script.js, ...(script.css ?? [])]) await localAsset(path)
  }
  for (const page of [
    manifest.action.default_popup,
    manifest.options_page,
    ...(manifest.side_panel ? [manifest.side_panel.default_path] : []),
  ]) {
    const file = await localAsset(page)
    const html = await readFile(file, "utf8")
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    assert(scripts.length > 0, `Page has no entry script: ${page}`)
    for (const [, attributes, body] of scripts) {
      assert.equal(body.trim(), "", "MV3 does not allow inline scripts")
      const src = attributes.match(/\bsrc="([^"]+)"/)?.[1]
      assert(src, "Scripts must reference local resources")
      await localAsset(src, dirname(file))
    }
    for (const [, href] of html.matchAll(/<link[^>]+href="([^"]+)"/g)) await localAsset(href, dirname(file))
  }
  async function scan(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name)
      if (entry.isDirectory()) await scan(file)
      else if (/\.(?:js|html|json)$/.test(entry.name)) {
        const content = await readFile(file, "utf8")
        assert(
          !/@vite\/client|@react-refresh|@crx\/client|__CRX_HMR_TOKEN__|crx:runtime-reload/.test(content),
          `Production output contains a development client: ${file}`,
        )
        if (entry.name.endsWith(".js")) {
          const [imports] = parse(content, file)
          for (const dependency of imports) {
            // import.meta and imports whose paths are computed at runtime have
            // no literal specifier. Browser validation covers the latter.
            const specifier = dependency.specifier ?? ("n" in dependency ? dependency.n : undefined)
            if (typeof specifier === "string" && !("glob" in dependency && dependency.glob))
              await localAsset(specifier, dirname(file))
          }
        }
      }
    }
  }
  await scan(dist)
  console.log("Manifest V3 output check passed: popup, options, service worker, JS imports, production permissions and CSP.")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const apps = selectApplications(await readApplications(root), process.argv[2]).filter((app) => app.type === "extension")
  for (const instance of apps) {
    const app = new URL(`../${instance.path}/`, import.meta.url)
    const { default: source } = await import(new URL("manifest.config.ts", app).href)
    await checkExtension(fileURLToPath(new URL("dist/", app)), source)
  }
  if (!apps.length) console.log("Extension output: not applicable (no registered extension).")
}
