import assert from "node:assert/strict"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { copySource, exists, fingerprint, ignored } from "./lib/workspace.mjs"
import { handleCancellation, positiveTimeout } from "./lib/commands.mjs"
import { createVerificationRunner, finishVerification } from "./lib/verification.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const runDir = join(root, ".reinit/verification", `crxjs-${Date.now()}`)
const workspace = join(runDir, "workspace")
const app = join(workspace, "apps/extension")
const port = positiveTimeout(process.env.EXTENSION_TEST_PORT, 3102, "EXTENSION_TEST_PORT")
assert(port < 65536, "EXTENSION_TEST_PORT 必须小于 65536")
const report = { checks: [], errors: [], runDir }
const runner = createVerificationRunner({ cwd: workspace, logDir: runDir, timeoutMs: positiveTimeout(process.env.EXTENSION_TEST_COMMAND_TIMEOUT_MS, 180_000, "EXTENSION_TEST_COMMAND_TIMEOUT_MS") })
const { start, run, until } = runner
let server, context
const removeSignalHandlers = handleCancellation(runner, () => {
  console.error("已请求取消；正在关闭浏览器及测试启动的进程。")
  void context?.close().catch(() => {})
})
const originalFingerprint = await fingerprint(root)
await mkdir(workspace, { recursive: true })

function passed(message) {
  report.checks.push(message)
  console.log(`✓ ${message}`)
}

async function launch(directory, profile) {
  const context = await chromium.launchPersistentContext(join(runDir, profile), {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
  })
  context.on("page", (page) => {
    page.on("pageerror", (error) => report.errors.push(`${profile}: ${error.message}`))
    page.on("console", (message) => {
      if (message.type() === "error") report.errors.push(`${profile}: ${message.text()}`)
    })
  })
  return context
}

async function extensionPages(context) {
  let worker
  await until(() => {
    worker = context.serviceWorkers().find((item) => item.url().startsWith("chrome-extension://"))
    return Boolean(worker)
  }, "扩展 service worker")
  const id = new URL(worker.url()).host
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${id}/index.html`)
  await popup.getByRole("button", { name: "打开设置" }).waitFor()
  const opened = context.waitForEvent("page")
  await popup.getByRole("button", { name: "打开设置" }).click()
  const options = await opened
  await options.waitForURL(`chrome-extension://${id}/options.html`)
  await until(async () => !(await options.getByRole("button", { name: "保存设置" }).isDisabled()), "设置完成加载")
  await until(async () => (await options.evaluate(() => chrome.storage.local.get("workspaceName"))).workspaceName === "Browser Client", "后台初始化本地存储")
  return { popup, options }
}

async function storageRoundTrip(popup, options, name) {
  await options.getByLabel("工作区名称").fill(name)
  await options.getByRole("button", { name: "保存设置" }).click()
  await options.getByRole("status").filter({ hasText: "设置已保存" }).waitFor()
  assert.equal((await options.evaluate(() => chrome.storage.local.get("workspaceName"))).workspaceName, name)
  await popup.reload()
  await popup.getByText(name, { exact: true }).waitFor()
}

