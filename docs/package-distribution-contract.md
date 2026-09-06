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
  - specs/release/**
  - test/unit/foundry-package-contract.test.mts
  - test/unit/foundry-release-*.test.mts
  - test/commands/foundry-release-*.test.mts
  - test/unit/runtime-layout.test.mts
  - test/scenarios/foundry-package-consumer.test.mts
lastReviewedAt: 2026-09-06
lastReviewedCommit: ab5746cde4c7814fdbb97fc37a3eb55080a871c5
lastReviewedNote: "Reviewed for Foundry #112: source-only native intake now pins official Node/TIDAS artifacts, selects bounded bytes and executes isolated native handshakes. Actual ABI evidence records glibc 2.38 and the Windows TIDAS VC runtime defect tracked in tidas-tools #181. Complete clean-machine component qualification remains pending."
related:
  - docs/public-runtime-contract.md
  - docs/runtime-context-contract.md
  - docs/task-authorization-contract.md
  - docs/safety-policy.md
---

# Foundry package distribution

The npm identity is `@tiangong-lca/foundry`; the public bin is `tiangong-foundry`. W06 establishes the installable `0.1.0` candidate and its production dependency closure. It does not publish a registry version or call this candidate F1. W08 owns the release-only workflow, Trusted Publishing/provenance, immutable tag, platform components, SBOM/license bundle and product compatibility manifest.

The package depends exactly on public `@tiangong-lca/cli@0.1.10`. Ajv remains a development dependency for internal commands and release-side SPDX validation. Sigstore 5.0.0, YAML 2.9.0, tar 7.5.22 and fflate 0.8.3 are also development-only release tools for signing/verification, lock parsing and bounded upstream archive selection. None enters the public compiler/dependency closure. TIDAS is an independently verified native component selected later by the CLI manager, not an npm dependency or bundled binary.

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

Release tools compare native filesystem directory identity when binding the script root to Git's reported root. Different drive/path casing for the same directory is accepted; a parent, child or other directory is rejected. This applies to version preparation, exact Git inspection and workflow admission without weakening clean-tree or inherited-Git-environment guards.

## Release diff and published-source verification

`pnpm release:inspect --base <40-hex-sha> --head <40-hex-sha>` reads exact ancestor-related commits from its own Git root, with inherited repository bindings and replacement objects disabled. It reports the source tree and whether the package version changed. Ordinary commits return `release: false` before unrelated blobs are read. A version change must equal the same three-file projection used by the version preparer. Every changed file must retain regular Git mode `100644` and valid UTF-8 bytes. Other source, lock, additions, deletions or mode changes fail; existing Markdown frontmatter and `.docpact/config.yaml` may change only the single-line `lastReviewedAt`, `lastReviewedCommit` and `lastReviewedNote` values. Document bodies and all remaining bytes stay fixed. `--github-output` writes validated scalar outputs only within GitHub Actions. This inspection does not prove PR approval, main eligibility or a completed release.

`pnpm release:verify-npm --package <cli|foundry> --version <x.y.z> --expected-git-head <40-hex-sha>` independently downloads the exact public npm metadata, tarball and attestation. Downloads reject redirects, credentials, alternate registry origins/paths and unbounded responses. Verification binds canonical SHA-512 to the downloaded tarball, then verifies the Sigstore certificate, issuer and transparency logs before interpreting the signed in-toto/SLSA payload. The verified certificate identity must match the signed workflow/ref, package subject, source commit and exact GitHub-hosted run attempt. Optional registry `gitHead` must match when present; its absence never substitutes for signed provenance.

CLI provenance is restricted to `tiangong-lca/tiangong-cli` and `.github/workflows/publish.yml` at the exact `cli-v<version>` tag. The Foundry policy binds `tiangong-lca/data-foundry` and `.github/workflows/publish-foundry.yml`; a normal publication must originate from a main push, and recovery must originate from `workflow_dispatch` on the exact `foundry-v<version>` tag. Both paths require the expected source digest.

`--output <new-absolute-directory>` preserves the verified tarball, raw registry metadata/attestations and the digest-bound verification report only after verification succeeds. It never replaces an existing directory. Reports are verification evidence, not independent trust anchors: component consumers still require the separately trusted product manifest/Skills lock. The tool cannot publish, tag, configure a publisher, read `.env` or supply a registry token. Sigstore uses an owned temporary trust cache that is removed after verification.

## Workflow source qualification

`pnpm release:context [--github-output]` admits only the canonical GitHub Actions event and workflow definition at the event's exact commit. A normal push must update main without creating, deleting or force-updating it. Manual recovery has no alternate-source inputs: it must dispatch the existing stable `foundry-v<version>` tag, with matching event/ref/workflow/source identity. The checked-out source must be clean, match the event commit and remain an ancestor of fetched `origin/main`; recovery additionally proves the exact local tag and its release-only first-parent diff.

An ordinary unchanged-version main push exits without a GitHub PR lookup. A release requires one PR merged into the canonical repository's main branch whose merge commit exactly matches the source; wrong-target, open, unmerged, ambiguous, incomplete or mismatched evidence fails. A merged fork PR remains valid even after its source fork is deleted: the canonical main commit and merged PR record own the source proof. The bounded read-only GitHub API lookup uses only the workflow-provided token and emits the PR identity, never credentials. This proves the source relationship; it does not replace required review or platform qualification.

`.github/workflows/publish-foundry.yml` connects that context gate to the existing four-native-host canonical gate through `workflow_call`. The reusable quality workflow checks out the admitted SHA, retains its ordinary PR/manual triggers, and does not persist checkout credentials. These source qualification jobs have read-only permissions.

After every host passes, the separate `release-tag` job revalidates the event, clean source/main relationship, release-only diff and merged PR. `pnpm release:tag` accepts no source/tag arguments or serialized context and requires that exact job identity. Only this job receives GitHub contents-write permission; it installs no project dependencies and does not persist checkout credentials.

The tag helper derives `foundry-v<version>`, queries only the canonical repository and creates a missing tag reference at the exact qualified source commit. An existing tag must resolve to that same commit; an annotated tag is followed through at most four tag objects, with cycles and invalid object types rejected. There is no update, force or delete operation. If a create response is lost or fails, one readback may confirm the intended tag; an absent or different result stays failed without replaying the mutation. A fresh workflow rerun repeats source validation and the same create-or-verify policy.

GitHub tag creation and source qualification alone are not F1 publication. npm publication, component production and final manifest publication remain further W08 stages.

## Prepared package and first publication

The `npm-package` job runs after four-host qualification and exact tag creation. It checks out that source without persisted credentials, installs frozen development dependencies without lifecycle scripts, and runs `pnpm release:prepare-package`. The command accepts no arguments, revalidates the merged release-only source and exact remote tag, builds a fresh package and rechecks the source after building. Packing returns the verified descriptor and archive bytes directly; the command does not reconstruct the archive from process output.

Signing is restricted to that GitHub-hosted job and the exact event/source/workflow identity. It requests a short-lived GitHub Actions OIDC identity with audience `sigstore`, signs standard in-toto/SLSA provenance binding the package SHA-512, canonical repository, source commit and workflow run attempt, then cryptographically verifies the returned bundle. A static `SIGSTORE_ID_TOKEN` is rejected. The signing token is neither persisted nor printed. This step publishes a transparency-log attestation but makes no npm registry write.

The fresh `package-artifacts/npm-release/` directory contains the exact tarball, `foundry-<version>.sigstore`, `prepared-release.json` and a generated README with source/PR/run links and exact commands. The workflow exports these files as a run/attempt-specific artifact. The receipt records source, file digests and inventory as preparation evidence; it does not establish npm publication or supply an independent runtime trust anchor.

`pnpm release:verify-prepared --directory <absolute-download-directory> --version <x.y.z> --expected-git-head <40-hex-sha>` is a read-only maintainer verifier. Select the expected version and source commit independently from the reviewed release PR. The verifier reads bounded regular files at the canonical versioned names and verifies the actual package bytes against the Sigstore certificate/log and signed source/workflow. It does not derive the expected identity from the downloaded receipt or README. Use this source command from the reviewed checkout with its frozen development dependencies installed.

For a package identity's first publication, after the reviewed pipeline has produced and verified the exact artifact:

1. Download the artifact from the qualified release's exact GitHub run attempt. Verify it with the command above and retain its result alongside the release record.
2. An authorized maintainer signs in to npm using their own account and completes the required 2FA. Keep the artifact files unchanged and change into their downloaded directory outside a Git checkout.
3. With pinned pnpm 11.24.0, execute the generated command: `pnpm publish ./tiangong-lca-foundry-<version>.tgz --access public --no-git-checks --config.provenance-file=./foundry-<version>.sigstore`. The generic `--config.provenance-file` spelling is required by this pinned client. The provided CI signature accompanies the unchanged package; the account authorizes its upload.
4. Independently run `release:verify-npm` for that exact version/source, compare its tarball digests with the prepared verification, and preserve the result. After a failed or uncertain upload, inspect the exact public version before deciding the next action; do not blindly replay a publish or overwrite an existing version.
5. Review the new package's npm Trusted Publisher settings for organization `tiangong-lca`, repository `data-foundry`, workflow `publish-foundry.yml`, permission to publish and the actual job environment binding. The current job declares no GitHub environment. Routine publication must use that reviewed workflow's OIDC path and receive separate public readback verification.

The npm package identity and publisher configuration are account-controlled prerequisites, separate from CI signing. A prepared artifact, a successful mock-registry transport test or source-only native qualification is not a published F1 release. The actual versioned workflow execution, complete native components and immutable product-manifest publication remain W08 release gates.

## Registry publication

After exporting the prepared artifact, the owning job runs `pnpm release:publish-package`. This command accepts no arguments and requires the exact `npm-package` job, merged release-only source, verified prepared bytes and unchanged immutable tag. An absent package identity produces a `needs-maintainer` result and stops with no upload; the already exported artifact contains the first-upload instructions. An existing exact version must pass independent public provenance/source/byte verification and is never uploaded again. A new version must advance an existing stable public `latest` tag. Registry availability and source/tag identity are refreshed before a new upload.

The new-version path explicitly requests GitHub OIDC audience `npm:registry.npmjs.org` and exchanges that identity at npm's fixed, package-specific endpoint. Only HTTP 201 with `token_type: oidc`, a fresh creation time, a future expiry and at most two hours of credential lifetime is accepted. Exchange failures do not reach the publisher. This uses the [official npm OIDC exchange](https://api-docs.npmjs.com/) and prevents pnpm's automatic OIDC failure handling from selecting an unrelated credential.

The pinned pnpm 11.24.0 executable uploads copied, rechecked tarball/signature bytes from a fresh private directory proven to be outside Git. Its environment contains essential process settings and only the newly exchanged short-lived credential; inherited npm/GitHub credentials, OIDC endpoints, Node options and user configuration overrides are omitted. Private npm configuration files contain fixed registry/TLS settings and an environment-variable placeholder, never the credential itself. Those files and temporary package copies are removed after the process closes. Publishing uses the prepacked artifact, provided provenance, no Git checks and zero HTTP retries; no shell, package lifecycle, ordinary-account token or alternate package manager is involved.

There is one publisher invocation. Regardless of its reported success or an uncertain/failed response, independent public readback owns the outcome. Up to three bounded readback attempts accommodate registry propagation; they never repeat publication. The public tarball's byte count and SHA-512 must match the prepared artifact, in addition to all signed-source/workflow checks. A different existing version payload, missing provenance or failed readback stops the release. Existing-version verification does not establish that the account has configured future Trusted Publisher permissions.

`package-artifacts/npm-publication/` contains the publication result and readable report; a successful result also preserves public metadata, attestations and verification. The workflow exports this evidence even when publication fails. `npm_published=true` is emitted only after public verification succeeds; later component/manifest stages must require it. It proves package publication only, not complete F1 runtime qualification.

## Frozen production payload and metadata

`pnpm release:prepare-production --output <new-absolute-directory>` is the source-only entrypoint for this input. It requires its own clean checkout, the pinned Node/pnpm source toolchain declaration and a supported host. Output must be outside the source checkout or under ignored `package-artifacts/`; existing destinations are preserved. `specs/release/runtime-inputs.json` binds the exact public CLI version, source commit, repository and tag, and must agree with the public Foundry dependency. The command independently verifies that public CLI release before assembling locked package bytes, runs C1's public runtime inspection from the isolated tree, and uses C1's public writer to produce the archive. It rechecks source before returning the receipt and readable report. No source/version/registry/publish override is available. Its `npm-production-input` result is a prepared assembly input, not a complete runtime or released F1.

`projectFoundryProductionLock` reads the sole owning pnpm lock and the exact direct dependency declaration from the public package. It requires the pnpm 9.0 lock format, one root importer and coherent exact root versions. Strict YAML parsing rejects duplicate keys, aliases, multiple documents and invalid UTF-8. The projection follows every required snapshot edge, binds canonical SHA-512 package integrities and default public-registry tarball locations, and excludes development-only nodes. Its source byte count/hash refer to the original lock, including its development graph; the derived JSON is release evidence, not a second authoritative package-manager lock.

The current qualified closure contains 16 packages with one version per package name. `materializeFoundryProductionPackages` consumes a fresh in-process projection, downloads those exact public tarballs without credentials/redirects, verifies their locked SHA-512 and extracts them into a new physical `node_modules` tree. It performs no version/range resolution, package-manager install, lifecycle execution or floating dependency lookup. Each tarball's manifest name/version and dependency/peer declaration must match the locked graph. The optional `@opentelemetry/api` peer declared by Supabase is explicitly recorded as absent; it is not silently installed or counted as shipped software. A missing required peer or an absent peer that would accidentally resolve in the flattened tree fails. Other optional package graphs, peer-context locators, aliases, non-registry resolutions or multiple versions of one name require an explicit layout/qualification change before use; they cannot silently select another layout.

The source tar extractor accepts bounded gzip npm archives with complete regular files under `package/`. Before creating a payload root it checks portable paths, case-folded duplicates, file/directory collisions, complete bodies and unpacked/count bounds. It rejects links, special entries, outside-prefix paths and malformed archives. Extraction uses the maintained tar library with strict parsing, ownership/path protections and bounded metadata; every extracted file is then compared with the preflight byte inventory. Modes normalize to 0644/0755, including on Windows; empty payload files remain valid. Existing destinations are never replaced and failures remove only the newly owned tree. This upstream npm reader does not relax C1's separate canonical component archive contract.

Production-tree results are fresh in-process evidence. `collectFoundryNpmMetadata` rechecks retained license bytes against the package inventory, preserves complete texts, and deduplicates identical texts by digest. Its license index binds each package, original archive/path or exact upstream source, declared license and copied file hash. The npm saxes 6.0.0 archive omits LICENSE: the reviewed supplement in `specs/release/` binds its exact package integrity and upstream commit `211fa0ebec9b628affc09219199639887174bfc3`, which matches both npm `gitHead` and the dereferenced `v6.0.0` tag. Full historical notices are retained. A new missing license needs its own reviewed source; the tool never invents license text or applies the saxes exception to another artifact.

`createFoundrySpdxDocument` emits deterministic SPDX 2.3 package/dependency data with exact archive checksums, source locations and retained license references. It rejects an incomplete graph or unsupported source/version/platform context. Its timestamp is normalized to the owning source commit; its namespace also binds the sorted software facts. Package-level metadata sets `filesAnalyzed: false` and does not claim per-file license conclusions; C1's component manifest separately binds every shipped file. The document is validated against the unmodified upstream SPDX 2.3 schema pinned in `specs/release/upstream-assets.json`. That catalog preserves its source commit, digest, attribution and CC-BY-3.0 license URI. The exact schema is excluded from formatting so its source digest remains valid; these source release assets are absent from the npm allowlist.

The production dependency payload is an input to complete runtime-component assembly. Its npm-only SBOM and candidate archive do not qualify a complete Node/C1/Foundry/TIDAS component, native host compatibility, public downloads or the final product manifest. Final assembly must include the selected native/software artifacts and their metadata, use the public C1 component writer, and pass every declared platform's actual consumer/manager/bootstrap gate.

## Native release inputs

`pnpm release:prepare-native --output <new-absolute-directory>` binds its clean source and current supported host to the reviewed Node/TIDAS entries in `specs/release/runtime-inputs.json`. It offers no platform, version, source or registry override. Native downloads use a bounded HTTPS transfer through official artifact hosts, verify the pinned SHA-256 before parsing, and select only the declared executable, license and distribution metadata. The tar reader never extracts unrelated files; selected links/duplicates and missing or oversized entries fail. ZIP decoding uses development-only fflate 0.8.3 into memory and writes only the fixed regular output files, never archive-supplied filesystem links or paths.

The current Node input is24.19.0 at source `cdc1b38d40cb567b7ad0b39c86addf830a0af0ae`; its official SHASUMS256 entries pin the four targets. The source LICENSE is byte-identical to the selected macOS release LICENSE. Windows uses the official `win-x64/node.exe` plus that checksum-bound source license. TIDAS0.2.1 is pinned to actual release target `8f930e0bf7c2e86741c95812aa21652d99eacc7e`, as recorded by the owning release request; workspace-integrated `ff49fe3` is the later request/review commit, not the binary build target. The command checks the TIDAS distribution manifest, executes the downloaded Node to verify version/architecture, and uses the existing TIDAS version/validation handshake in an isolated home. It records native observations, selected file hashes, upstream sources, licenses and SPDX data as assembly inputs.

Native handshake success is not minimum-host or clean-machine qualification. Current binary inspection finds Node macOS minimum13.5 and TIDAS minimum11.0; both TIDAS GNU Linux targets require GLIBC2.38. The current Windows TIDAS PE imports `VCRUNTIME140.dll`, absent from its archive. This known requirement is recorded in the input profile/report, and [tidas-tools #181](https://github.com/tiangong-lca/tidas-tools/issues/181) owns the correction before complete Windows/F1 qualification. A development runner's installed VC runtime cannot substitute for that fix.

## Qualification

`pnpm package:build` rebuilds both output roots from scratch and verifies the staged package. `pnpm package:check` compares the stage with the descriptor, runs a pack dry-run, and verifies the installed C1 descriptor. `pnpm package:pack` packs only `package-stage/` into an owned temporary directory, derives the versioned archive name from the verified staged descriptor, then installs it with an exclusive hardlink. The repository manifest, compiled verifier version and descriptor JSON Schema version remain coherent release projections; the verifier never takes its expected identity from the installed manifest it is checking. An identical existing archive is reused; a link, invalid file or different existing bytes are preserved and rejected rather than overwritten.

The package scenario rebuilds twice, packs twice byte-identically, and installs the same tarball into two clean consumers; the second install is offline from the first consumer's isolated public cache. It verifies the exact import surface and declarations, public CLI 0.1.10 runtime identity, shebang/bin, source/installed operation equivalence, arbitrary Unicode CWD, read-only package bytes, isolated workspace writes and all six facade operations. It also proves that internal commands, modified/extra/linked files, a lifecycle-bearing manifest, a `darwin-x64` descriptor and a package copied without C1 fail closed.

These checks qualify a local candidate tarball. They do not prove registry provenance, public component download, native TIDAS availability on every host or a complete Node+CLI+Foundry+TIDAS component. Those are W08 release gates.

Version rehearsal also runs the complete gate after the coherent version projection in an isolated source checkout. Synthetic current-host manifests used by migration and runtime-selection tests follow the executing repository package version; explicitly older and untrusted selections still test rejection. Passing only the unchanged `0.1.0` source tests does not prove that a versioned release can pass the gate.

The W10 planning extension adds the shared pure attempt leaf and bounded migration plan/stage readers to the public graph, plus the transfer-plan schema and migration contract. It still excludes the internal capsule command and all developer commands. Future package qualification must use the rebuilt descriptor/tarball; the earlier W06 tarball remains an immutable baseline artifact.

The W10 transfer extension ships bounded transfer I/O and staging/audit owners plus pending-marker and receipt schemas. It still has no install lifecycle effects, no business mutation dispatcher and no automatic activation; source-free consumers can explicitly stage and audit the same v2 plans.

The adoption extension ships migration planning/application/authority/scope guards, explicit read/write access, runtime selection and their strict schemas. The package descriptor lists both supported read and write schemas while retaining v1 as the default initialization schema; v2 writes additionally require the trusted host feature selection. Public CLI apply/runtime-use remain separate explicit actions, never install hooks. Source and installed packages must qualify the same behaviors; managed component publication/bootstrap remains W08.
