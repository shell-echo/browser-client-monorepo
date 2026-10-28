# Development guide

[Project home](../README.md) · [Development](development.md) · [Reinit](reinit.md) · [Testing](testing.md) · [Security](security.md)

Production hosting, environment inputs and per-instance Extension ZIP packaging are covered in [Deployment and delivery](deployment.md).

Run commands from the repository root. Paths in this guide are relative to that root.

## Web template

The homepage includes a header, overview, feature cards, documentation links, and footer. Desktop navigation becomes a shadcn Sheet below 768px, with Escape / close controls and focus restoration. The page includes a keyboard skip link and adapts to 320px screens. Colors and typography come from the shared b0 preset; there is no additional brand palette.

The page remains a Next.js Server Component in `apps/web/src/app/page.tsx`; interactive navigation lives in `apps/web/src/components/site-header.tsx`. Customize these files for your product. Documentation links open this repository's README. Login, account management, and business features are intentionally left for application development.

## Extension templates

| Entry          | Purpose                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `index.html`   | Compact 360px popup with the current workspace, theme menu, GitHub icon, and **Open settings** action |
| `options.html` | Responsive settings page with a workspace-name form and shared theme menu                             |

Page components live in `apps/extension/src/pages/`. The settings adapter in `src/lib/settings.ts` reads and writes the existing `chrome.storage.local.workspaceName` key without requesting new permissions. Saving trims surrounding whitespace and accepts 1–80 characters. The popup follows storage changes without reloading. Unsaved settings drafts survive external updates and failed saves; load failures require a successful retry before an editable form is shown. **Open settings** uses `chrome.runtime.openOptionsPage()` and reports failures with a retryable action.

Run `pnpm preview:extension` to inspect both pages in an ordinary browser: `/` previews the popup and `/options.html` shows settings. Preview workspace names use a separate localStorage key and do not change installed-extension settings. Theme preferences continue to use the shared theme provider and per-origin localStorage. The preview explains its separate storage behavior.

Reinit preserves Web and Extension source, HTML entries, manifest, shared UI / fonts, and custom browser hooks. No new application dependencies or framework configuration overrides are needed. Browser gates exercise both templates before replacement, including responsive layouts, real extension settings / failure recovery, ordinary browser previews, and existing theme / HMR behavior.

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

Admin restores its desktop sidebar preference from the `sidebar_state` cookie after reloads and route navigation. Only `true` and `false` are accepted; missing, invalid, or unavailable cookies use the expanded default. Writes retain the existing seven-day lifetime and root path. Cookie restrictions do not prevent toggling. The client-only Admin layout initializes this preference; the shared provider keeps its explicit `defaultOpen` / controlled-state contract so SSR consumers can supply server-derived state without hydration mismatches.

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

Shared ESLint excludes build output only at the consuming configuration's root and its `apps/*` / `packages/*` workspace boundaries. Business directories such as `src/dist`, `src/coverage`, or `scripts/.reinit` remain checked. Dependency directories retain the standard `node_modules` exclusion.

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

`reinit` reconnects the shared presets and their package dependencies. Project-managed TypeScript options and Oxlint rules take precedence over template defaults; differences are reported. New upstream options, additional inheritance, environment types, and lint overrides are preserved. Integration lives in `scripts/lib/tooling.mts`. Edit shared rules in configuration packages and framework adapters in scripts to retain changes across reinit. Direct application overrides remain temporary because framework configuration is regenerated.

## Engineering scripts

Engineering entry points, shared implementations, regression tests, and `browser-tests.config.mts` use TypeScript ES modules (`.mts`). Node.js 24 runs their erasable type syntax directly; no script compilation, custom loader, or generated JavaScript is required. Keep relative import extensions explicit and use `import type` for types. Runtime-transforming syntax such as enums and parameter properties, and TypeScript-only path aliases, are unsupported by this execution model.

The shared `@browser-client/typescript-config/node.json` preset enables strict checking, NodeNext resolution, `noEmit`, `erasableSyntaxOnly`, and `verbatimModuleSyntax`. `scripts/tsconfig.json` includes engineering modules, test helpers, regression tests, and browser assertions, adding DOM / Chrome types for Playwright callbacks. Root TypeScript and Node types use `catalog:tooling`, independently of the Next.js and Vite toolchains.

