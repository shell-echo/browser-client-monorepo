import type { BrowserConfig } from "./contracts.mts"
import assert from "node:assert/strict"
import { join } from "node:path"
import { verifyPageFoundation } from "./client-page-verification.mts"

async function verifyConcurrentSave({
  popup,
  options,
  until,
}: Pick<Parameters<NonNullable<BrowserConfig["extension"]["verifyInteractions"]>>[0], "popup" | "options" | "until">) {
  const input = options.getByRole("textbox", { name: "Workspace name", exact: true })
  for (const holdRead of [false, true]) {
    const local = `Pending local save ${holdRead}`
    const remote = `Newer remote write ${holdRead}`
    await options.evaluate(
      ({ local, remote, holdRead }) => {
        window.__settingsWrite = chrome.storage.local.set
        window.__settingsRead = chrome.storage.local.get
        const nativeSet = chrome.storage.local.set.bind(chrome.storage.local)
        const nativeGet = chrome.storage.local.get.bind(chrome.storage.local)
        const race: NonNullable<Window["__settingsRace"]> = {
          writePending: false,
          readPending: false,
          releaseWrite: () => {},
          releaseRead: () => {},
        }
        window.__settingsRace = race
        const writeGate = new Promise<void>((resolve) => {
          race.releaseWrite = resolve
        })
        const readGate = new Promise<void>((resolve) => {
          race.releaseRead = resolve
        })
        // These probes intercept the promise calls made by the settings page;
        // the Chrome SDK also declares unrelated generic callback overloads.
        Object.assign(chrome.storage.local, {
          set: async (settings: Record<string, unknown>) => {
            await nativeSet(settings)
            if (settings.workspaceName === local) {
              race.writePending = true
              await writeGate
            }
          },
          get: async (keys: string) => {
            const result = await nativeGet(keys)
            if (result.workspaceName === remote) {
              race.readPending = true
              if (holdRead) await readGate
            }
            return result
          },
        })
      },
      { local, remote, holdRead },
    )
    try {
      await input.fill(local)
      await options.getByRole("button", { name: "Save changes", exact: true }).click()
      await until(() => options.evaluate(() => window.__settingsRace?.writePending), "Delayed local save response")
      await popup.evaluate((workspaceName) => chrome.storage.local.set({ workspaceName }), remote)
      await until(() => options.evaluate(() => window.__settingsRace?.readPending), "Newer storage read started")
      // Let a completed read commit before releasing the older save response.
      if (!holdRead)
        await options.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        )
      await options.evaluate(() => window.__settingsRace!.releaseWrite())
      await options.getByText("Settings saved.", { exact: true }).waitFor()
      await options.evaluate(() => window.__settingsRace!.releaseRead())
      await until(async () => (await input.inputValue()) === remote, "Settings retains the newer storage value")
      await until(
        async () => (await popup.locator("[data-workspace-name]").innerText()) === remote,
        "Popup reflects latest write",
      )
      assert.equal(await popup.evaluate(async () => (await chrome.storage.local.get("workspaceName")).workspaceName), remote)
    } finally {
      await options.evaluate(() => {
        window.__settingsRace?.releaseWrite()
        window.__settingsRace?.releaseRead()
        chrome.storage.local.set = window.__settingsWrite!
        chrome.storage.local.get = window.__settingsRead!
        delete window.__settingsRace
        delete window.__settingsWrite
        delete window.__settingsRead
      })
    }
  }
}

