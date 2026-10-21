import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commandFailure } from "../lib/command-diagnostics.mjs"
import { createCommandRunner } from "../lib/commands.mjs"
import { createMaintenanceReport } from "../lib/maintenance-report.mjs"

test("captured command failures retain the actual registry diagnostic and exit status", async (t) => {
  const runner = createCommandRunner()
  t.after(() => runner.close())
  await assert.rejects(
    runner.run(process.execPath, ["-e", "console.log(process.env.REVIEW_DIAGNOSTIC);process.exit(7)"], {
      capture: true,
      env: { REVIEW_DIAGNOSTIC: JSON.stringify({ code: "EAI_AGAIN", message: "registry.npmjs.org lookup failed" }) },
    }),
    (error) => {
      assert.match(error.message, /failed \(7\)/)
      assert.match(error.message, /EAI_AGAIN/)
      assert.match(error.message, /registry\.npmjs\.org lookup failed/)
      assert.equal(error.output, undefined, "Raw captured output must not escape through error properties")
      return true
    },
  )
})

test("failure diagnostics redact credentials, authorization, query values and known environment secrets", () => {
  const output = [
    "EAI_AGAIN registry.npmjs.org",
    "https://alice:private-password@registry.example.com/package?token=private-query",
    "Authorization: Bearer private-bearer",
    JSON.stringify({
      password: "private-json",
      api_key: "private-key",
      access_token: "private-access",
      auth: "private-auth",
      _auth: "private-npm-auth",
      author: "Public Maintainer",
    }),
    "NPM_TOKEN=private-assignment",
    "unlabelled-private-environment-value",
    "unlabelled-npm-auth-value",
    "npm_abcdefghijklmnopqrstuvwxyz1234567890",
  ].join("\n")
  const error = commandFailure(
    "pnpm",
    ["view", "https://alice:argument-password@registry.example.com"],
    { code: 1, output },
    {
      SERVICE_API_KEY: "unlabelled-private-environment-value",
      npm_config__auth: "unlabelled-npm-auth-value",
    },
  )
  assert.match(error.message, /EAI_AGAIN registry\.npmjs\.org/)
  assert.match(error.message, /REDACTED/)
  assert.match(error.message, /Public Maintainer/)
  for (const secret of [
    "private-password",
    "private-query",
    "private-bearer",
    "private-json",
    "private-key",
    "private-access",
    "private-assignment",
    "unlabelled-private-environment-value",
    "npm_abcdefghijklmnopqrstuvwxyz1234567890",
    "argument-password",
    "private-auth",
    "private-npm-auth",
    "unlabelled-npm-auth-value",
  ])
    assert(!error.message.includes(secret), "Failure leaked a credential")
})

test("maintenance reports retain captured failure causes without persisting auth credentials", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "browser-client-diagnostic-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runner = createCommandRunner()
  t.after(() => runner.close())
  const path = join(root, "report.json")
  const metrics = createMaintenanceReport({ path, log() {} })
  let failure
  try {
    await metrics.phase("registry query", () =>
      runner.run(process.execPath, ["-e", "console.log(process.env.REVIEW_DIAGNOSTIC);process.exit(1)"], {
        capture: true,
        env: {
          REVIEW_DIAGNOSTIC: JSON.stringify({ code: "EAI_AGAIN", _auth: "private-report-auth", auth: "private-report-token" }),
        },
      }),
    )
  } catch (error) {
    failure = error
  }
  assert(failure)
  await metrics.finish("failed", { failure: failure.message })
  const bytes = await readFile(path, "utf8")
  const report = JSON.parse(bytes)
  assert.equal(report.status, "failed")
  assert.equal(report.phases[0].failure, report.failure)
  assert.match(report.failure, /EAI_AGAIN/)
  assert.match(report.failure, /REDACTED/)
  assert(!bytes.includes("private-report-auth"))
  assert(!bytes.includes("private-report-token"))
})

test("failure output strips terminal escapes and bounds long diagnostics while retaining the tail", () => {
  const secret = "private-".repeat(800)
  const output = secret + "\n" + "x".repeat(12000) + "\n\u001b[31mEAI_AGAIN registry.npmjs.org\u001b[0m"
  const error = commandFailure("pnpm", ["view", "vite@latest", "--json"], { code: 1, output }, { SERVICE_TOKEN: secret })
  assert(error.message.length < 5200)
  assert.match(error.message, /earlier output truncated/)
  assert.match(error.message, /EAI_AGAIN registry\.npmjs\.org$/)
  assert(!error.message.includes("private-"))
  assert(!error.message.includes("\u001b"))
})

test("successful captured JSON is returned unchanged", async (t) => {
  const runner = createCommandRunner()
  t.after(() => runner.close())
  const metadata = JSON.stringify({ version: "1.0.0", token: "metadata-must-not-be-rewritten" })
  assert.equal(
    await runner.run(process.execPath, ["-e", "console.log(process.env.REVIEW_METADATA)"], {
      capture: true,
      env: { REVIEW_METADATA: metadata },
    }),
    metadata,
  )
})
