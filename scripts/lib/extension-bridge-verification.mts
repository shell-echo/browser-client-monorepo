import assert from "node:assert/strict"
import type { BrowserContext, Page } from "playwright"
import type { Until } from "./contracts.mts"

export async function verifyExtensionBridge({
  context,
  popup,
  options,
  until,
  fixtureOrigin,
}: {
  context: BrowserContext
  popup: Page
  options: Page
  until: Until
  fixtureOrigin: string
}) {
  const extensionId = new URL(options.url()).hostname
  const site = await context.newPage()
  const panel = await context.newPage()
  const originalName: unknown = await options.evaluate(
    async () => (await chrome.storage.local.get("workspaceName")).workspaceName,
  )
  try {
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
    await panel.getByRole("heading", { name: "Browser connection", exact: true }).waitFor()
    await panel.getByRole("status").filter({ hasText: "connected" }).waitFor()
    await site.goto(fixtureOrigin)
    await until(() => site.evaluate(() => Boolean(window.__bridgeTest)), "Web SDK fixture ready")
    await site.evaluate((id) => window.__bridgeTest!.connect(id), extensionId)
    assert.equal(
      await site.evaluate(async () => {
        try {
          await window.__bridgeTest!.client!.request("workspace.get", {})
          return "UNEXPECTED_SUCCESS"
        } catch (error) {
          return (error as { code: string }).code
        }
      }),
      "NOT_AUTHORIZED",
    )
    assert.equal(
      await site.evaluate(async () => {
        try {
          await window.__bridgeTest!.client!.request("workspace.set", { name: "Unauthorized" })
          return "UNEXPECTED_SUCCESS"
        } catch (error) {
          return (error as { code: string }).code
        }
      }),
      "FORBIDDEN",
    )
    async function approve() {
      await site.evaluate(() =>
        window.__bridgeTest!.client!.request("access.request", { capabilities: ["workspace.read", "page.read"] }),
      )
      await options.getByRole("button", { name: "Allow this page", exact: true }).click()
      await until(() => site.evaluate(() => window.__bridgeTest!.access.includes("page.read")), "Document-scoped approval")
    }
    await approve()
    await site.evaluate(() => {
      window.__bridgeTest!.watch()
      const range = document.createRange()
      range.selectNodeContents(document.getElementById("selection")!)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    })
    const page = await site.evaluate(() => window.__bridgeTest!.client!.request("page.read", {}))
    assert.equal(page.selection, "Selected through the isolated agent")
    assert.equal(page.title, "Bridge fixture")
    assert.equal(page.url, `${fixtureOrigin}/`)
    const updated = "Bridge subscription check"
    await options.getByRole("textbox", { name: "Workspace name", exact: true }).fill(updated)
    await options.getByRole("button", { name: "Save changes", exact: true }).click()
    await until(
      () => site.evaluate((name) => window.__bridgeTest!.values.some((value) => value.name === name), updated),
      "Web targeted subscription",
    )
    await panel.getByRole("status").filter({ hasText: updated }).waitFor()
    await popup.getByRole("status").filter({ hasText: updated }).waitFor()
    await options.getByRole("button", { name: "Revoke access", exact: true }).click()
    await until(() => site.evaluate(() => window.__bridgeTest!.access.length === 0), "Web revocation snapshot")
    assert.equal(
      await site.evaluate(async () => {
        try {
          await window.__bridgeTest!.client!.request("page.read", {})
          return "UNEXPECTED_SUCCESS"
        } catch (error) {
          return (error as { code: string }).code
        }
      }),
      "NOT_AUTHORIZED",
    )
    await approve()
    await site.goto(`${fixtureOrigin}/?new-document=1`)
    await until(() => site.evaluate(() => Boolean(window.__bridgeTest)), "New Web document")
    await site.evaluate((id) => window.__bridgeTest!.connect(id), extensionId)
    assert.equal(
      await site.evaluate(async () => {
        try {
          await window.__bridgeTest!.client!.request("workspace.get", {})
          return "UNEXPECTED_SUCCESS"
        } catch (error) {
          return (error as { code: string }).code
        }
      }),
      "NOT_AUTHORIZED",
      "Navigation must not inherit an old grant",
    )
    await approve()
    const before = await site.evaluate(() => window.__bridgeTest!.client!.request("bridge.info", {}))
    const cdp = await context.newCDPSession(options)
    try {
      let versionId: string | undefined
      cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
        versionId =
          versions.find(
            (version) =>
              version.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && version.runningStatus === "running",
          )?.versionId ?? versionId
      })
      await cdp.send("ServiceWorker.enable")
      await until(() => Boolean(versionId), "Actual extension worker version")
      await cdp.send("ServiceWorker.stopWorker", { versionId: versionId! })
      await until(
        async () => {
          try {
            const info = await site.evaluate(() => window.__bridgeTest!.client!.request("bridge.info", {}))
            return info.epoch !== before.epoch
          } catch {
            return false
          }
        },
        "Actual worker termination and new epoch",
        30_000,
      )
      assert.deepEqual(await site.evaluate(() => window.__bridgeTest!.client!.request("workspace.get", {})), { name: updated })
      assert.equal((await site.evaluate(() => window.__bridgeTest!.client!.request("page.read", {}))).title, "Bridge fixture")
    } finally {
      await cdp.detach()
    }
    // A document shares its quota across all Ports. Use another real document
    // to verify that closing its flooding Port preserves this approved client.
    const floodSite = await context.newPage()
    try {
      await floodSite.goto(fixtureOrigin)
      await until(() => floodSite.evaluate(() => Boolean(window.__bridgeTest)), "Separate flooding document ready")
      assert.equal(
        await floodSite.evaluate((id) => window.__bridgeTest!.flood(id), extensionId),
        true,
        "Flooding port was not closed",
      )
    } finally {
      await floodSite.close()
    }
    assert.equal((await site.evaluate(() => window.__bridgeTest!.client!.request("bridge.info", {}))).version, 1)
    const disposablePopup = await context.newPage()
    await disposablePopup.goto(`chrome-extension://${extensionId}/index.html`)
    await disposablePopup.locator("[data-extension-id]").waitFor()
    await disposablePopup.close()
    assert.deepEqual(await site.evaluate(() => window.__bridgeTest!.client!.request("workspace.get", {})), { name: updated })
  } finally {
    await site.close()
    await panel.close()
    await options.evaluate(async (name) => {
      if (typeof name === "string") await chrome.storage.local.set({ workspaceName: name })
      else await chrome.storage.local.remove("workspaceName")
    }, originalName)
  }
}
