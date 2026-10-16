import assert from "node:assert/strict"
import { mkdir, readdir } from "node:fs/promises"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { handleCancellation, positiveTimeout } from "./lib/commands.mjs"
import { copySource, fingerprint, ignored } from "./lib/workspace.mjs"
import { createVerificationRunner, finishVerification } from "./lib/verification.mjs"
import { verifyThemes, verifyThemeBeforeHydration, verifyUnavailableStorage } from "./lib/theme-verification.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const runDir = join(
  resolve(process.env.BROWSER_TEST_OUTPUT_ROOT ?? join(root, ".reinit/verification")),
  `web-admin-${Date.now()}`,
)
const workspace = join(runDir, "workspace")
const report = { runDir, checks: [], errors: [] }
const port = (value, fallback, label) => {
  const number = positiveTimeout(value, fallback, label)
  assert(number < 65536, `${label} 必须小于 65536`)
  return number
}
const webPort = port(process.env.WEB_TEST_PORT, 3150, "WEB_TEST_PORT")
const adminPort = port(process.env.ADMIN_TEST_PORT, 3151, "ADMIN_TEST_PORT")
assert.notEqual(webPort, adminPort, "Web / Admin 测试端口不能相同")
const runner = createVerificationRunner({
  cwd: workspace,
  logDir: runDir,
  timeoutMs: positiveTimeout(process.env.WEB_ADMIN_TEST_COMMAND_TIMEOUT_MS, 300_000, "WEB_ADMIN_TEST_COMMAND_TIMEOUT_MS"),
  env: { NEXT_TELEMETRY_DISABLED: "1", TURBO_TELEMETRY_DISABLED: "1" },
})
let browser, originalFingerprint
const dispose = handleCancellation(runner, () => {
  void browser?.close().catch(() => {})
})
const passed = (message) => {
  report.checks.push(message)
  console.log(`✓ ${message}`)
}

async function freePort(port) {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once("error", reject)
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, resolve)
  })
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())))
}

async function pageFor(name, url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on("pageerror", (error) => report.errors.push(`${name}: ${error.message}`))
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(`${name}: ${message.text()} ${message.location().url}`)
  })
  page.on("requestfailed", (request) =>
    report.errors.push(`${name}: ${request.method()} ${request.url()} ${request.failure()?.errorText}`),
  )
  page.on("response", (response) => {
    if (response.status() >= 400) report.errors.push(`${name}: HTTP ${response.status()} ${response.url()}`)
  })
  const response = await page.goto(url, { waitUntil: "networkidle" })
  assert.equal(response.status(), 200)
  return page
}

async function sharedStyles(page, button) {
  assert.equal(await button.getAttribute("data-slot"), "button")
  const styles = await button.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      display: style.display,
      alignItems: style.alignItems,
      justifyContent: style.justifyContent,
      radius: style.borderRadius,
    }
  })
  // Flex items blockify inline-flex to flex. Check the rendered treatment too,
  // so an unstyled element cannot pass by merely carrying component attributes.
  assert(["flex", "inline-flex"].includes(styles.display), "共享 Button 布局样式未生效")
  assert.equal(styles.alignItems, "center")
  assert.equal(styles.justifyContent, "center")
  assert(parseFloat(styles.radius) > 0, "共享 Button 圆角样式未生效")
  assert((await page.locator('[data-slot="card"]').count()) > 0, "共享 Card 未渲染")
}

