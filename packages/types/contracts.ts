export type PackageExports = Record<string, string>;

export function isDeclarationFilePath(path: string) {
  return path.startsWith("./src/") && path.endsWith(".d.ts");
}

export function toTypesVersionsFromExports(exportsMap: PackageExports) {
  return Object.fromEntries(
    Object.entries(exportsMap).map(([entry, path]) => [entry.replace(/^\.\//, ""), [path.replace(/^\.\//, "")]]),
  );
}

export function collectTripleSlashReferences(source: string) {
  const matches = source.matchAll(/\/\/\/\s*<reference\s+(?:path|types)="([^"]+)"\s*\/>/g);

  return Array.from(matches, (match) => match[1]);
}

export function hasNamespaceDeclaration(source: string, namespaceName: string) {
  const pattern = new RegExp(`declare\\s+namespace\\s+${namespaceName}\\s*\\{`);

  return pattern.test(source);
}
