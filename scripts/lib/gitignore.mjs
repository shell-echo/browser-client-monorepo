import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const generatedDirectories = new Set([
  "node_modules",
  ".next",
  "dist",
  "dist-dev",
  "dist-ssr",
  ".turbo",
  ".reinit",
  "coverage",
  "out",
  "build",
  "logs",
  ".vercel",
])
const examples = ["!.env.example", "!.env.*.example"]

export function normalizeAppGitignore(source) {
  const lines = source
    .replace(/\r\n/g, "\n")
    .replace(/\n+$/, "")
    .split("\n")
    .filter((line) => !examples.includes(line))
    .map((line) => {
      const name = line.replace(/^\//, "").replace(/\/$/, "")
      if (generatedDirectories.has(name)) return `/${name}/`
      if (["*.tsbuildinfo", "next-env.d.ts"].includes(line)) return `/${line}`
      return line
    })
  return [...lines, ...examples, ""].join("\n")
}

export async function integrateGitignore(app) {
  const path = join(app, ".gitignore")
  let source = ""
  try {
    source = await readFile(path, "utf8")
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  await writeFile(path, normalizeAppGitignore(source))
}
