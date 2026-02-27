import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import adminConfig from "./admin.js";
import baseConfig from "./eslint.config.js";
import extensionConfig from "./extension.js";
import formatConfig from "./format.js";
import helperConfig from "./helper.js";
import loggerConfig from "./logger.js";
import typesConfig from "./types.js";
import uiConfig from "./ui.js";
import viteConfig from "./vite.js";
import webConfig from "./web.js";

type FlatConfig = {
  files?: string[];
  rules?: Record<string, unknown>;
};

function findRule(config: unknown[], ruleName: string) {
  for (let index = config.length - 1; index >= 0; index -= 1) {
    const item = config[index] as FlatConfig | undefined;
    if (item?.rules && Object.prototype.hasOwnProperty.call(item.rules, ruleName)) {
      return item.rules[ruleName];
    }
  }

  return undefined;
}

describe("@workspace/eslint-config", () => {
  const expectedExportEntries = [
    "./admin",
    "./constant",
    "./extension",
    "./format",
    "./helper",
    "./logger",
    "./types",
    "./ui",
    "./web",
  ];

  it("exports non-empty flat configs", () => {
    expect(baseConfig.length).toBeGreaterThan(0);
    expect(formatConfig.length).toBeGreaterThan(0);
    expect(viteConfig.length).toBeGreaterThan(0);
    expect(webConfig.length).toBeGreaterThan(0);
    expect(uiConfig.length).toBeGreaterThan(0);
    expect(typesConfig.length).toBeGreaterThan(0);
    expect(helperConfig.length).toBeGreaterThan(0);
    expect(loggerConfig.length).toBeGreaterThan(0);
  });

  it("reuses vite config in admin and extension entries", () => {
    expect(adminConfig).toBe(viteConfig);
    expect(extensionConfig).toBe(viteConfig);
  });

  it("contains formatting rules from shared format config", () => {
    expect(findRule(formatConfig, "import/order")).toBeDefined();
    expect(findRule(formatConfig, "prettier/prettier")).toBe("error");
    expect(findRule(formatConfig, "no-multiple-empty-lines")).toEqual(["error", { max: 1 }]);
  });

  it("keeps turbo env rule enabled for app-facing configs", () => {
    expect(findRule(viteConfig, "turbo/no-undeclared-env-vars")).toBe("warn");
    expect(findRule(webConfig, "turbo/no-undeclared-env-vars")).toBe("warn");
    expect(findRule(uiConfig, "turbo/no-undeclared-env-vars")).toBe("warn");
  });

  it("turns off triple-slash-reference for d.ts files in types config", () => {
    const declarationOverride = typesConfig.find(
      (item): item is FlatConfig => Array.isArray((item as FlatConfig)?.files) && (item as FlatConfig).files?.includes("**/*.d.ts"),
    );

    expect(declarationOverride).toBeDefined();
    expect(declarationOverride?.rules?.["@typescript-eslint/triple-slash-reference"]).toBe("off");
  });

  it("publishes expected entry points in package exports", () => {
    const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
      exports: Record<string, string>;
    };

    expect(Object.keys(packageJson.exports).sort()).toEqual(expectedExportEntries);

    for (const path of Object.values(packageJson.exports)) {
      expect(path.startsWith("./")).toBe(true);
      expect(path.endsWith(".js")).toBe(true);
      expect(existsSync(new URL(path, import.meta.url))).toBe(true);
    }
  });
});
