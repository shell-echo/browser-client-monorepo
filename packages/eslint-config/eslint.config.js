import js from "@eslint/js";
import { defineConfig } from "eslint/config";

import formatConfig from "./format.js";

const eslintConfig = defineConfig([js.configs.recommended, ...formatConfig]);

export default eslintConfig;
