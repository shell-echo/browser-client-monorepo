// Exact origins, including ports. Add a production HTTPS origin deliberately.
// Chrome's manifest patterns are coarser; the broker checks this list again.
export const webOrigins = ["http://127.0.0.1:3000", "http://localhost:3000"]
export const webMatches = [
  ...new Set(
    webOrigins.map((value) => {
      const url = new URL(value)
      if (!["https:", "http:"].includes(url.protocol) || url.origin !== value || url.username || url.password)
        throw new Error("Use an exact HTTP(S) bridge origin")
      if (url.protocol === "http:" && !["127.0.0.1", "localhost"].includes(url.hostname))
        throw new Error("Production bridge origins require HTTPS")
      return `${url.protocol}//${url.hostname}/*`
    }),
  ),
]
