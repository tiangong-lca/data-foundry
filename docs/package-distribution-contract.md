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
  - when preparing a release-only version change or verifying published npm provenance
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
  - scripts/release-*.ts
  - scripts/lib/foundry-release-*.ts
  - .github/workflows/publish-foundry.yml
  - .github/workflows/quality-gate.yml
  - scripts/lib/foundry-package-contract.ts
  - scripts/lib/foundry-runtime-paths.ts
  - specs/schemas/foundry-package-descriptor.schema.json
  - test/unit/foundry-package-contract.test.mts
  - test/unit/foundry-release-*.test.mts
  - test/commands/foundry-release-*.test.mts
  - test/unit/runtime-layout.test.mts
  - test/scenarios/foundry-package-consumer.test.mts
lastReviewedAt: 2026-09-06
lastReviewedCommit: 3a8a0a68b854342ad62a50c14840d445f0753847
lastReviewedNote: "Reviewed for Foundry #112: source workflow admission binds the exact canonical event, clean main source, version-only diff, recovery tag and merged PR; the existing four-platform quality gate is reusable at that SHA. No tag, registry or component publication stage is enabled yet; runtime/account/ownership contracts remain unchanged."
related:
  - docs/public-runtime-contract.md
  - docs/runtime-context-contract.md
  - docs/task-authorization-contract.md
  - docs/safety-policy.md
---

# Foundry package distribution

The npm identity is `@tiangong-lca/foundry`; the public bin is `tiangong-foundry`. W06 establishes the installable `0.1.0` candidate and its production dependency closure. It does not publish a registry version or call this candidate F1. W08 owns the release-only workflow, Trusted Publishing/provenance, immutable tag, platform components, SBOM/license bundle and product compatibility manifest.

The package depends exactly on public `@tiangong-lca/cli@0.1.10`. Ajv remains a development dependency because only repository-internal command owners import it; those owners are absent from the public compiler graph. Sigstore 5.0.0 is also development-only and serves source release verification; it is absent from the public dependency closure. TIDAS is an independently verified native component selected later by the CLI manager, not an npm dependency or bundled binary.

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

Verification uses regular-file, `O_NOFOLLOW`, fd size/inode/mtime and SHA checks. Missing, extra, linked, renamed, traversing, oversized or changed payloads fail before a package-backed facade context is created. Every package-entry resolution performs this check even if an extra source-like file appears; such a file is itself an unexpected payload and cannot switch the resolver into developer mode. A nested `node_modules` may be dependency storage only when it is a real directory, never a symlink. Source and ordinary developer-emitted layouts remain readable as legacy layout v1 or repository layout v2 without treating a copied name-only manifest as a package.

## Version preparation

`pnpm release:version --version <major.minor.patch>` is a read-only maintainer plan. It validates the repository package identity and coherent manifest, compiled-verifier and descriptor-schema versions, then reports the three bounded content changes. Stable versions cannot decrease. The CLI has no alternate-root or serialized-plan input.

`--apply` additionally requires a clean Git working tree at the script’s own repository root; inherited Git repository bindings are removed before that check. The private in-process plan binds the original file bytes and modes. Metadata must be regular files reached through real repository directories, and all inputs are rechecked before prepared files are renamed. Replacement is atomic per file, not a cross-file filesystem transaction; an I/O failure after a replacement reports the affected Git paths for review. This command creates no commit or tag and performs no registry operation. Release-only orchestration and publication remain separate W08 gates.

## Release diff and published-source verification

`pnpm release:inspect --base <40-hex-sha> --head <40-hex-sha>` reads exact ancestor-related commits from its own Git root, with inherited repository bindings and replacement objects disabled. It reports the source tree and whether the package version changed. Ordinary commits return `release: false` before unrelated blobs are read. A version change must equal the same three-file projection used by the version preparer. Every changed file must retain regular Git mode `100644` and valid UTF-8 bytes. Other source, lock, additions, deletions or mode changes fail; existing Markdown frontmatter and `.docpact/config.yaml` may change only the single-line `lastReviewedAt`, `lastReviewedCommit` and `lastReviewedNote` values. Document bodies and all remaining bytes stay fixed. `--github-output` writes validated scalar outputs only within GitHub Actions. This inspection does not prove PR approval, main eligibility or a completed release.

`pnpm release:verify-npm --package <cli|foundry> --version <x.y.z> --expected-git-head <40-hex-sha>` independently downloads the exact public npm metadata, tarball and attestation. Downloads reject redirects, credentials, alternate registry origins/paths and unbounded responses. Verification binds canonical SHA-512 to the downloaded tarball, then verifies the Sigstore certificate, issuer and transparency logs before interpreting the signed in-toto/SLSA payload. The verified certificate identity must match the signed workflow/ref, package subject, source commit and exact GitHub-hosted run attempt. Optional registry `gitHead` must match when present; its absence never substitutes for signed provenance.

