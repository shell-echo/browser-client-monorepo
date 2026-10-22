import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"
import base from "./base.js"

const browserOnlyGlobals = [
  ...new Set([...Object.keys(globals.browser).filter((name) => !Object.hasOwn(globals.node, name)), "chrome"]),
]

export default [
  ...base,
  {
    name: "browser-client/node",
    files: ["**/*.{js,mjs,cjs,mts}"],
    languageOptions: { ecmaVersion: "latest", globals: globals.node },
    rules: js.configs.recommended.rules,
  },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ["**/*.mts"] })),
  {
    name: "browser-client/node-typescript",
    files: ["**/*.mts"],
    ignores: ["**/*.d.mts"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-undef": "off",
      "no-restricted-globals": ["error", ...browserOnlyGlobals],
      "no-unreachable": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
]
