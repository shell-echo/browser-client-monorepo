import assert from "node:assert/strict"
import { test } from "node:test"
import { reinitTimeouts, timeoutForCommand } from "../lib/reinit-timeouts.mjs"

test("browser suites get a separate bounded budget without extending ordinary commands", () => {
  const timeouts = reinitTimeouts({})
  for (const args of [["test:web-admin"], ["test:extension"]]) assert.equal(timeoutForCommand(args, timeouts), 1_200_000)
  for (const args of [["install"], ["check"], ["view", "vite"], ["exec", "playwright", "install", "chromium"]])
    assert.equal(timeoutForCommand(args, timeouts), 600_000)
})

test("explicit global timeout remains compatible and the browser override takes precedence", () => {
  const global = reinitTimeouts({ REINIT_COMMAND_TIMEOUT_MS: "12345" })
  assert.equal(timeoutForCommand(["check"], global), 12345)
  assert.equal(timeoutForCommand(["test:web-admin"], global), 12345)
  const browser = reinitTimeouts({ REINIT_COMMAND_TIMEOUT_MS: "12345", REINIT_BROWSER_TIMEOUT_MS: "23456" })
  assert.equal(timeoutForCommand(["test:extension"], browser), 23456)
  assert.equal(timeoutForCommand(["install"], browser), 12345)
  assert.equal(reinitTimeouts({ REINIT_BROWSER_TIMEOUT_MS: "23456" }).command, 600_000)
})

test("invalid budgets fail closed instead of disabling command timeouts", () => {
  for (const name of ["REINIT_COMMAND_TIMEOUT_MS", "REINIT_BROWSER_TIMEOUT_MS"])
    for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "2147483648"])
      assert.throws(() => reinitTimeouts({ [name]: value }), new RegExp(name))
})