The shared ESLint package declares the verified compiler peer range `>=5.8 <6.1`, aligned with its current TypeScript ESLint integration. Reinit uses this contract to select a compatible compiler before considering historical plugin versions. Expand the range together with a verified lint integration update when supporting a newer compiler.

```sh
pnpm typecheck:scripts  # Check engineering code and tests without running or emitting them
pnpm lint:scripts      # Shared Node and TypeScript lint rules
pnpm test              # Run native .test.mts regression tests
```

`pnpm typecheck` checks scripts before workspace types; `pnpm check`, CI, and reinit's candidate / final checks include it. Native Node execution only strips types, so running a script alone does not establish type correctness. Shared interfaces cover dependency decisions, process ownership results, maintenance reports, and browser hooks. Keep runtime validation of registry responses, files, paths, and recovery state: static types cannot establish the shape or safety of external data.

ESLint configuration remains JavaScript for tool loading. The shared Node preset applies existing recommended JavaScript rules and TypeScript rules to `.mts` files, including unused declarations and explicit `any`. Browser-only globals are rejected in standalone Node scripts; the explicit browser assertion modules retain their Playwright context. Application template fixtures and VM / subprocess source strings retain the language needed for the behavior they test.

## Formatting and editors

The root `.prettierrc.json` formats applications, shared packages, and scripts with two spaces, double quotes, no semicolons, and a 128-column width. Prettier is installed locally and pinned. The Tailwind plugin reads the v4 theme from `packages/ui/src/styles/globals.css` and sorts classes in JSX, `cn`, `clsx`, and `cva`. No separate formatting package or per-workspace installation is required.

```sh
pnpm format          # Format source, configuration, and documentation
pnpm format:check    # Check only; included in pnpm check and CI
```

Both commands explicitly use `.prettierignore`, keeping formatting exclusions independent from Git rules. Exclusions cover workspace build outputs, dependencies, lockfiles, generated version records, static `public/` assets, private `.reinit/` data, patches, and `AGENTS.md`. Static assets and repository instructions are not reformatted. `.editorconfig` sets UTF-8, LF, two spaces, and a final newline while preserving meaningful Markdown and patch whitespace.

Open the repository root in VS Code and install the recommended Prettier, ESLint, Oxc, and Tailwind CSS IntelliSense extensions from `.vscode/extensions.json`. Saving uses local Prettier and the appropriate lint fixes. Web and scripts use ESLint; the root `.oxlintrc.json` excludes them from Oxc editor checks. Admin, Extension, and UI keep their shared rules. Root Oxlint uses the same catalog version as the applications so the editor can locate its language service. Oxfmt formatting and TypeScript Nightly are disabled; final type checks use each workspace's pinned TypeScript. Recommendations do not automatically install extensions or change personal settings.

After installing the isolated candidate, online `reinit` performs a strict frozen-lockfile install to verify the complete locked graph and cache the supply-chain metadata needed by the offline browser copies. It then formats regenerated application configuration and updated root configuration / workspace manifests, and runs full checks and browser tests. It does not rewrite application source, shared shadcn/ui, manifests, static assets, or editor settings. Formatting dependencies participate in compatible online upgrades; offline mode replays recorded versions. If metadata is unavailable, updated rules require source changes, or generated configuration cannot be formatted, validation stops and preserves the original project. Review formatting changes before retrying. After adding formatting dependencies, a successful online reinit is needed to record them for offline replay.

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

Web, Admin, and the extension popup place `Toggle theme` near the top right; extension settings put it in the Appearance card. Every page uses the shared shadcn `Button` and `DropdownMenu`. The radio menu offers `Light`, `Dark`, and `System`, defaulting to `System`. It marks the current selection and supports keyboard navigation, Escape, and focus restoration. All clients use the shared `ThemeProvider`, theme context, and `ThemeSwitcher` from `packages/ui`. Web wraps that provider in `NextThemeProvider` to apply its preference before hydration. Native form controls follow the active `color-scheme`.

