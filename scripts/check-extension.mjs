import assert from "node:assert/strict"
import { readFile, access, readdir } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { init, parse } from "es-module-lexer"

export function assetPath(dist, path, from = dist) {
  assert(typeof path === "string" && path.length && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path), `扩展资源必须是本地路径：${path}`)
  assert(!/[\\%?#]/.test(path), `扩展资源路径不明确：${path}`)
  const file = path.startsWith("/") ? resolve(dist, path.slice(1)) : resolve(from, path)
  assert(file.startsWith(resolve(dist) + sep), `资源越界：${path}`)
  return file
}

export async function checkExtension(dist, source) {
  await init
  const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"))
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.background.type, "module")
  for (const field of ["permissions", "host_permissions", "optional_permissions", "optional_host_permissions"]) {
    assert.deepEqual([...(manifest[field] ?? [])].sort(), [...(source[field] ?? [])].sort(), `生产权限与源码不同：${field}`)
  }
  assert.deepEqual(manifest.content_security_policy, source.content_security_policy, "生产 CSP 与源码不同")
  const localAsset = async (path, from = dist) => {
    const file = assetPath(dist, path, from)
    await access(file)
    return file
  }
  await localAsset(manifest.background.service_worker)
  for (const page of [manifest.action.default_popup, manifest.options_page]) {
    const file = await localAsset(page)
    const html = await readFile(file, "utf8")
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    assert(scripts.length > 0, `页面缺少入口脚本：${page}`)
    for (const [, attributes, body] of scripts) {
      assert.equal(body.trim(), "", "MV3 不允许内联脚本")
      const src = attributes.match(/\bsrc="([^"]+)"/)?.[1]
      assert(src, "脚本必须引用本地资源")
      await localAsset(src, dirname(file))
    }
    for (const [, href] of html.matchAll(/<link[^>]+href="([^"]+)"/g)) await localAsset(href, dirname(file))
  }
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name)
      if (entry.isDirectory()) await scan(file)
      else if (/\.(?:js|html|json)$/.test(entry.name)) {
        const content = await readFile(file, "utf8")
        assert(!/@vite\/client|@react-refresh|@crx\/client|__CRX_HMR_TOKEN__|crx:runtime-reload/.test(content), `生产产物含开发客户端：${file}`)
        if (entry.name.endsWith(".js")) {
          const [imports] = parse(content, file)
          for (const dependency of imports) {
            // import.meta and imports whose paths are computed at runtime have
            // no literal specifier. Browser validation covers the latter.
            if (dependency.n !== undefined) await localAsset(dependency.n, dirname(file))
          }
        }
      }
    }
  }
  await scan(dist)
  console.log("Manifest V3 产物检查通过：popup、options、service worker、JS 导入资源、生产权限与 CSP。")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = new URL("../apps/extension/", import.meta.url)
  const { default: source } = await import(new URL("manifest.config.ts", app).href)
  await checkExtension(fileURLToPath(new URL("dist/", app)), source)
}
