Browser Client Monorepo

## Project Reference

- [Turborepo - kitchen-sink](https://github.com/vercel/turborepo/blob/main/examples/kitchen-sink)
- [Vite.js - template](https://github.com/vitejs/vite/blob/main/packages/create-vite/template-react-ts)
- [Next.js - template](https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/app/ts)
- [ShadcnUI - monorepo-template](https://github.com/shadcn-ui/ui/tree/main/templates/next-monorepo)
- [CRXJS](https://github.com/crxjs)

## CLI scaffold mode

This repository can scaffold a filtered monorepo with only the browser clients you need:

```bash
pnpm run create -- <target-directory> --apps=admin,web,extension
```

- `--apps` accepts any comma-separated subset of `admin`, `web`, and `extension`.
- Every generated project keeps the shared `ui`, `eslint-config`, `typescript-config`, and `types` packages.
- App-specific workspace packages are copied only when the selected app needs them.
- Generated package manifests expand workspace catalogs to concrete package versions and try to resolve current npm `latest` versions for Vite, Next.js, CRXJS, React, Tailwind, ESLint, TypeScript, Turborepo, and related tooling.
