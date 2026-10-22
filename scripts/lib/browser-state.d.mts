export {}

// Test-only probes installed by browser callbacks in isolated profiles.
declare global {
  interface Window {
    __adminTemplateNavigation?: string
    __routeRecovery?: string
    __hmrSentinel?: string
    __themeClearObserved?: boolean
    __settingsWrite?: typeof chrome.storage.local.set
    __settingsRead?: typeof chrome.storage.local.get
    __settingsRace?: {
      writePending: boolean
      readPending: boolean
      releaseWrite(): void
      releaseRead(): void
    }
    __openOptions?: typeof chrome.runtime.openOptionsPage
    __openedOptions?: number
  }
}
