import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createCommandRunner, handleCancellation } from "./lib/commands.mjs"
import { classifyAudit, verifyBracesPatch } from "./lib/dependency-security.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const runner = createCommandRunner({
  cwd: root,
  timeoutMs: 60_000,
  env: { pnpm_config_fetch_retries: "0", pnpm_config_fetch_timeout: "30000" },
})
const dispose = handleCancellation(runner)
try {
  const receipt = await verifyBracesPatch(root)
  const result = await runner.start("pnpm", ["audit", "--json"], { capture: true }).done
  if (result.reason || result.error) throw result.reason ?? result.error
  assert(result.code === 0 || result.code === 1, "依赖审计命令执行失败")
  const { mitigated, unresolved } = classifyAudit(JSON.parse(result.output), receipt)
  console.log(`braces 本地补丁已验证：${receipt.patchHash}`)
  for (const advisory of mitigated) console.log(`已由本地补丁缓解（上游版本告警仍存在）：${advisory.url}`)
  for (const advisory of unresolved) console.error(`未处理：${advisory.module_name} / ${advisory.severity} / ${advisory.url}`)
  assert.equal(unresolved.length, 0, "依赖审计发现未处理的安全告警")
  console.log(`依赖审计通过：${mitigated.length} 项已验证本地补丁，0 项未处理告警。`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await runner.close()
  dispose()
}
