import assert from "node:assert/strict"
import { readApplications } from "../lib/apps.mts"
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { execFileSync } from "node:child_process"
import { normalizeTheme, THEME_STORAGE_KEY, THEME_STORAGE_SCRIPT } from "../../packages/ui/src/lib/theme.ts"
import { preserveApp } from "../lib/workspace.mts"

const root = fileURLToPath(new URL("../../", import.meta.url))
const bootstrap = await readFile(join(root, "packages/ui/src/lib/theme-init.js"), "utf8")

test("Next theme storage is normalized before hydration without changing valid preferences", () => {
  for (const saved of [null, "light", "dark", "system", "sepia", "invalid theme", ""]) {
    let value = saved
    runInNewContext(THEME_STORAGE_SCRIPT, {
      window: {
        localStorage: {
          getItem(key: string) {
            assert.equal(key, THEME_STORAGE_KEY)
            return value
          },
          setItem(key: string, next: string) {
            assert.equal(key, THEME_STORAGE_KEY)
            value = next
          },
          removeItem(key: string) {
            assert.equal(key, THEME_STORAGE_KEY)
            value = null
          },
        },
      },
    })
    assert.equal(value, saved === null || ["light", "dark", "system"].includes(saved) ? saved : null)
  }
  for (const method of ["getItem", "removeItem"]) {
    assert.doesNotThrow(() =>
      runInNewContext(THEME_STORAGE_SCRIPT, {
        window: {
          localStorage: {
            getItem() {
              if (method === "getItem") throw Error("blocked")
              return "sepia"
            },
            removeItem() {
              throw Error("read-only")
            },
          },
        },
      }),
    )
  }
})

test("Next theme recovery discards only invalid preferences when storage writes exceed quota", () => {
  for (const saved of ["light", "dark", "system", "sepia", "invalid theme", ""]) {
    const values = new Map([
      [THEME_STORAGE_KEY, saved],
      ["business-draft", "keep me"],
    ])
    let writes = 0
    runInNewContext(THEME_STORAGE_SCRIPT, {
      window: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem() {
            writes++
            throw new DOMException("Storage quota exceeded", "QuotaExceededError")
          },
          removeItem: (key: string) => values.delete(key),
        },
      },
    })
    assert.equal(values.get(THEME_STORAGE_KEY) ?? null, ["light", "dark", "system"].includes(saved) ? saved : null)
    assert.equal(values.get("business-draft"), "keep me")
    assert.equal(writes, 0, "Recovering a theme must not allocate storage")
  }
})

test("the shared design system resolves to official shadcn preset b0 without fallbacks", async () => {
  const cli = join(root, "node_modules/shadcn/dist/index.js")
  const preset = JSON.parse(
    execFileSync(process.execPath, [cli, "preset", "resolve", "--json", "--cwd", join(root, "packages/ui")], {
      encoding: "utf8",
      timeout: 30_000,
    }),
  )
  assert.equal(preset.code, "b0")
  assert.deepEqual(preset.fallbacks, [])
  const ui = JSON.parse(await readFile(join(root, "packages/ui/components.json"), "utf8"))
  for (const { id: app } of await readApplications(root)) {
    const config = JSON.parse(await readFile(join(root, "apps", app, "components.json"), "utf8"))
    for (const key of ["style", "iconLibrary", "menuColor", "menuAccent", "rtl"])
      assert.equal(config[key], ui[key], `${app}/${key}`)
    assert.equal(config.tailwind.baseColor, ui.tailwind.baseColor)
    assert.equal(config.tailwind.css, "../../packages/ui/src/styles/globals.css")
  }
})