CLI provenance is restricted to `tiangong-lca/tiangong-cli` and `.github/workflows/publish.yml` at the exact `cli-v<version>` tag. The Foundry policy binds `tiangong-lca/data-foundry` and `.github/workflows/publish-foundry.yml`; a normal publication must originate from a main push, and recovery must originate from `workflow_dispatch` on the exact `foundry-v<version>` tag. Both paths require the expected source digest.

`--output <new-absolute-directory>` preserves the verified tarball, raw registry metadata/attestations and the digest-bound verification report only after verification succeeds. It never replaces an existing directory. Reports are verification evidence, not independent trust anchors: component consumers still require the separately trusted product manifest/Skills lock. The tool cannot publish, tag, configure a publisher, read `.env` or supply a registry token. Sigstore uses an owned temporary trust cache that is removed after verification.

## Workflow source qualification

`pnpm release:context [--github-output]` admits only the canonical GitHub Actions event and workflow definition at the event's exact commit. A normal push must update main without creating, deleting or force-updating it. Manual recovery has no alternate-source inputs: it must dispatch the existing stable `foundry-v<version>` tag, with matching event/ref/workflow/source identity. The checked-out source must be clean, match the event commit and remain an ancestor of fetched `origin/main`; recovery additionally proves the exact local tag and its release-only first-parent diff.

An ordinary unchanged-version main push exits without a GitHub PR lookup. A release requires one canonical, merged main PR whose merge commit exactly matches the source; foreign, open, unmerged, ambiguous, incomplete or mismatched evidence fails. The bounded read-only GitHub API lookup uses only the workflow-provided token and emits the PR identity, never credentials. This proves the source relationship; it does not replace required review or platform qualification.

`.github/workflows/publish-foundry.yml` currently connects that context gate to the existing four-native-host canonical gate through `workflow_call`. The reusable quality workflow checks out the admitted SHA, retains its ordinary PR/manual triggers, and does not persist checkout credentials. These source qualification jobs have read-only permissions. Immutable tag creation, npm publication, component production and final manifest publication remain further W08 stages; a successful source qualification run alone is not F1 publication.

## Qualification

`pnpm package:build` rebuilds both output roots from scratch and verifies the staged package. `pnpm package:check` compares the stage with the descriptor, runs a pack dry-run, and verifies the installed C1 descriptor. `pnpm package:pack` packs only `package-stage/` into an owned temporary directory, derives the versioned archive name from the verified staged descriptor, then installs it with an exclusive hardlink. The repository manifest, compiled verifier version and descriptor JSON Schema version remain coherent release projections; the verifier never takes its expected identity from the installed manifest it is checking. An identical existing archive is reused; a link, invalid file or different existing bytes are preserved and rejected rather than overwritten.

The package scenario rebuilds twice, packs twice byte-identically, and installs the same tarball into two clean consumers; the second install is offline from the first consumer's isolated public cache. It verifies the exact import surface and declarations, public CLI 0.1.10 runtime identity, shebang/bin, source/installed operation equivalence, arbitrary Unicode CWD, read-only package bytes, isolated workspace writes and all six facade operations. It also proves that internal commands, modified/extra/linked files, a lifecycle-bearing manifest, a `darwin-x64` descriptor and a package copied without C1 fail closed.

These checks qualify a local candidate tarball. They do not prove registry provenance, public component download, native TIDAS availability on every host or a complete Node+CLI+Foundry+TIDAS component. Those are W08 release gates.

The W10 planning extension adds the shared pure attempt leaf and bounded migration plan/stage readers to the public graph, plus the transfer-plan schema and migration contract. It still excludes the internal capsule command and all developer commands. Future package qualification must use the rebuilt descriptor/tarball; the earlier W06 tarball remains an immutable baseline artifact.

The W10 transfer extension ships bounded transfer I/O and staging/audit owners plus pending-marker and receipt schemas. It still has no install lifecycle effects, no business mutation dispatcher and no automatic activation; source-free consumers can explicitly stage and audit the same v2 plans.

The adoption extension ships migration planning/application/authority/scope guards, explicit read/write access, runtime selection and their strict schemas. The package descriptor lists both supported read and write schemas while retaining v1 as the default initialization schema; v2 writes additionally require the trusted host feature selection. Public CLI apply/runtime-use remain separate explicit actions, never install hooks. Source and installed packages must qualify the same behaviors; managed component publication/bootstrap remains W08.
