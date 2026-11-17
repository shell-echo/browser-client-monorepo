import { createPageAgent } from "@browser-client/extension-sdk/agent"
import { BridgeError, PORT_NAME } from "@browser-client/extension-sdk/protocol"
import type { PageAction, PageActionResult, PageInfo, PageObservation } from "@browser-client/extension-sdk/protocol"

// ISOLATED world only. No window.postMessage/CustomEvent bridge into page scripts.
const scope = globalThis as typeof globalThis & { __browserClientPageAgent?: { connect(): void } }
if (!scope.__browserClientPageAgent) {
  const pageInfo = (): PageInfo => ({
    title: document.title.slice(0, 512),
    url: `${location.origin}${location.pathname}`.slice(0, 2048),
    selection: window.getSelection()?.toString().slice(0, 4096) ?? "",
  })
  const sensitiveSelector =
    'input[type="password"], input[autocomplete*="cc-" i], input[name*="password" i], input[name*="card" i], input[name*="cvv" i], input[name*="cvc" i], textarea[autocomplete*="cc-" i]'
  const sensitive = (element: Element | null) => {
    const field = element?.closest("input, textarea, select")
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement))
      return false
    return (
      (field instanceof HTMLInputElement && field.type.toLowerCase() === "password") ||
      /password|passcode|secret|card|cvv|cvc|security.?code/i.test(`${field.name} ${field.id} ${field.autocomplete}`) ||
      /cc-/.test(field.autocomplete)
    )
  }
  // The template intentionally runs only in the top frame. An iframe may host
  // a cross-origin payment/password control we cannot inspect, so suppress the
  // screenshot conservatively instead of trying to inspect another origin.
  const hasSensitiveFields = () => Boolean(document.querySelector(sensitiveSelector) || document.querySelector("iframe"))
  const impactText = (element: Element) =>
    `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("name") ?? ""}`
      .trim()
      .toLowerCase()
  const requiresConfirmation = (element: Element) => {
    const tag = element.tagName.toLowerCase()
    const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : ""
    return (
      (tag === "button" && element.closest("form") !== null) ||
      type === "submit" ||
      element.hasAttribute("data-browser-client-high-impact") ||
      /\b(submit|send|purchase|buy|pay|delete|remove|transfer|publish|confirm)\b/.test(impactText(element))
    )
  }
  const action = (value: PageAction): PageActionResult => {
    if (value.action === "click") {
      const target = document.elementFromPoint(value.x, value.y)
      if (!(target instanceof Element)) throw new BridgeError("TARGET_NOT_FOUND", "No page element is at those coordinates")
      const interactive = target.closest("button, a, input, textarea, select, [role=button], [contenteditable=true]") ?? target
      if (sensitive(interactive)) throw new BridgeError("SENSITIVE_FIELD", "Sensitive fields cannot be controlled")
      if (requiresConfirmation(interactive) && value.confirm !== true)
        throw new BridgeError("CONFIRMATION_REQUIRED", "This action requires explicit confirmation")
      if (!(interactive instanceof HTMLElement)) throw new BridgeError("TARGET_NOT_FOUND", "The target is not interactive")
      interactive.focus({ preventScroll: true })
      interactive.click()
      return { accepted: true, action: "click" }
    }
    if (value.action === "scroll") {
      window.scrollBy({ left: value.deltaX, top: value.deltaY, behavior: "instant" })
      return { accepted: true, action: "scroll", scrollX: window.scrollX, scrollY: window.scrollY }
    }
    if (value.action === "type") {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (!active) throw new BridgeError("NO_TEXT_TARGET", "Focus a text field before typing")
      const editable = active.isContentEditable
      if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || editable))
        throw new BridgeError("NO_TEXT_TARGET", "Focus a text field before typing")
      if (sensitive(active)) throw new BridgeError("SENSITIVE_FIELD", "Sensitive fields cannot be controlled")
      if (active instanceof HTMLInputElement && !["text", "search", "email", "url", "tel", "number"].includes(active.type))
        throw new BridgeError("NO_TEXT_TARGET", "The focused control does not accept text")
      if (editable) {
        if (value.replace !== false) active.textContent = value.text
        else active.textContent = `${active.textContent ?? ""}${value.text}`
        active.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value.text }))
      } else {
        const field = active as HTMLInputElement | HTMLTextAreaElement
        const start = value.replace === false ? (field.selectionStart ?? field.value.length) : 0
        const end = value.replace === false ? (field.selectionEnd ?? field.value.length) : field.value.length
        field.setRangeText(value.text, start, end, "end")
        field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value.text }))
        field.dispatchEvent(new Event("change", { bubbles: true }))
      }
      return { accepted: true, action: "type" }
    }
    if (value.action === "keypress") {
      const active = document.activeElement
      if (active && sensitive(active)) throw new BridgeError("SENSITIVE_FIELD", "Sensitive fields cannot be controlled")
      if (value.key === "Enter" && active && requiresConfirmation(active) && value.confirm !== true)
        throw new BridgeError("CONFIRMATION_REQUIRED", "Submitting this form requires explicit confirmation")
      const init = { key: value.key, code: value.key, bubbles: true, cancelable: true }
      active?.dispatchEvent(new KeyboardEvent("keydown", init))
      active?.dispatchEvent(new KeyboardEvent("keyup", init))
      return { accepted: true, action: "keypress" }
    }
    throw new BridgeError("UNSUPPORTED", "This action is handled by the extension worker")
  }
  const agent = createPageAgent({
    connect() {
      const port = chrome.runtime.connect({ name: PORT_NAME })
      port.onDisconnect.addListener(() => {
        try {
          void chrome.runtime.lastError
        } catch {
          /* Extension context was reloaded. */
        }
      })
      return port
    },
    read: pageInfo,
    observe: (): PageObservation => ({
      page: pageInfo(),
      viewport: {
        width: Math.max(1, Math.min(8192, window.innerWidth)),
        height: Math.max(1, Math.min(8192, window.innerHeight)),
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        devicePixelRatio: Math.max(0.1, Math.min(8, window.devicePixelRatio || 1)),
      },
      sensitiveFields: hasSensitiveFields(),
    }),
    action,
  })
  scope.__browserClientPageAgent = { connect: agent.connect }
  agent.connect()
  const show = (event: PageTransitionEvent) => {
    if (event.isTrusted && event.persisted) agent.connect()
  }
  const hide = (event: PageTransitionEvent) => {
    if (!event.isTrusted) return
    agent.suspend()
    if (!event.persisted) {
      agent.close()
      delete scope.__browserClientPageAgent
      window.removeEventListener("pagehide", hide)
      window.removeEventListener("pageshow", show)
    }
  }
  window.addEventListener("pagehide", hide)
  window.addEventListener("pageshow", show)
}
