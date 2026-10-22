import { useCallback, useEffect, useRef, useState } from "react"
import { readWorkspaceName, saveWorkspaceName, subscribeWorkspaceName } from "../lib/settings"

export function useWorkspaceName() {
  const [state, setState] = useState({ name: "", loading: true, error: "" })
  const requests = useRef({ generation: 0, active: false })

  const load = useCallback(() => {
    const pending = requests.current
    const current = ++pending.generation
    return readWorkspaceName().then(
      (name) => {
        if (pending.active && pending.generation === current) setState({ name, loading: false, error: "" })
      },
      () => {
        if (pending.active && pending.generation === current) {
          setState((previous) => ({ ...previous, loading: false, error: "Unable to load your workspace. Please try again." }))
        }
      },
    )
  }, [])

  useEffect(() => {
    const pending = requests.current
    pending.active = true
    const unsubscribe = subscribeWorkspaceName(() => void load())
    void load()
    return () => {
      pending.active = false
      pending.generation++
      unsubscribe()
    }
  }, [load])

  async function save(value: string) {
    const name = await saveWorkspaceName(value)
    requests.current.generation++
    if (requests.current.active) setState({ name, loading: false, error: "" })
    return name
  }

  return { ...state, reload: load, save }
}
