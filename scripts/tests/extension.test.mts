import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { assertCompatible } from "../check-extension-compat.mts"
import { assetPath, checkExtension } from "../check-extension.mts"

test("unsupported Vite upgrades are rejected before promotion", () => {
  const crx = { version: "3.0.0", peerDependencies: { vite: "^8.0.0" } }
  assert.doesNotThrow(() => assertCompatible({ version: "8.3.4" }, crx))
  assert.throws(() => assertCompatible({ version: "9.0.0" }, crx), /does not support Vite/)
  assert.throws(() => assertCompatible({ version: "8.3.4" }, { version: "unknown" }), /does not support Vite/)
})

test("the independent seed manifest and its policy load with Node ESM for production checking", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "manifest-esm-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "src"))
  await mkdir(join(root, "node_modules/@crxjs/vite-plugin"), { recursive: true })
  // Isolate module resolution from a template's deliberately absent node_modules.
  // The builder is a passthrough; the real relative TS import is exercised unchanged.
  await writeFile(
    join(root, "node_modules/@crxjs/vite-plugin/package.json"),
    JSON.stringify({ name: "@crxjs/vite-plugin", type: "module", exports: "./index.mjs" }),
  )
  await writeFile(join(root, "node_modules/@crxjs/vite-plugin/index.mjs"), "export const defineManifest = value => value\n")
  for (const path of ["manifest.config.ts", "src/bridge-policy.ts"]) {
    await writeFile(join(root, path), await readFile(new URL(`../../templates/extension/${path}`, import.meta.url)))
  }
  const { default: manifest } = await import(pathToFileURL(join(root, "manifest.config.ts")).href)
  assert.equal(manifest.background.type, "module")
  assert.deepEqual(manifest.externally_connectable.matches, ["http://127.0.0.1/*", "http://localhost/*"])
  assert.deepEqual(manifest.host_permissions, manifest.externally_connectable.matches)
})

test("CRX root-relative assets work; remote and escaping paths fail", () => {
  const dist = join(tmpdir(), "extension-dist")
  assert.equal(assetPath(dist, "/assets/main.js"), join(dist, "assets/main.js"))
  assert.equal(assetPath(dist, "./main.js", join(dist, "assets")), join(dist, "assets/main.js"))
  for (const path of [
    "../secret.js",
    "/../secret.js",
    "https://example.com/code.js",
    "//example.com/code.js",
    "data:script",
    "%2e%2e/secret.js",
    "..\\secret.js",
  ]) {
    assert.throws(() => assetPath(dist, path))
  }
})

test("production bridge policy and side panel/content entry assets are checked", async (t) => {
  const dist = await mkdtemp(join(tmpdir(), "bridge-dist-"))
  t.after(() => rm(dist, { recursive: true, force: true }))
  const source: chrome.runtime.ManifestV3 = {
    manifest_version: 3,
    name: "Bridge",
    version: "0.1.0",
    permissions: ["storage", "sidePanel"],
    action: { default_popup: "index.html" },
    options_page: "options.html",
    background: { service_worker: "worker.js", type: "module" },
    side_panel: { default_path: "sidepanel.html" },
    content_scripts: [{ matches: ["http://localhost/*"], js: ["agent.js"], run_at: "document_idle", all_frames: false }],
    externally_connectable: { ids: [], matches: ["http://localhost/*"] },
    incognito: "split",
    minimum_chrome_version: "116",
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  }
  const manifest = (value: unknown) => writeFile(join(dist, "manifest.json"), JSON.stringify(value))
  for (const file of ["worker.js", "main.js", "agent.js"]) await writeFile(join(dist, file), "export {}")
  for (const file of ["index.html", "options.html", "sidepanel.html"])
    await writeFile(join(dist, file), '<script type="module" src="/main.js"></script>')
  await manifest(source)
  await checkExtension(dist, source)
  await manifest({ ...source, externally_connectable: { matches: ["https://*/*"] } })
  await assert.rejects(checkExtension(dist, source), /Production bridge policy/)
  await manifest({ ...source, content_scripts: [{ ...source.content_scripts![0], all_frames: true }] })
  await assert.rejects(checkExtension(dist, source), /content script policy/)
  await manifest({ ...source, content_scripts: [{ ...source.content_scripts![0], js: ["missing.js"] }] })
  await assert.rejects(checkExtension(dist, source), /ENOENT/)
  await manifest({ ...source, side_panel: { default_path: "missing.html" } })
  await assert.rejects(checkExtension(dist, source), /Production bridge policy/)
})

test("production checker rejects leaked dev permissions, CSP, clients and missing assets", async (t) => {
  const dist = await mkdtemp(join(tmpdir(), "extension-dist-"))
  t.after(() => rm(dist, { recursive: true, force: true }))
  const source: chrome.runtime.ManifestV3 = {
    name: "Extension fixture",
    version: "0.0.0",
    manifest_version: 3,
    permissions: ["storage"],
    background: { service_worker: "worker.js", type: "module" },
    action: { default_popup: "index.html" },
    options_page: "options.html",
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  }
  const manifest = (value: unknown) => writeFile(join(dist, "manifest.json"), JSON.stringify(value))
  await manifest(source)
  await mkdir(join(dist, "assets"))
  for (const file of ["worker.js", "assets/main.js"]) await writeFile(join(dist, file), "export {}")
  for (const page of ["index.html", "options.html"])
    await writeFile(join(dist, page), '<script type="module" src="/assets/main.js"></script>')
  await checkExtension(dist, source)
  await manifest({ ...source, host_permissions: ["http://localhost/*"] })
  await assert.rejects(checkExtension(dist, source), /Production permissions/)
  await manifest({ ...source, content_security_policy: { extension_pages: "script-src 'self' http://localhost:*" } })
  await assert.rejects(checkExtension(dist, source), /Production CSP/)
  await manifest(source)
  await writeFile(join(dist, "worker.js"), 'import "/@vite/client"')
  await assert.rejects(checkExtension(dist, source), /development client/)
  await writeFile(join(dist, "worker.js"), "export {}")
  await writeFile(join(dist, "worker.js"), 'import "./assets/missing-background.js"')
  await assert.rejects(checkExtension(dist, source), /ENOENT/)
  await writeFile(join(dist, "worker.js"), 'export { missing } from "./assets/missing-reexport.js"')
  await assert.rejects(checkExtension(dist, source), /ENOENT/)
  await writeFile(join(dist, "worker.js"), 'export * from "./assets/main.js"; import("./assets/lazy.js")')
  await assert.rejects(checkExtension(dist, source), /ENOENT/)
  await writeFile(join(dist, "assets/lazy.js"), 'import "./missing-nested.js"')
  await assert.rejects(checkExtension(dist, source), /ENOENT/)
  await writeFile(join(dist, "assets/lazy.js"), 'export const note = "import ./missing-in-a-string.js";')
  await checkExtension(dist, source)
  await writeFile(
    join(dist, "assets/lazy.js"),
    "export const url = import.meta.url; export const load = (name) => import(`./${name}.js`);",
  )
  await checkExtension(dist, source)
  await writeFile(join(dist, "assets/lazy.js"), 'import "https://example.com/runtime.js"')
  await assert.rejects(checkExtension(dist, source), /local path/)
  await writeFile(join(dist, "assets/lazy.js"), "export {}")
  await rm(join(dist, "assets/main.js"))
  await assert.rejects(checkExtension(dist, source), /ENOENT/)
})
