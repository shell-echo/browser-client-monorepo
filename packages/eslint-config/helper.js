import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

import formatConfig from "./format.js";

const eslintConfig = defineConfig([js.configs.recommended, ...tseslint.configs.recommended, ...formatConfig]);

export default eslintConfig;
