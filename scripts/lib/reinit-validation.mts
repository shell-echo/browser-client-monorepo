export interface PreflightOptions {
  root: string
  stage: string
  baseline: string
  offline: boolean
  selected?: string[]
  run(args: string[], cwd: string, capture?: boolean, env?: NodeJS.ProcessEnv): Promise<unknown>
  promote(): Promise<void>
  checkInterrupted?: () => void
}
import { join } from "node:path"
import { fingerprint } from "./workspace.mts"

// Only the promotion callback can replace the original project. Keep every
// candidate check, browser cleanup and concurrent-edit check ahead of it.
export async function validateBeforePromotion({
  root,
  stage,
  baseline,
  offline,
  selected = [],
  run,
  promote,
  checkInterrupted = () => {},
}: PreflightOptions) {
  // A resolving install can cache abbreviated metadata only. Verify the locked
  // graph online so the browser copies can enforce pnpm's policies offline.
  if (!offline) await run(["install", "--frozen-lockfile", "--strict-peer-dependencies"], stage)
  await run(["exec", "node", "scripts/format-reinit.mts", ...selected], stage)
  await run(["check"], stage)
  if (!offline) {
    await run(["audit:security"], stage)
    await run(["exec", "playwright", "install", "chromium"], stage)
  }
  const env = { BROWSER_TEST_OUTPUT_ROOT: join(root, ".reinit/verification") }
  await run(["test:browser"], stage, false, env)
  if ((await fingerprint(root)) !== baseline)
    throw new Error(
      "Workspace changed during generation; stopping replacement. The original project is preserved. Stop editing and retry.",
    )
  checkInterrupted()
  await promote()
}
