import type { AuditAdvisory } from "../lib/dependency-security.mts"
interface BraceNode {
  type: string
  nodes: BraceNode[]
  parent?: BraceNode
}
import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createRequire } from "node:module"
import { readFile, realpath } from "node:fs/promises"
import { join } from "node:path"
import semver from "semver"
import { parse } from "yaml"
import { createCommandRunner } from "../lib/commands.mts"
import { bracesAdvisory, classifyAudit, verifyBracesPatch } from "../lib/dependency-security.mts"

const root = fileURLToPath(new URL("../../", import.meta.url))

test("locked tooling transitives retain upstream fixes for collection, HTTP and URI advisories", async () => {
  const lock = parse(await readFile(join(root, "pnpm-lock.yaml"), "utf8"))
  const fixedRanges: Record<string, string> = {
    zod: ">=4.6.6",
    "body-parser": "^1.20.9 || >=2.4.0",
    undici: "^6.29.1 || ^7.30.1 || >=8.12.2",
    "fast-uri": "^2.4.8 || ^3.1.9 || >=4.2.3",
  }
  for (const [name, range] of Object.entries(fixedRanges)) {
    for (const entry of Object.keys(lock.packages).filter((key) => key.startsWith(`${name}@`))) {
      const version = entry.slice(name.length + 1)
      assert(semver.satisfies(version, range), `${entry} is below the tested upstream security floor ${range}`)
    }
  }
  const cli = createRequire(await realpath(join(root, "node_modules/shadcn/package.json")))
  const zod = cli("zod")
  assert(semver.gte(cli("zod/package.json").version, "4.6.6"), "shadcn must resolve patched Zod 4")
  const schema = zod.object({ name: zod.string(), values: zod.array(zod.number()).max(2) })
  assert.deepEqual(schema.parse({ name: "workspace", values: [1, 2] }), { name: "workspace", values: [1, 2] })
  assert.equal(schema.safeParse({ name: "workspace", values: [1, 2, 3] }).success, false)
})

test("upstream shadcn CLI loads with its native Zod 4 dependency graph", async (t) => {
  const runner = createCommandRunner({ cwd: root, timeoutMs: 15_000 })
  t.after(() => runner.close())
  const manifestPath = await realpath(join(root, "node_modules/shadcn/package.json"))
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.shadcn
  const cli = fileURLToPath(new URL(bin, pathToFileURL(manifestPath)))
  const output = await runner.run(process.execPath, [cli, "--version"], { capture: true })
  assert.equal(output.trim(), manifest.version)
})

async function ipParsers() {
  const cli = createRequire(await realpath(join(root, "node_modules/shadcn/package.json")))
  const sdk = createRequire(cli.resolve("@modelcontextprotocol/sdk/server/index.js"))
  return [createRequire(cli.resolve("socks/package.json")), createRequire(sdk.resolve("express-rate-limit"))]
}

test("locked and installed shadcn IP parsers use upstream fixed versions", async () => {
  const lock = parse(await readFile(join(root, "pnpm-lock.yaml"), "utf8"))
  const versions = Object.keys(lock.packages).filter((name) => name.startsWith("ip-address@"))
  assert(versions.length > 0, "Expected the shadcn tooling IP parser dependency")
  for (const name of versions) {
    const version = name.slice("ip-address@".length)
    assert(semver.valid(version) && semver.gte(version, "10.7.4"), `${name} is affected by GHSA-rxp7-6hxx-x8q5`)
  }
  for (const consumer of await ipParsers()) {
    const version = consumer("ip-address/package.json").version
    assert(semver.gte(version, "10.7.4"), `Installed IP parser ${version} is below the security floor`)
  }
})

test("the installed IP parser rejects long malformed zones promptly and retains valid addresses", async (t) => {
  const runner = createCommandRunner({ cwd: root, timeoutMs: 5000 })
  t.after(() => runner.close())
  const modules = new Set((await ipParsers()).map((consumer) => consumer.resolve("ip-address")))
  for (const path of modules) {
    // A process deadline contains an accidental return to the quadratic
    // parser; it must not hang the test runner or share its event loop.
    await runner.run(process.execPath, [
      "--input-type=commonjs",
      "-e",
      `const assert = require("node:assert/strict");
const { Address4, Address6 } = require(process.argv[1]);
assert(Address4.isValid("192.0.2.1"));
assert(Address6.isValid("2001:db8::1"));
assert.equal(new Address6("fe80::1%eth0").zone, "%eth0");
for (const end of ["\\n", "\\r", "\\u2028", "\\u2029"]) {
  assert.equal(Address6.isValid("%".repeat(1_000_000) + end), false);
}`,
      path,
    ])
  }
})

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
    { url: "https://github.com/advisories/GHSA-rxp7-6hxx-x8q5", module_name: "ip-address", findings: [{ version: "10.7.3" }] },
  ]) {
    assert.equal(classifyAudit(audit({ advisory }), receipt).unresolved.length, 1)
  }
  assert.throws(() => classifyAudit({ error: { message: "registry unavailable" } }, receipt), /response is invalid/)
})
