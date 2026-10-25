import { toError } from "./contracts.mts"
interface ScopeLocation {
  root: string
  path: string
  token: string
}
interface ScopeOwner {
  version: number
  token: string
  pid: number | null
  state: "starting" | "running" | "stopping" | "settled"
  retainForRecovery?: boolean
}
import { randomUUID } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"

const environmentKey = "BROWSER_CLIENT_COMMAND_SCOPE"
const filename = "owner.json"

function readOwner(path: string, token: string): ScopeOwner {
  for (const entry of [path, join(path, filename)]) {
    const stat = lstatSync(entry)
    if (stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()))
      throw new Error(`Invalid process ownership path: ${entry}`)
  }
  const owner = JSON.parse(readFileSync(join(path, filename), "utf8"))
  if (owner.version !== 1 || owner.token !== token || !["starting", "running", "stopping", "settled"].includes(owner.state))
    throw new Error(`Invalid process ownership record: ${path}`)
  if (owner.pid !== null && (!Number.isSafeInteger(owner.pid) || owner.pid < 2))
    throw new Error(`Invalid owned process identifier: ${path}`)
  if (owner.retainForRecovery !== undefined && typeof owner.retainForRecovery !== "boolean")
    throw new Error(`Invalid recovery retention record: ${path}`)
  return owner
}

function retained(path: string, token: string): boolean {
  if (readOwner(path, token).retainForRecovery) return true
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!entry.name.startsWith("child-")) continue
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Invalid recovery ownership tree")
    if (retained(join(path, entry.name), token)) return true
  }
  return false
}

// Failed maintenance must keep ownership evidence after its outer runner exits.
export function releaseRetainedCommandScope(path: string) {
  const initial = JSON.parse(readFileSync(join(path, filename), "utf8")) as ScopeOwner
  const owner = readOwner(path, initial.token)
  if (!owner.retainForRecovery) return
  let root = path
  while (existsSync(join(dirname(root), filename))) {
    root = dirname(root)
    readOwner(root, initial.token)
  }
  if (realpathSync(dirname(root)) !== realpathSync(tmpdir()) || !/^browser-client-command-[A-Za-z0-9]{6}$/.test(basename(root)))
    throw new Error(`Refusing to reclaim a non-command temporary directory: ${root}`)
  writeOwner(path, { ...owner, retainForRecovery: false })
  try {
    if (readOwner(root, initial.token).state === "settled" && !retained(root, initial.token)) rmSync(root, { recursive: true })
  } catch (error) {
    // A sibling recovery may already have reclaimed their shared settled root.
    if (toError(error).code !== "ENOENT") throw error
  }
}

// Recovery only observes recorded groups. It never signals an unrelated
// process or assumes that a dead parent implies all detached children exited.
export function inspectCommandScope(path: string) {
  const initial = JSON.parse(readFileSync(join(path, filename), "utf8")) as ScopeOwner
  const result: ScopeOwner[] = []
  function visit(directory: string) {
    const record = readOwner(directory, initial.token)
    if (record.state === "settled") return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.name.startsWith("child-")) continue
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Invalid recovery ownership tree")
      visit(join(directory, entry.name))
    }
    result.push(record)
  }
  visit(path)
  return result
}

function writeOwner(path: string, owner: ScopeOwner) {
  const temporary = join(path, `${filename}.${process.pid}.tmp`)
  writeFileSync(temporary, JSON.stringify(owner), { mode: 0o600 })
  renameSync(temporary, join(path, filename))
}

function checkAncestors({ root, path, token }: ScopeLocation) {
  if (![root, path, token].every((value) => typeof value === "string" && value))
    throw new Error("Invalid inherited process ownership scope")
  const location = relative(root, path)
  if (location.startsWith(`..${sep}`) || location === ".." || isAbsolute(location))
    throw new Error("Invalid inherited process ownership scope")
  for (let current = path; ; current = dirname(current)) {
    const owner = readOwner(current, token)
    if (owner.state !== "running") throw new Error(`Parent command is stopping: ${current}`)
    if (current === root) break
  }
}

// Each command inherits a private branch, rather than a runner-wide list. A
// nested runner can stop its own services without touching sibling commands.
// Keep settled records until the outer command completes, so a killed middle
// process cannot hide its separately detached children from the outer runner.
export function createCommandScope(environment: NodeJS.ProcessEnv = process.env) {
  try {
    return prepareScope(environment)
  } catch (caught) {
    const error = toError(caught)
    error.unsafeToRestore = true
    throw error
  }
}

function prepareScope(environment: NodeJS.ProcessEnv) {
  let inherited: ScopeLocation | undefined
  if (environment[environmentKey] !== undefined) {
    inherited = JSON.parse(environment[environmentKey])
    checkAncestors(inherited!)
  }
  const path = mkdtempSync(join(inherited?.path ?? tmpdir(), inherited ? "child-" : "browser-client-command-"))
  const root = inherited?.root ?? path
  const token = inherited?.token ?? randomUUID()
  let owner: ScopeOwner = { version: 1, token, pid: null, state: "starting" }
  writeOwner(path, owner)
  try {
    // Close the registration race: ancestors see this starting record before
    // we check again and spawn. An interrupted registration fails closed.
    if (inherited) checkAncestors(inherited)
  } catch (caught) {
    const error = toError(caught)
    rmSync(path, { recursive: true, force: true })
    error.unsafeToRestore = true
    throw error
  }
  const update = (state: ScopeOwner["state"], pid = owner.pid) => {
    owner = { ...owner, state, pid }
    writeOwner(path, owner)
  }
  function records() {
    const result: ScopeOwner[] = []
    function visit(directory: string) {
      const record = readOwner(directory, token)
      if (record.state === "settled") return
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.name.startsWith("child-")) continue
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Invalid owned process scope: ${directory}`)
        visit(join(directory, entry.name))
      }
      result.push(record)
    }
    visit(path)
    return result
  }
  return {
    path,
    env: { [environmentKey]: JSON.stringify({ root, path, token }) },
    attach: (pid: number | undefined) => update("running", pid ?? null),
    retain: () => {
      owner = { ...owner, retainForRecovery: true }
      writeOwner(path, owner)
    },
    stopping: () => update("stopping"),
    records,
    settle: () => {
      if (owner.retainForRecovery) owner = { ...owner, retainForRecovery: false }
      update("settled")
      if (!inherited && !retained(path, token)) rmSync(path, { recursive: true, force: true })
    },
    discard: () => rmSync(path, { recursive: true, force: true }),
  }
}
