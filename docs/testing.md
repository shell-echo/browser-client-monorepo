# Testing and continuous integration

[Project home](../README.md) · [Development](development.md) · [Reinit](reinit.md) · [Testing](testing.md) · [Security](security.md)

Use application-specific assertions together with the shared infrastructure checks. Reports and browser profiles stay in the private `.reinit/` directory.

Maintenance regressions force-terminate both a real maintenance owner and a recovery owner while their detached command remains alive. Recovery must refuse before changing files, claims or lock ownership. Timeout configuration regressions verify that invalid settings leave no lock and corrected settings can retry. The composition acceptance suite creates two Web, two Admin and two Extension instances; each Extension worker builds and validates only its own production output before the suite aggregates complete coverage.

## Validation commands

```sh
pnpm check       # Formatting, compatibility, tests, lint, types, all builds, and extension output
pnpm test        # Preservation, recovery, cancellation / timeouts, cleanup, catalogs, and configuration
pnpm lint:scripts
pnpm typecheck:scripts
pnpm build

# Install the matching Chromium before the first browser test
pnpm exec playwright install chromium
pnpm test:browser  # Every registered instance, with mandatory coverage aggregation
pnpm test:extension
pnpm test:web-admin
pnpm test:reinit  # Slow: real online rebuild, offline replay, and rejection test in an isolated copy
pnpm audit:security
```

### Low-resource local verification

When other tasks share your computer, opt in for one verification command at a time:

```sh
pnpm verify:low check
pnpm verify:low test:browser admin
pnpm verify:low test:apps     # Still a long acceptance; run only when resources allow
pnpm verify:low test:reinit
```

The wrapper lowers its own scheduling priority, then inherits that priority into its children. It runs Turborepo tasks and Node test files serially, sets Next.js build workers to one, and bounds Rayon, libuv and Go worker pools to one. Browser instance workers already run sequentially; required peer pages and multi-instance isolation assertions remain intact. All assertions, type checks, browser gates and timeouts stay enabled. Low scheduling priority and bounded concurrency reduce peaks, but do not impose a hard CPU or total-memory limit. Stop with Ctrl+C if the machine becomes unresponsive; owned processes are stopped before cleanup.

This profile is opt-in through `verify:low`; ordinary development and CI commands retain their defaults. The private `BROWSER_CLIENT_LOW_RESOURCE=1` marker and thread settings propagate to isolated maintenance/browser workspaces. Reinit's Next.js adapter reapplies the conditional worker configuration, and Turborepo hashes the resource settings so normal and low-resource builds use separate cache entries. Browser reports record `resourceMode`. No dependencies, business files or test assertions are replaced by this profile.

### Optional resource guard

```sh
pnpm verify:low --guard check
pnpm verify:low --guard test:browser admin
pnpm verify:low --guard --wait-ms=600000 test:accessibility
pnpm verify:low --guard --resume=guard-1793010000000-1234abcd
```

Guard mode supports macOS and Linux. Startup requires three consecutive observations about 20 seconds apart: CPU idle at least 80%, memory availability at least 40%, and normal memory pressure. macOS uses the second interval sample of `top -l 2`, `memory_pressure -Q` and kernel pressure; load average is not a CPU-idle measurement. Linux uses interval `/proc/stat`, `MemAvailable` and zero full-stall PSI over its ten-second window. Unsupported platforms or unreadable observations never count as healthy. Plain serial `verify:low` remains available separately. Under memory pressure the guard omits CPU/process scans and waits with lightweight observations.

Runtime sampling is about every 15 seconds. Abnormal memory pressure, memory below 40%, CPU idle below 35%, idle below 50% twice, unavailable observations, or observed owned-process RSS over 2 GiB stops only the owned command tree. This is sampled protection, not an OS quota or a guarantee against unrelated system load. Priority and single-worker settings remain enabled. Runtime resource stops require a fifteen-minute cooldown before resume.

Every attempt retains `report.json`, `resources.jsonl` and command output in a new `.reinit/verification/guard-*` directory. Exit 75 means startup capacity was unavailable or resource protection stopped work; test failures and unsafe cleanup still fail. Startup waits default to ten minutes. Resume validates source fingerprint, Node/platform, successful cleanup and cooldown, then reruns the recorded task in a new attempt directory. It does not skip arbitrary steps inside interrupted maintenance or mark unexecuted assertions passed. Changed source requires a fresh run. Startup-only waits have no runtime cooldown.

