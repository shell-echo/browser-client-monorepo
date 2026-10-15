import assert from "node:assert/strict"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import semver from "semver"
import { parse, parseDocument } from "yaml"
import { mergeManifest, readJson, writeJson } from "./integrate.mjs"

const fields = ["dependencies", "devDependencies"]
const stable = (version) => Boolean(semver.valid(version) && !semver.prerelease(version))
const deprecated = (metadata) => typeof metadata.deprecated === "string"
const supports = (version, range) => Boolean(semver.validRange(range) && semver.satisfies(version, range))
const minimumVersions = { eslint: "10.0.0" }
const minimumRequirements = (name) =>
  Object.hasOwn(minimumVersions, name) ? [{ from: "项目最低版本策略", range: `>=${minimumVersions[name]}` }] : []

function assertMinimumVersion(name, version) {
  for (const { from, range } of minimumRequirements(name)) {
    assert(supports(version, range), `${from} 要求 ${name} ${range}，实际为 ${version ?? "未知"}；停止重建，请先联网 reinit。`)
  }
}

// Use the publisher's latest channel, never next/beta/rc. A mistagged
// prerelease falls back to the highest stable release below that channel.
export function stableVersions(versions, latest) {
  assert(semver.valid(latest), "registry latest 版本无效")
  return [...new Set(versions)].filter((version) => stable(version) && semver.lte(version, latest)).sort(semver.rcompare)
}

export function createRegistry(view) {
  const metadata = new Map(),
    indexes = new Map()
  const read = (name, version) => {
    const key = `${name}@${version}`
    if (!metadata.has(key))
      metadata.set(
        key,
        (async () => {
          const value = await view(key, ["version", "peerDependencies", "peerDependenciesMeta", "engines", "deprecated"])
          assert(value && !Array.isArray(value) && semver.valid(value.version), `${key} 的 registry 响应无效`)
          if (version !== "latest") assert.equal(value.version, version, `${key} 的 registry 版本不匹配`)
          return value
        })(),
      )
    return metadata.get(key)
  }
  const versions = (name) => {
    if (!indexes.has(name))
      indexes.set(
        name,
        (async () => {
          const value = await view(name, ["versions", "dist-tags"])
          assert(Array.isArray(value.versions), `${name} 的版本列表无效`)
          return stableVersions(value.versions, value["dist-tags"]?.latest)
        })(),
      )
    return indexes.get(name)
  }
  const latest = async (name) => {
    const tagged = await read(name, "latest")
    if (stable(tagged.version) && !deprecated(tagged)) return tagged
    for (const version of await versions(name)) {
      const candidate = await read(name, version)
      if (!deprecated(candidate)) return candidate
    }
    throw new Error(`${name} 没有未弃用的稳定版`)
  }
  return { read, versions, latest }
}

