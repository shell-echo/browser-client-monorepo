import assert from "node:assert/strict"
import { test } from "node:test"
import type { AxeResults } from "axe-core"
import { accessibilityScan, accessibilityCoverage, assertAccessible, accessibilityTags } from "../lib/accessibility.mts"
import { accessibilityPaths } from "../lib/browser-config.mts"

test("accessibility evidence retains actionable rule targets without page HTML or private form values", () => {
  const raw = {
    testEngine: { version: "4.14.0" },
    passes: [{}],
    incomplete: [{ id: "contrast", nodes: [{}] }],
    violations: [
      {
        id: "button-name",
        impact: "critical",
        help: "Name the button",
        helpUrl: "https://example.test/rule",
        nodes: [{ target: ["#save"], html: '<button value="private input">', failureSummary: "Missing name" }],
      },
    ],
  } as unknown as AxeResults
  const scan = accessibilityScan(raw, { label: "fixture", url: "http://127.0.0.1/", theme: "dark", width: 320 })
  assert.equal(scan.violations[0].nodes[0].target[0], "#save")
  assert(!JSON.stringify(scan).includes("private input"))
  assert.throws(() => assertAccessible(scan), /button-name/)
  assert.throws(() => accessibilityCoverage([scan]))
  assert.throws(() => accessibilityCoverage([]), /missing/)
  const good = { ...scan, violations: [] }
  assert.equal(accessibilityCoverage([good]).scans, 1)
  assert.equal(good.incomplete.length, 1, "Manual-review findings must remain in evidence")
  assert(accessibilityTags.includes("wcag22aa"))
  assert.throws(() => accessibilityScan({} as AxeResults, { label: "bad", url: "", theme: "dark", width: 320 }), /Malformed/)
})

test("the primary route cannot be omitted and extra audit paths must stay local and bounded", () => {
  assert.deepEqual(accessibilityPaths({ path: "/", accessibilityPaths: [] }), ["/"])
  assert.deepEqual(accessibilityPaths({ path: "/", accessibilityPaths: ["/login", "/"] }), ["/", "/login"])
  for (const paths of [["https://external.test/"], ["//external.test/"], Array(21).fill("/")])
    assert.throws(() => accessibilityPaths({ path: "/", accessibilityPaths: paths }))
})