test("the early CSP-safe bootstrap honors saved themes, system preference and unavailable storage", () => {
  for (const [saved, dark, expected] of [
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["system", true, "dark"],
    [null, false, "light"],
    ["invalid", true, "dark"],
    ["blocked", true, "dark"],
  ]) {
    const classes = new Set(["light", "dark", "unrelated"])
    runInNewContext(bootstrap, {
      window: {
        localStorage: {
          getItem: (key: string) => {
            assert.equal(key, THEME_STORAGE_KEY)
            if (saved === "blocked") throw Error("blocked")
            return saved
          },
        },
        matchMedia: (query: string) => {
          assert.equal(query, "(prefers-color-scheme: dark)")
          return { matches: dark }
        },
      },
      document: {
        documentElement: {
          classList: {
            remove: (...values: string[]) => values.forEach((value) => classes.delete(value)),
            add: (value: string) => classes.add(value),
          },
        },
      },
    })
    assert.deepEqual([...classes].sort(), [expected, "unrelated"].sort(), `${saved}/${dark}`)
  }
  for (const value of [undefined, null, "sepia", {}, 123, "system"]) assert.equal(normalizeTheme(value), "system")
  assert.equal(normalizeTheme("light"), "light")
  assert.equal(normalizeTheme("dark"), "dark")
})

test("Vite pages use identical external bootstrap assets ahead of the React entry", async () => {
  const applications = (await readApplications(root)).filter((app) => app.type !== "web")
  const destinations = [
    ...applications,
    ...(["admin", "extension"] as const).map((type) => ({ path: `templates/${type}`, type })),
  ]
  for (const { path, type } of destinations) {
    assert.equal(
      await readFile(join(root, path, "public/theme-init.js"), "utf8"),
      bootstrap,
      "Run pnpm theme:sync after editing the shared bootstrap",
    )
    for (const page of type === "extension" ? ["index.html", "options.html"] : ["index.html"]) {
      const html = await readFile(join(root, path, page), "utf8")
      assert(html.indexOf('<script src="/theme-init.js">') < html.indexOf('<script type="module"'))
      assert(html.includes('<script src="/theme-init.js"></script>'))
    }
  }
})

test("reinit retains theme wrappers, HTML bootstrap and public assets while refreshing framework configs", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "browser-client-theme-"))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const previous = join(temporary, "previous"),
    stage = join(temporary, "candidate")
  for (const dir of ["src", "public"]) {
    await mkdir(join(previous, dir), { recursive: true })
    await mkdir(join(stage, dir), { recursive: true })
  }
  const files = {
    "src/main.tsx": "<ThemeProvider><App /></ThemeProvider>\n",
    "public/theme-init.js": bootstrap,
    "index.html": '<script src="/theme-init.js"></script>',
    "options.html": '<script src="/theme-init.js"></script>',
  }
  for (const [file, contents] of Object.entries(files)) await writeFile(join(previous, file), contents)
  await writeFile(join(previous, "vite.config.ts"), "old")
  await writeFile(join(stage, "vite.config.ts"), "new official config")
  await preserveApp(previous, stage)
  for (const [file, contents] of Object.entries(files)) assert.equal(await readFile(join(stage, file), "utf8"), contents)
  assert.equal(await readFile(join(stage, "vite.config.ts"), "utf8"), "new official config")
})

test("bootstrap isolates new instances and migrates original preferences without losing quota-failed reads", () => {
  for (const [legacy, quota, expected] of [
    [false, false, "light"],
    [true, false, "dark"],
    [true, true, "dark"],
  ] as const) {
    const values = new Map([[THEME_STORAGE_KEY, "dark"]])
    const classes = new Set<string>()
    runInNewContext(bootstrap, {
      window: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => {
            if (quota) throw Error("quota")
            values.set(key, value)
          },
          removeItem: (key: string) => values.delete(key),
        },
        matchMedia: () => ({ matches: false }),
      },
      document: {
        documentElement: {
          dataset: { appNamespace: "second", appLegacy: String(legacy) },
          classList: {
            remove: (...items: string[]) => items.forEach((item) => classes.delete(item)),
            add: (item: string) => classes.add(item),
          },
        },
      },
    })
    assert(classes.has(expected))
    assert.equal(values.get(`${THEME_STORAGE_KEY}:second`), legacy && !quota ? "dark" : undefined)
    if (!legacy || quota) assert.equal(values.get(THEME_STORAGE_KEY), "dark")
  }
})
