---
title: Foundry Orchestration Module Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when changing library, BAFU, USLCI, or Worldsteel orchestration
  - when deciding whether logic belongs in a command owner, a Foundry semantic stage, or the CLI batch runtime
  - when adding a stage, retry, resume, artifact, or module dependency
whenToUpdate:
  - when an orchestration responsibility moves between modules or repositories
  - when module budgets, dependency direction, stage metadata, or replay contracts change
  - when the public CLI CommandSpec or batch primitive version changes
checkPaths:
  - docs/orchestration-module-contract.md
  - AGENTS.md
  - README.md
  - WORKFLOW.md
  - docs/architecture.md
  - docs/foundry-ai-navigation.md
  - docs/capability-ownership-policy.md
  - scripts/commands/library-scope-workflow.ts
  - scripts/commands/bafu-leaf-classification-tasks.ts
  - scripts/commands/bafu-auto-authoring.ts
  - scripts/commands/bafu-process-scope-e2e.ts
  - scripts/commands/bafu-batch-import-run.ts
  - scripts/commands/uslci-batch-import-run.ts
  - scripts/commands/worldsteel-batch-import-run.ts
  - scripts/lib/bafu-authoring/**
  - scripts/lib/bafu-classification/**
  - scripts/lib/bafu-orchestration/**
  - scripts/lib/batch-orchestration/**
  - scripts/lib/library-orchestration/**
  - scripts/lib/foundry-command-spec.ts
  - scripts/lib/foundry-command-metadata.ts
  - specs/orchestration-module-budgets.json
  - test/unit/*orchestration*.test.mts
  - test/unit/bafu-*-contract.test.mts
  - test/unit/library-*.test.mts
  - test/commands/bafu-*.test.mts
  - package.json
  - pnpm-lock.yaml
lastReviewedAt: 2026-08-29
lastReviewedCommit: 1f0b3b282827b03a009f7acd544a07dd7785baee
lastReviewedNote: "Reviewed for Issue #70: semantic extraction is move-only while public CLI CommandSpec/batch work remains tracked in CLI #232 and behavior changes remain separate Foundry tasks."
related:
  - https://github.com/tiangong-lca/data-foundry/issues/70
  - https://github.com/tiangong-lca/tiangong-cli/issues/232
  - https://github.com/tiangong-lca/data-foundry/issues/74
  - https://github.com/tiangong-lca/data-foundry/issues/75
  - https://github.com/tiangong-lca/data-foundry/issues/76
  - https://github.com/tiangong-lca/data-foundry/issues/77
  - specs/orchestration-module-budgets.json
---

# Foundry Orchestration Module Contract

## 1. Outcome and ownership

The high-level orchestration layer must be easy for an Agent to navigate without moving LCA semantics into generic execution code. Public command owners converge toward help, option validation, stage-contract wiring, and calls into typed semantic modules. Foundry retains profile policy, scope selection, classification and identity meaning, blocker taxonomy, artifact projection, and import-ledger interpretation. The published CLI owns reusable executable-plus-argv validation, bounded scheduling, attempt/recovery mechanics, and mutation no-replay guarantees.

`@tiangong-lca/cli@0.1.1`, still pinned by this Foundry branch, does not expose a public library API. CLI `0.1.2` has now published the reviewed CommandSpec, batch, and run-lock surfaces, but Foundry must first pin and verify that exact release before migrating execution mechanics. Until that dependency wave lands, Foundry must not deep-import `dist/src/**`, invent a compatibility wrapper, or copy the CLI scheduler into semantic modules.

## 2. Baseline and ratchet

Issue #70 started from five owners totaling 16,680 lines:

| Command owner                       | Initial lines |                          Target |
| ----------------------------------- | ------------: | ------------------------------: |
| `library-scope-workflow.ts`         |         2,810 |                     at most 500 |
| `bafu-leaf-classification-tasks.ts` |         2,343 |                     at most 500 |
| `bafu-auto-authoring.ts`            |         3,028 |                     at most 500 |
| `bafu-process-scope-e2e.ts`         |         2,204 |                     at most 500 |
| `bafu-batch-import-run.ts`          |         6,295 | at most 500 after CLI migration |

The executable ceilings are machine-owned by `specs/orchestration-module-budgets.json` and may only decrease. Ordinary semantic stages target at most 800 lines. A pure ordered-rule module may temporarily use the 1,200-line target only when rule precedence is one contract; a larger migration ceiling is debt, not permission to grow. Split by artifact, policy, or stage meaning rather than `part-N` filenames.

The same ratchet enforces dependency direction and SCC stability. `scripts/lib/**` does not import command owners except the explicitly recorded dispatcher edge. The characterized authoring three-module SCC remains the only cycle; no orchestration extraction may add another.

## 3. Semantic stage map

Navigate directly to the narrowest owner:

| Concern | Semantic owner | Command responsibility left above it |
| --- | --- | --- |
| BAFU structured name parsing and functional-unit cleanup | `scripts/lib/bafu-authoring/name-plan.ts` | task loading and patch/report projection |
| BAFU flow/process identity equivalence | `scripts/lib/bafu-authoring/identity-equivalence.ts` | decision batch I/O and command envelope |
| BAFU patch and source-trace projection | `scripts/lib/bafu-authoring/patch-projection.ts` | input/output files and report emission |
| BAFU process/product leaf repair | `scripts/lib/bafu-classification/leaf-repair.ts` | schema loading, sharding, task/report files |
| Library entity index and process-bundle scope projection | `scripts/lib/library-orchestration/entity-projection.ts` | directory enumeration and artifact writes |
| Ready-scope filtering, classification preflight, family ordering, and preflight rows | `scripts/lib/batch-orchestration/scope-selection.ts` | ledger reads, profile adapters, worker execution |
| Universe and ledger coverage | `scripts/lib/batch-orchestration/universe-coverage.ts` | command help/options and report destination |
| Finalize blocker/recovery eligibility | `scripts/lib/bafu-orchestration/finalize-recovery-policy.ts` | subprocess, CommandSpec, retries, file reads |
| Batch commit, post-write verify/retry, and closeout | `scripts/lib/batch-orchestration/post-write-handoff.ts` | stage runner, timeouts, profile/scope labels, and report aggregation |
| Per-dataset finalize, support reuse/commit, recovery, and handoff | `scripts/lib/batch-orchestration/scope-finalize-commit.ts` | injected finalize/identity/handoff services, paths, and profile context |

Some paths may be introduced later in the same Issue #70 branch. A path named here is not executable authority until its code, tests, metadata, and review evidence are merged.

## 4. Execution boundary

Execution stages accept a parsed content-bound CommandSpec, never a rendered shell string. `executable` plus `argv` are authoritative; display text is diagnostic. Artifact facts are revalidated immediately before dispatch. Environment and raw child output are not durable command authority.

The CLI batch contract must provide:

- a run identity plus per-item identity, content digest, and policy digest;
- a finite concurrency ceiling and explicit claim/completion/result ordering;
- pause before claim, stop without killing in-flight work, and resource/exclusive keys;
- monotonic attempt events durably observed before an unsafe dispatch;
- read-only retry classification with injected delay, and mutation no-auto-retry;
- explicit idempotency/readback recovery for an ambiguous mutation;
- exact resume matching and rejection of incomplete or drifting authority;
- an exclusive run-root lock before multiple processes can share output/ledger state.

Foundry injects profile and report projection. The generic engine must not know BAFU, USLCI, Worldsteel, dataset blocker codes, or Foundry filenames.

## 5. Evidence from real runs

The local ignored-runtime audit intentionally excluded credentials, receipt bodies, and data payloads. It found approximately 252 GiB of historical state, including about 173 GiB of Worldsteel batch/pilot copies. One USLCI run produced 10,830 checkpoints for 1,358 scopes over six resume rounds; a scope reached 50 snapshots. Of 75,400 historical artifact locators, only 326 still existed after scratch cleanup. Identity preflight consumed about 39.4 cumulative hours, and one outage produced 129 retryable finalize timeouts that later cleared.

These observations are design inputs, not fixtures to commit. Replay tests use sanitized synthetic cases with the same counts/state transitions. Content-addressed artifact retention is Foundry #76; content/policy-bound resume is #75; raw-argv/fake parallel behavior is #74. Exact-name physical-equivalence repair is #77. Move-only #70 must not silently resolve any of them.

## 6. TDD and equivalence

Every extraction begins with a failing contract that imports the intended semantic owner. GREEN first moves existing logic without changing regexes, precedence, option defaults, stage order, object insertion order, stdout, exit status, report paths, hashes, retry classification, or write authority.

The batch post-write handoff slice is characterized by six focused cases: process, support, and Flow same-id/version conflicts proceed only through successful readback and closeout; retryable readback failures preserve attempts and exponential delay; missing verification reports exhaust the bounded retry count without closeout; and non-idempotent commit failures stop before verification. The finalize/commit slice adds five cases for missing reports, verified support reuse, stale support invalidation plus fresh commit/cache, exact recovered-row evidence, and support-failure short-circuiting. Together they ratchet the batch owner from 2,640 to 1,900 lines; the 559-line handoff and 425-line finalize/commit stages remain under the ordinary 800-line ceiling.

Required evidence grows with the boundary:

- pure rule: realistic cases plus exact `JSON.stringify` bytes/key order/SHA;
- artifact projection: old/new fixture files byte-identical;
- selection/resume: BAFU plus real-shaped USLCI and Worldsteel preflight/replay cases;
- execution migration: CommandSpec drift, pause/stop, ordering, ambiguity, recovery, and run-lock cases;
- repository delivery: lint, TS7 typecheck, full tests, Golden diff, surface audit, build, audit, and Docpact.

Production-account cases remain outside ordinary tests. They may use only the designated account's authorized isolated drafts, with public reads allowed and foreign/public/shared mutation plus review/publish prohibited. LangGraph remains entirely excluded.
