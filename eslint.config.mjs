import nodeConfig from "@browser-client/eslint-config/node"

export default [
  ...nodeConfig,
  { ignores: ["apps/**", "packages/ui/**"] },
  {
    // These names run inside Playwright page.evaluate callbacks.
    files: [
      "scripts/test-extension.mts",
      "scripts/test-web-admin.mts",
      "scripts/lib/theme-verification.mts",
      "scripts/lib/client-page-verification.mts",
      "scripts/lib/admin-verification.mts",
      "scripts/lib/web-verification.mts",
      "scripts/lib/extension-verification.mts",
      "browser-tests.config.mts",
    ],
    rules: { "no-restricted-globals": "off" },
    languageOptions: {
      globals: { chrome: "readonly", window: "readonly", document: "readonly", getComputedStyle: "readonly" },
    },
  },
]
