/// <reference types="node" />

import { readFileSync } from "node:fs";

import tailwindcss from "@tailwindcss/postcss";
import postcss, { type AtRule, type Container, type Root, type Rule } from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

const postcssProcessor = postcss([tailwindcss()]);

function readGlobalsCss() {
  return readFileSync(new URL("./globals.css", import.meta.url), "utf8");
}

async function compileGlobalsCss() {
  const sourcePath = new URL("./globals.css", import.meta.url).pathname;
  const result = await postcssProcessor.process(readGlobalsCss(), { from: sourcePath });

  return result.css;
}

let cssAst: Root;
let compiledCssPromise: Promise<string> | undefined;

function findRule(container: Container, selector: string) {
  let target: Rule | undefined;
  container.walkRules((rule) => {
    if (!target && rule.selector === selector) target = rule;
  });

  return target;
}

function findAtRule(container: Container, name: string, params: string) {
  let target: AtRule | undefined;
  container.walkAtRules(name, (rule) => {
    if (!target && rule.params.trim() === params) target = rule;
  });

  return target;
}

function hasDeclaration(rule: Rule | AtRule, prop: string) {
  return rule.nodes?.some((node) => node.type === "decl" && node.prop === prop) ?? false;
}

function hasApply(rule: Rule, params: string) {
  return rule.nodes?.some((node) => node.type === "atrule" && node.name === "apply" && node.params.includes(params)) ?? false;
}

describe("globals.css", () => {
  beforeAll(() => {
    cssAst = postcss.parse(readGlobalsCss(), { from: undefined });
  });

  it("defines root and dark theme tokens", () => {
    const rootRule = findRule(cssAst, ":root");
    const darkRule = findRule(cssAst, ".dark");

    expect(rootRule).toBeDefined();
    expect(darkRule).toBeDefined();
    if (!rootRule || !darkRule) return;

    expect(hasDeclaration(rootRule, "--background")).toBe(true);
    expect(hasDeclaration(rootRule, "--foreground")).toBe(true);
    expect(hasDeclaration(rootRule, "--radius")).toBe(true);
    expect(hasDeclaration(darkRule, "--background")).toBe(true);
    expect(hasDeclaration(darkRule, "--foreground")).toBe(true);
  });

  it("contains theme mapping and base layer rules", () => {
    const themeInline = findAtRule(cssAst, "theme", "inline");
    const baseLayer = findAtRule(cssAst, "layer", "base");

    expect(themeInline).toBeDefined();
    expect(baseLayer).toBeDefined();
    if (!themeInline || !baseLayer) return;

    expect(hasDeclaration(themeInline, "--color-background")).toBe(true);
    expect(hasDeclaration(themeInline, "--radius-lg")).toBe(true);

    const bodyRule = findRule(baseLayer, "body");
    const buttonRule = findRule(baseLayer, "button");
    expect(bodyRule).toBeDefined();
    expect(buttonRule).toBeDefined();
    if (!bodyRule || !buttonRule) return;

    expect(hasApply(bodyRule, "bg-background text-foreground")).toBe(true);
    expect(hasApply(buttonRule, "cursor-pointer")).toBe(true);
  });

  it("is compilable in postcss pipeline", async () => {
    compiledCssPromise ??= compileGlobalsCss();
    const css = await compiledCssPromise;

    expect(css).toContain("--color-background");
    expect(css).toContain("cursor: pointer;");
  });
});
