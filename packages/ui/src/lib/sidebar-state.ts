const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7

export function sidebarCookieName() {
  const namespace = typeof document === "undefined" ? undefined : document.documentElement?.dataset?.appNamespace
  return namespace ? `${SIDEBAR_COOKIE_NAME}_${namespace}` : SIDEBAR_COOKIE_NAME
}

// Client applications can restore the preference when mounting their layout.
// SSR consumers should supply their server-derived defaultOpen instead.
export function readSidebarState(fallback = true) {
  try {
    const name = sidebarCookieName()
    const entries = document.cookie.split(";").map((entry) => entry.trim())
    let saved = entries.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1)
    if (saved === undefined && name !== SIDEBAR_COOKIE_NAME && document.documentElement?.dataset?.appLegacy === "true") {
      saved = entries.find((entry) => entry.startsWith(`${SIDEBAR_COOKIE_NAME}=`))?.slice(SIDEBAR_COOKIE_NAME.length + 1)
      if (saved === "true" || saved === "false") writeSidebarState(saved === "true")
    }
    return saved === "true" ? true : saved === "false" ? false : fallback
  } catch {
    return fallback
  }
}

export function writeSidebarState(open: boolean) {
  try {
    document.cookie = `${sidebarCookieName()}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`
  } catch {
    // Cookie restrictions must not prevent the current layout from toggling.
  }
}
