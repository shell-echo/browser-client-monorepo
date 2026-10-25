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

## Upstream IP parser fix

The shadcn tooling graph resolves `ip-address@10.7.4`, the upstream fix for [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5). The lockfile updates both the SOCKS and MCP rate-limiter dependency chains within their existing version ranges. No advisory exception or local patch is used for this package.

Security regressions check every locked IP parser version and the installed tooling consumers against the `10.7.4` minimum. A separate process with a five-second deadline checks million-character malformed zone identifiers and normal IPv4 / IPv6 parsing. These tests are part of `pnpm check`, including online and offline reinit candidate validation; a vulnerable cached version fails before replacement. Online auditing continues to check for newly published advisories.

## Upstream tooling fixes

The shadcn tooling catalog now uses the upstream Zod 4 integration in shadcn 4.22.1. The lockfile also refreshes compatible HTTP and URI transitives: Zod >=4.6.6, body-parser >=2.4.0, undici >=7.30.1 on the 7.x line, and fast-uri >=3.1.9 on the 3.x line. These address [Zod collection resource exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [body-parser compressed-body failures](https://github.com/advisories/GHSA-27r3-jxmh-p828), [undici response-stream failures](https://github.com/advisories/GHSA-xjj6-f33q-929c), and [fast-uri scheme decoding](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), together with the related advisories returned by the live audit. The upgrade uses upstream dependency ranges; it does not override Zod 3 consumers to a different major or add audit exceptions. Regressions inspect every locked affected package and load the real shadcn CLI and its Zod schema API. They run in normal checks and reinit's candidate/final checks, including offline replay.

## Scheduled checks

`.github/workflows/security-audit.yml` also runs frozen installation and the same patch-aware audit every Monday at 01:23 UTC (09:23 Asia/Shanghai), with a manual trigger available. The schedule takes effect on the default branch after publication; execution time depends on GitHub's scheduler. It checks the existing lockfile without upgrading dependencies or changing source. Unresolved advisories fail the workflow and remain visible in its logs.

`.github/dependabot.yml` checks GitHub Actions versions weekly and groups update pull requests. npm dependencies continue through the project's compatibility solver and required validation; Dependabot does not manage them or auto-merge updates.

The [Security audit workflow](../.github/workflows/security-audit.yml) audits existing versions; [Reinit](reinit.md) owns dependency upgrades.
