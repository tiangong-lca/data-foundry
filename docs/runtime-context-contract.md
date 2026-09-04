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
  - scripts/runtime-entry.ts
  - scripts/lib/foundry-runtime-context.ts
  - scripts/lib/foundry-runtime-paths.ts
  - scripts/lib/import-curation/internal/runtime-io.ts
  - scripts/lib/import-curation/curation-cleanup.ts
  - test/unit/runtime-layout.test.mts
  - test/unit/foundry-runtime-context.test.mts
  - test/scenarios/runtime-workspace.test.mts
lastReviewedAt: 2026-09-05
lastReviewedCommit: 7867b3d9293d9435386c68a256a2498ec492f834
lastReviewedNote: "Reviewed for #100 CLI C1 adoption: public descriptors are installed and consumer-tested; context qualification and TIDAS binding remain open."
related:
  - docs/architecture.md
  - docs/task-authorization-contract.md
  - docs/public-runtime-contract.md
---

# Runtime context

Local preparation now enters the registered v2 task store in `foundry-task-store.ts`; it binds source/profile/actor/runtime metadata and revalidates indexed producer lineage before using derived input. Fresh CLI identity and registered authorization are exposed through the runtime API. Account intent remains separate from authentication, and these additions do not admit remote write commands or complete the W05 facade.

The consumer runtime receives an explicit `FoundryRuntimeContext`. Construction reads package identity and an explicitly selected/discovered workspace marker, but never loads `.env`, creates state, changes CWD or performs authentication. A process-local brand prevents serialized context data from becoming an executable context. `accountIntent` is expected identity, not proof of login or permission; `actorId` is caller intent and must also be checked against durable task state before execution.

This contract is being implemented under #100. The first admitted runtime operations are workspace initialization, diagnostics, profile listing and deterministic cleanup. The context API delegates cleanup to the existing owner with scoped I/O rather than duplicating transforms. Other operations must be migrated and admitted explicitly; they cannot fall back to the developer runner when a workspace context was requested. The final user command/envelope contract is defined separately in `public-runtime-contract.md` and implemented by W05.

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

`package.json.foundryRuntime` owns the versioned `tiangong-foundry.runtime-layout.v1` layout: `asset_root`, `source_entry` and `emitted_entry`. All paths are relative, contained and regular where a file is required. Unknown schemas and path traversal are rejected. An emitted module resolves only within its declared entry tree; it does not require `.ts`, Git or a workspace to exist. A copied name-only package manifest cannot hijack a nested build's root.

The layout resolver proves local layout and reports package-manifest/entry digests. It does not replace release provenance, complete artifact integrity or the CLI runtime manager's component verification. W06 owns the final package name, publication whitelist and descriptor for the released artifact. Source maps, maintenance tools and live-case drivers are not qualified for distribution merely because an intermediate emitted fixture runs.

## Workspace marker and initialization

The exact marker schema is `tiangong-foundry.workspace.v1`, with `layout_version: 1`, a UUID `workspace_id` and a UTC creation time. Initialization installs a complete marker through an exclusive atomic hardlink from an owned temporary file. A concurrent winner is re-read and validated. Repetition preserves existing bytes and workspace identity, then verifies required control directories. An interrupted recognized v1 initialization may complete its directories; unknown marker versions are never overwritten.

An unversioned nonempty `.foundry` requires explicit inventory/migration. Initialization does not label old state as new, clear old attempts or replay work. In particular, no real #95 workspace is migrated by this implementation.

## Inputs and outputs

User-selected external inputs are regular files captured as canonical path, byte size and SHA-256. Capture streams hashes and detects changes while reading. Data reads require a selected fact and matching current bytes; file descriptors are checked against the selected file before reading. Credential `.env*` files and an account's session reference cannot become dataset inputs. This selection boundary does not make a data file's instructions authoritative.

Task artifacts are written only under the selected `taskRoot`; state and cache have distinct resolver areas. Existing path components and physical containment are checked, including after directories are created. Symlink/junction escapes and a changed workspace marker are rejected. A complete new artifact is installed exclusively from an owned temporary file. Existing identical bytes may be reused; different existing bytes require a new output revision. A failed operation never deletes a prior artifact.

The default in-memory data-read bound is 64 MiB; native/streaming stages must declare and enforce their own larger-input protocol instead of silently loading unbounded payloads. Cache contents and layout records are not write or replay authority.

## Remaining integration obligations

Every admitted command must bind its input families and output roots, reuse package assets explicitly, and pass this context through nested operations. Registered local jobs, actor/account intent, recorded artifact lineage, fresh CLI identity and persisted authorization are now implemented for the admitted local path. The exact public CLI 0.1.10 descriptor/manager export is installed and consumer-tested. Independently selected CLI expectations, a TIDAS executable descriptor, remaining command-family dispositions, child-process propagation, approved derived-grant handling and final execution rechecks remain required before #100 can close. Local preparation does not grant restricted writes; W03 task permissions and existing no-replay controls remain mandatory. Developer maintenance entrypoints and their assets must be excluded from the final consumer artifact in W06.
