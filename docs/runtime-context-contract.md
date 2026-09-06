---
title: Foundry Runtime Context and Filesystem Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when resolving Foundry package assets or a user workspace
  - when adapting an existing command owner to the consumer runtime
whenToUpdate:
  - when runtime layout, root ownership, input facts or workspace initialization changes
checkPaths:
  - package.json
  - scripts/foundry-runtime.ts
  - scripts/foundry-facade.ts
  - scripts/runtime-entry.ts
  - scripts/lib/foundry-runtime-context.ts
  - scripts/lib/foundry-runtime-command-policy.ts
  - scripts/lib/foundry-runtime-qualification.ts
  - scripts/lib/foundry-execution-admission.ts
  - scripts/lib/foundry-facade-store.ts
  - scripts/lib/foundry-migration-inventory.ts
  - scripts/lib/foundry-runtime-paths.ts
  - scripts/lib/foundry-package-contract.ts
  - scripts/package-entry.ts
  - scripts/public-api.ts
  - tsconfig.package.json
  - specs/schemas/foundry-package-descriptor.schema.json
  - scripts/lib/tidas-adapter.ts
  - scripts/lib/import-curation/internal/runtime-io.ts
  - scripts/lib/import-curation/curation-cleanup.ts
  - test/unit/runtime-layout.test.mts
  - test/unit/foundry-package-contract.test.mts
  - test/unit/foundry-runtime-context.test.mts
  - test/unit/foundry-runtime-command-policy.test.mts
  - test/unit/foundry-runtime-qualification.test.mts
  - test/unit/foundry-runtime-authority-schemas.test.mts
  - test/scenarios/runtime-workspace.test.mts
  - test/scenarios/foundry-execution-admission.test.mts
  - test/scenarios/foundry-package-consumer.test.mts
lastReviewedAt: 2026-09-06
lastReviewedCommit: 292c5bba283c62e24b0ffc53f3b7d128ea6b9f92
lastReviewedNote: "Reviewed for Foundry #112: the source-only production-input command now owns the lock/materialization/SPDX call graph, binds a clean source and reviewed public C1 input, and returns a verified archive plus receipt. Public runtime behavior is unchanged; complete native Node/F1/TIDAS assembly and final release qualification remain pending."
related:
  - docs/architecture.md
  - docs/task-authorization-contract.md
  - docs/public-runtime-contract.md
  - docs/package-distribution-contract.md
---

# Runtime context

Local preparation enters the registered v2 task store in `foundry-task-store.ts`; it binds source/profile/actor/runtime metadata and revalidates indexed producer lineage before using derived input. Fresh CLI identity, exact runtime qualification, registered authorization, derived-input succession and child execution admission are exposed through the runtime API. Account intent remains separate from authentication. The API returns a reviewed CommandSpec to the existing no-replay owner; it does not execute or retry a mutation itself.

The consumer runtime receives an explicit `FoundryRuntimeContext`. Construction reads package identity and an explicitly selected/discovered workspace marker, but never loads `.env`, creates state, changes CWD or performs authentication. A process-local brand prevents serialized context data from becoming an executable context. `accountIntent` is expected identity, not proof of login or permission; `actorId` is caller intent and must also be checked against durable task state before execution.

The runtime entry now exposes the six W05 hierarchical operations described in `public-runtime-contract.md`, while retaining the old source developer commands. The facade delegates cleanup to the existing owner with scoped I/O rather than duplicating transforms. All 63 internal commands keep their explicit disposition in `foundry-runtime-command-policy.ts`; the six public operations are a separate orchestration surface over those owners. Repository maintenance remains excluded, and task/native families remain internal with declared asset/input/output roots, child-process ownership, qualification and authorization requirements.

## Runtime qualification and child admission

