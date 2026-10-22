import type { ChildProcess, StdioOptions } from "node:child_process"
import type { Browser, Page } from "playwright"

export type Target = "web" | "admin" | "extension"
export type DependencyField = "dependencies" | "devDependencies"
export type VersionMap = Record<string, string>
export interface PackageManifest {
  name?: string
  version?: string
  private?: boolean
  packageManager?: string
  dependencies?: VersionMap
  devDependencies?: VersionMap
  peerDependencies?: VersionMap
  scripts?: VersionMap
  [key: string]: unknown
}
export interface WorkspacePolicy {
  catalog?: VersionMap
  catalogs?: Record<string, VersionMap>
  patchedDependencies?: VersionMap
  [key: string]: unknown
}
export interface LockedDependency {
  specifier?: string
  version?: string
}
export interface Lockfile {
  catalogs?: Record<string, Record<string, LockedDependency>>
  importers?: Record<string, Partial<Record<DependencyField, Record<string, LockedDependency>>>>
  packages?: Record<string, unknown>
  patchedDependencies?: VersionMap
  snapshots?: Record<string, unknown>
}
export interface Requirement {
  from: string
  range: string
}
export type DependencyLocation =
  | { catalog: string; name: string; path?: never; field?: never }
  | { catalog?: never; name: string; path: string; field: DependencyField }
export interface DependencyVariable {
  id: string
  name: string
  previous?: string
  current?: string
  location?: DependencyLocation
  required?: Requirement[]
  strictLatest?: boolean
  fixed?: string | null
}
export interface DependencyDecision extends DependencyVariable {
  version: string
  latest?: string
  reasons?: string[]
}
export interface DependencyReceipt {
  policy?: string
  resolvedAt?: string
  entries: DependencyDecision[]
}
export interface GeneratorRecord {
  generator: string
  version: string
  generatedAt?: string
}
export type TemplateVersions = Partial<Record<Target, GeneratorRecord>> & { dependencies?: DependencyReceipt }
export interface RegistryMetadata {
  version: string
  peerDependencies?: VersionMap
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  engines?: VersionMap
  deprecated?: string
}
export interface DependencyScope {
  path: string
  name?: string
  peers?: VersionMap
  dependencies: VersionMap
}
export interface Registry {
  read(name: string, version: string): Promise<RegistryMetadata>
  versions(name: string): Promise<string[]>
  latest(name: string): Promise<RegistryMetadata>
}
export interface OperationError extends Error {
  code?: string
  unsafeToRestore?: boolean
}

// Catch values are untrusted. Keep real Error instances (and recovery flags)
// intact, while making non-Error failures safe to report without losing flags.
export function toError(value: unknown): OperationError {
  try {
    if (value instanceof Error) return value
    const record = value !== null && (typeof value === "object" || typeof value === "function") ? value : undefined
    const message = record
      ? "message" in record && typeof record.message === "string"
        ? record.message
        : "Unknown failure"
      : String(value)
    const error: OperationError = new Error(message)
    if (record && "code" in record && typeof record.code === "string") error.code = record.code
    if (record && "unsafeToRestore" in record && record.unsafeToRestore) error.unsafeToRestore = true
    return error
  } catch {
    // Unreadable exception metadata cannot establish that rollback is safe.
    return Object.assign(new Error("Cannot inspect failure metadata; manual recovery is required"), { unsafeToRestore: true })
  }
}
export interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  capture?: boolean
  stdio?: StdioOptions
}
export interface RunnerOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  graceMs?: number
}
export interface CommandResult {
  code: number | null
  signal: NodeJS.Signals | null
  error?: Error
  reason?: Error
  output: string
}
export interface CommandHandle {
  child: ChildProcess
  done: Promise<CommandResult>
  stop(cause?: Error): Promise<void>
}
export interface PhaseEntry {
  name: string
  status: string
  startedAt: string
  timeoutMs?: number
  failure?: string
  durationMs?: number
  finishedAt?: string
}
export interface MaintenanceReport {
  runDir?: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  phases?: PhaseEntry[]
  status?: string
  failure?: string
  cleanupFailures?: string[]
  [key: string]: unknown
}
export type Phase = <T>(name: string, work: () => T | Promise<T>, options?: { timeoutMs?: number }) => Promise<T>
export type Until = (check: () => unknown | Promise<unknown>, label: string, timeout?: number) => Promise<void>
export type PageFor = (name: string, url: string) => Promise<Page>
export interface BrowserAssertions {
  page: Page
  browser: Browser
  pageFor: PageFor
  url: string
  runDir: string
  errors: string[]
  passed(message: string): void
}
export type RouteAssertions = Omit<BrowserAssertions, "page" | "browser">
export interface HmrConfig {
  file: string
  update(source: string): string | Promise<string>
  verify(context: { page: Page; popup: Page }): void | Promise<void>
}
export interface BrowserConfig {
  web: { path: string; verify(context: BrowserAssertions): void | Promise<void> }
  admin: {
    path: string
    verify(context: BrowserAssertions): void | Promise<void>
    verifyRoutes(context: RouteAssertions): void | Promise<void>
  }
  extension: {
    verifyPage(context: { page: Page; kind: "popup" | "options" }): void | Promise<void>
    verifyBackground(context: { page: Page; until: Until }): void | Promise<void>
    verifyInteractions?(context: { popup: Page; options: Page; until: Until; runDir: string; profile: string }): Promise<void>
    verifyPreview?(context: { page: Page; until: Until; runDir: string }): Promise<void>
    hmr: HmrConfig
  }
}
