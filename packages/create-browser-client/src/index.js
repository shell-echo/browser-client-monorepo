#!/usr/bin/env node
/* global console, process */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appPackages = {
  admin: ["@workspace/components", "@workspace/ui", "react", "react-dom", "react-router"],
  web: ["@workspace/components", "@workspace/constant", "@workspace/ui", "next", "react", "react-dom"],
  extension: [
    "@workspace/components",
    "@workspace/constant",
    "@workspace/helper",
    "@workspace/logger",
    "@workspace/ui",
    "react",
    "react-dom",
  ],
};

const sharedPackages = ["components", "eslint-config", "typescript-config", "types", "ui"];
const packageDeps = {
  components: ["ui"],
  extension: ["constant", "helper", "logger"],
  web: ["constant"],
};

const latestPackages = [
  "@crxjs/vite-plugin",
  "@eslint/js",
  "@tailwindcss/postcss",
  "@tailwindcss/vite",
  "@testing-library/react",
  "@types/chrome",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@vitejs/plugin-react-swc",
  "@vitest/coverage-v8",
  "cspell",
  "eslint",
  "eslint-config-next",
  "eslint-config-prettier",
  "eslint-plugin-import",
  "eslint-plugin-only-warn",
  "eslint-plugin-prettier",
  "eslint-plugin-react",
  "eslint-plugin-react-hooks",
  "eslint-plugin-react-refresh",
  "eslint-plugin-turbo",
  "globals",
  "jsdom",
  "next",
  "postcss",
  "prettier",
  "react",
  "react-dom",
  "react-router",
  "tailwindcss",
  "turbo",
  "typescript",
  "typescript-eslint",
  "vite",
  "vite-plugin-zip-pack",
  "vitest",
];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("-"));
const selectedApps = readApps(args);

if (!target) {
  console.error("Usage: create-browser-client <directory> [--apps admin,web,extension]");
  process.exit(1);
}

const targetRoot = resolve(process.cwd(), target);
if (existsSync(targetRoot) && readdirSync(targetRoot).length > 0) {
  console.error(`Target directory is not empty: ${targetRoot}`);
  process.exit(1);
}

const packages = collectPackages(selectedApps);
const catalogVersions = readCatalogVersions();
const versions = resolveLatestVersions();
copyRepo(targetRoot, selectedApps, packages);
rewriteWorkspace(targetRoot, selectedApps, packages, versions);
console.log(`Created ${targetRoot} with apps: ${selectedApps.join(", ")}`);

function readApps(values) {
  const flag = values.find((arg) => arg.startsWith("--apps="));
  const list = (flag ? flag.split("=")[1] : "admin,web,extension")
    .split(",")
    .map((app) => app.trim())
    .filter(Boolean);
  const invalid = list.filter((app) => !appPackages[app]);
  if (invalid.length) throw new Error(`Unknown apps: ${invalid.join(", ")}`);

  return [...new Set(list)];
}

function collectPackages(apps) {
  const packages = new Set(sharedPackages);
  for (const app of apps) {
    packages.add(app);
    for (const dep of packageDeps[app] || []) packages.add(dep);
  }
  for (const pkg of [...packages]) for (const dep of packageDeps[pkg] || []) packages.add(dep);

  return packages;
}

function readCatalogVersions() {
  const versions = {};
  let catalog;
  for (const line of readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8").split("\n")) {
    const catalogMatch = line.match(/^ {2}([^:\s]+):$/);
    if (catalogMatch) {
      catalog = catalogMatch[1];
      versions[catalog] = {};
      continue;
    }
    const versionMatch = line.match(/^ {4}['"]?([^:'"]+)['"]?: (.+)$/);
    if (catalog && versionMatch) versions[catalog][versionMatch[1]] = `^${versionMatch[2].replace(/^['"]|['"]$/g, "")}`;
  }

  return versions;
}

function resolveLatestVersions() {
  const versions = {};
  for (const name of latestPackages) {
    try {
      versions[name] =
        `^${execFileSync("npm", ["view", name, "version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()}`;
    } catch {
      versions[name] = undefined;
    }
  }

  return versions;
}

function copyRepo(destination, apps, packages) {
  const skip = new Set([".git", "node_modules", ".turbo", "dist", ".next", "coverage", "pnpm-lock.yaml"]);
  const walk = (source, dest) => {
    const rel = relative(repoRoot, source);
    if (skip.has(source.split("/").pop())) return;
    if (rel.startsWith("apps/") && rel.split("/").length >= 2 && !apps.includes(rel.split("/")[1])) return;
    if (rel.startsWith("packages/") && rel.split("/").length >= 2 && !packages.has(rel.split("/")[1])) return;
    const stat = statSync(source);
    if (stat.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      for (const entry of readdirSync(source)) walk(join(source, entry), join(dest, entry));
    } else copyFileSync(source, dest);
  };
  rmSync(destination, { recursive: true, force: true });
  walk(repoRoot, destination);
}

function rewriteWorkspace(root, apps, packages, versions) {
  writeFileSync(join(root, "pnpm-workspace.yaml"), `packages:\n${apps.length ? "  - apps/*\n" : ""}  - packages/*\n`);
  for (const file of findPackageJson(root)) {
    const json = JSON.parse(readFileSync(file, "utf8"));
    pruneWorkspaceDeps(json, apps, packages);
    bumpVersions(json, versions, catalogVersions);
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  }
}

function findPackageJson(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (["node_modules", ".git"].includes(entry)) continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (entry === "package.json") files.push(path);
    }
  };
  walk(root);

  return files;
}

function pruneWorkspaceDeps(json, apps, packages) {
  for (const section of ["dependencies", "devDependencies"]) {
    if (!json[section]) continue;
    for (const name of Object.keys(json[section])) {
      if (name.startsWith("@workspace/")) {
        const pkg = name.replace("@workspace/", "");
        if (!packages.has(pkg)) delete json[section][name];
      }
    }
    if (Object.keys(json[section]).length === 0) delete json[section];
  }
  if (json.name === "browser-client-monorepo") {
    json.name = rootName(targetRoot);
    delete json.dependencies;
    delete json.devDependencies?.["create-browser-client"];
    if (json.devDependencies && Object.keys(json.devDependencies).length === 0) delete json.devDependencies;
    delete json.scripts?.create;
    json.scripts = Object.fromEntries(
      Object.entries(json.scripts || {}).filter(([name]) => name !== "test" || packages.has("ui")),
    );
  }
}

function bumpVersions(json, versions, catalogVersions) {
  for (const section of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(json[section] || {})) {
      const current = String(json[section][name]);
      if (current.startsWith("workspace:")) continue;
      if (versions[name]) json[section][name] = versions[name];
      else if (current.startsWith("catalog:")) {
        const catalog = current.split(":")[1];
        json[section][name] = catalogVersions[catalog]?.[name] || current;
      }
    }
  }
}

function rootName(path) {
  return path.split(/[\\/]/).filter(Boolean).pop() || "browser-client-monorepo";
}
