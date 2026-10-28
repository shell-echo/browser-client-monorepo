import { toError } from "./lib/contracts.mts"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createCommandRunner, handleCancellation } from "./lib/commands.mts"
import { classifyAudit, verifyBracesPatch, verifyDeepmergePatch } from "./lib/dependency-security.mts"

const root = fileURLToPath(new URL("../", import.meta.url))
const runner = createCommandRunner({
  cwd: root,
  timeoutMs: 60_000,
  env: { pnpm_config_fetch_retries: "0", pnpm_config_fetch_timeout: "30000" },
})
const dispose = handleCancellation(runner)
try {
  const receipt = await verifyBracesPatch(root)
  const deepmergeReceipt = await verifyDeepmergePatch(root)
  const result = await runner.start("pnpm", ["audit", "--json"], { capture: true }).done
  if (result.reason || result.error) throw result.reason ?? result.error
  assert(result.code === 0 || result.code === 1, "Dependency audit command failed")
  const { mitigated, unresolved } = classifyAudit(JSON.parse(result.output), receipt, deepmergeReceipt)
  console.log(`Verified local braces patch: ${receipt.patchHash}`)
  console.log(`Verified local deepmerge patch: ${deepmergeReceipt.patchHash}`)
  for (const advisory of mitigated)
    console.log(`Mitigated by a local patch (upstream version advisory remains): ${advisory.url}`)
  for (const advisory of unresolved)
    console.error(`Unresolved: ${advisory.module_name} / ${advisory.severity} / ${advisory.url}`)
  assert.equal(unresolved.length, 0, "Dependency audit found unresolved security advisories")
  console.log(`Dependency audit passed: ${mitigated.length} verified local mitigations, 0 unresolved advisories.`)
} catch (caught) {
  const error = toError(caught)
  console.error(error.message)
  process.exitCode = 1
} finally {
  await runner.close()
  dispose()
}
