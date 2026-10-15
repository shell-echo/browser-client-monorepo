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
    throw new Error("生成期间工作区发生变化，停止替换。原项目完整保留，请停止编辑后重试。")
  checkInterrupted()
  await promote()
}
