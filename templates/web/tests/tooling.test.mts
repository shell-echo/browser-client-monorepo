import { test } from "node:test"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const lintTimeout = 60_000

test("Next loads conditional verification worker limits without changing normal configuration", () => {
  const app = fileURLToPath(new URL("../", import.meta.url))
  for (const low of [false, true]) {
    const env: NodeJS.ProcessEnv = { ...process.env, RAYON_NUM_THREADS: "1" }
    delete env.BROWSER_CLIENT_LOW_RESOURCE
    if (low) env.BROWSER_CLIENT_LOW_RESOURCE = "1"
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import assert from "node:assert/strict";
        import {createRequire} from "node:module";
        const require = createRequire(import.meta.url);
        const loadConfig = require("next/dist/server/config").default;
        const config = await loadConfig("phase-production-build", process.cwd(), {silent: true});
        const {default: raw} = await import("./next.config.ts");
        assert(config.transpilePackages.includes("@browser-client/ui"));
        assert(config.turbopack.rules["*.css"]);
        if (process.env.BROWSER_CLIENT_LOW_RESOURCE === "1") {
          assert.equal(config.experimental.cpus, 1);
          assert.equal(config.experimental.memoryBasedWorkersCount, false);
        } else {
          assert.equal(raw.experimental?.cpus, undefined);
        }`,
      ],
      { cwd: app, env, encoding: "utf8", timeout: lintTimeout },
    )
  }
})

test("real ESLint combines shared policy with Next rules and ignores generated extension output", () => {
  const app = fileURLToPath(new URL("../", import.meta.url))
  // Match the real CLI's cwd so eslint-plugin-react can detect the app's React.
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict"
    import { ESLint } from "eslint"
    const eslint = new ESLint()
    const config = await eslint.calculateConfigForFile("src/app/page.tsx")
    assert.equal(config.linterOptions.reportUnusedDisableDirectives, 2)
    assert(config.rules["@next/next/no-html-link-for-pages"])
    assert(config.rules["@typescript-eslint/no-unused-vars"])
    assert.equal(await eslint.isPathIgnored("dist-dev/generated.js"), true)
    const [result] = await eslint.lintText("// eslint-disable-next-line no-debugger\\nexport const value = 1;", { filePath: "src/config-probe.ts" })
    assert(result.messages.some((message) => message.severity === 2 && /Unused eslint-disable directive/.test(message.message)))
  `,
    ],
    { cwd: app, encoding: "utf8", timeout: lintTimeout },
  )
})
