import nodeConfig from "@browser-client/eslint-config/node"

export default [
  ...nodeConfig,
  {
    // These names run inside Playwright's extension page.evaluate callbacks.
    files: ["scripts/test-extension.mjs"],
    languageOptions: { globals: { chrome: "readonly", window: "readonly", getComputedStyle: "readonly" } },
  },
]
