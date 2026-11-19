let revision = -1
const el = (id) => document.getElementById(id)
async function refresh() {
  const response = await fetch(`/state?after=${revision}`)
  if (response.status === 204) return
  if (!response.ok) throw new Error("Console status unavailable")
  const state = await response.json()
  revision = state.revision
  window.browserAgentConsoleRevision = revision
  document.body.classList.toggle("live", state.live)
  for (const name of ["chapter", "title", "subtitle", "badge", "code", "goal", "decision", "result", "boundary"])
    el(name).textContent = state[name] ?? ""
  el("intro").hidden = Boolean(state.live || state.hideIntro)
  el("code-section").hidden = !state.code
  el("goal-section").hidden = !state.goal
  el("decision").hidden = !state.decision
  el("result").classList.toggle("denied", state.denied)
  el("frame-section").hidden = !state.frame
  if (state.frame) {
    el("frame").src = state.frame.dataUrl
    el("geometry").textContent = `${state.frame.width} × ${state.frame.height} · ${state.frame.id}`
  } else el("frame").removeAttribute("src")
  el("events").replaceChildren(
    ...state.events
      .slice(-1)
      .reverse()
      .map((entry) => {
        const li = document.createElement("li")
        const icon = document.createElement("span")
        icon.textContent = entry.ok ? "✓" : "⊘"
        li.append(icon, `${entry.name} · ${entry.detail}`)
        return li
      }),
  )
}
async function poll() {
  try {
    await refresh()
  } catch {
    el("result").textContent = "Connection interrupted. Awaiting a real status update."
  }
  setTimeout(poll, 400)
}
void poll()
