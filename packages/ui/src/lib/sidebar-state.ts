const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7

// Client applications can restore the preference when mounting their layout.
// SSR consumers should supply their server-derived defaultOpen instead.
export function readSidebarState(fallback = true) {
  try {
    const prefix = `${SIDEBAR_COOKIE_NAME}=`
    const saved = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(prefix))
      ?.slice(prefix.length)
    return saved === "true" ? true : saved === "false" ? false : fallback
  } catch {
    return fallback
  }
}

export function writeSidebarState(open: boolean) {
  try {
    document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`
  } catch {
    // Cookie restrictions must not prevent the current layout from toggling.
  }
}
