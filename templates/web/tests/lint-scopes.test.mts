import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"

const generated = ["dist", "dist-dev", ".turbo", ".reinit", "coverage"]

test("Next ESLint checks business directories named like build outputs while ignoring app-root outputs", async () => {
  const previousCwd = process.cwd()
  const web = fileURLToPath(new URL("../", import.meta.url))
  process.chdir(web)
  try {
    const eslint = new ESLint({ cwd: web })
    const source =
      '"use client";import {useState} from "react";export default function Broken({ok}:{ok:boolean}){if(ok)useState(0);return null}'
    for (const name of generated) {
      for (const file of [`src/${name}/feature.tsx`, `src/features/${name}/feature.tsx`]) {
        assert.equal(await eslint.isPathIgnored(file), false, file)
        const [result] = await eslint.lintText(source, { filePath: file })
        assert(
          result.messages.some((message) => message.ruleId === "react-hooks/rules-of-hooks"),
          file,
        )
      }
      assert.equal(await eslint.isPathIgnored(`${name}/generated.js`), true, name)
    }
    assert.equal(await eslint.isPathIgnored("node_modules/dependency/index.js"), true)
  } finally {
    process.chdir(previousCwd)
  }
})
