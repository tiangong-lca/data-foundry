---
title: Account Context Policy
docType: policy
scope: runtime-account-context
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when configuring local account labels, account profiles, or remote-write account context
  - when deciding whether a Foundry report or mutation plan may rely on a display account label
whenToUpdate:
  - when account profile, credential, task manifest, or remote-write account guard behavior changes
checkPaths:
  - docs/account-context-policy.md
  - AGENTS.md
  - WORKFLOW.md
  - package.json
  - scripts/with-lca-account.mjs
  - scripts/commands/commit-handoff.mjs
lastReviewedAt: 2026-08-25
lastReviewedCommit: c996633832ea23bf7883c7b219f524bf28e6ce7e
lastReviewedNote: "Reviewed for Issue #63: pnpm account wrapper usage and clean-worktree toolchain tests remain credential-free."
---

# Account Context Policy

Foundry must not hard-code a personal TianGong account name in reusable docs, templates, mutation plans, or public-facing reports.

## Runtime Account Authority

The authoritative runtime scope is the resolved credential/session and the frozen dataset manifest.

`FOUNDRY_ACCOUNT_LABEL` is optional and non-secret. It exists only as a human display label when one operator has multiple local credentials and wants reports to show which local credential set was intended.

Agents must not use the display label to decide:

- which account was read;
- which records are safe to mutate;
- whether remote commit is allowed;
- whether a dry-run or verification gate passed.

Those decisions must come from credentials, source manifests, task policy, mutation plans, dry-run results, and verification artifacts.

## Parallel Account Profiles

When two local tasks must run against different TianGong accounts in the same checkout, do not switch by commenting and uncommenting `TIANGONG_LCA_API_KEY` in `.env`.

Use ignored account profile files instead:

```text
.foundry/account-profiles/<profile>.env
```

Each profile keeps the standard variable names expected by existing CLI and Foundry commands:

```env
TIANGONG_LCA_API_KEY=...
TIANGONG_LCA_SESSION_FILE=/Users/<user>/.local/state/tiangong-lca-cli/<profile>-session.json
FOUNDRY_ACCOUNT_LABEL=<profile>
FOUNDRY_EXPECTED_USER_ID=<resolved-user-id>
```

Run commands through:

```bash
pnpm account:run -- <profile> -- <command> [args...]
```

The wrapper loads the selected profile into the child process using the same `TIANGONG_LCA_*` names, sets `FOUNDRY_ACCOUNT_PROFILE`, and verifies `FOUNDRY_EXPECTED_USER_ID` before running the command unless `--no-auth-check` is passed. This keeps account selection durable in the command and local task metadata instead of relying on chat memory.

Package installation, lint, typecheck, build, unit tests, and the clean arbitrary-worktree toolchain test are credential-free. They must not read `.env`, account profiles, thread guards, or `.foundry` runtime state. A real remote case enters this policy only when it deliberately invokes the exact installed CLI dependency (`pnpm exec tiangong-lca`, backed by `@tiangong-lca/cli@0.1.0`) through the approved account guard.

## Codex Thread Guards

When parallel Codex conversations use different account profiles in the same checkout, bind the profile to the actual `CODEX_THREAD_ID` instead of relying on chat memory or a generic "current conversation" note.

Use an ignored guard file:

```text
.foundry/state/thread-account-guards/<CODEX_THREAD_ID>.json
```

Minimum shape:

```json
{
  "schema_version": 1,
  "scope": "codex-thread-runtime-account-guard",
  "codex_thread_id": "<CODEX_THREAD_ID>",
  "profile": "<profile>",
  "expected_user_id": "<resolved-user-id>",
  "required_command_prefix": "node scripts/with-lca-account.mjs <profile> --"
}
```

`scripts/with-lca-account.mjs` reads this file when `CODEX_THREAD_ID` is present. If a guard exists for the active thread, the wrapper refuses any different profile before running the child command. This makes account selection survive context compaction and prevents cross-talk between two active Codex threads in the same repository.

## Private vs Public Surfaces

Private operator runs may set `FOUNDRY_ACCOUNT_LABEL` in local `.env`.

Public or reusable project surfaces should use neutral language such as:

- credential-scoped account;
- current credentials;
- configured runtime account;
- resolved TianGong session;
- account label, when explicitly referring to the optional display field.

Personal account names may appear only when they are part of a historical source artifact path or a private local task seed. In that case, document them as source artifact labels, not as general product concepts.

## Requiredness

The account label is not required for AI execution.

It can be required for a human-operated local run by setting:

```env
FOUNDRY_ACCOUNT_LABEL_REQUIRED_FOR_HUMANS=true
```

Even then, missing or mismatched labels must block only human-orientation workflows. They must not be treated as proof of data ownership or write eligibility.
