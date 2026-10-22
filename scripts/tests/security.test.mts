import type { AuditAdvisory } from "../lib/dependency-security.mts"
interface BraceNode {
  type: string
  nodes: BraceNode[]
  parent?: BraceNode
}
import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { realpath } from "node:fs/promises"
import { bracesAdvisory, classifyAudit, verifyBracesPatch } from "../lib/dependency-security.mts"

const root = fileURLToPath(new URL("../../", import.meta.url))

test("installed shadcn dependency rejects deep brace/paren patterns and preserves normal expansion", async () => {
  const receipt = await verifyBracesPatch(root)
  assert.equal(receipt.verified, true)
  const cli = createRequire(await realpath(new URL("../../node_modules/shadcn/package.json", import.meta.url)))
  const glob = createRequire(cli.resolve("fast-glob/package.json"))
  const match = createRequire(glob.resolve("micromatch/package.json"))
  const braces = match("braces")
  assert.equal(glob("micromatch").isMatch("src/app.tsx", "src/*.{ts,tsx}"), true)
  assert.deepEqual(braces.expand("file-{1..3}.ts"), ["file-1.ts", "file-2.ts", "file-3.ts"])
  assert.doesNotThrow(() => braces.parse("\\{".repeat(150)))
  assert.doesNotThrow(() => braces.parse('"' + "{".repeat(150) + '"'))
  for (const method of ["compile", "expand", "stringify"]) {
    const ast: BraceNode = { type: "root", nodes: [] }
    let node = ast
    for (let depth = 0; depth < 150; depth++) {
      const child = { type: "paren", nodes: [], parent: node }
      node.nodes.push(child)
      node = child
    }
    assert.throws(
      () => braces[method](ast),
      (error) => error instanceof Error && "code" in error && error.code === "ERR_BRACES_DEPTH",
      `${method} must also guard caller-provided ASTs`,
    )
  }
})

test("audit only accepts the exact advisory/version after patch verification; other findings stay failures", () => {
  const known = { url: bracesAdvisory, module_name: "braces", findings: [{ version: "3.0.3" }] }
  const audit = (advisories: Record<string, AuditAdvisory>) => ({ metadata: { vulnerabilities: { high: 1 } }, advisories })
  const receipt = { verified: true, version: "3.0.3" }
  assert.equal(classifyAudit(audit({ known }), receipt).mitigated.length, 1)
  assert.equal(classifyAudit(audit({ known }), undefined).unresolved.length, 1)
  for (const advisory of [
    { ...known, url: "https://github.com/advisories/GHSA-new" },
    { ...known, findings: [{ version: "3.0.2" }] },
    { ...known, module_name: "other" },
  ]) {
    assert.equal(classifyAudit(audit({ advisory }), receipt).unresolved.length, 1)
  }
  assert.throws(() => classifyAudit({ error: { message: "registry unavailable" } }, receipt), /response is invalid/)
})
