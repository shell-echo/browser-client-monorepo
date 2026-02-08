# Repository Guidelines

This monorepo houses multiple browser client apps and shared packages. Use pnpm + Turborepo for development and keep changes scoped to the app or package you touch.

## Project Structure & Module Organization

- `apps/admin`: Vite + React admin app. Source in `apps/admin/src`, static assets in `apps/admin/public`.
- `apps/web`: Next.js app using the App Router; routes live in `apps/web/app`.
- `apps/extension`: Browser extension built with Vite + CRXJS; entry points live under `apps/extension/src` (e.g., `action-popup`, `side-panel`, `content-script`, `service-worker`).
- `packages/ui` and `packages/components`: shared UI primitives and app-level components.
- `packages/types`: shared `*.d.ts` entry points for each app.
- `packages/eslint-config` and `packages/typescript-config`: shared lint and TS config.
- Root config: `turbo.json`, `pnpm-workspace.yaml`, `.prettierrc`.

## Build, Test, and Development Commands

- `pnpm install`: install workspace dependencies (Node >=24).
- `pnpm dev`: run `turbo run dev` across apps.
- `pnpm --filter web dev`: run a single app (replace `web` with `admin` or `extension`).
- `pnpm build`: build all packages/apps via Turborepo.
- `pnpm lint`: run ESLint across the workspace.
- `pnpm format`: format using Prettier.
- `pnpm spellcheck`: run `cspell` with `.cspell.json`.

## Coding Style & Naming Conventions

- Prettier is the source of truth: 2-space indentation, 128-column width, semicolons, double quotes.
- ESLint configs live per app (`apps/*/eslint.config.*`) and shared in `packages/eslint-config`.
- Use `.tsx` for React components and `.ts` for utilities. Keep naming consistent with the local package (e.g., `App.tsx` in Vite apps, `app/` routes in Next).
- Shared package files are typically lowercase (see `packages/ui/src/components/button.tsx`).

## Testing Guidelines

- There is no test runner or `test` script configured yet, and no `__tests__`/`*.test.*` files in the repo.
- If you add tests, introduce a package-level script and document how to run it.

## Commit & Pull Request Guidelines

- Git history uses short, lowercase, imperative messages (e.g., "init project", "upgrade package"). Follow that style.
- PRs should include: summary of changes, affected apps/packages, how to validate (`pnpm dev`/`pnpm build`), and screenshots for UI changes. Link related issues when available.

## Configuration & Environment

- Tooling expects Node >=24 and `pnpm@10.28.2` (see `package.json`).
- `.env*` files are included in Turbo build inputs; document new environment variables in the app’s README if you add any.