`qualifyFoundryRuntime` compares an independently selected CLI expectation with the exact installed `@tiangong-lca/cli@0.1.10` runtime descriptor. It also compares a strict TIDAS expectation with the selected platform, executable bytes, compatible 0.2.x version, validation protocols, event schemas and asset fingerprint. The selected TIDAS executable is copied into a private temporary directory, rehashed there and invoked with the credential-free child environment; both handshake calls must be silent. Qualification uses a process-local brand. The portable identity described by `runtime-qualification.schema.json` is diagnostic evidence and cannot be deserialized into authority.

The TIDAS expectation admits only `linux-x64`, `linux-arm64`, `darwin-arm64` and `win32-x64`; `darwin-x64` cannot enter the schema or runtime context. `tidas-runtime-expectation.schema.json` is the reviewed machine shape. Qualification creation performs the isolated version/protocol/assets handshake once. Every later assertion reopens and hashes the selected executable and rejects any byte drift before child admission; identical immutable bytes do not replay the handshake. This keeps the original observed behavior bound to exact content while avoiding repeated child-process creation inside one admission call.

`execution-context.schema.json` describes the content-addressed child handoff stored under `evidence/executions/`. It is distinct from the older offline `foundry-execution-capsule-stage.v1` admission ledger: the older contract proves immutable staged evidence and attempt state, while `tiangong-foundry.execution-context.v1` binds a current task invocation. Rehydration requires a fresh process-local context, qualification and identity; exact workspace/task/actor, approved source ancestry, current final-row bytes, active authorization and QA waivers, installed owner CLI, owner-draft argv semantics, task-contained output root and CommandSpec digest are rechecked. The action list must match the CLI operation. Serialized admissions, unrelated CLI commands and changed capsule/spec/input bytes fail closed.

## Root ownership

| Root | Meaning and authority |
| --- | --- |
| `runtimeRoot` | Immutable executing package. No user outputs or state may be written here. |
| `assetRoot` | Reviewed runtime schemas, profiles and semantic documents within the package. |
| `workspaceRoot` | User-selected project, independent of the package and current CWD. |
| `controlRoot` | `<workspace>/.foundry`; versioned workspace coordination. |
| `stateRoot` | Workspace coordination records; not arbitrary task outputs. |
| `taskRoot` | `<workspace>/.foundry/workspaces/<task-id>` for one explicit task. |
| `tempRoot` | Recomputable scratch space within the selected task/control root. |
| `cacheRoot` | Recomputable Foundry content under the OS user cache, isolated by runtime identity, platform, workspace and account intent. Managed executable components remain CLI-owned. |

`--workspace` selects a project explicitly. Otherwise only an existing `.foundry/workspace.json` marker discovered upward from the caller's CWD establishes a workspace. Filesystem roots, the package directory, installed `.agents/skills` / `.codex/skills` paths and `_npx` directories are rejected as workspaces. No failed lookup falls back to the package root.

Node must be at least 24.19 and below 25. The admitted platform matrix is macOS arm64, Linux x64/arm64 and Windows x64. Admission runs before workspace mutations or input capture. macOS Intel is unsupported.

## Package layout

`package.json.foundryRuntime` accepts the retained `tiangong-foundry.runtime-layout.v1` source/emitted shape and makes v2 authoritative for new builds. V2 adds `package_entry` and `package_descriptor` while preserving the developer `source_entry` and full-repository `emitted_entry`. All paths are relative, contained and regular where a file is required. The resolver chooses the declared tree that contains the active module; unknown schemas, ambiguous roots and path traversal are rejected. An installed package needs neither source `.ts`, full `dist`, Git nor a workspace, and a copied name-only manifest cannot hijack a nested build's root.

The layout resolver proves local layout and reports package-manifest/entry digests. When only the package entry is present, it also verifies the strict package descriptor, exact payload set and sanitized public manifest before creating a context. This does not replace W08 release provenance or the CLI runtime manager's component verification. Source maps, maintenance tools and live-case drivers are absent from the W06 closure.

## Workspace marker and initialization

