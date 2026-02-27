import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  getOptionMismatches,
  REQUIRED_BASE_LIB,
  REQUIRED_BASE_OPTIONS,
  TSCONFIG_SCHEMA_URL,
  type TsConfig,
} from "./contracts";

function readJson(path: string) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as TsConfig;
}

describe("@workspace/typescript-config", () => {
  it("reports missing or mismatched compiler options", () => {
    expect(getOptionMismatches(undefined, { strict: true, module: "NodeNext" })).toEqual(["strict", "module"]);
    expect(getOptionMismatches({ strict: false, module: "NodeNext" }, { strict: true, module: "NodeNext" })).toEqual(["strict"]);
  });

  it("defines strict baseline compiler options", () => {
    const base = readJson("./base.json");

    expect(base.$schema).toBe(TSCONFIG_SCHEMA_URL);
    expect(base.display).toBe("Default");
    expect(getOptionMismatches(base.compilerOptions, REQUIRED_BASE_OPTIONS)).toEqual([]);
    expect(base.compilerOptions?.lib).toEqual(REQUIRED_BASE_LIB);
  });

  it("extends base config for react libraries", () => {
    const reactLibrary = readJson("./react-library.json");

    expect(reactLibrary.$schema).toBe(TSCONFIG_SCHEMA_URL);
    expect(reactLibrary.display).toBe("React Library");
    expect(reactLibrary.extends).toBe("./base.json");
    expect(reactLibrary.compilerOptions).toEqual(expect.objectContaining({ jsx: "react-jsx" }));
  });
});