One guard runs per project at a time. Its coordination lock is separate from the maintenance lock. After an unexpected controller exit, another run can reclaim it only after the recorded owner and every known command group are confirmed absent. Old coordination/scope/report data is retained. Unreadable or uncertain ownership refuses startup; unknown/failed attempts cannot resume automatically. Inspect these records and use normal maintenance recovery for any affected isolated workspace. Do not remove locks blindly.

### Accessibility acceptance

`pnpm test:browser` validates the real axe-core engine against accessible and deliberately invalid label/contrast fixtures. Web/Admin instances scan their main configured route. Admin seeds also declare `/login`, `/dashboard` and `/missing-page` through `accessibilityPaths`; add business routes to preserved instance browser configuration as needed. Paths must stay on the local application origin.

Actual production popup/options pages are audited without relaxing extension CSP. Scans cover light/dark themes and desktop/mobile widths and check automatically detectable WCAG 2 A/AA, 2.1 A/AA and 2.2 AA rules. Violations and manual-review findings are retained; no failing rules are disabled. The engine is a root development dependency and is not bundled into applications. Existing keyboard, focus, recovery and business assertions still run; automated scans do not establish complete accessibility conformance.

Each instance report needs successful, nonempty accessibility coverage. Missing/empty/failed/stale evidence fails the browser gate. `accessibility.jsonl` contains rule IDs, selectors and failure summaries, without page HTML or form values. CI retains it alongside reports/logs/screenshots. `pnpm test:accessibility` runs the small real-engine regression. Ordinary `pnpm check` includes pure configuration/report tests and does not launch Chromium. See [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing).

`test:web-admin` creates source copies and local Git boundaries under `.reinit/verification/web-admin-*/`, installs offline from the lockfile, and rebuilds Web / Admin. Next.js production and Vite preview servers verify English page content, language metadata, accessible GitHub icon links, bundled Inter, shared component styles, theme interactions, and browser / console / resource errors. Web additionally verifies the responsive site template, navigation drawer / keyboard recovery, section links and documentation links at 320 / 390 / 768 / 1280px, invalid stored themes before hydration, invalid cross-tab updates, cleared storage, and unavailable storage. Simulated storage quota failures cover valid and invalid saved preferences, first paint without hydration, system changes, manual switching, reloads, and preservation of unrelated stored data. Admin additionally verifies its centered homepage, login and dashboard templates, native email validation, client-side navigation, deep links / reloads, unknown routes, and responsive drawer / menu behavior at the same widths. Separate fault contexts intercept real login / dashboard production chunks to verify recovery from HTTP and network errors, return-to-home navigation, and refresh retry; normal-page error checks remain strict. Reports, server logs, and screenshots remain in that directory. Tests close their own browsers and processes and verify the original source is unchanged.

### Custom business browser assertions

The default browser regressions also cross the desktop breakpoint with Web navigation open, then return to mobile and verify that the old dialog stays closed. Admin checks collapsed and expanded sidebar preferences after reloads and route remounts, invalid cookies, and denied cookie reads / writes. Extension concurrency checks delay a real storage-write response while another extension page writes a newer name, covering both completed and pending reads; Settings, Popup, and storage must converge on the latest value. These checks run in the normal browser suites and therefore in reinit's required pre-promotion gates.

Each `apps/<id>/browser-tests.config.mts` owns its instance's page titles, layouts, routes, background expectations, and application HMR edit. The root file provides optional overrides keyed by instance id. When replacing the demo pages with product screens, update this file with assertions for the actual business behavior. It is preserved across reinit, copied into browser verification workspaces, and loaded after installing the candidate's dependencies.

| Configuration                  | Contract                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `web.path`, `admin.path`       | A path on the local application's origin, such as `/workspace`; external URLs are rejected                                                 |
| `web.verify`, `admin.verify`   | Required async business checks; receive `{ page, browser, pageFor, url, runDir, errors, passed }`                                          |
| `admin.verifyRoutes`           | Required route / navigation assertions; receives `{ pageFor, url, runDir, errors, passed }`, where `url` is Admin's origin                 |
| `extension.verifyPage`         | Required popup / options assertions; receives `{ page, kind }`                                                                             |
| `extension.verifyBackground`   | Required background initialization assertions; receives `{ page, until }`                                                                  |
| `extension.verifyInteractions` | Optional settings / business interactions in development and production; receives `{ popup, options, until, runDir, profile }`             |
| `extension.verifyPreview`      | Optional ordinary browser UI preview assertions; receives `{ page, until, runDir }`                                                        |
| `extension.hmr`                | `{ file, update(source), verify({ page, popup }) }`; selects an extension source file, produces a real change, and waits for its UI update |

