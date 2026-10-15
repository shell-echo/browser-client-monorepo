import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"

// Exercise the real application config, including Next's legacy-plugin adapter.
// A successful peer install alone does not establish runtime compatibility.
const fixtures = [
  ["react/jsx-key", 2, "export default function C(){ return [<div />, <div />] }"],
  ["react/jsx-no-duplicate-props", 2, 'export default function C(){ return <div id="a" id="b" /> }'],
  ["react/jsx-no-undef", 2, "export default function C(){ return <Missing /> }"],
  ["react/no-children-prop", 2, 'export default function C(){ return <div children="child" /> }'],
  [
    "react/no-danger-with-children",
    2,
    'export default function C(){ return <div dangerouslySetInnerHTML={{__html:"text"}}>child</div> }',
  ],
  ["react/no-unescaped-entities", 2, "export default function C(){ return <div>don't</div> }"],
  [
    "react/require-render-return",
    2,
    'import React from "react"; export default class C extends React.Component { render(){ const x=1; } }',
  ],
  [
    "react/no-direct-mutation-state",
    2,
    'import React from "react"; export default class C extends React.Component { componentDidMount(){ this.state.x=1; } render(){ return null; } }',
  ],
  [
    "react/no-string-refs",
    2,
    'import React from "react"; export default class C extends React.Component { render(){ return <input ref="field" />; } }',
  ],
  [
    "react-hooks/rules-of-hooks",
    2,
    '"use client";import {useState} from "react"; export default function C({ok}:{ok:boolean}){ if(ok)useState(0); return null; }',
  ],
  [
    "react-hooks/exhaustive-deps",
    1,
    '"use client";import{useEffect}from"react";export default function C({value}:{value:string}){useEffect(()=>{console.log(value)},[]);return null;}',
  ],
  ["jsx-a11y/alt-text", 1, 'export default function C(){ return <img src="/test.png" /> }'],
  ["jsx-a11y/aria-props", 1, 'export default function C(){ return <div aria-bogus="x" /> }'],
  ["jsx-a11y/aria-proptypes", 1, 'export default function C(){ return <div aria-hidden="maybe" /> }'],
  ["jsx-a11y/aria-unsupported-elements", 1, 'export default function C(){ return <meta role="button" /> }'],
  ["jsx-a11y/role-has-required-aria-props", 1, 'export default function C(){ return <div role="checkbox" /> }'],
  ["jsx-a11y/role-supports-aria-props", 1, 'export default function C(){ return <div role="article" aria-checked="true" /> }'],
  ["import/no-anonymous-default-export", 1, "export default {value:1}"],
  ["@next/next/no-sync-scripts", 2, 'export default function C(){ return <script src="/test.js" /> }'],
  ["@typescript-eslint/no-explicit-any", 2, "export type Value = any"],
  ["@typescript-eslint/no-unused-vars", 1, "const unused=1;export const value=2;"],
]

test("official Next rules remain effective with the shared ESLint version", async (t) => {
  const previousCwd = process.cwd()
  const web = fileURLToPath(new URL("../../apps/web/", import.meta.url))
  // React's version detection uses process.cwd(), independently of ESLint.cwd.
  // Node runs test files in separate processes, so this does not affect peers.
  process.chdir(web)
  try {
    const eslint = new ESLint({ cwd: web })
    for (const [rule, severity, source] of fixtures) {
      await t.test(rule, async () => {
        const [result] = await eslint.lintText(source, { filePath: "src/lint-regression.tsx" })
        assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages))
        const message = result.messages.find((message) => message.ruleId === rule)
        assert(message, `规则 ${rule} 未检出错误：${JSON.stringify(result.messages)}`)
        assert.equal(message.severity, severity, `${rule} 的严重级别发生变化`)
      })
    }
    await t.test("valid shared shadcn/ui usage", async () => {
      const [result] = await eslint.lintText(
        'import{Button}from"@browser-client/ui/components/button";export default function C(){return <Button type="button">Save</Button>}',
        { filePath: "src/lint-valid.tsx" },
      )
      assert.deepEqual(result.messages, [])
    })
  } finally {
    process.chdir(previousCwd)
  }
})