export async function verifyExtensionPage({ page, kind }: Parameters<BrowserConfig["extension"]["verifyPage"]>[0]) {
  await page.getByRole("heading", { name: kind === "options" ? "Settings" : "Workspace", level: 1, exact: true }).waitFor()
  await verifyPageFoundation(page)
  if (kind === "options") await page.getByRole("textbox", { name: "Workspace name", exact: true }).waitFor()
  else await page.locator("[data-workspace-name]").waitFor()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${kind} overflows horizontally`)
}

export async function verifyExtensionSettings({
  popup,
  options,
  until,
  runDir,
  profile,
  preview = false,
}: Parameters<NonNullable<BrowserConfig["extension"]["verifyInteractions"]>>[0] & { preview?: boolean }) {
  const input = options.getByRole("textbox", { name: "Workspace name", exact: true })
  const button = options.getByRole("button", { name: "Save changes", exact: true })
  const displayed = popup.locator("[data-workspace-name]")
  const original = await input.inputValue()
  const stored = () =>
    options.evaluate(
      (preview) =>
        preview
          ? localStorage.getItem("browser-client-workspace-name")
          : chrome.storage.local.get("workspaceName").then((value) => value.workspaceName),
      preview,
    )
  const save = async (value: string) => {
    await input.fill(value)
    await button.click()
    await options.getByText("Settings saved.", { exact: true }).waitFor()
    await until(async () => (await displayed.innerText()) === value.trim(), "Popup reflects saved settings without reload")
    assert.equal(await stored(), value.trim())
  }
  await save("  My workspace  ")
  await options.reload()
  await input.waitFor()
  assert.equal(await input.inputValue(), "My workspace")
  await input.fill("   ")
  await button.click()
  await options.getByRole("alert").waitFor()
  assert.equal(await stored(), "My workspace", "Invalid input changed storage")
  await input.fill("")
  await button.click()
  assert.equal(await input.evaluate((element) => element instanceof HTMLInputElement && element.validity.valueMissing), true)
  assert.equal(await stored(), "My workspace")
  assert.equal(await input.getAttribute("maxlength"), "80")
  await save("W".repeat(80))

  for (const width of [320, 390, 768, 1280]) {
    await options.setViewportSize({ width, height: 900 })
    assert(
      await options.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `Options overflow at ${width}px`,
    )
    await options.screenshot({ path: join(runDir, `${profile}-options-${width}.png`), fullPage: true })
  }
  for (const width of [320, 360]) {
    await popup.setViewportSize({ width, height: 480 })
    assert(
      await popup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `Popup overflow at ${width}px`,
    )
    assert(await displayed.isVisible())
  }
  await options.setViewportSize({ width: 1280, height: 900 })
  await popup.setViewportSize({ width: 360, height: 480 })

  if (!preview) {
    await verifyConcurrentSave({ popup, options, until })
    await input.fill("Unsaved draft")
    await popup.evaluate(() => chrome.storage.local.set({ workspaceName: "Updated elsewhere" }))
    await until(async () => (await displayed.innerText()) === "Updated elsewhere", "External storage update")
    assert.equal(await input.inputValue(), "Unsaved draft", "External updates replaced an unsaved draft")
    await button.click()
    await options.getByText("Settings saved.", { exact: true }).waitFor()
    await until(async () => (await displayed.innerText()) === "Unsaved draft", "Draft save")

    await options.evaluate(() => {
      window.__settingsWrite = chrome.storage.local.set
      chrome.storage.local.set = async () => {
        throw new Error("Simulated storage failure")
      }
    })
    try {
      await input.fill("Keep this draft")
      await button.click()
      await options.getByRole("alert").waitFor()
      assert.equal(await input.inputValue(), "Keep this draft")
      assert.equal(await stored(), "Unsaved draft", "Failed save changed the stored value")
    } finally {
      await options.evaluate(() => {
        chrome.storage.local.set = window.__settingsWrite!
        delete window.__settingsWrite
      })
    }
    await button.click()
    await options.getByText("Settings saved.", { exact: true }).waitFor()
    await until(async () => (await displayed.innerText()) === "Keep this draft", "Storage retry")

    const fault = await options.context().newPage()
    try {
      await fault.addInitScript(() => {
        window.__settingsRead = chrome.storage.local.get
        chrome.storage.local.get = async () => {
          throw new Error("Simulated read failure")
        }
      })
      await fault.goto(options.url())
      await fault.getByRole("alert").waitFor()
      assert.equal(
        await fault.getByRole("textbox", { name: "Workspace name", exact: true }).count(),
        0,
        "Read failure exposed an editable default",
      )
      await fault.evaluate(() => {
        chrome.storage.local.get = window.__settingsRead!
        delete window.__settingsRead
      })
      await fault.getByRole("button", { name: "Try again", exact: true }).click()
      await fault.getByRole("textbox", { name: "Workspace name", exact: true }).waitFor()
      assert.equal(await fault.getByRole("textbox", { name: "Workspace name", exact: true }).inputValue(), "Keep this draft")
    } finally {
      await fault.close()
    }

    await popup.evaluate(() => {
      window.__openOptions = chrome.runtime.openOptionsPage
      window.__openedOptions = 0
      chrome.runtime.openOptionsPage = async () => {
        window.__openedOptions!++
        await window.__openOptions!()
      }
    })
    try {
      await popup.getByRole("button", { name: "Open settings", exact: true }).click()
      await until(() => popup.evaluate(() => window.__openedOptions === 1), "Popup opens the actual options page")
      await popup.evaluate(() => {
        chrome.runtime.openOptionsPage = async () => {
          throw new Error("Simulated options failure")
        }
      })
      await popup.getByRole("button", { name: "Open settings", exact: true }).click()
      await popup.getByRole("alert").waitFor()
    } finally {
      await popup.evaluate(() => {
        chrome.runtime.openOptionsPage = window.__openOptions!
        delete window.__openOptions
        delete window.__openedOptions
      })
    }
    // A successful retry clears the error, using the real Chrome API again.
    await popup.getByRole("button", { name: "Open settings", exact: true }).click()
    await popup.getByRole("alert").waitFor({ state: "hidden" })
  }
  await save(original)
  await popup.screenshot({ path: join(runDir, `${profile}-popup.png`), fullPage: true })
}

export async function verifyExtensionPreview({
  page,
  until,
  runDir,
}: Parameters<NonNullable<BrowserConfig["extension"]["verifyPreview"]>>[0]) {
  await verifyExtensionPage({ page, kind: "popup" })
  const popup = await page.context().newPage()
  try {
    await popup.goto(page.url())
    await verifyExtensionPage({ page: popup, kind: "popup" })
    await page.getByRole("button", { name: "Open settings", exact: true }).click()
    await page.waitForURL("**/options.html")
    await verifyExtensionPage({ page, kind: "options" })
    await verifyExtensionSettings({ popup, options: page, until, runDir, profile: "preview", preview: true })
    await page.getByRole("link", { name: "Back to popup preview", exact: true }).click()
    await page.waitForURL("**/index.html")
    await verifyExtensionPage({ page, kind: "popup" })
  } finally {
    await popup.close()
  }
}
