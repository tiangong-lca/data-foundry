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
lastReviewedAt: 2026-09-04
lastReviewedCommit: 42ae8e94055ba7f912fdbd38fe16479409338033
lastReviewedNote: "Reviewed for Issue #76: immutable control blobs, self-hashed receipts, and safe prune/cache policies are pinned."
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

Foundry now pins the published `@tiangong-lca/cli@0.1.9` release. CommandSpec, batch/run-lock, and strict identity receipt parsing are consumed only through the package's public `./command-spec`, `./batch`, and `./auth-identity-receipt` exports; Foundry must not deep-import `dist/src/**`, expose CLI test internals, invent a compatibility wrapper, or copy the CLI scheduler/parser into semantic modules. LCA/profile semantics, Foundry reports, test-only receipt fixture bytes, and remote-write gates remain Foundry-owned adapters around those public primitives.

`cli-bounded-batch-runner.ts` is the generic executable delegation boundary: it creates the public run contract, acquires `withBatchRunLock`, and calls `runBoundedBatch`. `foundry-scope-batch-runner.ts` projects Foundry scope content/policy/executable authority, family-group exclusive keys, bounded concurrency, pause/stop, events, and readback-only mutation recovery. The callback remains Foundry-owned and returns the same scope status projection after semantic execution or explicit ambiguous/no-replay recording. The five-line command facade contains no implementation; `bafu-batch-command-runtime.ts` is the explicit composition root and contains no alternate worker counter or `Promise.all` claim loop.

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
| BAFU category-map closure-wide status and blocker report | `scripts/lib/bafu-classification/category-map-report.ts` | decision/task file I/O and artifact writes |
| Canonical description JSON validation and cloning | `scripts/lib/canonical-description.ts` | canonical selection, file I/O, stage orchestration, or remote authority |
| Library entity index and process-bundle scope projection | `scripts/lib/library-orchestration/entity-projection.ts` | directory enumeration and artifact writes |
| Ready process-scope input-order report/checkpoint projection | `scripts/lib/library-orchestration/ready-process-scope-runner.ts` | CommandSpec execution, generic scheduling, and CLI contract semantics |
| Artifact-bound ready-scope command execution and logs | `scripts/lib/library-orchestration/ready-scope-command.ts` | scope readiness, ordering, batch claims, and report aggregation |
| Ready-scope content/policy/CLI contract and scheduling adapter | `scripts/lib/library-orchestration/ready-scope-scheduler.ts` | LCA readiness, blockers, command results, and artifacts |
| Ready-scope filtering, classification preflight, family ordering, and preflight rows | `scripts/lib/batch-orchestration/scope-selection.ts` | ledger reads, profile adapters, worker execution |
| Location task-queue path/bytes/SHA binding and post-suggest verification | `scripts/lib/batch-orchestration/location-task-queue.ts` | task build, semantic suggestion/apply, taxonomy choice, and report aggregation |
| Universe and ledger coverage | `scripts/lib/batch-orchestration/universe-coverage.ts` | command help/options and report destination |
| Finalize blocker/recovery eligibility | `scripts/lib/bafu-orchestration/finalize-recovery-policy.ts` | subprocess, CommandSpec, retries, file reads |
| Post-finalize recovery dispatch and exact argv projection | `scripts/lib/bafu-orchestration/post-finalize-recovery.ts` | stage selection, report interpretation, and downstream retry policy |
| Same-id/version lost-success eligibility | `scripts/lib/same-identity-commit-recovery.ts` | commit dispatch, report discovery, verification, or closeout |
| Process verify and closeout argv planning | `scripts/lib/bafu-orchestration/process-handoff-plan.ts`, `scripts/lib/bafu-orchestration/process-handoff-closeout.ts` | stage execution, report parsing, retry, and semantic acceptance |
| Batch commit, post-write verify/retry, and closeout | `scripts/lib/batch-orchestration/post-write-handoff.ts` | stage runner, timeouts, profile/scope labels, and report aggregation |
| Per-dataset finalize, support reuse/commit, recovery, and handoff | `scripts/lib/batch-orchestration/scope-finalize-commit.ts` | injected finalize/identity/handoff services, paths, and profile context |
| Scope content/policy/executable resume authority and source-byte facts | `scripts/lib/batch-orchestration/scope-resume-contract.ts`, `scope-source-content.ts` | profile options, input discovery, and report aggregation |
| Verified/blocked contract matching and blocker re-admission | `scripts/lib/batch-orchestration/scope-resume-ledger.ts`, `scope-resume-projection.ts` | ledger locations and selected-scope policy |
| Durable consumed-attempt state and CLI event compaction | `scripts/lib/batch-orchestration/scope-attempt-ledger.ts` | command-owned files and reader counts |
| Exact flow payload carry-forward and verified-row writing | `scripts/lib/batch-orchestration/flow-resume-ledger.ts`, `verified-flow-write.ts` | flow finalize/commit and identity semantics |
| Process finalize checkpoint and report-byte authority | `scripts/lib/bafu-orchestration/process-scope-resume.ts` | process workflow options, execution, and report projection |
| Immutable control blob identity and hardlink/copy/reuse | `scripts/lib/batch-orchestration/control-artifact-store.ts` | scope reference choice and reader reports |
| Receipt schema, locator projection, and post-prune verification | `control-receipt-contract.ts`, `control-reference-projection.ts`, `control-receipt-verification.ts` | profile execution and payload semantics |
| Receipt-before-prune orchestration and ownership-safe deletion | `scope-control-retention.ts`, `scope-safe-prune.ts`, `scope-scratch-policy.ts` | verified-state admission and run/store locations |
| Recomputable shared-context cache eviction | `shared-context-cache-prune.ts` | cache cap and keep-scratch option |

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
- source bundle/shared context bytes, profile options, stage policy, CommandSpec projection, and exact installed CLI package in the current authority;
- one compact active state per consumed incomplete mutation attempt, with no replay until exact readback recovery succeeds;
- canonical payload SHA matching before a verified Flow row can be carried forward;
- an exclusive run-root lock before multiple processes can share output/ledger state.

