import { join } from "node:path"
import { fingerprint } from "./workspace.mjs"

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
}) {
  await run(["exec", "node", "scripts/format-reinit.mjs", ...selected], stage)
  await run(["check"], stage)
  if (!offline) {
    await run(["audit:security"], stage)
    await run(["exec", "playwright", "install", "chromium"], stage)
  }
  const env = { BROWSER_TEST_OUTPUT_ROOT: join(root, ".reinit/verification") }
  await run(["test:web-admin"], stage, false, env)
  await run(["test:extension"], stage, false, env)
  if ((await fingerprint(root)) !== baseline)
    throw new Error(
      "Workspace changed during generation; stopping replacement. The original project is preserved. Stop editing and retry.",
    )
  checkInterrupted()
  await promote()
}
