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

Lint-scope regressions require real Hooks / TypeScript violations in nested business directories named `dist`, `dist-dev`, `.turbo`, `.reinit`, or `coverage` to fail, while corresponding root / workspace build outputs remain ignored. Sidebar preference unit tests cover exact cookie matching, fallback values, persistence attributes, unavailable storage, and non-browser execution. Browser tests open mobile drawers across repeated 320 / 390 / 767 / 768 / 1280px transitions and verify they stay closed on return, retain both desktop preferences through reloads, keep page content mounted, and remain keyboard-accessible. Existing application agent instructions are also checked for exact preservation over conflicting generated instructions during template refreshes.

Web and Admin theme isolation tests use native storage events from a same-origin iframe. Session preferences, invalid names, removals, clears, unknown-area synthetic events, and unavailable localStorage must not alter the selected theme or crash the page. Real local preferences still synchronize; unrelated business events and storage-clear notifications remain available. Security regressions also check the fixed IP parser versions and bound malformed-input execution in a child process. Reinit preservation tests include these shared components, security tests, and browser assertions, so the same checks run before replacement.

## Continuous integration

`.github/workflows/ci.yml` runs frozen installation, `pnpm check`, and `pnpm audit:security` on push/pull request. The stable `browser` job derives its expected instances from the registry and runs them sequentially through `pnpm test:browser`. It rejects missing, duplicate, skipped or stale reports. Reports, logs and screenshots are retained for seven days without uploading source, environment files, profiles or dependencies. The workflow has no deployment step.

Application-specific unit regressions live with their instance, so removing a client does not leave root tests importing deleted source. Root tests cover configuration, template adapters, dependencies, recovery and cleanup with independent fixtures. Recovery regressions inject real `SIGKILL` interruptions into promotion and rollback boundaries and check repeated recovery and conflicting-edit preservation. [Composition lifecycle](applications.md) describes the registry and namespace contracts.

The [Security audit workflow](../.github/workflows/security-audit.yml) runs weekly and on manual dispatch. [Dependabot](../.github/dependabot.yml) maintains GitHub Actions versions. See [Dependency security](security.md#scheduled-checks) for their schedules and scope; npm dependency upgrades remain part of reinit.
