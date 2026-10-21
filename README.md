# browser-client

A pnpm monorepo with Next.js Web, Vite Admin, and a Vite / CRXJS Chrome / Edge extension. All three clients share shadcn/ui components and Tailwind CSS v4 themes from `packages/ui`.

## Getting started

Requires **Node.js 24 LTS** and **pnpm 11.25.0**, pinned by `packageManager`. `.tool-versions` pins Node for mise / asdf, and `.node-version` specifies Node 24. With mise installed, run `mise install` first, or use `mise exec node@24 -- pnpm install`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

| Client               | Command                  | URL or output                               |
| -------------------- | ------------------------ | ------------------------------------------- |
| Web                  | `pnpm dev:web`           | http://127.0.0.1:3000                       |
| Admin                | `pnpm dev:admin`         | http://127.0.0.1:5173                       |
| Extension            | `pnpm dev:extension`     | Load `apps/extension/dist-dev`; HMR enabled |
| Extension UI preview | `pnpm preview:extension` | http://127.0.0.1:5174                       |

`pnpm dev` starts the first three services. Development servers listen on localhost. Each client uses the shared `ClientPage` from `packages/ui`, displaying `Web Client`, `Admin Client`, or `Extension Client` above a GitHub icon linking to this repository. Content is centered horizontally and vertically, with a theme switcher in the top right. The extension popup uses a compact 360 × 280 layout; options and the UI preview fill the viewport. The starter has no backend, authentication, or production data.

English is the default for UI text, accessibility labels, page metadata, extension descriptions, documentation, and development command output. HTML documents use `lang="en"`.

## Admin templates

Admin keeps its starter homepage at `/` and provides links to two ready-to-customize shadcn blocks:

| Route        | Official block                                                | Behavior                                                                                                        |
| ------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/login`     | [login-05](https://ui.shadcn.com/blocks/login#login-05)       | Email form with Apple / Google buttons; a centered, single-column layout with stacked buttons on narrow screens |
| `/dashboard` | [sidebar-08](https://ui.shadcn.com/blocks/sidebar#sidebar-08) | Inset dashboard shell, collapsible navigation, project / user menus, breadcrumbs, and content placeholders      |

Both use the existing Base UI / base-nova style, English text, and shared light / dark / system theme switcher. Below 768px, the sidebar becomes a modal drawer with a visible close button, backdrop dismissal, Escape handling, and focus restoration. Summary placeholders stack on mobile. Desktop navigation supports the sidebar toggle and Ctrl / Cmd + B.

These are UI templates. Email / social sign-in, registration, and legal-policy buttons show explicit setup messages without sending credentials or creating a session. Dashboard navigation and menu actions are example placeholders; replace them when adding application features. The user menu's **Back to login** opens the template without implying a real logout. Neither route is access-controlled.

Page and block source lives in `apps/admin/src/pages/` and `apps/admin/src/components/`; reusable primitives, the responsive hook, and sidebar colors live in `packages/ui`. React Router handles navigation, browser history, deep links, and the not-found page. Production hosts must rewrite non-asset routes such as `/login` and `/dashboard` to Admin's `index.html`; Vite development and preview already provide this SPA fallback.

Lazy route failures show a responsive recovery page with **Refresh page** and **Back to home** actions. Refresh starts a new document so a failed module import can be retried; returning home resets the route boundary while preserving the theme. Recovery is user initiated and does not automatically reload unsaved work.

Reinit preserves these source directories, shared UI, and Admin-specific router / icon dependencies. Its required browser suite checks both templates before replacement, including form behavior, theme changes, direct URL reloads, mobile drawers, menus, and horizontal overflow at 320 / 390 / 768 / 1280px.

## Project structure

```text
apps/
  web/          # Next.js App Router + TypeScript
  admin/        # Official Vite React TypeScript template
  extension/    # Official Vite React TypeScript template + CRXJS + Manifest V3
packages/
  ui/           # Shared shadcn/ui components, utilities, and themes
  typescript-config/ # Base / React / Next.js / Vite TypeScript presets
  eslint-config/     # Shared ESLint configuration combined with framework rules
  oxlint-config/     # React application and shared UI Oxlint presets
scripts/
  reinit.mjs    # Rebuild from the latest official templates
  clean-reinit.mjs # Preview and remove old successful backups / browser workspaces
  lib/          # Template integration, dependencies, commands, migration, and recovery
  tests/        # Source preservation and failure recovery tests
