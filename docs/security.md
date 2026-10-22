# Dependency security

[Project home](../README.md) · [Development](development.md) · [Reinit](reinit.md) · [Testing](testing.md) · [Security](security.md)

The project audits the locked dependency graph and verifies local mitigations before accepting them. Policy and commands are defined in [the workspace configuration](../pnpm-workspace.yaml), [the audit script](../scripts/audit-dependencies.mts), and [security regression tests](../scripts/tests/security.test.mts).

## Audit commands and the current patch

```sh
pnpm audit:security
pnpm audit --prod
```

shadcn CLI is a root and UI development dependency; `shadcn/tailwind.css` still resolves during builds. The current lockfile includes its transitive `braces@3.0.3` dependency, patched locally for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). `patches/braces@3.0.3.patch` limits parser and recursive AST traversal depth for both strings and direct AST inputs. The patch is registered in `pnpm-workspace.yaml#patchedDependencies`, pinned in the single lockfile, and preserved by reinit.

Raw `pnpm audit` uses package versions and may still report this advisory. `audit:security` first verifies the patch hash, lockfile coverage, and installed behavior, then reads the complete audit response. Only the verified `3.0.3` instance of this GHSA is classified as locally mitigated; no global ignore list is applied. Other packages, versions, advisories, or registry errors fail the check. Regression tests are included in `pnpm check`. The patch addresses recursion depth, not arbitrary glob / regular-expression resource consumption.

After upgrading to a verified upstream fix, remove the patch and its verification policy together. Removing an advisory record or changing a version string does not establish a fix.

## Scheduled checks

`.github/workflows/security-audit.yml` also runs frozen installation and the same patch-aware audit every Monday at 01:23 UTC (09:23 Asia/Shanghai), with a manual trigger available. The schedule takes effect on the default branch after publication; execution time depends on GitHub's scheduler. It checks the existing lockfile without upgrading dependencies or changing source. Unresolved advisories fail the workflow and remain visible in its logs.

`.github/dependabot.yml` checks GitHub Actions versions weekly and groups update pull requests. npm dependencies continue through the project's compatibility solver and required validation; Dependabot does not manage them or auto-merge updates.

The [Security audit workflow](../.github/workflows/security-audit.yml) audits existing versions; [Reinit](reinit.md) owns dependency upgrades.