Foundry injects profile and report projection. The generic engine must not know BAFU, USLCI, Worldsteel, dataset blocker codes, or Foundry filenames.

## 5. Evidence from real runs

The local ignored-runtime audit intentionally excluded credentials, receipt bodies, and data payloads. It found approximately 252 GiB of historical state, including about 173 GiB of Worldsteel batch/pilot copies. One USLCI run produced 10,830 checkpoints for 1,358 scopes over six resume rounds; a scope reached 50 snapshots. Of 75,400 historical artifact locators, only 326 still existed after scratch cleanup. Identity preflight consumed about 39.4 cumulative hours, and one outage produced 129 retryable finalize timeouts that later cleared.

These observations are design inputs, not payload fixtures to commit. Sanitized Issue #75 tests retain the real 1,358-scope cardinality and outage transitions: active attempt state compacts to at most one row per affected scope and the transient event file returns to zero after a completed run. Issue #76 uses the same durable observations without committing payloads: 34 Worldsteel pilot references plus six rounds of 1,358 USLCI references deduplicate identical control bytes to one blob; payloads retain only explicit bytes/SHA facts after pruning. Current and historical-shaped reports receive the same receipt/locator form. Missing controls, invalid receipts, blob drift, path escape, and scope/store/cache symlinks fail before deletion. Issue #75 binds scope source/shared bytes, options, stage/CommandSpec/CLI fingerprints, process checkpoint output bytes, and canonical Flow payloads; legacy ledgers are explicitly distrusted, repaired blocker authority is re-admitted, and consumed ambiguous mutations require readback rather than replay. Issue #74 replaces raw argv/fake parallel execution with public CommandSpec and locked CLI batch contracts. Issue #77 separately makes exact names subordinate to the ordered physical-equivalence reasons. Issue #78 preserves multilingual canonical description JSON through every rewrite-ledger consumer and rejects lossy/non-JSON values before mutation. Issue #79 makes every emitted category-map manual-review row closure-blocking even when no current task references it, while preserving resolved report bytes. Issue #80 binds every post-finalize recovery projection to the full executed executable/argv and rejects projector drift. Issue #81 requires structured `23505` plus exact same-id/version semantics, one commit dispatch, and exact readback before closeout. Issue #83 binds suggestion/apply to one location queue artifact fact and rejects TOCTOU drift. Move-only #70 did not silently resolve any of them.

## 6. TDD and equivalence

Every extraction begins with a failing contract that imports the intended semantic owner. GREEN first moves existing logic without changing regexes, precedence, option defaults, stage order, object insertion order, stdout, exit status, report paths, hashes, retry classification, or write authority.

Issue #74 freezes public CommandSpec function identity, artifact drift before spawn, raw-array rejection, real max concurrency, exclusive process identity, input-ordered checkpoints/reports, one-attempt mutation failure, pause-before-claim, stop closure, exception isolation and exact CLI package identity. The explicit command-stage/report migration changes only raw array fields to full CommandSpec objects and updates their byte hashes. The command owner stays 494/494 lines, runner 310/314, command leaf 79/140 and scheduler below 140, with no new cycle; the 367-line local CommandSpec implementation is removed.