try {
  for (const name of await readdir(root)) {
    if (!ignored(name)) await copySource(join(root, name), join(workspace, name))
  }
  await run("git", ["init", "--quiet"], "git.log")
  await run("pnpm", ["install", "--offline", "--frozen-lockfile"], "install.log")
  await run("node", ["scripts/check-extension-compat.mjs"], "compat.log")
  server = start("pnpm", ["--filter", "@browser-client/extension", "dev"], "dev.log", { EXTENSION_DEV_PORT: String(port) }, 0)
  await until(async () => {
    assert.equal(server.child.exitCode, null, `开发服务已退出：${join(runDir, "dev.log")}`)
    return await exists(join(app, "dist-dev/manifest.json")) && (await fetch(`http://127.0.0.1:${port}/@vite/client`, { signal: AbortSignal.timeout(2000) })).ok
  }, "开发产物及 Vite 服务", 60_000)
  context = await launch(join(app, "dist-dev"), "profile-dev")
  runner.check()
  report.chromium = context.browser().version()
  const { popup, options } = await extensionPages(context)
  await storageRoundTrip(popup, options, "开发设置验证")
  passed("开发扩展真实加载，后台初始化、popup → options 和 storage 往返正常")

  const paths = ["apps/extension/src/App.tsx", "packages/ui/src/components/button.tsx", "packages/ui/src/styles/globals.css"]
  const originals = await Promise.all(paths.map((path) => readFile(join(workspace, path), "utf8")))
  const unsaved = "HMR 保留的未保存输入"
  await options.getByLabel("工作区名称").fill(unsaved)
  await options.evaluate(() => { window.__hmrSentinel = "same-document" })
  let navigations = 0
  options.on("framenavigated", (frame) => { if (frame === options.mainFrame()) navigations++ })
  const preserved = async () => {
    assert.equal(await options.getByLabel("工作区名称").inputValue(), unsaved, "HMR 丢失 React 状态")
    assert.equal(await options.evaluate(() => window.__hmrSentinel), "same-document")
    assert.equal(navigations, 0, "HMR 导致整页刷新")
  }
  assert(originals[0].includes('"扩展设置"'))
  await writeFile(join(workspace, paths[0]), originals[0].replace('"扩展设置"', '"扩展设置 · HMR"'))
  await options.getByText("扩展设置 · HMR", { exact: true }).waitFor()
  await preserved()
  passed("扩展 React 页面热更新，保留未保存输入且没有整页刷新")

  assert(originals[1].includes('data-slot="button"'))
  await writeFile(join(workspace, paths[1]), originals[1].replace('data-slot="button"', 'data-slot="button" data-hmr-shared="updated"'))
  await options.locator('button[data-hmr-shared="updated"]').waitFor()
  await popup.locator('button[data-hmr-shared="updated"]').waitFor()
  await preserved()
  passed("共享 shadcn/ui Button 同时热更新 popup / options，保留 React 状态")

  await writeFile(join(workspace, paths[2]), `${originals[2]}\n[data-slot="button"] { border-top-width: 7px !important; }\n`)
  await until(() => options.locator('[data-slot="button"]').evaluate((button) => getComputedStyle(button).borderTopWidth === "7px"), "共享主题 CSS 热更新")
  await preserved()
  passed("共享 Tailwind / UI 样式热更新，保留 React 状态")
  await context.close(); context = undefined
  await server.stop(); server = undefined
  for (let i = 0; i < paths.length; i++) await writeFile(join(workspace, paths[i]), originals[i])

  await run("pnpm", ["--filter", "@browser-client/extension", "build"], "build.log")
  await run("node", ["scripts/check-extension.mjs"], "production-check.log")
  context = await launch(join(app, "dist"), "profile-production")
  runner.check()
  const network = []
  context.on("request", (request) => { if (/^https?:/.test(request.url())) network.push(request.url()) })
  const production = await extensionPages(context)
  await storageRoundTrip(production.popup, production.options, "生产设置验证")
  assert.deepEqual(network, [], "生产扩展请求了外部 HTTP 资源")
  assert.deepEqual(report.errors, [], "浏览器出现运行错误")
  passed("开发服务关闭后，生产扩展独立加载；后台、popup、options、storage 正常，无外部 HTTP 请求或运行错误")
  assert.equal(await fingerprint(root), originalFingerprint, "测试改变了原工作区源码")
  passed("浏览器测试仅修改临时副本，原工作区源码保持不变")
  report.status = "passed"
} catch (error) {
  report.status = "failed"
  report.failure = error.stack
  throw error
} finally {
  await finishVerification(report, [() => context?.close(), runner.close, removeSignalHandlers])
}
