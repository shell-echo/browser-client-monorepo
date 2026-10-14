// Framework plugins stay in the consuming app so reinit can upgrade them together.
export default [
  {
    name: "browser-client/generated-files",
    ignores: ["**/node_modules/**", "**/dist/**", "**/dist-dev/**", "**/.turbo/**", "**/.reinit/**", "**/coverage/**"],
  },
  {
    name: "browser-client/base",
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
]
