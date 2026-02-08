import eslintConfig from "@workspace/eslint-config/extension";

export default [
  ...eslintConfig,
  {
    rules: {
      "turbo/no-undeclared-env-vars": ["warn", { allowList: ["MODE"] }],
    },
  },
];
