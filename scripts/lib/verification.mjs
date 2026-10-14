import { writeFile } from "node:fs/promises"
import { join } from "node:path"

export async function finishVerification(report, cleanup) {
  const failures = []
  for (const close of cleanup) {
    try { await close() } catch (error) { failures.push(error) }
  }
  if (failures.length) {
    report.status = "failed"
    report.cleanupFailures = failures.map((error) => error.stack ?? String(error))
  }
  const path = join(report.runDir, "report.json")
  await writeFile(path, JSON.stringify(report, null, 2) + "\n")
  console.log(`浏览器验证报告：${path}`)
  if (failures.length) throw new AggregateError(failures, "浏览器测试现场清理失败")
}
