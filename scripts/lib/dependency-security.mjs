import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"
import { parse } from "yaml"

export const bracesAdvisory = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"

export async function verifyBracesPatch(root) {
  const workspace = parse(await readFile(join(root, "pnpm-workspace.yaml"), "utf8"))
  const lock = parse(await readFile(join(root, "pnpm-lock.yaml"), "utf8"))
  const patch = "patches/braces@3.0.3.patch"
  assert.equal(workspace.patchedDependencies?.["braces@3.0.3"], patch, "braces 的本地补丁未注册")
  const hash = createHash("sha256").update(await readFile(join(root, patch))).digest("hex")
  assert.equal(lock.patchedDependencies?.["braces@3.0.3"], hash, "braces 补丁与锁文件不一致")
  const snapshots = Object.keys(lock.snapshots).filter((name) => name.startsWith("braces@"))
  assert.deepEqual(snapshots, [`braces@3.0.3(patch_hash=${hash})`], "发现未纳入本地补丁的 braces 版本")

  // Resolve the same dependency chain used by shadcn, through pnpm's real paths.
  const cli = createRequire(await realpath(join(root, "node_modules/shadcn/package.json")))
  const glob = createRequire(cli.resolve("fast-glob/package.json"))
  const match = createRequire(glob.resolve("micromatch/package.json"))
  const braces = match("braces")
  assert.equal(match("braces/package.json").version, "3.0.3")
  for (const open of ["{", "("]) {
    const close = open === "{" ? "}" : ")"
    const pattern = open.repeat(4000) + "a" + close.repeat(4000)
    for (const method of ["parse", "compile", "expand", "stringify"]) {
      assert.throws(() => braces[method](pattern), (error) => error.code === "ERR_BRACES_DEPTH", `${method} 未限制 ${open} 嵌套深度`)
    }
  }
  assert.deepEqual(braces.expand("src/{web,admin}.{ts,tsx}"), ["src/web.ts", "src/web.tsx", "src/admin.ts", "src/admin.tsx"])
  assert.equal(braces.stringify(braces.parse("src/{a,b}.ts")), "src/{a,b}.ts")
  return { verified: true, version: "3.0.3", patchHash: hash }
}

export function classifyAudit(audit, receipt) {
  assert(audit.metadata?.vulnerabilities && audit.advisories && !audit.error, "依赖审计响应无效或 registry 请求失败")
  const mitigated = [], unresolved = []
  for (const advisory of Object.values(audit.advisories)) {
    const patched = receipt?.verified === true && advisory.url === bracesAdvisory && advisory.module_name === "braces"
      && advisory.findings?.length > 0 && advisory.findings.every((finding) => finding.version === receipt.version)
    if (patched) mitigated.push(advisory)
    else unresolved.push(advisory)
  }
  return { mitigated, unresolved }
}