// A small constraint solver for direct dependencies. Frameworks are fixed at
// latest; shared packages may fall back, with every fallback recorded. pnpm's
// strict peer installation subsequently checks the complete transitive graph.
export async function solveUpdates({ variables, scopes, registry, nodeVersion = process.versions.node }) {
  variables = variables.map((variable) => ({
    ...variable,
    required: [...(variable.required ?? []), ...minimumRequirements(variable.name)],
  }))
  const chosen = new Map(),
    initial = new Map(),
    rejected = new Map()
  console.log(`解析 ${variables.length} 项直接依赖的稳定版本与兼容约束…`)
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
  const provider = (scope, name) => scope.dependencies[name] ?? root?.dependencies[name]
  const violations = () => {
    const errors = []
    const check = (scope, caller, peers) => {
      for (const [name, range] of Object.entries(peers ?? {})) {
        const supplied = chosen.get(provider(scope, name))
        if (supplied && !supports(supplied.version, range))
          errors.push(`${scope.path}: ${caller} 要求 ${name} ${range}，候选为 ${supplied.version}`)
      }
    }
    for (const scope of scopes) {
      const react = chosen.get(provider(scope, "react")),
        dom = chosen.get(provider(scope, "react-dom"))
      if (react && dom && react.version !== dom.version)
        errors.push(`${scope.path}: React / React DOM 运行时版本必须一致（${react.version} / ${dom.version}）`)
      check(scope, scope.name, scope.peers)
      for (const [name, id] of Object.entries(scope.dependencies)) {
        const dependency = chosen.get(id)
        if (dependency) check(scope, `${name}@${dependency.version}`, dependency.peerDependencies)
      }
    }
    return errors
  }
  // Choose providers early, so a plugin can fall back without needlessly
  // downgrading React or another provider to accommodate its latest release.
  const weights = new Map()
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
    lastErrors = []
  async function visit(index) {
    if (index === ordered.length) return true
    const variable = ordered[index],
      newest = initial.get(variable.id)
    async function attempt(candidate) {
      if (++attempts > 4000) throw new Error(`依赖兼容性搜索超限，原项目未替换：${lastErrors.join("；")}`)
      const errors = []
      if (!stable(candidate.version)) errors.push("预发布版本")
      // Do not introduce withdrawn or obsolete releases just because their
      // peer metadata is incomplete. An existing legacy version may remain
      // for compatibility, but its deprecation must be visible in the receipt.
      if (deprecated(candidate) && candidate.version !== variable.current && !variable.fixed)
        errors.push(`上游已弃用，禁止新引入：${candidate.deprecated || "未提供原因"}`)
      if (candidate.engines?.node && !supports(nodeVersion, candidate.engines.node))
        errors.push(`需要 Node ${candidate.engines.node}，当前 ${nodeVersion}`)
      for (const required of variable.required ?? [])
        if (!supports(candidate.version, required.range))
          errors.push(`${required.from} 要求 ${variable.name} ${required.range}`)
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
      `${variable.id}: latest ${newest.version} 不兼容，查找稳定版（${(rejected.get(variable.id) ?? []).join("；")}）`,
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
  if (!(await visit(0))) throw new Error(`无法找到稳定且兼容的依赖组合，原项目未替换：${lastErrors.join("；")}`)
  return variables.map((variable) => ({
    ...variable,
    latest: initial.get(variable.id).version,
    version: chosen.get(variable.id).version,
    reasons: [
      ...(chosen.get(variable.id).version === initial.get(variable.id).version
        ? []
        : (rejected.get(variable.id) ?? ["与其他依赖的 peer 要求冲突"])),
      ...(deprecated(chosen.get(variable.id))
        ? [`现有兼容版本被上游标记 deprecated：${chosen.get(variable.id).deprecated || "未提供原因"}`]
        : []),
    ],
  }))
}

async function manifestsAt(root) {
  const result = [{ path: ".", manifest: await readJson(join(root, "package.json")) }]
  for (const parent of ["apps", "packages"]) {
    for (const entry of await readdir(join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = `${parent}/${entry.name}`
      try {
        result.push({ path, manifest: await readJson(join(root, path, "package.json")) })
      } catch (error) {
        if (error.code !== "ENOENT") throw error
      }
    }
  }
  return result
}

export async function updateDependencies({ root, templates, previous, registry, offline = false, saved }) {
  const document = parseDocument(await readFile(join(root, "pnpm-workspace.yaml"), "utf8"))
  assert.equal(document.errors.length, 0, "workspace YAML 无效")
  const workspace = document.toJS()
  const lock = parse(await readFile(join(root, "pnpm-lock.yaml"), "utf8"))
  const manifests = await manifestsAt(root)
  const variables = new Map(),
    scopes = []
  const add = (id, name, value, location, required = [], strictLatest = false, fixed) => {
    if (!variables.has(id)) {
      const current = location.catalog
        ? lock.catalogs?.[location.catalog]?.[name]?.version
        : lock.importers?.[location.path]?.[location.field]?.[name]?.version?.split("(")[0]
      variables.set(id, { id, name, previous: value, current, location, required: [], strictLatest, fixed })
    }
    variables.get(id).required.push(...required)
    return id
  }
  for (const [group, entries] of Object.entries({ default: workspace.catalog, ...workspace.catalogs })) {
    for (const [name, range] of Object.entries(entries ?? {})) {
      assert(semver.validRange(range), `不支持的 catalog 版本：${name} ${range}`)
      const required =
        name === "@types/node" ? [{ from: "Node.js 运行时", range: `^${process.versions.node.split(".")[0]}.0.0` }] : []
      if (
        name === "typescript" &&
        ((group === "next" && !templates.web) || (group === "vite" && !templates.admin && !templates.extension))
      ) {
        required.push({ from: `未重建的 ${group} 工具链`, range })
      }
      add(`catalog:${group}:${name}`, name, range, { catalog: group, name }, required)
    }
  }
  for (const item of manifests) {
    const { path } = item,
      target = path.split("/")[1],
      template = templates[target]
    if (path.startsWith("apps/") && template) item.manifest = mergeManifest(template, previous[target], target)
    const scope = { path, name: item.manifest.name, peers: item.manifest.peerDependencies, dependencies: {} }
    scopes.push(scope)
    for (const field of fields)
      for (const [name, value] of Object.entries(item.manifest[field] ?? {})) {
        if (value.startsWith("workspace:")) continue
        const location = { path, field, name }
        const toolchain = target === "web" ? "next" : "vite"
        const catalog = value.startsWith("catalog:")
          ? value.slice(8) || "default"
          : Object.hasOwn(workspace.catalog ?? {}, name)
            ? "default"
            : Object.hasOwn(workspace.catalogs?.[toolchain] ?? {}, name)
              ? toolchain
              : undefined
        const declared = template?.[field]?.[name]
        // A starter's ESLint default is not a framework requirement. The actual
        // config peers, strict install and rule regression tests enforce support.
        const required =
          declared && !["next", "eslint-config-next", "vite", "@types/node", "eslint"].includes(name)
            ? [
                {
                  from: `${path} 官方模板`,
                  range: ["react", "react-dom"].includes(name) && semver.valid(declared) ? `^${declared}` : declared,
                },
              ]
            : []
        if (template && ["tailwindcss", "@tailwindcss/vite"].includes(name) && !template[field]?.[name])
          required.push({ from: `${path} Tailwind 接入`, range: "^4.1.0" })
        let id
        if (catalog) {
          id = `catalog:${catalog}:${name}`
          assert(variables.has(id), `catalog 缺少 ${name}`)
          variables.get(id).required.push(...required)
          item.manifest[field][name] = catalog === "default" ? "catalog:" : `catalog:${catalog}`
        } else if (semver.validRange(value)) {
          const managed =
            path === "." ||
            path.startsWith("packages/") ||
            Boolean(
              template &&
              (template[field]?.[name] ||
                ["@crxjs/vite-plugin", "@types/chrome", "@tailwindcss/vite", "tailwindcss"].includes(name)),
            )
          const fixed = managed
            ? undefined
            : semver.clean(lock.importers?.[path]?.[field]?.[name]?.version?.split("(")[0] ?? "")
          if (!managed && !fixed) throw new Error(`${path}: 无法确认业务依赖 ${name} 的锁定版本；请先完成普通安装`)
          id = add(
            `${path}:${field}:${name}`,
            name,
            value,
            location,
            required,
            managed && ["next", "eslint-config-next", "vite", "@crxjs/vite-plugin"].includes(name),
            fixed,
          )
        }
        if (id) scope.dependencies[name] = id
      }
  }
  let entries
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
        assert(!replay, `离线记录缺少 ${variable.id}，请先联网 reinit`)
        assertMinimumVersion(variable.name, variable.current)
        return []
      }
      assert.equal(entry.name, variable.name, "离线依赖记录名称不匹配")
      assert(stable(entry.version), `离线依赖记录不是稳定版：${entry.id}`)
      const required = [...variable.required, ...minimumRequirements(variable.name)]
      for (const { range, from } of required)
        assert(supports(entry.version, range), `${from} 要求 ${variable.name} ${range}，与离线依赖记录不兼容`)
      return [{ ...variable, required, version: entry.version, latest: entry.latest, reasons: entry.reasons }]
    })
  } else
    entries = (await solveUpdates({ variables: [...variables.values()], scopes, registry })).filter(
      (variable) => !variable.fixed,
    )
  for (const entry of entries) {
    const { location, version } = entry
    if (location.catalog)
      document.setIn(
        location.catalog === "default" ? ["catalog", entry.name] : ["catalogs", location.catalog, entry.name],
        version,
      )
    else manifests.find((item) => item.path === location.path).manifest[location.field][entry.name] = version
    console.log(
      `${entry.name} (${entry.id}): ${entry.previous} → ${version}${entry.reasons?.length ? `；latest ${entry.latest} 未采用：${entry.reasons.join("；")}` : ""}`,
    )
  }
  await writeFile(join(root, "pnpm-workspace.yaml"), document.toString())
  for (const item of manifests) await writeJson(join(root, item.path, "package.json"), item.manifest)
  const updatedIds = new Set(entries.map((entry) => entry.id))
  return {
    policy: offline && !replay ? "legacy-offline" : "stable-compatible-v1",
    resolvedAt: offline ? saved?.resolvedAt : new Date().toISOString(),
    entries: [...(saved?.entries ?? []).filter((entry) => !updatedIds.has(entry.id)), ...entries],
  }
}

export async function verifyResolvedUpdates(root, receipt) {
  const lock = parse(await readFile(join(root, "pnpm-lock.yaml"), "utf8"))
  const workspace = parse(await readFile(join(root, "pnpm-workspace.yaml"), "utf8"))
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
    if (location.catalog) {
      const configured = (location.catalog === "default" ? workspace.catalog : workspace.catalogs?.[location.catalog])?.[
        entry.name
      ]
      assert.equal(configured, entry.version, `${entry.id} 的 catalog 与更新计划不一致`)
      const specifier = location.catalog === "default" ? "catalog:" : `catalog:${location.catalog}`
      const used = Object.values(lock.importers ?? {}).some((importer) =>
        fields.some((field) => importer[field]?.[entry.name]?.specifier === specifier),
      )
      if (!used) continue
    }
    const actual = location.catalog
      ? lock.catalogs?.[location.catalog]?.[entry.name]?.version
      : lock.importers?.[location.path]?.[location.field]?.[entry.name]?.version?.split("(")[0]
    assert.equal(actual, entry.version, `${entry.id} 的实际安装版本与更新计划不一致`)
  }
}
