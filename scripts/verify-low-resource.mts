import { fileURLToPath } from "node:url"
import { createCommandRunner, handleCancellation } from "./lib/commands.mts"
import { lowResourceEnvironment, lowerVerificationPriority, verificationTask } from "./lib/verification-resources.mts"
import { parseGuardArguments, runResourceGuard } from "./lib/resource-guard.mts"

async function main() {
  const args = process.argv.slice(2)
  if (!args.length || (args.length === 1 && args[0] === "--help")) {
    console.log(`Usage: pnpm verify:low [--guard] TASK [INSTANCE]
       pnpm verify:low --guard --resume=REPORT_ID
Guard options: --wait-ms=600000 (startup waiting budget, at most one day).
Tasks: check, test, test:browser, test:web-admin, test:extension,
       test:reinit, test:apps, test:accessibility, audit:security,
       lint:scripts, typecheck:scripts, format:check

Opt-in serial verification with low scheduling priority and bounded worker pools.
All assertions, browser gates and timeouts remain enabled.
This reduces resource peaks; it is not a hard CPU or total-memory limit.`)
    return
  }
  const parsed = parseGuardArguments(args)
  if (parsed.guard) {
    lowerVerificationPriority()
    process.exitCode = (await runResourceGuard(fileURLToPath(new URL("../", import.meta.url)), parsed)).code
    return
  }
  const task = verificationTask(parsed.task)
  const priority = lowerVerificationPriority()
  const runner = createCommandRunner({
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: lowResourceEnvironment(),
    timeoutMs: 0,
  })
  const dispose = handleCancellation(runner)
  console.log(`Low-resource verification: serial tasks, worker pools=1, scheduling priority=${priority}.`)
  try {
    await runner.run("pnpm", task)
  } finally {
    await runner.close()
    dispose()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
