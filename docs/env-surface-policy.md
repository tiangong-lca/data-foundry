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
  - scripts/foundry.ts
  - scripts/foundry-golden-diff.ts
  - scripts/commands/core.ts
  - scripts/with-lca-account.ts
  - scripts/lib/foundry-runtime-environment.ts
  - scripts/lib/foundry-runtime-utils.ts
  - test/unit/foundry-runtime-environment.test.mts
lastReviewedAt: 2026-09-04
lastReviewedCommit: 46e359bc3d5d4055db034e7ec04e7989d8eb3680
lastReviewedNote: "Reviewed for #97: fresh OAuth identity, private session references and credential-free candidate Golden snapshots; transport ownership and no-replay gates remain unchanged. Support-cache CLI extraction is a tracked prerequisite in tiangong-cli #270."
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

The account wrapper reads only public OAuth configuration, an absolute private CLI session reference, and expected project/user intent from the selected ignored account profile. Legacy user API keys, username/password and access-token profiles are rejected; the CLI owns session contents and refresh. Blank public inputs use the CLI official Production profile. A custom project requires complete public OAuth configuration. Each execution obtains a new server-verified identity receipt, requires the expected project/user and a live OAuth session, and enforces receipt TTL/hash checks without requiring another password login. The child receives the session reference and a restricted environment; Foundry filesystem env loading is disabled inside that boundary. `FOUNDRY_AUTH_RECEIPT_*` values are safe, wrapper-generated child bindings and must not be configured in `.env` or account profiles. `FOUNDRY_ACCOUNT_PROFILE_SKIP_AUTH_CHECK` and equivalent bypass variables are unsupported and must not be documented or propagated.

## Internal Credential-Free Child Policy

`FOUNDRY_RUNTIME_ENV_FILE_POLICY=disabled` is an internal child-process binding, not a user-configurable `.env.example` variable. The Golden harness sets it only inside an explicit allowlisted environment shared byte-for-byte by baseline and current commands. Both sides run in isolated source snapshots: candidate files come only from Git-visible tracked/untracked source, excluding ignored operator inputs, credentials, task state and prior reports. That environment replaces HOME, temp, XDG, npm, git and Corepack state with task-local directories, preserves only required platform launcher keys, accepts only `TIANGONG_LCA_CLI_BIN` and `TIDAS_BIN` as caller overrides, and drops ambient `NODE_OPTIONS`, tokens, keys, passwords, sessions, credential URLs and other configuration injection. Ordinary Foundry execution keeps the existing default of loading the repository `.env`; tests seed only a temporary `.env` to prove the disabled and default paths.

## Automatic Check

`pnpm env:check` validates `.env.example` against the allowlist and forbidden-key list in `scripts/foundry.ts`.

The same env-surface check is included in `pnpm acceptance:check`, so the Codex Stop hook can block future automatic runs when an internal variable is accidentally promoted into Foundry's public env example. The clean arbitrary-worktree toolchain gate is offline and must not read `.env`, account profiles, or `.foundry` runtime state.

The pre-push hook removes every repository-local Git environment binding reported by `git rev-parse --local-env-vars` before starting the full gate. Fixture repository initialization must not reuse the outer push repository or index; direct fixture runners also use an isolated Git environment. `test/unit/git-hook-isolation.test.mts` verifies the actual hook preserves the outer repository config while the nested test repository is created separately.

Canonical-support refresh passes only public OAuth configuration, the CLI session reference and essential platform/home paths to its CLI child. It uses a fresh temporary cwd, so the CLI cannot load the operator checkout `.env`. Username/password, legacy API keys, unrelated secrets and shell configuration are not propagated. The caller must provide the account wrapper's expected project/user intent.
