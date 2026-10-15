import nodeConfig from "@browser-client/eslint-config/node"

export default [
  ...nodeConfig,
  { ignores: ["apps/**", "packages/ui/**"] },
  {
    // These names run inside Playwright page.evaluate callbacks.
    files: ["scripts/test-extension.mjs", "scripts/test-web-admin.mjs"],
    languageOptions: {
      globals: { chrome: "readonly", window: "readonly", document: "readonly", getComputedStyle: "readonly" },
    },
  },
]
