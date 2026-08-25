---
title: Acceptance Loop Notes
docType: reference
scope: acceptance-loop
status: active
authoritative: false
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when checking why Foundry has local acceptance-loop hooks and JSON reports
  - when maintaining the Codex Stop hook or acceptance-check command shape
whenToUpdate:
  - when acceptance-check, Stop hook behavior, or artifact report policy changes
checkPaths:
  - docs/agent-harness-cli-comparison.md
  - docs/file-organization.md
  - docs/codex-stop-hook.md
  - .codex/hooks.json
  - .codex/hooks/run-foundry-acceptance-check.sh
  - scripts/commands/core.ts
lastReviewedAt: 2026-08-25
lastReviewedCommit: c700a3786b2f152957c9edc8b7be4732a8d543dd
lastReviewedNote: "Reviewed for Issue #67 Wave 26 integration: core acceptance aggregation and orchestration owners move under local RED/GREEN characterization; pnpm Stop-hook invocation, continuation, ignored report policy, environment checks and failure artifacts remain unchanged."
related:
  - docs/file-organization.md
  - docs/codex-stop-hook.md
---

# Acceptance Loop Notes

Foundry keeps a lightweight acceptance loop so agent work is inspectable through artifacts rather than chat summaries.

Useful pattern:

- task-specific contracts live under `specs/acceptance/` when a task needs an explicit artifact checklist;
- deterministic checks write JSON reports under `.foundry/state/`;
- the Codex Stop hook runs `pnpm acceptance:check`;
- blocking failures point the agent at concrete missing or inconsistent files.

The pnpm/TS7 migration extends the same evidence model: `pnpm test:toolchain` checks the single lock/compiler graph and migration inventory, while a clean arbitrary-worktree run proves the project did not borrow dependencies, credentials, or ignored runtime state from the developer checkout.

`scripts/commands/core.ts` owns the local acceptance aggregation invoked by the existing package script. Its TypeScript migration preserves workflow, storage, environment and surface-check order plus the same `.foundry/state/acceptance/latest.json` artifact; it does not change Stop-hook registration or introduce a remote check.

Run:

```bash
pnpm acceptance:check
```

The loop checks `.env.example` policy on every run. Task-specific artifact contracts are optional; when `specs/acceptance/` has no JSON contracts, the acceptance loop only runs repository policy checks.
