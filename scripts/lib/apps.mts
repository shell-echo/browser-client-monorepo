import type { PackageManifest, TemplateVersions, Target } from "./contracts.mts"
import assert from "node:assert/strict"
import { readFile, readdir, lstat, realpath } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseTree, type Node as JsonNode, type ParseError } from "jsonc-parser"
import { parseDocument } from "yaml"

export const appTypes = ["web", "admin", "extension"] as const
export const integrationVersion = 1
export interface AppDefinition {
  type: Target
  port: number
}
export interface AppsConfig {
  $schema?: string
  schemaVersion: 1
  apps: Record<string, AppDefinition>
}
export interface AppIdentity {
  instanceId: string
  type: Target
  legacy: boolean
  integrationVersion: number
}
export interface Application extends AppDefinition, AppIdentity {
  id: string
  path: string
  packageName: string
}

function object(value: unknown): asserts value is Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "Expected a configuration object")
}
export function assertAppId(id: string) {
  assert(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) && id.length <= 48, `Invalid application identifier: ${id}`)
  assert(
    ![
      "all",
      "list",
      "doctor",
      "add",
      "remove",
      "restore",
      "recover",
      "con",
      "prn",
      "aux",
      "nul",
      "constructor",
      "prototype",
    ].includes(id) && !/^(com|lpt)[0-9]$/.test(id),
    `Reserved application identifier: ${id}`,
  )
}
export function parseAppsConfig(source: string): AppsConfig {
  const errors: ParseError[] = []
  const tree = parseTree(source, errors, { disallowComments: true, allowTrailingComma: false })
  assert(tree && errors.length === 0, "Invalid apps.config.json")
  function unique(node: JsonNode) {
    if (node.type === "object") {
      const names = new Set<string>()
      for (const property of node.children ?? []) {
        const name = property.children![0].value as string
        assert(!names.has(name), `Duplicate configuration key: ${name}`)
        names.add(name)
      }
    }
    for (const child of node.children ?? []) unique(child)
  }
  unique(tree)
  const config: unknown = JSON.parse(source)
  object(config)
  assert(
    Object.keys(config).every((key) => ["$schema", "schemaVersion", "apps"].includes(key)),
    "Unknown apps configuration field",
  )
  assert.equal(config.schemaVersion, 1, "Unsupported apps configuration schema")
  if (config.$schema !== undefined) assert.equal(typeof config.$schema, "string")
  object(config.apps)
  const ports = new Set<number>()
  for (const [id, definition] of Object.entries(config.apps)) {
    assertAppId(id)
    object(definition)
    assert.deepEqual(Object.keys(definition).sort(), ["port", "type"], `Unexpected application fields: ${id}`)
    assert(
      appTypes.some((type) => type === definition.type),
      `Unknown application type: ${id}`,
    )
    assert(
      Number.isSafeInteger(definition.port) && Number(definition.port) >= 1024 && Number(definition.port) <= 65535,
      `Invalid development port: ${id}`,
    )
    assert(!ports.has(Number(definition.port)), `Duplicate development port: ${definition.port}`)
    ports.add(Number(definition.port))
  }
  return config as unknown as AppsConfig
}

