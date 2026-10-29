export const DEFAULT_WORKSPACE_NAME = "Browser Client"
export const WORKSPACE_NAME_LIMIT = 80
const previewKey = "browser-client-workspace-name"

export function isExtensionContext() {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id)
}

export function validateWorkspaceName(value: string) {
  const name = value.trim()
  if (!name || name.length > WORKSPACE_NAME_LIMIT) {
    throw new Error(`Enter a workspace name between 1 and ${WORKSPACE_NAME_LIMIT} characters.`)
  }
  return name
}

export async function readWorkspaceName() {
  const value: unknown = isExtensionContext()
    ? (await chrome.storage.local.get("workspaceName")).workspaceName
    : window.localStorage.getItem(previewKey)
  // Bound the displayed value without rewriting existing storage.
  return typeof value === "string" && value.trim() ? value.slice(0, WORKSPACE_NAME_LIMIT) : DEFAULT_WORKSPACE_NAME
}

export async function saveWorkspaceName(value: string) {
  const name = validateWorkspaceName(value)
  if (isExtensionContext()) await chrome.storage.local.set({ workspaceName: name })
  else window.localStorage.setItem(previewKey, name)
  return name
}

export function subscribeWorkspaceName(onChange: () => void) {
  if (isExtensionContext()) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && Object.hasOwn(changes, "workspaceName")) onChange()
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }
  const listener = (event: StorageEvent) => {
    if (event.key === previewKey || event.key === null) onChange()
  }
  window.addEventListener("storage", listener)
  return () => window.removeEventListener("storage", listener)
}
