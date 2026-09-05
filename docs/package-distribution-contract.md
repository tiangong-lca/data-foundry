---
title: Foundry Package Distribution Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when changing the Foundry npm package, public bin, exports, package compiler or shipped assets
  - when qualifying a packed or installed Foundry candidate
whenToUpdate:
  - when package identity, file closure, descriptor, runtime layout, supported platform or install behavior changes
checkPaths:
  - package.json
  - pnpm-lock.yaml
  - tsconfig.package.json
  - scripts/package-entry.ts
  - scripts/public-api.ts
  - scripts/build-foundry-package.ts
  - scripts/pack-foundry-package.ts
  - scripts/verify-foundry-package.ts
  - scripts/lib/foundry-package-contract.ts
  - scripts/lib/foundry-runtime-paths.ts
  - specs/schemas/foundry-package-descriptor.schema.json
  - test/unit/foundry-package-contract.test.mts
  - test/unit/runtime-layout.test.mts
  - test/scenarios/foundry-package-consumer.test.mts
lastReviewedAt: 2026-09-05
lastReviewedCommit: 8cbbddb1a727ff2858918d0ff6d2efb1c8827390
lastReviewedNote: "Reviewed for #106 W06: the unpublished 0.1.0 candidate has a public-only bin/API, deterministic source-free closure, sanitized staging manifest, strict descriptor and two-consumer qualification."
related:
  - docs/public-runtime-contract.md
  - docs/runtime-context-contract.md
  - docs/task-authorization-contract.md
  - docs/safety-policy.md
---

# Foundry package distribution

The npm identity is `@tiangong-lca/foundry`; the public bin is `tiangong-foundry`. W06 establishes the installable `0.1.0` candidate and its production dependency closure. It does not publish a registry version or call this candidate F1. W08 owns the release-only workflow, Trusted Publishing/provenance, immutable tag, platform components, SBOM/license bundle and product compatibility manifest.

The package depends exactly on public `@tiangong-lca/cli@0.1.10`. Ajv remains a development dependency because only repository-internal command owners import it; those owners are absent from the public compiler graph. TIDAS is an independently verified native component selected later by the CLI manager, not an npm dependency or bundled binary.

## Public surface

`scripts/package-entry.ts` is the only bin source. It calls `runFoundryPublicCommand`, which routes the six operations in `public-runtime-contract.md` and converts every other name into the stable unknown-operation envelope. It never falls back to `scripts/foundry.ts`, the repository doctor, 63-command dispatcher, production case runner or maintenance owners.

`scripts/public-api.ts` binds the facade's module identity internally. A consumer supplies workspace, optional runtime selection/account intent and host controls; it cannot redirect package discovery through its own `moduleUrl`. The root and `./runtime` exports expose only the facade, public command host, result/task/migration protocol types and validators, next-action binding verifier, and package descriptor verifier. Internal command factories, mutation dispatch and raw runtime/task stores are not package exports.

## Build and staging roots

Three roots have distinct ownership:

| Root | Contract |
| --- | --- |
| `package-dist/` | Ignored deterministic compiler output. `tsconfig.package.json` follows only the public bin/API import graph and emits JS plus declarations. |
| `package-stage/` | Ignored exact publish tree with a generated public manifest and copied reviewed payload. |
| `package-artifacts/` | Ignored local tarball destination; no task, credential or source data belongs here. |

The package compiler sets LF output and disables source maps, declaration maps and inline sources. The admitted closure contains no `scripts/commands/**`, `scripts/cases/**`, source `.ts`, tests, CI/agent/Git state or developer tools. Generated `.d.ts` declarations are public types, not source implementation.

The repository manifest retains developer scripts. `build-foundry-package.ts` projects a separate exact public manifest into `package-stage/` containing identity, repository links, public access intent, bin/exports/files, Node engine, license, one production dependency and runtime layout. It omits `scripts`, `devDependencies`, `packageManager`, lint configuration and `private`. There are no install/prepare lifecycle hooks; installation cannot initialize a workspace, install Git hooks, authenticate or download a component. Repository hook setup is the explicit `pnpm dev:hooks` command.

## File and descriptor integrity

`package.json.files` is an explicit allowlist for the compiled closure, public schemas/profile documents and reviewed contracts. Profile documentation referenced by `specs/import-profiles.json` is included so a distributed profile has no dangling governed document. README and LICENSE are included. Private live evidence, `.env*`, session data, tasks, inputs, outputs, reports and `.foundry` are excluded.

`package-dist/assets/foundry-package-descriptor.json` uses `tiangong-foundry.package-descriptor.v1`. It binds package/bin/API identity, exact CLI dependency, runtime layout v2, the four supported tuples, workspace read/write schema and public protocol set. Its sorted file inventory binds every other shipped payload by portable path, bytes and SHA-256. The descriptor excludes itself. `package.json` is also excluded from the byte inventory because package managers normalize its property order; the installed verifier instead compares its complete semantic object to the exact sanitized public shape and rejects every extra field, including lifecycle scripts.

Verification uses regular-file, `O_NOFOLLOW`, fd size/inode/mtime and SHA checks. Missing, extra, linked, renamed, traversing, oversized or changed payloads fail before a package-backed facade context is created. Installed package resolution requires the descriptor and exact file set. Source and ordinary developer-emitted layouts remain readable as legacy layout v1 or repository layout v2 without treating a copied name-only manifest as a package.

## Qualification

`pnpm package:build` rebuilds both output roots from scratch and verifies the staged package. `pnpm package:check` compares the stage with the descriptor, runs a pack dry-run, and verifies the installed C1 descriptor. `pnpm package:pack` packs only `package-stage/`.

The package scenario rebuilds twice, packs twice byte-identically, and installs the same tarball into two clean consumers; the second install is offline from the first consumer's isolated public cache. It verifies the exact import surface and declarations, public CLI 0.1.10 runtime identity, shebang/bin, source/installed operation equivalence, arbitrary Unicode CWD, read-only package bytes, isolated workspace writes and all six facade operations. It also proves that internal commands, modified/extra/linked files, a lifecycle-bearing manifest, a `darwin-x64` descriptor and a package copied without C1 fail closed.

These checks qualify a local candidate tarball. They do not prove registry provenance, public component download, native TIDAS availability on every host or a complete Node+CLI+Foundry+TIDAS component. Those are W08 release gates.