export async function readAppsConfig(root: string) {
  return parseAppsConfig(await readSourceFile(join(root, "apps.config.json")))
}
async function readSourceFile(path: string) {
  const info = await lstat(path)
  assert(info.isFile() && !info.isSymbolicLink(), `Configuration must be a regular file: ${path}`)
  return readFile(path, "utf8")
}
export async function readVersions(root: string): Promise<TemplateVersions> {
  return JSON.parse(await readSourceFile(join(root, "template-versions.json")))
}
export function application(id: string, definition: AppDefinition, identity: AppIdentity): Application {
  assertAppId(id)
  assert(appTypes.includes(definition.type), `Unknown application type: ${id}`)
  assert(
    Number.isSafeInteger(definition.port) && definition.port >= 1024 && definition.port <= 65535,
    `Invalid development port: ${id}`,
  )
  assert.equal(identity.type, definition.type, `Application type changed: ${id}; use an explicit migration`)
  assert(/^[a-z0-9-]{1,80}$/.test(identity.instanceId), `Invalid instance identity: ${id}`)
  assert.equal(typeof identity.legacy, "boolean", `Invalid legacy storage policy: ${id}`)
  assert.equal(identity.integrationVersion, integrationVersion, `Unsupported application integration: ${id}`)
  return { ...definition, ...identityOf(identity), id, path: `apps/${id}`, packageName: `@browser-client/${id}` }
}
export async function readApplications(root: string, { directories = true } = {}): Promise<Application[]> {
  const config = await readAppsConfig(root)
  const versions = await readVersions(root)
  assert.equal(versions.schemaVersion, 2, "Application records require migration")
  assert(versions.applications && typeof versions.applications === "object", "Missing application identity records")
  assert.deepEqual(
    Object.keys(versions.applications).sort(),
    Object.keys(config.apps).sort(),
    "Application configuration and identity records differ; use app add/remove/restore",
  )
  const result = Object.entries(config.apps).map(([id, definition]) => application(id, definition, versions.applications![id]!))
  assert.equal(new Set(result.map((app) => app.instanceId)).size, result.length, "Duplicate application identities")
  if (!directories) return result
  const workspace = parseDocument(await readSourceFile(join(root, "pnpm-workspace.yaml")))
  assert.equal(workspace.errors.length, 0, "Invalid pnpm workspace configuration")
  assert.deepEqual(
    [...(workspace.toJS().packages ?? [])].sort(),
    ["apps/*", "packages/*"],
    "Managed applications require the supported apps/* and packages/* workspace layout",
  )
  const rootManifest: PackageManifest = JSON.parse(await readSourceFile(join(root, "package.json")))
  const names = new Set<string>(rootManifest.name ? [rootManifest.name.toLowerCase()] : [])
  for (const parent of ["apps", "packages"]) {
    const base = join(root, parent)
    assert(
      !(await lstat(base)).isSymbolicLink() && (await realpath(base)) === resolve(base),
      `Invalid workspace directory: ${parent}`,
    )
    const directories = new Set<string>()
    for (const entry of await readdir(base, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), `Workspace symlink is not supported: ${parent}/${entry.name}`)
      if (!entry.isDirectory()) continue
      assert(!directories.has(entry.name.toLowerCase()), `Case-insensitive workspace directory collision: ${entry.name}`)
      directories.add(entry.name.toLowerCase())
      if (parent === "apps" && !Object.hasOwn(config.apps, entry.name)) {
        const marker = await lstat(join(base, entry.name, "app-identity.json")).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
          throw error
        })
        assert(!marker, `Unregistered managed application: ${entry.name}; restore its registry entry or use app remove`)
      }
      let manifest: PackageManifest
      try {
        manifest = JSON.parse(await readSourceFile(join(base, entry.name, "package.json")))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
        throw error
      }
      assert(
        typeof manifest.name === "string" && !names.has(manifest.name.toLowerCase()),
        `Missing or duplicate workspace name: ${parent}/${entry.name}`,
      )
      names.add(manifest.name.toLowerCase())
    }
  }
  for (const app of result) {
    const path = join(root, app.path)
    assert(
      (await lstat(path)).isDirectory() && (await realpath(path)) === resolve(path),
      `Invalid application directory: ${app.id}`,
    )
    const manifest: PackageManifest = JSON.parse(await readSourceFile(join(path, "package.json")))
    assert.equal(manifest.name, app.packageName, `Application package name mismatch: ${app.id}`)
    const identity: AppIdentity = JSON.parse(await readSourceFile(join(path, "app-identity.json")))
    assert.deepEqual(identity, identityOf(app), `Application identity differs from its record: ${app.id}`)
  }
  return result
}
export function identityOf(app: AppIdentity): AppIdentity {
  return { instanceId: app.instanceId, type: app.type, legacy: app.legacy, integrationVersion: app.integrationVersion }
}
export function selectApplications(apps: Application[], selector = "all") {
  if (selector === "all") return apps
  const app = apps.find((entry) => entry.id === selector)
  assert(app, `Unknown application: ${selector}`)
  return [app]
}
export function toolchainFor(type: Target | "ui") {
  return type === "web" ? "next" : "vite"
}
