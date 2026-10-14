import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { assertCompatible } from "../check-extension-compat.mjs"
import { assetPath, checkExtension } from "../check-extension.mjs"

test("unsupported Vite upgrades are rejected before promotion", () => {
  const crx = { version: "3.0.0", peerDependencies: { vite: "^8.0.0" } }
  assert.doesNotThrow(() => assertCompatible({ version: "8.3.4" }, crx))
  assert.throws(() => assertCompatible({ version: "9.0.0" }, crx), /不支持 Vite/)
  assert.throws(() => assertCompatible({ version: "8.3.4" }, { version: "unknown" }), /不支持 Vite/)
})

test("CRX root-relative assets work; remote and escaping paths fail", () => {
  const dist = join(tmpdir(), "extension-dist")
  assert.equal(assetPath(dist, "/assets/main.js"), join(dist, "assets/main.js"))
  assert.equal(assetPath(dist, "./main.js", join(dist, "assets")), join(dist, "assets/main.js"))
  for (const path of ["../secret.js", "/../secret.js", "https://example.com/code.js", "//example.com/code.js", "data:script", "%2e%2e/secret.js", "..\\secret.js"]) {
    assert.throws(() => assetPath(dist, path))
  }
})

test("production checker rejects leaked dev permissions, CSP, clients and missing assets", async (t) => {
  const dist = await mkdtemp(join(tmpdir(), "extension-dist-"))
  t.after(() => rm(dist, { recursive: true, force: true }))
  const source = {
    manifest_version: 3, permissions: ["storage"],
    background: { service_worker: "worker.js", type: "module" },
    action: { default_popup: "index.html" }, options_page: "options.html",
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  }
  const manifest = (value) => writeFile(join(dist, "manifest.json"), JSON.stringify(value))
  await manifest(source)
  await mkdir(join(dist, "assets"))
  for (const file of ["worker.js", "assets/main.js"]) await writeFile(join(dist, file), "export {}")
  for (const page of ["index.html", "options.html"]) await writeFile(join(dist, page), '<script type="module" src="/assets/main.js"></script>')
  await checkExtension(dist, source)
  await manifest({ ...source, host_permissions: ["http://localhost/*"] })
  await assert.rejects(checkExtension(dist, source), /生产权限/)
  await manifest({ ...source, content_security_policy: { extension_pages: "script-src 'self' http://localhost:*" } })
  await assert.rejects(checkExtension(dist, source), /生产 CSP/)
  await manifest(source)
  await writeFile(join(dist, "worker.js"), 'import "/@vite/client"')
  await assert.rejects(checkExtension(dist, source), /开发客户端/)
  await writeFile(join(dist, "worker.js"), "export {}")
  await writeFile(join(dist, "worker.js"), 'import "./assets/missing-background.js"')
  await assert.rejects(checkExtension(dist, source), /ENOENT/)
  await writeFile(join(dist, "worker.js"), 'export * from "./assets/main.js"; import("./assets/lazy.js")')
  await assert.rejects(checkExtension(dist, source), /ENOENT/)
  await writeFile(join(dist, "assets/lazy.js"), 'import "./missing-nested.js"')
  await assert.rejects(checkExtension(dist, source), /ENOENT/)
  await writeFile(join(dist, "assets/lazy.js"), 'export const note = "import ./missing-in-a-string.js";')
  await checkExtension(dist, source)
  await writeFile(join(dist, "assets/lazy.js"), 'import "https://example.com/runtime.js"')
  await assert.rejects(checkExtension(dist, source), /本地路径/)
  await writeFile(join(dist, "assets/lazy.js"), "export {}")
  await rm(join(dist, "assets/main.js"))
  await assert.rejects(checkExtension(dist, source), /ENOENT/)
})