Preferences survive reloads in `localStorage["browser-client-theme:<instanceId>"]`, using the public identity supplied by the application shell. Storage is scoped to the origin as well as the instance. Same-origin tabs and popup / options within one extension synchronize changes; unrelated instance keys and session-storage events are ignored. Original instances marked `legacy: true` can migrate a valid old `browser-client-theme` preference when their namespaced key is absent. New instances never inherit that legacy preference; if migration writes fail, the original instance can still read its old preference without deleting it.

System mode follows live OS changes; manual selection takes priority. Pages remain usable when local storage is disabled. Web removes invalid stored preferences before hydration without allocating storage, and the shared provider normalizes invalid cross-tab values before applying them. Other stored data and valid preferences are retained. If writes fail, manual changes still apply to the current page but cannot persist across reloads. Clearing storage restores system mode.

Web applies its theme before hydration and uses `suppressHydrationWarning` on `html` for theme-related attribute differences. Admin and Extension use a blocking external `theme-init.js` in `<head>` before React runs. The extension retains strict Manifest V3 CSP without inline scripts or additional permissions. Bootstrap source lives in `packages/ui/src/lib/theme-init.js`. Run `pnpm theme:sync` after editing it: the command updates all registered Vite instances and `templates/admin/public/` / `templates/extension/public/`, including when the registry is empty or contains only Web. It checks every destination before writing and refuses custom assets or symbolic links. Regression tests verify seed and instance copies, script ordering, empty compositions, and source preservation when the updated seeds are integrated into a new instance.

`reinit` preserves root layouts, page entries, HTML, bootstrap assets, and shared theme components. Shared dependencies participate in compatible upgrades. Browser tests cover switching, persistence, same-origin synchronization, OS changes, early first paint, and unavailable storage; extension tests also cover actual loading, CSP, and HMR.

## Browser extension

1. Run `pnpm dev:extension` and keep the service running.
2. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select `apps/extension/dist-dev`.
4. Open the **Workspace** popup from the extension icon and choose **Open settings** to open the **Settings** page. The popup shows the current workspace; settings provide the workspace-name form and appearance menu. Both include the product name and GitHub icon link. You can also open settings through **Extension options** in the extension management page. The background initializes the default workspace without overwriting an existing name.

`manifest.config.ts`, using CRXJS `defineManifest`, is the only manifest source. `src/background.ts`, `index.html`, `options.html`, `sidepanel.html`, and `src/content.ts` are the background, popup, options, side-panel, and isolated content-agent entries. CRXJS discovers entries and generates resource paths from the manifest; do not add another manifest under `public/`.

Popup / options support React Fast Refresh, including shared UI components and styles. Ordinary component edits can retain React state. Background or manifest changes may reload the extension and reset state. CRXJS injects localhost development connections, permissions, and CSP into development output only. The default port is 5174. Override it with `EXTENSION_DEV_PORT=3202 pnpm dev:extension` to keep HTTP and WebSocket ports synchronized; do not override only `--port`.

Build production output with `pnpm --filter @browser-client/extension build` and load or package `apps/extension/dist`. Production is independent of the development server and has no HMR client. Unified communication retains `storage`, `activeTab`, `scripting`, and `sidePanel`, strict CSP, and the explicitly configured website host/content-script allowlist; the broker separately enforces document-scoped consent. See the [communication guide](extension-communication.md) before changing that policy. **Publish `dist`, not `dist-dev`.** Reload the extension manually after rebuilding production output.

`pnpm preview:extension` previews UI in a normal web page without CRXJS or extension APIs. It shares the extension development port, so run only one of these services at a time.

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

## 扩展统一通信

Web、popup、options、side panel 和隔离 content agent 共用版本化 SDK，由 Service Worker 集中路由与按文档授权。接入与安全边界见 [通信指南](extension-communication.md)。Web 示例位于 `/extension`；生产站点和自定义端口必须显式配置精确 origin，不自动扩大信任。共享包、side panel 入口和 manifest 随独立种子及 reinit 保留，生产检查覆盖通信入口策略。协议回归与真实浏览器的后台终止/恢复、撤权和风暴验收分别记录；资源不足时不启动重型验证。