The default hooks check the Web, Admin, and Extension templates. Missing required hooks, invalid optional hooks / paths, and unchanged HMR edits fail instead of silently skipping checks. Do not replace hooks with no-ops: replace the starter assertions with meaningful business assertions. The configured Web / Admin pages and extension pages must expose the shared theme switcher. Keep the interaction and preview hooks while using the built-in extension settings templates.

The runners always retain theme and persistence tests, shared UI / CSS HMR, React state preservation without storage persistence or full-page navigation, extension storage round trips, production loading, runtime / console error checks, and original-source fingerprints. HMR writes only to the isolated extension source and restores it before the production build; it no longer assumes a particular business title or `src/App.tsx` in the runner. There is no flag to bypass the reinit browser gates.

### Real reinit acceptance

The **Reinit acceptance** workflow is manual (`workflow_dispatch`), separate from ordinary CI. After this workflow reaches the default branch, select it in GitHub Actions and choose **Run workflow**. It executes the same `pnpm test:reinit` command available locally; it does not commit, push, or publish anything.

The command copies the current source into `.reinit/verification/reinit-*/workspace`, installs the current lockfile offline, adds untracked business / environment preservation probes, and runs the real `reinit --apply` with official generators and online dependency resolution. It then runs `reinit --apply --offline` and checks that generator versions and dependency decisions match the online result. Both runs include all existing candidate checks, browser gates, promotion, and final-location checks. Source snapshots verify business files, shared components, editor settings, and custom browser hooks remain unchanged. Finally, a real CLI rejection of an ESLint 9 offline receipt must preserve the temporary project's source, manifests, and lockfile. The user's original source is fingerprinted separately and must remain unchanged.

Install Chromium before running locally, as for the other browser suites. This acceptance command requires registry access, generator / dependency downloads, enough disk space for nested isolated workspaces, and substantially more time than ordinary CI. `REINIT_TEST_COMMAND_TIMEOUT_MS` sets the timeout of each outer reinit command (default 30 minutes); `REINIT_COMMAND_TIMEOUT_MS` continues to govern its individual commands. GitHub uploads only reports, logs, and screenshots, excluding source copies, environment files, browser profiles, and dependencies. Successful workspace copies participate in the existing cleanup retention policy.

Both browser suites record individual source-copy, installation, build, browser-launch, and assertion phase durations in `report.json`, including the failing phase when a normal failure or handled cancellation occurs. Long phases print progress every 30 seconds. These timings help distinguish local copy / build / browser work from registry or download delays; increasing a timeout alone does not diagnose a slow phase. Forced termination can prevent the browser report from being finalized, so also retain the reinit report and console log.

Default test ports are 3150 / 3151. Override with distinct `WEB_TEST_PORT` / `ADMIN_TEST_PORT` values; availability is checked before starting. Page workers use a five-minute child-command timeout; it does not set the duration of the entire suite. Pause editing during tests to avoid fingerprint mismatches.

`test:extension` creates a source copy and isolated Chromium profiles under `.reinit/verification/`. Port 3102 tests actual extension loading, background initialization, popup / options, storage round trips, and page / shared component / shared style HMR with React state preservation. The starter's interaction hook also checks workspace-name validation / trimming, real UI saves, persistence, live popup updates, unsaved drafts, injected read / write failures and retry, the actual **Open settings** action and its failure recovery, long-name wrapping, and options layouts at 320 / 390 / 768 / 1280px. It stops the dev server, rebuilds production output, then repeats interactions during independent production loading and rejects external HTTP requests. The optional preview hook subsequently checks ordinary browser popup / options navigation and separate localStorage persistence. Only copies are modified; logs, screenshots, and `report.json` are retained. Install root dependencies first; copies install offline from the lockfile. Pause editing for the final source fingerprint check. `EXTENSION_TEST_PORT` overrides the port; `EXTENSION_TEST_COMMAND_TIMEOUT_MS` sets each child-command timeout, defaulting to 3 minutes. Cancellation closes test processes and browsers.

Production output checks resolve static imports, re-exports, and string dynamic imports from every emitted JS file, rejecting missing, remote, or escaping resources. Computed runtime paths still require browser coverage.

`pnpm check` does not launch browsers. Reinit separately requires the complete registered browser suite before replacement. Run `pnpm test:extension` after Vite / CRXJS changes. Automated tests use Playwright Chromium; Chrome / Edge extension management and store publication still require verification in those browsers.