Issue #75 freezes scope authority and recovery at four layers. `scope-resume-contract.test.mts` changes real bundle/shared bytes, options, CommandSpec, CLI version, and stage policy; `scope-attempt-ledger.test.mts` preserves 1,358 consumed outage attempts in one compact row each and proves rejected drift cannot replace the old attempt contract; `process-scope-resume-contract.test.mts` rejects legacy/tampered checkpoints and output reports; `flow-resume-ledger.test.mts` rejects identity-only or changed-payload Flow reuse. Command tests prove exact verified skip, legacy invalidation, repaired-blocker re-admission, pending/limit behavior, and reader artifacts. The composition root remains exactly 1,700 lines, generic CLI boundary 45, Foundry scope adapter 189, and every new resume/write leaf stays below its shrink-only ceiling with no new SCC.

Issue #76 freezes retention at current and historical-shaped boundaries. `control-artifact-retention.test.mts` runs 34 Worldsteel pilot references plus 6×1,358 USLCI references, exact scope receipt/prune, hardlink-to-copy fallback, idempotent reuse, read-only sealing, missing-control fail-close, symlink/store escape, unrecoverable CAS failure, and payload fact-only disposition. The real BAFU command test requires scope report/receipt/prune/store artifacts and ownership-safe shared-cache reports. Failed or ambiguous scopes keep scratch; only verified scope execution calls retention. The composition root remains exactly 1,700 lines and every new CAS/projection/verification/prune module remains below its independent ceiling with no new SCC.

Issue #78 freezes a real two-language description at four boundaries: library process-reference plus exchange-ledger JSONL bytes/SHA, batch resolution decision bytes/SHA, identity-apply to process-reference transport, and BAFU carry-forward output/report bytes. Scalar strings remain scalar; functions, BigInt, cycles, sparse arrays, and other lossy values fail before payload mutation. The shared validator stays below its 100-line ceiling, `decision-apply.ts` shrinks under 667 lines, identity-patch and carry-forward remain at their prior 618/586 ceilings, and cycle analysis remains unchanged.

Issue #80 freezes every post-finalize recovery stage against the captured invocation. Identity and semantic success, nonzero exit, thrown execution, missing reports, and an intentionally corrupt projector all require the same ordered `{ executable, argv, display }` shape. Exact result bytes/SHA are updated only for that explicit report-contract migration. One source call each to `runArgvStage`, `commandString`, and `projectCommandStage` prevents reconstruction drift, while the semantic module remains at 539/540 lines and cycle-free.

Issue #83 freezes one location queue discovery and the exact path/bytes/SHA fact used by both suggestion and apply. Missing, changed-length, same-length changed-hash, and relative-path drift cases stop before apply with expected/observed facts. The 89-line binding leaf stays below 120, `scope-preparation.ts` remains at 532/532, cycle analysis is unchanged, and the stable verified-resume report/ledger byte contracts do not move.

The process and batch post-write handoff slices characterize strict lost-success recovery: explicit `23505` plus exact same-id/version semantics may proceed to verification, while text-only, mixed, malformed, or incomplete evidence fails without replay. Exact readback must prove owner, state, identity, version, payload, and root closure; mismatch, unexpected, missing, or exhausted reports never close out. Retryable readback failures preserve attempts and exponential delay, and ordinary commit failures stop before verification. The finalize/commit slice adds five cases for missing reports, verified support reuse, stale support invalidation plus fresh commit/cache, exact recovered-row evidence, and support-failure short-circuiting. The CLI boundary adds four focused cases for public contract/run-lock release, pause/stop closure, family serialization with independent progress, and command delegation. The public batch owner is now 5 lines (ceiling 20); the 1,649-line composition root is visible under a separate 1,700-line shrink-only ceiling, while the 166-line CLI adapter, 136-line authoring filter, 149-line recovery evidence, 68-line scratch policy, 534-line batch handoff, 478-line process handoff, and 425-line finalize/commit modules remain independently budgeted.

Required evidence grows with the boundary:

- pure rule: realistic cases plus exact `JSON.stringify` bytes/key order/SHA;
- artifact projection: old/new fixture files byte-identical;
- selection/resume: BAFU plus real-shaped USLCI and Worldsteel preflight/replay cases;
- execution migration: CommandSpec drift, pause/stop, ordering, ambiguity, recovery, and run-lock cases;
- repository delivery: lint, TS7 typecheck, full tests, Golden diff, surface audit, build, audit, and Docpact.

Production-account cases remain outside ordinary tests. They may use only the designated account's authorized isolated drafts, with public reads allowed and foreign/public/shared mutation plus review/publish prohibited. LangGraph remains entirely excluded.
