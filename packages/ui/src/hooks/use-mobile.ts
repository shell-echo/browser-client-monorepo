"use client"

import { useCallback, useSyncExternalStore } from "react"

const MOBILE_QUERY = "(max-width: 767px)"

function subscribe(onStoreChange: () => void, onBreakpointChange?: (isMobile: boolean) => void) {
  const media = window.matchMedia(MOBILE_QUERY)
  const onChange = (event: MediaQueryListEvent) => {
    onBreakpointChange?.(event.matches)
    onStoreChange()
  }
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

const getSnapshot = () => window.matchMedia(MOBILE_QUERY).matches
const getServerSnapshot = () => false

export function useIsMobile(onBreakpointChange?: (isMobile: boolean) => void) {
  const subscribeToChanges = useCallback(
    (onStoreChange: () => void) => subscribe(onStoreChange, onBreakpointChange),
    [onBreakpointChange],
  )
  return useSyncExternalStore(subscribeToChanges, getSnapshot, getServerSnapshot)
}
