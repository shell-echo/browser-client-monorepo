import { fileURLToPath } from "node:url"
import { createCommandRunner, handleCancellation } from "./lib/commands.mts"
import { lowResourceEnvironment, lowerVerificationPriority, verificationTask } from "./lib/verification-resources.mts"

async function main() {
  const args = process.argv.slice(2)
  if (!args.length || (args.length === 1 && args[0] === "--help")) {
    console.log(`Usage: pnpm verify:low TASK [INSTANCE]
Tasks: check, test, test:browser, test:web-admin, test:extension,
       test:reinit, test:apps, lint:scripts, typecheck:scripts, format:check

Opt-in serial verification with low scheduling priority and bounded worker pools.
All assertions, browser gates and timeouts remain enabled.
This reduces resource peaks; it is not a hard CPU or total-memory limit.`)
    return
  }
  const task = verificationTask(args)
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