template-versions.json  # Generator versions, timestamps, and dependency decisions
```

The project retains official template tooling: Web uses ESLint; Vite applications use Oxlint. Turborepo schedules builds, lint, and type checks. `pnpm-lock.yaml` is the only dependency lockfile.

## Shared configuration

Shared rules live in `packages/` and are consumed through `workspace:*` development dependencies. Applications retain environment-specific and path-specific settings:

| Consumer                | TypeScript preset                                  | Lint configuration                                                   |
| ----------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| Web                     | `@browser-client/typescript-config/nextjs.json`    | `@browser-client/eslint-config/base` + official Next.js rules        |
| Admin / Extension pages | `@browser-client/typescript-config/vite.json`      | `@browser-client/oxlint-config/react-app.json`                       |
| Vite configuration      | `@browser-client/typescript-config/vite-node.json` | Same lint rules as its application                                   |
| UI                      | `@browser-client/typescript-config/react.json`     | `@browser-client/oxlint-config/react.json`, including Unicorn checks |

`base.json` supplies strict checking, `skipLibCheck`, and `noEmit`; React, Next.js, and Vite presets extend it. `vite-common.json` shares options between page and build configurations. Keep `paths`, environment `types`, `include/exclude`, project references, `tsBuildInfoFile`, and the Next.js plugin in each consumer so relative paths resolve correctly. Local application settings override shared defaults.

The ESLint package shares generated-file ignores and unused-disable checks without coupling to a Next.js version. The Web template manages Next.js rules and their dependencies. Oxlint's React preset shares Hooks rules; the application preset adds Fast Refresh checks. Shared UI can export both components and utilities. Oxlint JSON `extends` currently uses file paths, so consumers reference `./node_modules/@browser-client/oxlint-config/...`.

```json
{
  "extends": "@browser-client/typescript-config/vite.json",
  "compilerOptions": {
    "types": ["vite/client", "chrome"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

Run `pnpm check` after changing shared rules. All three configuration packages are included in Turbo's `globalDependencies`, invalidating affected checks and build caches. Root scripts and the root ESLint configuration use the shared `node` preset; run `pnpm lint:scripts` independently when needed.

Each application's `.env*` files are build cache inputs. Store them in the corresponding application and keep real values out of Git. Turbo recognizes `NEXT_PUBLIC_*` / `VITE_*`; add future build-affecting server variables to `build.env`. `EXTENSION_DEV_PORT` is passed through to the extension service started by `pnpm dev`.

`reinit` reconnects the shared presets and their package dependencies. Project-managed TypeScript options and Oxlint rules take precedence over template defaults; differences are reported. New upstream options, additional inheritance, environment types, and lint overrides are preserved. Integration lives in `scripts/lib/tooling.mjs`. Edit shared rules in configuration packages and framework adapters in scripts to retain changes across reinit. Direct application overrides remain temporary because framework configuration is regenerated.

## Formatting and editors

The root `.prettierrc.json` formats applications, shared packages, and scripts with two spaces, double quotes, no semicolons, and a 128-column width. Prettier is installed locally and pinned. The Tailwind plugin reads the v4 theme from `packages/ui/src/styles/globals.css` and sorts classes in JSX, `cn`, `clsx`, and `cva`. No separate formatting package or per-workspace installation is required.

```sh
pnpm format          # Format source, configuration, and documentation
pnpm format:check    # Check only; included in pnpm check and CI
```

Both commands explicitly use `.prettierignore`, keeping formatting exclusions independent from Git rules. Exclusions cover workspace build outputs, dependencies, lockfiles, generated version records, static `public/` assets, private `.reinit/` data, patches, and `AGENTS.md`. Static assets and repository instructions are not reformatted. `.editorconfig` sets UTF-8, LF, two spaces, and a final newline while preserving meaningful Markdown and patch whitespace.

Open the repository root in VS Code and install the recommended Prettier, ESLint, Oxc, and Tailwind CSS IntelliSense extensions from `.vscode/extensions.json`. Saving uses local Prettier and the appropriate lint fixes. Web and scripts use ESLint; the root `.oxlintrc.json` excludes them from Oxc editor checks. Admin, Extension, and UI keep their shared rules. Root Oxlint uses the same catalog version as the applications so the editor can locate its language service. Oxfmt formatting and TypeScript Nightly are disabled; final type checks use each workspace's pinned TypeScript. Recommendations do not automatically install extensions or change personal settings.

After installing the isolated candidate, online `reinit` performs a strict frozen-lockfile install to verify the complete locked graph and cache the supply-chain metadata needed by the offline browser copies. It then formats regenerated application configuration and updated root configuration / workspace manifests, and runs full checks and browser tests. It does not rewrite application source, shared shadcn/ui, manifests, static assets, or editor settings. Formatting dependencies participate in compatible online upgrades; offline mode replays recorded versions. If metadata is unavailable, updated rules require source changes, or generated configuration cannot be formatted, validation stops and preserves the original project. Review formatting changes before retrying. After adding formatting dependencies, a successful online reinit is needed to record them for offline replay.

## Shared dependency versions

`pnpm-workspace.yaml` catalogs manage React, React DOM, React types, Tailwind, Oxlint, ESLint, shadcn, and Lucide icons. Consumers use `catalog:`; `catalog:next` and `catalog:vite` manage framework toolchains. Admin and shared UI consume the same Lucide catalog version. Applications declare Next.js, Vite, framework plugins, and CRXJS. Online reinit upgrades catalogs, root tooling, and direct dependencies in `packages/*` to verified exact versions while preserving shared component source, exports, scripts, and peer contracts.

Regular installs follow the lockfile. Online reinit selects stable releases from each publisher's latest channel, excludes beta / rc prereleases, and does not follow next channels. Next.js, Vite, and CRXJS must use the latest stable versions. Shared dependencies fall back to the highest stable version satisfying Node engines, template toolchains, and peer contracts, with reasons recorded. React / React DOM versions must match. Node types follow the active Node major. TypeScript retains template requirements, and toolchains for applications outside the rebuild retain their compatible ranges.

New deprecated versions are rejected. If compatibility requires retaining an already-used deprecated release, the receipt records its status. Decisions and reasons live in `template-versions.json#dependencies`. Strict peer installation, resolved-lockfile verification, full checks, and online security auditing follow dependency solving. Incompatibility stops replacement without downgrading Next / Vite / CRXJS or treating old caches as online latest.

The project uses ESLint 10. Shared peer contracts and catalog development dependencies align its version; Web retains all official Next.js Core Web Vitals / TypeScript rules. Template ESLint defaults are not hard constraints: actual configuration peers, strict installation, and rule regression tests determine compatibility. Next 16.4.1 provides an [ESLint 10 rule context compatibility layer](https://github.com/vercel/next.js/blob/v16.4.1/packages/eslint-config-next/src/rule-context.ts). React 7.37.5, Import 2.32.0, and JSX a11y 6.10.2 do not declare ESLint 10 peers upstream, so `peerDependencyRules.allowedVersions` grants exceptions only to those exact plugin versions; other peers remain strict. `pnpm test` executes React, Hooks, accessibility, Import, Next, and TypeScript rules, including valid shared shadcn/ui usage. Future plugin upgrades must pass the same checks without automatically broadening exceptions.

ESLint's minimum version is `10.0.0`; the current shared configuration peer is `^10`. Online solving, offline receipts, legacy lockfiles without receipts, and the installed dependency graph all enforce this floor. Cached or previously installed ESLint 9 is rejected even without a deprecation marker. Failure to find a compatible combination preserves the original project. Offline records below the floor or without a verifiable version require an online reinit first. Installed-version checks happen before replacement; final validation failures restore the backup.

Application-specific dependencies remain at their locked versions unless they are explicitly managed by the starter. Admin's built-in `react-router` participates in every online reinit, including rebuilds of other targets. Its verified integration range is `^8.0.0`; Node engines and peer requirements further constrain selection to the highest compatible stable release. A new router major requires an explicit integration update and browser validation. Other user-added application dependencies remain locked. The policy migration records the existing router version as an offline baseline without claiming a new registry query; subsequent online runs resolve it normally. Missing or incompatible offline receipts stop before replacement.

Shared UI dependencies, including Base UI, icons, styling utilities, and shadcn CLI, participate in upgrades without regenerating existing components. Node / pnpm versions, application source, and APIs are not automatically migrated. Version policy lives in `scripts/lib/updates.mjs`; catalog integration lives in `scripts/lib/catalogs.mjs`.

### Dependency security

```sh
pnpm audit:security
pnpm audit --prod
```

shadcn CLI is a root and UI development dependency; `shadcn/tailwind.css` still resolves during builds. Its transitive `braces@3.0.3` dependency has no upstream fix for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). `patches/braces@3.0.3.patch` limits parser and recursive AST traversal depth for both strings and direct AST inputs. The patch is registered in `pnpm-workspace.yaml#patchedDependencies`, pinned in the single lockfile, and preserved by reinit.

Raw `pnpm audit` uses package versions and may still report this advisory. `audit:security` first verifies the patch hash, lockfile coverage, and installed behavior, then reads the complete audit response. Only the verified `3.0.3` instance of this GHSA is classified as locally mitigated; no global ignore list is applied. Other packages, versions, advisories, or registry errors fail the check. Regression tests are included in `pnpm check`. The patch addresses recursion depth, not arbitrary glob / regular-expression resource consumption.

When an upstream fix becomes available, upgrade and remove the patch and its verification policy together. Removing an advisory record or changing a version string does not establish a fix.

## shadcn/ui

Uses the official [shadcn preset `b0`](https://ui.shadcn.com/create?preset=b0): Nova style, Neutral theme / base and chart colors, Inter font, Lucide icons, default radius and menu color, and subtle menu accents. The existing Base UI foundation is retained. Each application's `components.json` points to the shared UI package and uses the same preset settings.

Preset CSS and primitives are generated with the official `shadcn apply --preset b0` command. Inter is bundled through `@fontsource-variable/inter` in the shared UI package, so Web, Admin, popup, and options use the same font without Google Fonts or other external font requests. Shared components retain their Next.js client boundaries and responsive drawer behavior. Run `pnpm exec shadcn preset resolve --json --cwd apps/admin` to verify the project resolves to `b0` without fallbacks. Reinit preserves this shared source and regenerates application shadcn configuration from `packages/ui/components.json`.

```sh
# Resolve from Web; shared primitives are written to packages/ui
pnpm ui:add dialog

# Add page blocks from the corresponding application
pnpm exec shadcn add login-01 --cwd apps/admin
```

```tsx
import { Button } from "@browser-client/ui/components/button"
```

Themes live in `packages/ui/src/styles/globals.css`. Applications use `@source` to scan their own source; shared styles also scan UI source. Shared components using React hooks or interaction must declare `"use client"` for Next.js Server Component compatibility. Run `pnpm check` after adding components.

## Light and dark themes

Web, Admin, extension popup, and options provide a top-right `Toggle theme` button using the shared shadcn `Button` and `DropdownMenu`. The radio menu offers `Light`, `Dark`, and `System`, defaulting to `System`. It marks the current selection and supports keyboard navigation, Escape, and focus restoration. Clients share colors, context, and `ThemeSwitcher` from `packages/ui`. Web uses `next-themes` for Next.js SSR; Vite pages use the shared `ThemeProvider`. Native form controls follow the active `color-scheme`.

Preferences are stored per origin in `localStorage["browser-client-theme"]` and survive reloads. Same-origin tabs and popup / options within one extension synchronize changes. Web and Admin use different ports and therefore keep separate preferences. System mode follows live OS changes; manual selection takes priority. Pages remain usable when local storage is disabled. Web removes invalid stored preferences before the first theme script, falling back to `system` even when writes exceed the storage quota, and intercepts invalid cross-tab updates before next-themes applies them to the DOM. Other stored data and valid preferences are retained. If writes fail, manual changes still apply to the current page but cannot persist across reloads. Clearing storage also restores system mode.

Web applies its theme before hydration and uses `suppressHydrationWarning` on `html` for theme-related attribute differences. Admin and Extension use a blocking external `theme-init.js` in `<head>` before React runs. The extension retains strict Manifest V3 CSP without inline scripts or additional permissions. Bootstrap source lives in `packages/ui/src/lib/theme-init.js`; committed copies live in both Vite applications' `public/` directories. Run `pnpm theme:sync` after editing it. Regression tests verify identical copies and script ordering.

`reinit` preserves root layouts, page entries, HTML, bootstrap assets, and shared theme components. `next-themes` participates in compatible shared dependency upgrades. Browser tests cover switching, persistence, same-origin synchronization, OS changes, early first paint, and unavailable storage; extension tests also cover actual loading, CSP, and HMR.

## Browser extension

1. Run `pnpm dev:extension` and keep the service running.
2. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select `apps/extension/dist-dev`.
4. Open the popup from the extension icon; use **Extension options** in the extension management page to open options. Both show centered `Extension Client` content and a GitHub icon link, with theme switching. The background retains a `chrome.storage.local` initialization example for future application code.

`manifest.config.ts`, using CRXJS `defineManifest`, is the only manifest source. `src/background.ts`, `index.html`, and `options.html` are the background, popup, and options entries. CRXJS discovers entries and generates resource paths from the manifest; do not add another manifest under `public/`.

Popup / options support React Fast Refresh, including shared UI components and styles. Ordinary component edits can retain React state. Background or manifest changes may reload the extension and reset state. CRXJS injects localhost development connections, permissions, and CSP into development output only. The default port is 5174. Override it with `EXTENSION_DEV_PORT=3202 pnpm dev:extension` to keep HTTP and WebSocket ports synchronized; do not override only `--port`.

Build production output with `pnpm --filter @browser-client/extension build` and load or package `apps/extension/dist`. Production is independent of the development server, retains only `storage` permission and strict CSP, and has no content scripts, website host permissions, or HMR client. **Publish `dist`, not `dist-dev`.** Reload the extension manually after rebuilding production output.

`pnpm preview:extension` previews UI in a normal web page without CRXJS or extension APIs. It shares the extension development port, so run only one of these services at a time.

## reinit: rebuild from official templates

Following HomeFull's rebuild-and-restore approach, reinit preserves current files on disk, including uncommitted and untracked source, without relying on Git commits or `git restore`.

```sh
pnpm reinit                  # Show the plan without network access or writes
pnpm reinit web --dry-run    # Preview a specific target
pnpm reinit --apply          # Rebuild all three applications
pnpm reinit admin --apply    # Refresh Admin and shared dependencies; check all applications
pnpm reinit extension --apply
pnpm reinit --apply --offline # Replay recorded, cached versions without querying latest
```

Stop development / build processes and pause editing before applying reinit. The workflow:

1. Acquire a lock and fingerprint source contents, paths, types, and permissions. Separate file digests prevent content from impersonating adjacent records. Resolve stable versions from the official `create-next-app` / `create-vite` latest channels.
2. Create an isolated workspace under `.reinit/staging/<id>` and run the exact generator versions without creating AGENTS.md. Initialize a local Git boundary so parent ignore rules cannot hide source from checks. No commits or remotes are created; original Git metadata is preserved. Git is required.
3. Solve latest stable framework, CRXJS, and shared dependency constraints against templates, Node, and peers. Record reasons for any shared dependency fallback. Update catalogs and manifests, restore application files, and reconnect workspaces, TypeScript / lint presets, shadcn/ui, Tailwind, and CRXJS while preserving `manifest.config.ts`.
4. Install with strict peers, verify resolved versions, and run `pnpm check`, including actual Vite / CRXJS compatibility. Online mode also runs `pnpm audit:security` and prepares Chromium using the candidate's Playwright version. Both `pnpm test:web-admin` and `pnpm test:extension` must pass for every target, including a single-application rebuild, because shared dependencies can affect all clients. Missing browsers, test failures, or cleanup failures stop replacement. A final fingerprint check rejects concurrent edits to the original workspace.
5. Move original apps, packages, root `package.json`, `pnpm-workspace.yaml`, node_modules, lockfile, and version records into `.reinit/backups/<id>`, then install the validated candidate directories.
6. Run a strict frozen-lockfile install and checks at the final location. Online mode retains network access for pnpm supply-chain metadata checks; offline mode uses cached data only. Failure restores original directories, retaining backups and failed candidates for diagnosis.

| Content                                                                                                                    | Rebuild behavior                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`, `public/`, `.env*`, `manifest.config.ts`, HTML entries, tests, and application files                               | Preserve from disk, replacing entire template demo directories                                                                                                                                                         |
| Component / configuration source, exports, scripts, and peer contracts in `packages/`; root documentation and Git metadata | Preserve; shared UI is not reinitialized                                                                                                                                                                               |
| Direct dependencies in root / `packages/*/package.json` and workspace catalogs                                             | Upgrade online to highest compatible stable versions, preserving other fields and workspace settings                                                                                                                   |
| Application `package.json`                                                                                                 | Preserve nonstandard scripts, custom fields, and project versions; update explicit starter-managed dependencies, retain other application dependencies, and prefer official template dependencies and standard scripts |
| Application `tsconfig*.json`, `next/vite/eslint/postcss.config.*`, `.oxlintrc.json`, `next-env.d.ts`, `components.json`    | Regenerate using the new template and integration adapters                                                                                                                                                             |
| Application `README.md`, `.gitignore`                                                                                      | Use the new template; normalize generated-directory ignores and environment-example exceptions; keep project documentation in the root README or docs                                                                  |
| Nested application `pnpm-workspace.yaml` and lockfiles                                                                     | Remove in favor of the repository's single workspace and lockfile                                                                                                                                                      |
| Generated `node_modules`, `.next`, `dist`, `dist-dev`, `.turbo`, `*.tsbuildinfo` at repository / workspace roots           | Regenerate; only exclude at those boundaries. Application paths such as `public/dist/`, `src/dist/`, and matching names within shared source are preserved and fingerprinted                                           |

Git build-output rules are anchored at repository and workspace boundaries. Business paths such as `public/dist/`, `src/dist/`, and `src/cache.tsbuildinfo` remain committable. Real `.env*` files stay ignored; sanitized `.env.example` and `.env.*.example` files can be committed in every application. `scripts/lib/gitignore.mjs` reapplies this policy to fresh official templates while retaining other upstream exclusions. Tests invoke Git itself to verify both business paths and ignored build outputs.

Persist custom framework configuration in `scripts/lib/integrate.mjs`; otherwise it remains only in backups. Reinit updates framework foundations while preserving application source; it does not automatically migrate application APIs. Incompatible upstream structures or APIs stop at staging so adapters or source can be adjusted before retrying. Generator versions are recorded in `template-versions.json` on each successful generation; ordinary installs follow the lockfile.

Extension reinit uses the latest stable official `create-vite --template react-ts`, resolves latest stable Vite and CRXJS, then reconnects shared UI. Exact versions are saved to manifests and version records. Each online run queries again. Conflicting latest Vite / CRXJS peer ranges stop replacement and preserve the original project until compatibility or integration is resolved.

Dependency records follow current declarations. Reinit drops records for removed dependencies, workspaces, and catalog entries; online declaration moves replace the old records. Partial rebuilds retain records for unrebuilt applications and refresh them when their locked versions have changed, preserving later full offline replay without rewriting their dependency declarations. Offline replay can reuse an existing catalog record; missing records for new managed locations require an online rebuild first. Missing records still stop before replacement, and obsolete ESLint 9 records remain invalid in offline mode.

Use `--offline` explicitly when needed. It replays recorded templates and dependency decisions without registry queries, browser downloads, or online auditing. Complete an online reinit of all applications first to populate records and caches. Generators, dependencies, and the matching Chromium must be cached; missing records or caches stop the run. Prepare Chromium with `pnpm exec playwright install chromium`; on Linux, install missing system libraries following Playwright diagnostics. Older records without dependency receipts retain legacy behavior, marked `legacy-offline`, and still enforce the ESLint floor. Offline mode uses the same strict installation, browser tests, backup, and recovery steps. Default online failures do not fall back to old versions.

Browser reports, logs, and screenshots are written to the original project's `.reinit/verification/` and survive candidate replacement. Standalone browser tests use the same default; `BROWSER_TEST_OUTPUT_ROOT` can override their report parent. Reinit explicitly uses the original project's directory to retain diagnostics.

Every applied reinit also saves a private `.reinit/reports/reinit-<id>.json` with the target applications, online / offline mode, command and dependency-planning durations, total elapsed time, final status, and any failure / retained-lock information. Console output includes phase durations. Reports survive replacement and are not deleted by cleanup. A dry run creates no report or other files. Reports are diagnostics; backup journals remain the recovery authority after forced termination.

Captured command failures retain the diagnostic stdout tail in their error and maintenance report. Diagnostics remove terminal escapes, redact common credential formats and known sensitive environment values, and cap the command description at 1,024 characters and captured output at 4,096 characters. Successful captured JSON is returned unchanged; timeout, cancellation, and unsafe-recovery errors retain their existing identity and recovery behavior.

### Failure recovery and backups

Generation or staging-check failures leave original directories untouched. Final-location validation failures restore them. Ctrl-C / SIGTERM cancels the current command and its process tree, waits for exit, forces termination if necessary, then restores directories. If exit cannot be confirmed, the lock and workspace remain; automatic recovery is withheld to avoid concurrent writes. `scripts/lib/commands.mjs` also manages browser test commands.

Reinit commands have a default 10-minute total timeout; set `REINIT_COMMAND_TIMEOUT_MS` to a positive integer in milliseconds to override. Registry queries default to 30 seconds and install downloads to 120 seconds, with at most two retries and 1–5 second retry delays. Install network concurrency defaults to 4. pnpm 11 settings such as `pnpm_config_fetch_timeout` / `pnpm_config_fetch_retries` can override these defaults. `.reinit` is Git-ignored and may contain environment files; treat it as private local backup data. It is neither an off-disk backup nor a power-loss-atomic transaction.

pnpm may add exact `minimumReleaseAgeExclude` entries for explicitly selected new releases, including platform packages. These exceptions are backed up and rolled back with workspace configuration; release-age protection is not globally disabled. Temporary generator `dlx` exceptions are not copied into the project.

After a forced termination or power loss, inspect `.reinit/lock/owner.json` and the relevant backup `journal.json`, then confirm the locations of originals, backups, and candidates before recovering. **Do not simply delete locks or backups.** Normal failure releases the lock; backups are not automatically removed.

For manual recovery, stop related processes and move current `apps/`, `packages/`, `package.json`, `pnpm-workspace.yaml`, `node_modules/`, `pnpm-lock.yaml`, and `template-versions.json` to a new preservation directory. Restore matching paths from one successful backup according to `journal.json#paths`, then run `pnpm install --frozen-lockfile` and `pnpm check`. Older backups may omit root manifests or workspace settings; follow their journals and do not mix lockfiles and source from different snapshots.

### Cleaning old successful workspaces

```sh
pnpm reinit:clean                       # Preview; keep the latest 3 per category and the last 7 days
pnpm reinit:clean --sizes               # Also scan total, eligible and retained logical file sizes
pnpm reinit:clean --keep=1 --days=0      # Preview a smaller retention window
pnpm reinit:clean --keep=1 --days=0 --apply
```

Only successful backups and their staging directories beyond both retention limits are eligible. For successful browser verification records, cleanup removes workspace copies and profiles while retaining `report.json` and logs. Failed / incomplete recovery records, directories without valid records, and migration baselines are protected. Cleanup refuses an existing maintenance lock and acquires the same lock itself. At least one recent successful record per category is retained; symbolic links are rejected. Ctrl-C / SIGTERM finishes the current deletion, stops further cleanup, and releases the lock. Deleted old workspaces are not restored; SIGKILL or power loss requires manual lock inspection.

`--sizes` is optional because scanning large backup trees can take time. It reports data by top-level maintenance directory and estimates how much logical data is eligible under the existing retention policy. Symbolic links are measured without following their targets. Hard links and shared filesystem blocks mean logical sizes can exceed the disk space actually reclaimed. Preview remains read-only; `--sizes` does not change eligibility or delete failed workspaces.

## Validation

```sh
pnpm check       # Formatting, compatibility, tests, lint, types, all builds, and extension output
pnpm test        # Preservation, recovery, cancellation / timeouts, cleanup, catalogs, and configuration
pnpm lint:scripts
pnpm build

# Install the matching Chromium before the first browser test
pnpm exec playwright install chromium
pnpm test:extension
pnpm test:web-admin
pnpm test:reinit  # Slow: real online rebuild, offline replay, and rejection test in an isolated copy
pnpm audit:security
```

`test:web-admin` creates source copies and local Git boundaries under `.reinit/verification/web-admin-*/`, installs offline from the lockfile, and rebuilds Web / Admin. Next.js production and Vite preview servers verify English page content, language metadata, accessible GitHub icon links, shared component styles, desktop / mobile centering, theme interactions, and browser / console / resource errors. Web additionally verifies invalid stored themes before hydration, invalid cross-tab updates, cleared storage, and unavailable storage. Simulated storage quota failures cover valid and invalid saved preferences, first paint without hydration, system changes, manual switching, reloads, and preservation of unrelated stored data. Admin additionally verifies the login and dashboard templates, native email validation, client-side navigation, deep links / reloads, unknown routes, and responsive drawer / menu behavior at 320 / 390 / 768 / 1280px. Separate fault contexts intercept real login / dashboard production chunks to verify recovery from HTTP and network errors, return-to-home navigation, and refresh retry; normal-page error checks remain strict. Reports, server logs, and screenshots remain in that directory. Tests close their own browsers and processes and verify the original source is unchanged.

### Custom business browser assertions

`browser-tests.config.mjs` owns the starter's page titles, layouts, routes, background expectations, and application HMR edit. When replacing the demo pages with product screens, update this file with assertions for the actual business behavior. It is preserved across reinit, copied into browser verification workspaces, and loaded after installing the candidate's dependencies.

| Configuration                | Contract                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `web.path`, `admin.path`     | A path on the local application's origin, such as `/workspace`; external URLs are rejected                                                 |
| `web.verify`, `admin.verify` | Required async business checks; receive `{ page, browser, pageFor, url, runDir, errors, passed }`                                          |
| `admin.verifyRoutes`         | Required route / navigation assertions; receives `{ pageFor, url, runDir, errors, passed }`, where `url` is Admin's origin                 |
| `extension.verifyPage`       | Required popup / options assertions; receives `{ page, kind }`                                                                             |
| `extension.verifyBackground` | Required background initialization assertions; receives `{ page, until }`                                                                  |
| `extension.hmr`              | `{ file, update(source), verify({ page, popup }) }`; selects an extension source file, produces a real change, and waits for its UI update |

The default hooks retain every existing starter and Admin template assertion. Missing hooks, invalid paths, and unchanged HMR edits fail instead of silently skipping checks. Do not replace hooks with no-ops: replace the starter assertions with meaningful business assertions. The configured Web / Admin pages and extension pages must expose the shared theme switcher.

The runners always retain theme and persistence tests, shared UI / CSS HMR, React state preservation without storage persistence or full-page navigation, extension storage round trips, production loading, runtime / console error checks, and original-source fingerprints. HMR writes only to the isolated extension source and restores it before the production build; it no longer assumes a particular business title or `src/App.tsx` in the runner. There is no flag to bypass the reinit browser gates.

### Real reinit acceptance

The **Reinit acceptance** workflow is manual (`workflow_dispatch`), separate from ordinary CI. After this workflow reaches the default branch, select it in GitHub Actions and choose **Run workflow**. It executes the same `pnpm test:reinit` command available locally; it does not commit, push, or publish anything.

The command copies the current source into `.reinit/verification/reinit-*/workspace`, installs the current lockfile offline, adds untracked business / environment preservation probes, and runs the real `reinit --apply` with official generators and online dependency resolution. It then runs `reinit --apply --offline` and checks that generator versions and dependency decisions match the online result. Both runs include all existing candidate checks, browser gates, promotion, and final-location checks. Source snapshots verify business files, shared components, editor settings, and custom browser hooks remain unchanged. Finally, a real CLI rejection of an ESLint 9 offline receipt must preserve the temporary project's source, manifests, and lockfile. The user's original source is fingerprinted separately and must remain unchanged.

Install Chromium before running locally, as for the other browser suites. This acceptance command requires registry access, generator / dependency downloads, enough disk space for nested isolated workspaces, and substantially more time than ordinary CI. `REINIT_TEST_COMMAND_TIMEOUT_MS` sets the timeout of each outer reinit command (default 30 minutes); `REINIT_COMMAND_TIMEOUT_MS` continues to govern its individual commands. GitHub uploads only reports, logs, and screenshots, excluding source copies, environment files, browser profiles, and dependencies. Successful workspace copies participate in the existing cleanup retention policy.

Default test ports are 3150 / 3151. Override with distinct `WEB_TEST_PORT` / `ADMIN_TEST_PORT` values; availability is checked before starting. `WEB_ADMIN_TEST_COMMAND_TIMEOUT_MS` sets the command timeout, defaulting to 5 minutes. Pause editing during tests to avoid fingerprint mismatches.

`test:extension` creates a source copy and isolated Chromium profiles under `.reinit/verification/`. Port 3102 tests actual extension loading, background initialization, popup / options, storage round trips, and page / shared component / shared style HMR with React state preservation. It stops the dev server, rebuilds production output, then tests independent loading, runtime errors, and external HTTP requests. Only copies are modified; logs and `report.json` are retained. Install root dependencies first; copies install offline from the lockfile. Pause editing for the final source fingerprint check. `EXTENSION_TEST_PORT` overrides the port; `EXTENSION_TEST_COMMAND_TIMEOUT_MS` sets the command timeout, defaulting to 3 minutes. Cancellation closes test processes and browsers.

Production output checks resolve static imports, re-exports, and string dynamic imports from every emitted JS file, rejecting missing, remote, or escaping resources. Computed runtime paths still require browser coverage.

`pnpm check` does not launch browsers. Reinit separately requires both browser suites before replacement. Run `pnpm test:extension` after Vite / CRXJS changes. Automated tests use Playwright Chromium; Chrome / Edge extension management and store publication still require verification in those browsers.

Configuration tests invoke TypeScript, ESLint, and Oxlint to verify path / environment resolution, rejected Hooks violations, inherited rule arguments, and preservation of new upstream options during reinit.

## CI

`.github/workflows/ci.yml` runs frozen installation, `pnpm check`, and `pnpm audit:security` on push / pull request. Web / Admin production browser tests run in a separate job after base checks pass. Extension, shared package, script, dependency, or CI changes also trigger extension tests; first pushes and manual runs do too. Browser jobs retain reports, logs, and Web / Admin screenshots for 7 days without uploading source copies or profiles. The workflow validates the project and has no deployment step.

`.github/workflows/security-audit.yml` also runs frozen installation and the same patch-aware audit every Monday at 01:23 UTC (09:23 Asia/Shanghai), with a manual trigger available. The schedule takes effect on the default branch after publication; execution time depends on GitHub's scheduler. It checks the existing lockfile without upgrading dependencies or changing source. Unresolved advisories fail the workflow and remain visible in its logs.

`.github/dependabot.yml` checks GitHub Actions versions weekly and groups update pull requests. npm dependencies continue through the project's compatibility solver and required validation; Dependabot does not manage them or auto-merge updates.

## Official references

- [Next.js create-next-app](https://nextjs.org/docs/app/api-reference/cli/create-next-app)
- [Vite templates](https://vite.dev/guide/)
- [CRXJS installation and configuration](https://crxjs.dev/guide/installation/from-scratch/)
- [Vite WebSocket configuration](https://vite.dev/config/server-options.html#server-ws)
- [shadcn/ui monorepo](https://ui.shadcn.com/docs/monorepo)
- [Chrome Manifest V3 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [pnpm 11 configuration changes](https://pnpm.io/blog/releases/11.0)
- [pnpm catalogs](https://pnpm.io/catalogs)
- [Playwright Chrome extensions](https://playwright.dev/docs/chrome-extensions)
- [TypeScript configuration inheritance](https://www.typescriptlang.org/tsconfig/extends.html)
- [ESLint shareable configuration](https://eslint.org/docs/latest/extend/shareable-configs)
- [Oxlint configuration inheritance](https://oxc.rs/docs/guide/usage/linter/config.html#extend-shared-configs)