Configuration tests invoke TypeScript, ESLint, and Oxlint to verify path / environment resolution, rejected Hooks violations, inherited rule arguments, and preservation of new upstream options during reinit. Next.js configuration tests load normalized settings before requesting the cached raw module through the installed framework's TypeScript loader, preserving both normal and low-resource assertions; Node's module-type fallback warning fails the regression. New Web template seeds include the same check. Engineering regression tests use native `.test.mts` execution. Additional checks exercise nested TypeScript commands without installed dependencies, rejection of invalid process / dependency / browser contracts and non-erasable syntax, inherited lint rules, and preservation of recovery flags when reporting unknown failures.

Nested process fixtures give successful startup and ownership scenarios a bounded 15-second budget and use the production five-second process-exit grace period. Deliberate timeout cases explicitly retain their shorter command deadlines; uncertain-registration probes keep a short grace period. Writer fallback shutdown occurs after the command and cleanup budgets, so a natural exit cannot satisfy cleanup assertions. Process-exit, stopped-write, sibling isolation, and rollback assertions remain required.

Command cancellation regressions cover transient permission errors when sending either SIGTERM or SIGKILL to an owned process group. The fixture exits independently, then cleanup must observe a real ESRCH before settling; a permission error alone cannot establish exit. Persistent signal / probe denial must exhaust the bounded grace periods, reject cleanup as unsafe to restore, and retain ownership records while the fixture remains alive.

Lint-scope regressions require real Hooks / TypeScript violations in nested business directories named `dist`, `dist-dev`, `.turbo`, `.reinit`, or `coverage` to fail, while corresponding root / workspace build outputs remain ignored. Sidebar preference unit tests cover exact cookie matching, fallback values, persistence attributes, unavailable storage, and non-browser execution. Browser tests open mobile drawers across repeated 320 / 390 / 767 / 768 / 1280px transitions and verify they stay closed on return, retain both desktop preferences through reloads, keep page content mounted, and remain keyboard-accessible. Existing application agent instructions are also checked for exact preservation over conflicting generated instructions during template refreshes.

Web and Admin theme isolation tests use native storage events from a same-origin iframe. Session preferences, invalid names, removals, clears, unknown-area synthetic events, and unavailable localStorage must not alter the selected theme or crash the page. Real local preferences still synchronize; unrelated business events and storage-clear notifications remain available. Security regressions also check the fixed IP parser versions and bound malformed-input execution in a child process. Reinit preservation tests include these shared components, security tests, and browser assertions, so the same checks run before replacement.

## Continuous integration

`.github/workflows/ci.yml` runs frozen installation, `pnpm check`, and `pnpm audit:security` on push/pull request. The stable `browser` job derives its expected instances from the registry and runs them sequentially through `pnpm test:browser`. It rejects missing, duplicate, skipped or stale reports. Reports, logs and screenshots are retained for seven days without uploading source, environment files, profiles or dependencies. The workflow has no deployment step.

Application-specific unit regressions live with their instance, so removing a client does not leave root tests importing deleted source. Root tests cover configuration, template adapters, dependencies, recovery and cleanup with independent fixtures. Recovery regressions inject real `SIGKILL` interruptions into promotion and rollback boundaries and check repeated recovery and conflicting-edit preservation. [Composition lifecycle](applications.md) describes the registry and namespace contracts.

Cleanup regressions use disposable flat and multi-instance report trees. They verify retention windows, removal of expired copies / profiles, preservation of every report / log / screenshot and unlisted directory, and protection for failed, missing, malformed, mismatched, linked or locked instance data. Theme synchronization regressions cover empty, Web-only and multiple Vite compositions, seed creation, repeated synchronization, and preservation of updated seed assets through the same source-integration helper used by app add. Custom or linked destinations fail before any asset is updated. These fixtures run in `pnpm test`; they do not generate official templates, start Chromium, or clean real maintenance data.

The [Security audit workflow](../.github/workflows/security-audit.yml) runs weekly and on manual dispatch. [Dependabot](../.github/dependabot.yml) maintains GitHub Actions versions. See [Dependency security](security.md#scheduled-checks) for their schedules and scope; npm dependency upgrades remain part of reinit.

## 扩展统一通信

Web、popup、options、side panel 和隔离 content agent 共用版本化 SDK，由 Service Worker 集中路由与按文档授权。接入与安全边界见 [通信指南](extension-communication.md)。Web 示例位于 `/extension`；生产站点和自定义端口必须显式配置精确 origin，不自动扩大信任。共享包、side panel 入口和 manifest 随独立种子及 reinit 保留，生产检查覆盖通信入口策略。协议回归与真实浏览器的后台终止/恢复、撤权和风暴验收分别记录；资源不足时不启动重型验证。
