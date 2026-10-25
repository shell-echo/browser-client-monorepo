import { readFileSync } from "node:fs"
import { dirname, basename, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { application, identityOf, parseAppsConfig, type AppIdentity } from "./apps.mts"
import type { TemplateVersions } from "./contracts.mts"

// Build configuration reads the checked-in registry; client bundles receive
// only the public instance identity, never the repository configuration.
export function applicationSettings(location: string | URL) {
  const appDir = dirname(fileURLToPath(location))
  const root = resolve(appDir, "../..")
  const id = basename(appDir)
  const config = parseAppsConfig(readFileSync(join(root, "apps.config.json"), "utf8"))
  const definition = config.apps[id]
  assert(definition, `Application is not registered: ${id}`)
  const records: TemplateVersions = JSON.parse(readFileSync(join(root, "template-versions.json"), "utf8"))
  const saved = records.applications?.[id]
  assert(saved, `Application identity is missing: ${id}`)
  const app = application(id, definition, saved)
  const identity: AppIdentity = JSON.parse(readFileSync(join(appDir, "app-identity.json"), "utf8"))
  assert.deepEqual(identity, identityOf(app), `Application identity mismatch: ${id}`)
  let override = process.env.APP_DEV_PORT
  if (override !== undefined) assert.equal(process.env.APP_INSTANCE_ID, id, "A port override must target one APP_INSTANCE_ID")
  if (override === undefined && app.type === "extension" && process.env.EXTENSION_DEV_PORT !== undefined) {
    assert.equal(
      Object.values(config.apps).filter((entry) => entry.type === "extension").length,
      1,
      "Use an instance-specific port override when multiple extensions exist",
    )
    override = process.env.EXTENSION_DEV_PORT
  }
  const port = override === undefined ? app.port : Number(override)
  assert(Number.isSafeInteger(port) && port >= 1024 && port <= 65535, `Invalid application port: ${id}`)
  return { ...app, port }
}

export function identityPlugin(identity: AppIdentity) {
  return {
    name: "browser-client:instance-identity",
    transformIndexHtml: {
      order: "pre" as const,
      handler(html: string) {
        assert(/<html\b/i.test(html), "Application HTML is missing its root element")
        assert(!/\bdata-app-(namespace|legacy)=/i.test(html), "Instance identity attributes are managed by the Vite adapter")
        return html.replace(
          /<html\b/i,
          `<html data-app-namespace="${identity.instanceId}" data-app-legacy="${identity.legacy}"`,
        )
      },
    },
  }
}
