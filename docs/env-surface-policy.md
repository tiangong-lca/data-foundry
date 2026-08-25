---
title: Environment Surface Policy
docType: policy
scope: runtime-env
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when adding, removing, or documenting Foundry environment variables
  - when changing credential-free toolchain or acceptance-hook environment boundaries
whenToUpdate:
  - when .env.example or an executable runtime environment consumer changes
  - when pnpm, CLI, skill, or account-guard environment ownership changes
checkPaths:
  - .env.example
  - .codex/hooks/run-foundry-acceptance-check.sh
  - docs/env-surface-policy.md
  - scripts/foundry.mjs
  - scripts/commands/core.ts
  - scripts/with-lca-account.ts
  - scripts/lib/foundry-runtime-utils.ts
lastReviewedAt: 2026-08-25
lastReviewedCommit: c700a3786b2f152957c9edc8b7be4732a8d543dd
lastReviewedNote: "Reviewed for Issue #67 Wave 26 integration: typing orchestration plus core env/doctor/workspace, identity-preflight and finalize owners adds, removes or broadens no environment variable; tests use explicit local values and no repository credentials."
---

# Environment Surface Policy

Foundry `.env.example` is a public runtime contract, not a mirror of every adjacent repository environment variable.

## Allowed Variables

Only document variables that meet at least one of these conditions:

- foundry reads the variable directly;
- foundry passes the variable to a public `tiangong` CLI command as part of the documented runtime contract;
- foundry uses the variable to locate an adjacent workspace repository or local skill root;
- foundry uses the variable as an explicit local-only safety gate.

Allowed families:

- `FOUNDRY_*` for foundry-owned gates, paths, labels, and observability controls;
- public `TIANGONG_LCA_API_*`, session, QA LLM, KB search, and unstructured-document runtime keys used by CLI-backed workflows;
- `TIANGONG_AI_*` keys used by runtime-installed Tiangong AI KB skills such as `tiangong-kb-sci-search`;
- `UNSTRUCTURED_*` aliases used by the runtime-installed Tiangong AI `$document-granular-decompose` skill;
- `TIDAS_BIN`, `TIDAS_CONFIG`, `TIDAS_MEMORY_BUDGET_MIB`, and `TIDAS_QUEUE_CAPACITY` for the public Rust tidas machine contract;
- `LCA_DATA_AGENT_*`, `TIANGONG_LCA_CLI_BIN`, `TIANGONG_LCA_CLI_DIR`, `TIANGONG_LCA_SKILLS_ROOT`, and `LCA_SKILLS_ROOT` path indirection keys.

## Forbidden Variables

Do not add adjacent-repo internal test or quality toggles to foundry `.env.example`.

Examples that must stay out of foundry:

- `TIANGONG_LCA_COVERAGE`
- generic `SUPABASE_URL` / `SUPABASE_KEY`
- tracker secrets such as `LINEAR_API_KEY` / `GITHUB_TOKEN`
- operator-specific source pointers such as `SOURCE_REPO_URL`

If a new variable is only needed by `tiangong-lca-cli` tests, `tiangong-lca-skills` validation, CI, or a private operator workflow, document it in the owning project or local `.env`, not here.

## Ownership Rule

When a variable is needed by more than one project, record the owner before documenting it:

- foundry-owned orchestration and safety gates live here;
- CLI runtime variables should be public CLI contract variables, not CLI internal test controls;
- skills should consume CLI variables through wrapper contracts and should not introduce database credentials or private transport variables;
- private operator convenience variables stay in local `.env` and must not become reusable project examples.

The account wrapper reads credential and expected project/user intent only from the selected ignored account profile. `FOUNDRY_AUTH_RECEIPT_*` values are safe, wrapper-generated child bindings and must not be configured in `.env` or account profiles. `FOUNDRY_ACCOUNT_PROFILE_SKIP_AUTH_CHECK` and equivalent bypass variables are unsupported and must not be documented or propagated.

## Automatic Check

`pnpm env:check` validates `.env.example` against the allowlist and forbidden-key list in `scripts/foundry.mjs`.

The same env-surface check is included in `pnpm acceptance:check`, so the Codex Stop hook can block future automatic runs when an internal variable is accidentally promoted into Foundry's public env example. The clean arbitrary-worktree toolchain gate is offline and must not read `.env`, account profiles, or `.foundry` runtime state.
