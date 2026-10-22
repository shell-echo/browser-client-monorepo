import type {
  PackageManifest,
  VersionMap,
  WorkspacePolicy,
  Lockfile,
  RegistryMetadata,
  Registry,
  Requirement,
  DependencyVariable,
  DependencyDecision,
  DependencyScope,
  DependencyReceipt,
  DependencyLocation,
} from "./contracts.mts"
type PlannedVariable = DependencyVariable & { location: DependencyLocation; required: Requirement[] }
type PlannedDecision = DependencyDecision & { location: DependencyLocation; required: Requirement[] }
import { toError } from "./contracts.mts"
import assert from "node:assert/strict"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import semver from "semver"
import { parse, parseDocument } from "yaml"
import { mergeManifest, readJson, writeJson } from "./integrate.mts"

const fields = ["dependencies", "devDependencies"] as const
const stable = (version: string | undefined) =>
  Boolean(typeof version === "string" && semver.valid(version) && !semver.prerelease(version))
const deprecated = (metadata: RegistryMetadata) => typeof metadata.deprecated === "string"
const supports = (version: string | undefined, range: string) =>
  Boolean(typeof version === "string" && semver.validRange(range) && semver.satisfies(version, range))
const minimumVersions: VersionMap = { eslint: "10.0.0" }
// These application dependencies belong to the starter integration. Keep
// user-added dependencies locked unless explicitly added to this policy.
const applicationDependencies: Record<string, VersionMap> = { "apps/admin": { "react-router": "^8.0.0" } }
const minimumRequirements = (name: string) =>
  Object.hasOwn(minimumVersions, name) ? [{ from: "Project minimum version policy", range: `>=${minimumVersions[name]}` }] : []

function assertMinimumVersion(name: string, version: string | undefined) {
  for (const { from, range } of minimumRequirements(name)) {
    assert(
      supports(version, range),
      `${from} requires ${name} ${range}, actual version is ${version ?? "Unknown"}; Stopping rebuild; run online reinit first.`,
    )
  }
}

// Use the publisher's latest channel, never next/beta/rc. A mistagged
// prerelease falls back to the highest stable release below that channel.
export function stableVersions(versions: string[], latest: string) {
  assert(semver.valid(latest), "Invalid registry latest version")
  return [...new Set(versions)].filter((version) => stable(version) && semver.lte(version, latest)).sort(semver.rcompare)
}

export function createRegistry(view: (name: string, fields: string[]) => Promise<unknown>): Registry {
  const metadata = new Map<string, Promise<RegistryMetadata>>(),
    indexes = new Map<string, Promise<string[]>>()
  const read = (name: string, version: string) => {
    const key = `${name}@${version}`
    if (!metadata.has(key))
      metadata.set(
        key,
        (async () => {
          const value = (await view(key, [
            "version",
            "peerDependencies",
            "peerDependenciesMeta",
            "engines",
            "deprecated",
          ])) as RegistryMetadata
          assert(value && !Array.isArray(value) && semver.valid(value.version), `${key} registry response is invalid`)
          if (version !== "latest") assert.equal(value.version, version, `${key} has a mismatched registry version`)
          return value
        })(),
      )
    return metadata.get(key)!
  }
  const versions = (name: string) => {
    if (!indexes.has(name))
      indexes.set(
        name,
        (async () => {
          const value = (await view(name, ["versions", "dist-tags"])) as { versions: string[]; "dist-tags"?: VersionMap }
          assert(Array.isArray(value.versions), `${name} has an invalid version list`)
          return stableVersions(value.versions, value["dist-tags"]?.latest ?? "")
        })(),
      )
    return indexes.get(name)!
  }
  const latest = async (name: string) => {
    const tagged = await read(name, "latest")
    if (stable(tagged.version) && !deprecated(tagged)) return tagged
    for (const version of await versions(name)) {
      const candidate = await read(name, version)
      if (!deprecated(candidate)) return candidate
    }
    throw new Error(`${name} has no non-deprecated stable release`)
  }
  return { read, versions, latest }
}