The default initialization marker is `tiangong-foundry.workspace.v1`, with `layout_version: 1`, a UUID `workspace_id` and a UTC creation time. Initialization installs a complete marker through an exclusive atomic hardlink from an owned temporary file. A concurrent winner is re-read and validated. Repetition preserves existing bytes and workspace identity, then verifies required control directories. An interrupted recognized v1 initialization may complete its directories; unknown marker versions are never overwritten.

An unversioned nonempty `.foundry` requires explicit inventory/migration. Initialization does not label old state as new, clear old attempts or replay work. In particular, no real #95 workspace is migrated by this implementation.

## Inputs and outputs

User-selected external inputs are regular files captured as canonical path, byte size and SHA-256. Capture streams hashes and detects changes while reading. Data reads require a selected fact and matching current bytes; file descriptors are checked against the selected file before reading. Credential `.env*` files and an account's session reference cannot become dataset inputs. This selection boundary does not make a data file's instructions authoritative.

Task artifacts are written only under the selected `taskRoot`; state and cache have distinct resolver areas. Existing path components and physical containment are checked, including after directories are created. Symlink/junction escapes and a changed workspace marker are rejected. A complete new artifact is installed exclusively from an owned temporary file. Existing identical bytes may be reused; different existing bytes require a new output revision. A failed operation never deletes a prior artifact.

The default in-memory data-read bound is 64 MiB; native/streaming stages must declare and enforce their own larger-input protocol instead of silently loading unbounded payloads. Cache contents and layout records are not write or replay authority.

## Facade state and downstream integration

W05 stores request indexes and task pointers under workspace state. Their deterministic revision identity binds normalized task spec plus ordered canonical input facts; task payloads and outputs remain in the W04 task store. Status and resume reconstruct the context from those records and recheck original bytes. The facade does not treat request state as permission or attempt authority.

W06 builds only the required facade/runtime modules, schemas and assets and proves the same behavior from a source-free read-only installed candidate; `package-distribution-contract.md` owns that exact closure. W08 publishes F1 and binds the process-local runtime-selection interface to an immutable CLI-manager product manifest. Local preparation does not grant restricted writes; W03 task permissions and existing attempt/readback no-replay controls remain mandatory. Developer maintenance entrypoints, tests and private case drivers remain excluded from the consumer artifact.

The shared `assertFoundryRuntimeHost` gate also protects inventory-only migration, which cannot construct a context from an unknown legacy marker. Transfer planning constructs the destination context before reading the source and requires disjoint canonical roots with no existing destination `.foundry`. It does not initialize either workspace. See [workspace migration](workspace-migration-contract.md) for transfer, explicit adoption/activation and rollback boundaries.

A strict `workspace-migration-pending.v1` marker returns no active workspace id. `initializeFoundryWorkspace` and consumer doctor explicitly reject pending state. Migration staging/audit can inspect it to recover its exact claim and preserved archive; normal task creation remains unavailable until a separately audited activation.

Facade revision lookup validates retained predecessor jobs/publications without requiring their original input bytes to match a new revision. It checks every earlier revision for attempt evidence and refuses descendant continuation when any is present. Missing/changed predecessor storage is preserved as a recovery condition. This read-only request-chain check does not change runtime qualification or replace W10's complete migrated-task history and activation requirements.

Migrated `workspace.v2` state binds an activation receipt, required features and an extension object. Construction validates the anchored migration documents and requires an independently trusted host selection. Write access must qualify the executing Foundry version and every required feature; unknown write features fail closed. The internal pending-adoption scope supplies a future id only during the bounded local callback and cannot survive it or create authorization/execution admission. Read-only task inspection skips write locks and cannot repair missing records. Read-compatible inspection may verify retained older runtime/profile snapshots without treating them as current write rules.

`state/runtime-selection.json` records an explicit component selection and read/write mode. Ordinary writes must match it. The dedicated selector requires an independently qualified current writer, verifies/pins both component versions through the public CLI manager, and records selection history without rewriting the workspace marker or business state. An explicit CLI session reference cannot be read as marker or protected migration metadata.
