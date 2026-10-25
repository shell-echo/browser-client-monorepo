# Composable applications

[Project home](../README.md) · [Development](development.md) · [Reinit](reinit.md) · [Testing](testing.md)

The default Web, Admin and Extension are instances of three built-in templates. Keep one application, multiple instances of one type, any combination, or an explicit empty registry with the shared packages retained.

## Registry and identity

`apps.config.json` declares instances and development ports:

```json
{
  "$schema": "./schemas/apps.schema.json",
  "schemaVersion": 1,
  "apps": {
    "website": { "type": "web", "port": 3000 },
    "portal": { "type": "web", "port": 3001 },
    "admin": { "type": "admin", "port": 5173 },
    "operations": { "type": "admin", "port": 5175 },
    "addon": { "type": "extension", "port": 5174 }
  }
}
```

Each instance owns `apps/<id>` and package `@browser-client/<id>`. Names use lowercase letters, digits and hyphens. Reserved names, duplicate keys, path traversal and duplicate ports fail validation. Ports are integers from 1024 through 65535. The supported workspace layout is `apps/*` and `packages/*`.

`template-versions.json` records identities and official generator versions separately from desired configuration. Each generated `app-identity.json` must match its record. Missing directories, omitted managed entries and name/type drift stop maintenance. Editing the registry never implicitly deletes an application. Use lifecycle commands for additions/removals. Development port changes take effect after restarting the service. Renaming and type conversion require explicit future migrations.

Unmanaged workspaces in the supported directories remain intact and participate in workspace compatibility, installation and build/lint/type checks. They are not regenerated or assigned browser assertions automatically.

## Inspect and run

```sh
pnpm app list
pnpm app doctor
pnpm app dev operations
pnpm app build portal
pnpm app start portal
pnpm app preview-ui addon
pnpm dev
pnpm build
```

Original development aliases address the default instance names and fail if that instance has been removed. Use `pnpm app` for custom names. Unknown selectors never become successful empty filters.

Development ports come from the registry. A temporary override targets one process: `APP_INSTANCE_ID=addon APP_DEV_PORT=3202 pnpm app dev addon`. Legacy `EXTENSION_DEV_PORT` works only with exactly one registered Extension. HTTP and HMR use the same port; occupied ports do not silently fall back. Browser tests use separate ports and execute instances sequentially.

## Add, remove and restore

```sh
pnpm app add portal --type web --port 3001
pnpm app add portal --type web --port 3001 --apply
pnpm app add operations --type admin --port 5175 --apply
pnpm app remove extension
pnpm app remove extension --apply --offline
pnpm app restore ARCHIVE_ID
pnpm app restore ARCHIVE_ID --apply --offline
```

Maintenance previews are read-only and never contact the registry. Applying an addition generates official latest stable framework templates in isolation and integrates independent seeds from `templates/<type>`, including pages, assets and instance tests. Existing business applications are never prototypes. Shared shadcn/ui, b0, Inter and engineering presets remain in `packages/`.

Additions retain existing compatible locked dependencies. If the latest framework cannot use that baseline, the operation stops before replacement; run and validate a full reinit before retrying. New instances require online official templates. Offline reinit supports recorded instances with cached packages and Chromium.

Reverse workspace/file/link references prevent removal. Removal updates the graph and receipts without upgrading unrelated clients. Private business/environment source archives under `.reinit/archives/<operation-id>/` are protected from ordinary `reinit:clean` retention rules.

Restore verifies archived identity and source, refuses occupied names/ports, and reconciles that instance with the current workspace. It does not restore an old whole-workspace lockfile. Incompatible dependencies or missing offline cache entries stop the operation. Archives remain available afterward.

## Rebuild and recover

```sh
pnpm reinit portal
pnpm reinit portal --apply
pnpm reinit all --apply --offline
pnpm app recover OPERATION_ID
pnpm app recover OPERATION_ID --apply
```

If an interruption left `package.json` or dependencies between replacement renames, invoke recovery directly with `node scripts/app.mts recover OPERATION_ID --apply`. Its bootstrap imports only Node built-ins and restores the original dependency tree before running checks.

Reinit refreshes selected framework foundations while preserving business source, assets, environments, manifests, instance tests and shared UI. Unselected frameworks remain compatibility constraints. Online reinit uses latest stable frameworks and highest compatible managed dependencies; ESLint stays at least 10. Offline replay uses matching records and caches without implicit registry access.

Every applying operation shares one lock, isolated generation, strict installation, workspace checks and registered browser coverage before replacement. Source, registry, dependency policy, lockfile and identities are backed up together, checked for concurrent edits, and verified again at their final location.

Recovery reconciles observed filesystem contents with a write-ahead plan, including interruptions between renames and journal updates. Interrupted recovery can resume. Conflicting edits, unresolved process registration or running detached children retain the lock and both versions. Stop development/build services and pause editing during maintenance; the lock does not lock your editor. Local archives are neither off-disk backups nor a power-loss-atomic transaction.

## Tests and persistence

Instances own `browser-tests.config.mts` and any `tests/*.test.mts`; optional root browser overrides are keyed by instance id. Update business assertions when customizing pages. `pnpm test:browser` requires reports for every registered instance and rejects missing, duplicate, skipped and stale results. A genuinely empty registry reports browser checks as not applicable while still requiring base checks.

`pnpm test:apps` exercises real empty, Admin-only and six-instance compositions in a private copy, including two instances of each type, official-template additions, offline removal/restoration, shared-host cookie isolation, offline reinit and a SIGKILL recovery during dependency replacement. `pnpm test:reinit` separately covers online/offline upgrading and ESLint minimum-version rejection for the current composition. Both are long acceptance suites; the manual Reinit acceptance workflow selects either suite and retains diagnostic reports without uploading source or environment files.

Cookie and theme keys use instance namespaces. Shared UI receives public identity through the application shell, without importing repository configuration into client bundles. Original instances have a controlled legacy-preference migration path; newly created instances never read legacy preferences. Registry, identity and runtime integration changes participate in build caching.