// A small constraint solver for direct dependencies. Frameworks are fixed at
// latest; shared packages may fall back, with every fallback recorded. pnpm's
// strict peer installation subsequently checks the complete transitive graph.
export async function solveUpdates<T extends DependencyVariable>({
  variables,
  scopes,
  registry,
  nodeVersion = process.versions.node,
}: {
  variables: T[]
  scopes: DependencyScope[]
  registry: Registry
  nodeVersion?: string
}): Promise<(T & { version: string; latest: string; reasons: string[] })[]> {
  variables = variables.map((variable) => ({
    ...variable,
    required: [...(variable.required ?? []), ...minimumRequirements(variable.name)],
  }))
  const chosen = new Map<string, RegistryMetadata>(),
    initial = new Map<string, RegistryMetadata>(),
    rejected = new Map<string, string[]>()
  console.log(`Resolving stable versions and compatibility constraints for ${variables.length} direct dependencies...`)
  let cursor = 0
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(4, variables.length) }, async () => {
      while (cursor < variables.length) {
        const variable = variables[cursor++]
        initial.set(
          variable.id,
          variable.fixed ? await registry.read(variable.name, variable.fixed) : await registry.latest(variable.name),
        )
      }
    }),
  )
  const failed = workers.find((result) => result.status === "rejected")
  if (failed) throw failed.reason
  const root = scopes.find((scope) => scope.path === ".")
  const provider = (scope: DependencyScope, name: string) => scope.dependencies[name] ?? root?.dependencies[name]
  const violations = () => {
    const errors = []
    const check = (scope: DependencyScope, caller: string, peers?: VersionMap) => {
      for (const [name, range] of Object.entries(peers ?? {})) {
        const supplied = chosen.get(provider(scope, name) ?? "")
        if (supplied && !supports(supplied.version, range))
          errors.push(`${scope.path}: ${caller} requires ${name} ${range}, candidate is ${supplied.version}`)
      }
    }
    for (const scope of scopes) {
      const react = chosen.get(provider(scope, "react")),
        dom = chosen.get(provider(scope, "react-dom"))
      if (react && dom && react.version !== dom.version)
        errors.push(`${scope.path}: React / React DOM runtime versions must match (${react.version} / ${dom.version})`)
      check(scope, scope.name ?? scope.path, scope.peers)
      for (const [name, id] of Object.entries(scope.dependencies)) {
        const dependency = chosen.get(id)
        if (dependency) check(scope, `${name}@${dependency.version}`, dependency.peerDependencies)
      }
    }
    return errors
  }
  // Choose providers early, so a plugin can fall back without needlessly
  // downgrading React or another provider to accommodate its latest release.
  const weights = new Map<string, number>()
  for (const scope of scopes) {
    const peerSets = [scope.peers, ...Object.values(scope.dependencies).map((id) => initial.get(id)?.peerDependencies)]
    for (const peers of peerSets)
      for (const name of Object.keys(peers ?? {})) {
        const id = provider(scope, name)
        weights.set(id, (weights.get(id) ?? 0) + 1)
      }
  }
  const ordered = [...variables].sort(
    (a, b) =>
      Number(Boolean(b.strictLatest || b.fixed)) - Number(Boolean(a.strictLatest || a.fixed)) ||
      (weights.get(b.id) ?? 0) - (weights.get(a.id) ?? 0) ||
      a.id.localeCompare(b.id),
  )
  let attempts = 0,
    lastErrors: string[] = []
  async function visit(index: number): Promise<boolean> {
    if (index === ordered.length) return true
    const variable = ordered[index],
      newest = initial.get(variable.id)!
    async function attempt(candidate: RegistryMetadata): Promise<boolean> {
      if (++attempts > 4000)
        throw new Error(
          `Dependency compatibility search limit exceeded; original project is unchanged: ${lastErrors.join("; ")}`,
        )
      const errors = []
      if (!stable(candidate.version)) errors.push("Prerelease version")
      // Do not introduce withdrawn or obsolete releases just because their
      // peer metadata is incomplete. An existing legacy version may remain
      // for compatibility, but its deprecation must be visible in the receipt.
      if (deprecated(candidate) && candidate.version !== variable.current && !variable.fixed)
        errors.push(`Deprecated upstream; cannot introduce this version: ${candidate.deprecated || "No reason provided"}`)
      if (candidate.engines?.node && !supports(nodeVersion, candidate.engines.node))
        errors.push(`Requires Node ${candidate.engines.node}, current ${nodeVersion}`)
      for (const required of variable.required ?? [])
        if (!supports(candidate.version, required.range))
          errors.push(`${required.from} requires ${variable.name} ${required.range}`)
      chosen.set(variable.id, candidate)
      errors.push(...violations())
      if (!errors.length && (await visit(index + 1))) return true
      chosen.delete(variable.id)
      if (errors.length) lastErrors = errors
      if (candidate.version === newest.version) rejected.set(variable.id, errors.length ? errors : lastErrors)
      return false
    }
    if (await attempt(newest)) return true
    if (variable.strictLatest || variable.fixed) return false
    console.log(
      `${variable.id}: latest ${newest.version} is incompatible; looking for a stable release (${(rejected.get(variable.id) ?? []).join("; ")})`,
    )
    for (const version of await registry.versions(variable.name)) {
      if (semver.gte(version, newest.version) || (variable.required ?? []).some(({ range }) => !supports(version, range)))
        continue
      chosen.set(variable.id, { version })
      const incompatible = violations().length > 0
      chosen.delete(variable.id)
      if (incompatible) continue
      if (await attempt(await registry.read(variable.name, version))) return true
    }
    return false
  }
  if (!(await visit(0)))
    throw new Error(
      `No stable compatible dependency combination found; original project is unchanged: ${lastErrors.join("; ")}`,
    )
  return variables.map((variable) => ({
    ...variable,
    latest: initial.get(variable.id)!.version,
    version: chosen.get(variable.id)!.version,
    reasons: [
      ...(chosen.get(variable.id)!.version === initial.get(variable.id)!.version
        ? []
        : (rejected.get(variable.id) ?? ["Conflicts with peer requirements of other dependencies"])),
      ...(deprecated(chosen.get(variable.id)!)
        ? [
            `Existing compatible version is marked deprecated upstream: ${chosen.get(variable.id)!.deprecated || "No reason provided"}`,
          ]
        : []),
    ],
  }))
}

