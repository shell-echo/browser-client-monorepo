// Patterns are relative to the consuming config. Ignore build outputs only at
// repository / workspace boundaries; src/dist and similar business trees count.
const generated = ["dist", "dist-dev", ".turbo", ".reinit", "coverage"]

// Framework plugins stay in the consuming app so reinit can upgrade them together.
export default [
  {
    name: "browser-client/generated-files",
    ignores: [
      "**/node_modules/**",
      ...generated.flatMap((name) => [`${name}/**`, `apps/*/${name}/**`, `packages/*/${name}/**`]),
    ],
  },
  {
    name: "browser-client/base",
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
]
