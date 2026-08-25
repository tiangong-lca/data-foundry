---
title: Codex Stop Hook
docType: runbook
scope: repository
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when diagnosing or updating the repository-local Codex Stop hook
  - when checking which acceptance command blocks task completion
whenToUpdate:
  - when Stop-hook registration, command invocation, output, or recursion behavior changes
checkPaths:
  - docs/codex-stop-hook.md
  - docs/agent-harness-cli-comparison.md
  - .codex/hooks.json
  - .codex/hooks/run-foundry-acceptance-check.sh
  - package.json
lastReviewedAt: 2026-08-25
lastReviewedCommit: 8e7f3efa4c9586ff9ceab68f2ed454f8c3af2ccf
lastReviewedNote: "Reviewed for Issue #67 Wave 26 freshness: five orchestration owners move to TS7 without changing Stop-hook registration, pnpm acceptance invocation, output, artifacts, or recursion guard."
---

# Codex Stop Hook

Foundry uses a repository-local Codex Stop hook to prevent an agent turn from finishing when required acceptance artifacts are missing or inconsistent.

## Files

- `.codex/hooks.json`: registers the Stop hook.
- `.codex/hooks/run-foundry-acceptance-check.sh`: runs the foundry acceptance check and translates failures into a Codex continuation decision.

## Behavior

When Codex attempts to stop:

1. the hook runs `pnpm acceptance:check`;
2. if checks pass, the hook exits without output and the turn may finish;
3. if checks fail, the hook prints JSON:

```json
{
  "decision": "block",
  "reason": "Foundry acceptance checks found blocking failures..."
}
```

For Stop hooks this means the agent should continue with the `reason` as the next prompt, repair the concrete artifacts, and rerun the acceptance check before finishing.

## Runtime Outputs

The hook writes ignored runtime files under `.foundry/state/`:

- `.foundry/state/hooks/foundry-acceptance.summary.txt`
- `.foundry/state/hooks/last-stop-hook-event.json`
- `.foundry/state/acceptance/latest.json`
- `.foundry/state/acceptance/continuation-prompt.md`

These files are local runtime evidence and should not be committed.

## Manual Debugging

```bash
pnpm acceptance:check
bash .codex/hooks/run-foundry-acceptance-check.sh
```

The hook has a recursion guard through `FOUNDRY_ACCEPTANCE_HOOK_ACTIVE=1`.
