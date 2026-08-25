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
  - scripts/with-lca-account.ts
  - scripts/commands/commit-handoff.ts
lastReviewedAt: 2026-08-25
lastReviewedCommit: a9f003156cd58f223ae2bd4557616c9d9ee65b71
lastReviewedNote: "Reviewed for Issue #67 Wave 24: the typed commit-handoff owner preserves receipt-bound target-user/account-mode checks, current-session binding for unsupported commands, exact CommandSpec artifacts, and no authentication bypass."
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

Each profile keeps the exact credential and intent values required by the installed CLI and Foundry wrapper:

```env
TIANGONG_LCA_API_BASE_URL=https://<expected-project-ref>.supabase.co/functions/v1
TIANGONG_LCA_API_KEY=...
TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY=...
FOUNDRY_ACCOUNT_LABEL=<profile>
FOUNDRY_EXPECTED_PROJECT_REF=<expected-project-ref>
FOUNDRY_EXPECTED_USER_ID=<resolved-user-id>
```

Run commands through:

```bash
pnpm account:run -- <profile> -- <executable> [args...]
```

The wrapper selects only the required LCA credential values from the profile, disables the CLI session cache, forces a fresh signin, and invokes the exact installed CLI 0.1.1 as:

```text
auth identity-receipt --expected-project-ref <ref> --expected-user-id <uuid> --timeout-ms 10000 --json
```

It accepts only an exact, fresh `tiangong-lca.auth-identity-receipt.v1` whose assertions are `intent-bound`, whose project/user match both profile expectations, whose session is a cache-disabled forced signin, and whose CLI package/version match the installed package. Only then does it run the requested executable and argv with `shell:false` and a restricted environment. The child receives safe `FOUNDRY_AUTH_RECEIPT_*` bindings plus the required LCA credential values; unrelated parent environment variables are excluded.

The wrapper never prints or persists the key and never relays the captured identity-receipt subprocess stdout/stderr on failure. The requested executable necessarily receives the credential and inherits terminal stdio; it is therefore part of the trusted computing boundary and must be a trusted project CLI or Foundry entrypoint. Its own output is not redacted by the wrapper. Child cancellation is returned as the stable shell-compatible `128 + signal` exit code (`130` for `SIGINT`, `143` for `SIGTERM`).

There is no `--no-auth-check`, missing-expectation fallback, session-cache fallback, or environment-controlled skip path. Commands that do not need credentials should run directly instead of through `account:run`.

Package installation, lint, typecheck, build, unit tests, and the clean arbitrary-worktree toolchain test are credential-free. They must not read `.env`, account profiles, thread guards, or `.foundry` runtime state. A real remote case enters this policy only when it deliberately invokes the exact installed CLI dependency (`pnpm exec tiangong-lca`, backed by `@tiangong-lca/cli@0.1.1`) through the approved receipt guard.

## Codex Thread Guards

When parallel Codex conversations use different account profiles in the same checkout, bind the profile to the actual `CODEX_THREAD_ID` instead of relying on chat memory or a generic "current conversation" note.

Use an ignored guard file:

```text
.foundry/state/thread-account-guards/<CODEX_THREAD_ID>.json
```

Minimum shape:

```json
{
  "schema_version": 2,
  "scope": "codex-thread-runtime-account-guard",
  "codex_thread_id": "<CODEX_THREAD_ID>",
  "profile": "<profile>",
  "expected_project_ref": "<expected-project-ref>",
  "expected_user_id": "<resolved-user-id>",
  "required_command_prefix": "node scripts/with-lca-account.ts <profile> --"
}
```

`scripts/with-lca-account.ts` requires this file whenever `CODEX_THREAD_ID` is present. It rejects a missing guard and any thread, profile, expected-project, or expected-user mismatch before invoking the CLI receipt command. This makes account selection survive context compaction and prevents cross-talk between two active Codex threads in the same repository.

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
