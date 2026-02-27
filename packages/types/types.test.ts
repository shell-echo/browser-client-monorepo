import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  collectTripleSlashReferences,
  hasNamespaceDeclaration,
  isDeclarationFilePath,
  toTypesVersionsFromExports,
} from "./contracts";

type PackageJson = {
  exports: Record<string, string>;
  typesVersions: {
    "*": Record<string, string[]>;
  };
};

function readText(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const expectedExports = {
  "./admin": "./src/admin.d.ts",
  "./common": "./src/common.d.ts",
  "./extension": "./src/extension.d.ts",
  "./web": "./src/web.d.ts",
};

const expectedTypesVersions = {
  admin: ["src/admin.d.ts"],
  common: ["src/common.d.ts"],
  extension: ["src/extension.d.ts"],
  web: ["src/web.d.ts"],
};

describe("@workspace/types", () => {
  it("exports the pinned type entry map", () => {
    const packageJson = JSON.parse(readText("./package.json")) as PackageJson;

    expect(packageJson.exports).toEqual(expectedExports);
  });

  it("exports the expected type entry names", () => {
    const packageJson = JSON.parse(readText("./package.json")) as PackageJson;

    expect(Object.keys(packageJson.exports).sort()).toEqual(Object.keys(expectedExports).sort());
  });

  it("keeps typesVersions aligned with exports", () => {
    const packageJson = JSON.parse(readText("./package.json")) as PackageJson;

    expect(packageJson.typesVersions["*"]).toEqual(toTypesVersionsFromExports(packageJson.exports));
    expect(packageJson.typesVersions["*"]).toEqual(expectedTypesVersions);
  });

  it("ships all exported declaration files", () => {
    const exportPaths = Object.values((JSON.parse(readText("./package.json")) as PackageJson).exports);

    for (const exportPath of exportPaths) {
      expect(isDeclarationFilePath(exportPath)).toBe(true);
      expect(existsSync(new URL(exportPath, import.meta.url))).toBe(true);
    }
  });

  it("defines shared primitive types in common declarations", () => {
    const common = readText("./src/common.d.ts");

    expect(common).toContain("type Timestamp = number;");
    expect(common).toContain('type MODE = "development" | "production" | "test";');
  });

  it("references shared declarations correctly", () => {
    const admin = readText("./src/admin.d.ts");
    const extension = readText("./src/extension.d.ts");
    const web = readText("./src/web.d.ts");

    expect(collectTripleSlashReferences(admin)).toContain("./common.d.ts");
    expect(collectTripleSlashReferences(extension)).toEqual(expect.arrayContaining(["chrome", "./common.d.ts"]));
    expect(collectTripleSlashReferences(web)).toEqual(expect.arrayContaining(["chrome", "./common.d.ts", "./extension.d.ts"]));
  });

  it("declares browser-facing namespaces and css module typing", () => {
    const extension = readText("./src/extension.d.ts");
    const web = readText("./src/web.d.ts");

    expect(hasNamespaceDeclaration(extension, "Extension")).toBe(true);
    expect(hasNamespaceDeclaration(web, "Web")).toBe(true);
    expect(web).toContain('declare module "*.css";');
  });
});
