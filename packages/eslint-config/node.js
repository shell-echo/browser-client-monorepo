import js from "@eslint/js"
import globals from "globals"
import base from "./base.js"

export default [
  ...base,
  {
    name: "browser-client/node",
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { ecmaVersion: "latest", globals: globals.node },
    rules: js.configs.recommended.rules,
  },
]