async function manifestsAt(root: string) {
  const result = [{ path: ".", manifest: await readJson(join(root, "package.json")) }]
  for (const parent of ["apps", "packages"]) {
    for (const entry of await readdir(join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = `${parent}/${entry.name}`
      try {
        result.push({ path, manifest: await readJson(join(root, path, "package.json")) })
      } catch (caught) {
        const error = toError(caught)
        if (error.code !== "ENOENT") throw error
      }
    }
  }
  return result
}

export type UpdateOptions = {
  root: string
  templates: Partial<Record<string, PackageManifest>>
  previous: Partial<Record<string, PackageManifest>>
  saved?: DependencyReceipt
} & ({ offline: true; registry?: Registry } | { offline?: boolean; registry: Registry })

export async function updateDependencies({
  root,
  templates,
  previous,
  registry,
  offline = false,
  saved,
}: UpdateOptions): Promise<DependencyReceipt> {
  const document = parseDocument(await readFile(join(root, "pnpm-workspace.yaml"), "utf8"))
  assert.equal(document.errors.length, 0, "Invalid workspace YAML")
  const workspace: WorkspacePolicy = document.toJS()
  const lock: Lockfile = parse(await readFile(join(root, "pnpm-lock.yaml"), "utf8"))
  const manifests = await manifestsAt(root)
  const variables = new Map<string, PlannedVariable>(),
    scopes: DependencyScope[] = []
  const add = (
    id: string,
    name: string,
    value: string,
    location: DependencyLocation,
    required: Requirement[] = [],
    strictLatest = false,
    fixed?: string | null,
  ) => {
    if (!variables.has(id)) {
      const current = location.catalog
        ? lock.catalogs?.[location.catalog]?.[name]?.version
        : lock.importers?.[location.path!]?.[location.field!]?.[name]?.version?.split("(")[0]
      variables.set(id, { id, name, previous: value, current, location, required: [], strictLatest, fixed })
    }
    variables.get(id)!.required.push(...required)
    return id
  }
  for (const [group, entries] of Object.entries({ default: workspace.catalog, ...workspace.catalogs })) {
    for (const [name, range] of Object.entries(entries ?? {})) {
      assert(semver.validRange(range), `Unsupported catalog version: ${name} ${range}`)
      const required =
        name === "@types/node" ? [{ from: "Node.js runtime", range: `^${process.versions.node.split(".")[0]}.0.0` }] : []
      if (
        name === "typescript" &&
        ((group === "next" && !templates.web) || (group === "vite" && !templates.admin && !templates.extension))
      ) {
        required.push({ from: `Unrebuilt ${group} toolchain`, range })
      }
      add(`catalog:${group}:${name}`, name, range, { catalog: group, name }, required)
    }
  }
  for (const item of manifests) {
    const { path } = item,
      target = path.split("/")[1],
      template = templates[target]
    if (path.startsWith("apps/") && template) item.manifest = mergeManifest(template, previous[target], target)
    const scope: DependencyScope = { path, name: item.manifest.name, peers: item.manifest.peerDependencies, dependencies: {} }
    scopes.push(scope)
    for (const field of fields)
      for (const [name, value] of Object.entries(item.manifest[field] ?? {})) {
        if (value.startsWith("workspace:")) continue
        const location: DependencyLocation = { path, field, name }
        const toolchain = target === "web" ? "next" : "vite"
        const catalog = value.startsWith("catalog:")
          ? value.slice(8) || "default"
          : Object.hasOwn(workspace.catalog ?? {}, name)
            ? "default"
            : Object.hasOwn(workspace.catalogs?.[toolchain] ?? {}, name)
              ? toolchain
              : undefined
        const declared = Object.hasOwn(template?.[field] ?? {}, name) ? template?.[field]?.[name] : undefined
        // A starter's ESLint default is not a framework requirement. The actual
        // config peers, strict install and rule regression tests enforce support.
        const required =
          declared && !["next", "eslint-config-next", "vite", "@types/node", "eslint"].includes(name)
            ? [
                {
                  from: `${path} official template`,
                  range: ["react", "react-dom"].includes(name) && semver.valid(declared) ? `^${declared}` : declared,
                },
              ]
            : []
        const applicationRange =
          field === "dependencies" && Object.hasOwn(applicationDependencies[path] ?? {}, name)
            ? applicationDependencies[path][name]
            : undefined
        if (applicationRange) required.push({ from: `${path} project integration`, range: applicationRange })
        if (template && ["tailwindcss", "@tailwindcss/vite"].includes(name) && !template[field]?.[name])
          required.push({ from: `${path} Tailwind integration`, range: "^4.1.0" })
        const managed =
          path === "." ||
          path.startsWith("packages/") ||
          Boolean(applicationRange) ||
          Boolean(
            template &&
            (declared || ["@crxjs/vite-plugin", "@types/chrome", "@tailwindcss/vite", "tailwindcss"].includes(name)),
          )
        const strictLatest = managed && ["next", "eslint-config-next", "vite", "@crxjs/vite-plugin"].includes(name)
        let id
        if (catalog) {
          id = `catalog:${catalog}:${name}`
          assert(variables.has(id), `catalog is missing ${name}`)
          variables.get(id)!.required.push(...required)
          variables.get(id)!.strictLatest ||= strictLatest
          item.manifest[field]![name] = catalog === "default" ? "catalog:" : `catalog:${catalog}`
        } else if (semver.validRange(value)) {
          const fixed = managed
            ? undefined
            : semver.clean(lock.importers?.[path]?.[field]?.[name]?.version?.split("(")[0] ?? "")
          if (!managed && !fixed)
            throw new Error(
              `${path}: Cannot confirm the locked version of application dependency ${name}; run a regular install first`,
            )
          id = add(`${path}:${field}:${name}`, name, value, location, required, strictLatest, fixed)
        }
        if (id) scope.dependencies[name] = id
      }
  }
  let entries: PlannedDecision[]
  const replay = saved?.policy === "stable-compatible-v1" ? saved : undefined
  if (offline) {
    // All receipt generations obey today's floor, including stale entries.
    // Legacy records without receipts must prove their locked version instead.
    for (const entry of saved?.entries ?? []) assertMinimumVersion(entry.name, entry.version)
    entries = [...variables.values()].flatMap((variable) => {
      if (variable.fixed) {
        assertMinimumVersion(variable.name, variable.fixed)
        return []
      }
      const entry = replay?.entries?.find((entry) => entry.id === variable.id)
      if (!entry) {
        assert(!replay, `Offline receipt is missing ${variable.id}; run online reinit first`)
        assertMinimumVersion(variable.name, variable.current)
        return []
      }
      assert.equal(entry.name, variable.name, "Offline dependency receipt name mismatch")
      assert(stable(entry.version), `Offline dependency receipt does not contain a stable version: ${entry.id}`)
      if (variable.strictLatest) {
        assert(
          stable(entry.latest),
          `Offline framework receipt has no stable latest version: ${entry.id}; run online reinit first`,
        )
        assert.equal(
          entry.version,
          entry.latest,
          `Offline framework receipt contains a fallback: ${entry.id}; run online reinit first`,
        )
      }
      const required = [...variable.required, ...minimumRequirements(variable.name)]
      for (const { range, from } of required)
        assert(
          supports(entry.version, range),
          `${from} requires ${variable.name} ${range}, is incompatible with the offline dependency receipt`,
        )
      return [{ ...variable, required, version: entry.version, latest: entry.latest, reasons: entry.reasons }]
    })
  } else {
    assert(registry, "Online dependency planning requires a registry")
    entries = (await solveUpdates({ variables: [...variables.values()], scopes, registry })).filter(
      (variable) => !variable.fixed,
    )
  }
  const updatedIds = new Set(entries.map((entry) => entry.id))
  // Removed declarations and old catalog locations no longer belong to the
  // plan. Keep receipts for unrebuilt applications so a later full offline
  // replay still works, refreshing any manually changed locked versions.
  const retained = (saved?.entries ?? [])
    .filter((entry) => variables.has(entry.id) && !updatedIds.has(entry.id))
    .map((entry) => {
      const variable = variables.get(entry.id)!
      if (!variable.fixed) return entry
      assert(stable(variable.fixed), `${entry.id} must retain a stable locked version for offline replay`)
      if (entry.version === variable.fixed) return entry
      return {
        ...variable,
        version: variable.fixed,
        latest: variable.fixed,
        reasons: ["Application dependency retained at its current locked version"],
      }
    })
  for (const entry of entries) {
    const { location, version } = entry
    if (location.catalog)
      document.setIn(
        location.catalog === "default" ? ["catalog", entry.name] : ["catalogs", location.catalog, entry.name],
        version,
      )
    else manifests.find((item) => item.path === location.path)!.manifest[location.field!]![entry.name] = version
    const fallback = entry.latest && entry.latest !== version ? `latest ${entry.latest} not selected: ` : ""
    console.log(
      `${entry.name} (${entry.id}): ${entry.previous} → ${version}${entry.reasons?.length ? `; ${fallback}${entry.reasons.join("; ")}` : ""}`,
    )
  }
  await writeFile(join(root, "pnpm-workspace.yaml"), document.toString())
  for (const item of manifests) await writeJson(join(root, item.path, "package.json"), item.manifest)
  return {
    policy: offline && !replay ? "legacy-offline" : "stable-compatible-v1",
    resolvedAt: offline ? saved?.resolvedAt : new Date().toISOString(),
    entries: [...retained, ...entries],
  }
}

export async function verifyResolvedUpdates(root: string, receipt: DependencyReceipt) {
  const lock: Lockfile = parse(await readFile(join(root, "pnpm-lock.yaml"), "utf8"))
  const workspace: WorkspacePolicy = parse(await readFile(join(root, "pnpm-workspace.yaml"), "utf8"))
  // Verify actual dependencies too: a legacy receipt may be empty, and an
  // indirect dependency may install an extra ESLint outside the direct plan.
  for (const catalog of Object.values(lock.catalogs ?? {})) {
    if (catalog.eslint) assertMinimumVersion("eslint", catalog.eslint.version)
  }
  for (const importer of Object.values(lock.importers ?? {}))
    for (const field of fields) {
      if (importer[field]?.eslint) assertMinimumVersion("eslint", importer[field].eslint.version?.split("(")[0])
    }
  for (const key of Object.keys(lock.packages ?? {})) {
    if (key.startsWith("eslint@")) assertMinimumVersion("eslint", key.slice("eslint@".length).split("(")[0])
  }
  for (const entry of receipt.entries) {
    assertMinimumVersion(entry.name, entry.version)
    const { location } = entry
    assert(location, `${entry.id} has no dependency location`)
    if (location.catalog) {
      const configured = (location.catalog === "default" ? workspace.catalog : workspace.catalogs?.[location.catalog])?.[
        entry.name
      ]
      assert.equal(configured, entry.version, `${entry.id} catalog differs from the update plan`)
      const specifier = location.catalog === "default" ? "catalog:" : `catalog:${location.catalog}`
      const used = Object.values(lock.importers ?? {}).some((importer) =>
        fields.some((field) => importer[field]?.[entry.name]?.specifier === specifier),
      )
      if (!used) continue
    }
    const actual = location.catalog
      ? lock.catalogs?.[location.catalog]?.[entry.name]?.version
      : lock.importers?.[location.path!]?.[location.field!]?.[entry.name]?.version?.split("(")[0]
    assert.equal(actual, entry.version, `${entry.id} installed version differs from the update plan`)
  }
}