async function mobileLayout(page, name) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("heading", { level: 1 }).waitFor()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} 移动端出现水平溢出`)
  await page.screenshot({ path: join(runDir, `${name}-mobile.png`), fullPage: true })
}

try {
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  originalFingerprint = await fingerprint(root)
  await freePort(webPort)
  await freePort(adminPort)
  for (const name of await readdir(root))
    if (!ignored(name)) await copySource(join(root, name), join(workspace, name), { root })
  await runner.run("git", ["init", "--quiet"], "git.log")
  await runner.run("pnpm", ["install", "--offline", "--frozen-lockfile"], "install.log")
  await runner.run(
    "pnpm",
    ["exec", "turbo", "run", "build", "--filter=@browser-client/web", "--filter=@browser-client/admin"],
    "build.log",
  )
  const web = runner.start(
    "pnpm",
    ["--filter", "@browser-client/web", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)],
    "web.log",
    {},
    0,
  )
  const admin = runner.start(
    "pnpm",
    [
      "--filter",
      "@browser-client/admin",
      "exec",
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(adminPort),
      "--strictPort",
    ],
    "admin.log",
    {},
    0,
  )
  for (const [server, port] of [
    [web, webPort],
    [admin, adminPort],
  ]) {
    await runner.until(
      async () => {
        assert.equal(server.child.exitCode, null, "生产服务提前退出，请查看日志")
        return (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2000) })).ok
      },
      `生产服务 ${port}`,
      60_000,
    )
  }
  browser = await chromium.launch({ channel: "chromium", headless: true })
  runner.check()
  report.chromium = browser.version()

  const webPage = await pageFor("web", `http://127.0.0.1:${webPort}`)
  assert.equal(await webPage.title(), "Browser Client")
  assert.match(await webPage.getByRole("heading", { level: 1 }).innerText(), /构建你的下一款产品/)
  // Base UI renders this anchor with the button role; verify both semantics
  // exposed to the user and the actual navigation target.
  const workspaceLink = webPage.getByRole("button", { name: "查看工作区", exact: true })
  assert.equal(await workspaceLink.getAttribute("href"), "#workspaces")
  await sharedStyles(webPage, workspaceLink)
  await workspaceLink.click()
  await webPage.waitForURL(`http://127.0.0.1:${webPort}/#workspaces`)
  assert.equal(await webPage.locator('#workspaces [data-slot="card"]').count(), 3)
  await webPage.screenshot({ path: join(runDir, "web-desktop.png"), fullPage: true })
  await mobileLayout(webPage, "web")
  passed("Web 生产页面、共享组件样式、工作区导航及桌面 / 移动布局正常")
  await verifyThemes(webPage, { errors: report.errors, screenshot: join(runDir, "web-dark.png") })
  await verifyThemeBeforeHydration(browser, `http://127.0.0.1:${webPort}/`, false)
  passed("Web 深浅主题、刷新保存、跨标签同步、实时跟随系统及 hydration 前深色首屏正常")

  const adminPage = await pageFor("admin", `http://127.0.0.1:${adminPort}`)
  const heading = adminPage.getByRole("heading", { level: 1 })
  assert.equal(await heading.innerText(), "Browser Client")
  const input = adminPage.getByLabel("工作区名称"),
    save = adminPage.getByRole("button", { name: "保存名称", exact: true })
  await sharedStyles(adminPage, save)
  await input.fill("   ")
  await runner.until(() => save.isDisabled(), "Admin 空白名称禁用")
  await input.fill("  冒烟测试工作区  ")
  await save.click()
  await runner.until(async () => (await heading.innerText()) === "冒烟测试工作区", "Admin 表单保存")
  assert.equal(await adminPage.getByRole("status").innerText(), "已更新当前页面")
  await adminPage.screenshot({ path: join(runDir, "admin-desktop.png"), fullPage: true })
  await mobileLayout(adminPage, "admin")
  await adminPage.reload({ waitUntil: "networkidle" })
  assert.equal(await heading.innerText(), "Browser Client", "演示表单应仅保留当前页面状态")
  passed("Admin 生产页面、共享表单、空白校验、名称保存及桌面 / 移动布局正常")
  await input.fill("主题切换保留的未保存输入")
  await verifyThemes(adminPage, { errors: report.errors, screenshot: join(runDir, "admin-dark.png") })
  await verifyThemeBeforeHydration(browser, `http://127.0.0.1:${adminPort}/`, true)
  await verifyUnavailableStorage(adminPage)
  passed("Admin 深浅主题、刷新保存、跨标签同步、实时跟随系统、React 前首屏及存储不可用降级正常")
  assert.deepEqual(report.errors, [], "浏览器存在运行、控制台或资源加载错误")
  passed("Web / Admin 无浏览器运行错误、控制台错误或失败资源")
  assert.equal(await fingerprint(root), originalFingerprint, "冒烟测试改变了原工作区源码")
  passed("冒烟测试仅使用临时副本，原工作区源码保持不变")
  report.status = "passed"
} catch (error) {
  report.status = "failed"
  report.failure = error.stack
  for (const [index, page] of (browser?.contexts().flatMap((context) => context.pages()) ?? []).entries()) {
    await page.screenshot({ path: join(runDir, `failure-${index}.png`), fullPage: true, timeout: 5000 }).catch(() => {})
  }
  throw error
} finally {
  await finishVerification(report, [() => browser?.close(), runner.close, dispose])
}
