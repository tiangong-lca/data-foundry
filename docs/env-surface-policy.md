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
  - scripts/lib/foundry-runtime-qualification.ts
  - scripts/lib/foundry-execution-admission.ts
  - scripts/foundry-facade.ts
  - scripts/runtime-entry.ts
  - scripts/lib/tidas-adapter.ts
  - scripts/lib/foundry-runtime-utils.ts
  - scripts/build-foundry-package.ts
  - scripts/pack-foundry-package.ts
  - scripts/verify-foundry-package.ts
  - scripts/package-entry.ts
  - scripts/public-api.ts
  - test/scenarios/foundry-package-consumer.test.mts
  - test/unit/foundry-runtime-environment.test.mts
lastReviewedAt: 2026-09-05
lastReviewedCommit: 8cbbddb1a727ff2858918d0ff6d2efb1c8827390
lastReviewedNote: "Reviewed for #106 W06: package build/pack has no credential input or lifecycle hook; consumer installs use a projected allowlisted environment."
---

# Environment Surface Policy

Foundry `.env.example` is a public runtime contract, not a mirror of every adjacent repository environment variable.

Package build, descriptor verification and packing do not load `.env`. The public staging manifest has no lifecycle scripts. Clean-consumer tests pass only platform process variables, isolated HOME/package-cache paths and optional network proxy/CA settings to package tools; credential-shaped variables are rejected from that projection. Installed workspace/task operations retain the facade's explicit account-intent/session-reference contract and never search the package directory for credentials.

Repository pack/verification tools and consumer tests share `scripts/lib/package-manager-command.ts`. On Windows, it selects a native `pnpm.exe` from an absolute `PNPM_HOME` or `PATH` entry. npm requires one complete PATH installation containing `npm.cmd`, `node.exe` and `node_modules/npm/bin/npm-cli.js`; the colocated Node executes the script. These tooling selectors never execute `.cmd` or a shell, never reinterpret argv, and never become public Foundry environment variables or shipped runtime code.

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

`FOUNDRY_RUNTIME_ENV_FILE_POLICY=disabled` is an internal child-process binding, not a user-configurable `.env.example` variable. The Golden harness sets it only inside an explicit allowlisted environment shared byte-for-byte by baseline and current commands. Both sides run in isolated source snapshots: candidate files come only from Git-visible tracked/untracked source, excluding ignored operator inputs, credentials, task state and prior reports. That environment replaces HOME, temp, XDG, npm, git and Corepack state with task-local directories, preserves only required platform launcher keys, accepts only `TIANGONG_LCA_CLI_BIN` and `TIDAS_BIN` as caller overrides, and drops ambient `NODE_OPTIONS`, tokens, keys, passwords, sessions, credential URLs and other configuration injection. The legacy developer entry keeps explicit CLI startup behavior for repository maintenance. The explicit workspace runtime never loads `.env`, and user-workspace commands do not fall back to the developer path. Tests seed only temporary environment files and intercept operator-state access before it can occur.

Runtime qualification passes the same explicit isolated environment into both TIDAS handshake invocations. It copies the independently hashed TIDAS executable into a private temporary directory, rehashes the copy and invokes only that copy; ambient `TIDAS_*` settings cannot alter executable selection or resource budgets. The execution-context document stores runtime, authorization, input and CommandSpec digests only. It contains no environment map, OAuth material, session reference or credential path.

The W05 facade receives runtime expectations and the selected TIDAS executable only through an explicit process-local host argument. `FOUNDRY_CLI_EXPECTATION`, ambient `TIDAS_BIN`, task spec fields, ordinary argv and `.env` are not trust sources; unsupported public options are rejected before workspace mutation. The final CLI manager/manifest binding is W06/W08 work.

Consumer doctor may receive expected project/user and an absolute private session reference. It verifies only that the reference is a bounded regular non-link file and reports `configured_unverified`; it never opens the file or claims server authentication. Missing reference metadata returns `needs_auth` with a human OAuth action. Task start does not authenticate or cache an identity. Restricted resume continues to require a fresh CLI-owned identity at the W04 boundary.

## Automatic Check

`pnpm env:check` validates `.env.example` against the allowlist and forbidden-key list in `scripts/foundry.ts`.

The same env-surface check is included in `pnpm acceptance:check`, so the Codex Stop hook can block future automatic runs when an internal variable is accidentally promoted into Foundry's public env example. The clean arbitrary-worktree toolchain gate is offline and must not read `.env`, account profiles, or `.foundry` runtime state.

The pre-push hook removes every repository-local Git environment binding reported by `git rev-parse --local-env-vars` before starting the full gate. Fixture repository initialization must not reuse the outer push repository or index; direct fixture runners also use an isolated Git environment. `test/unit/git-hook-isolation.test.mts` verifies the actual hook preserves the outer repository config while the nested test repository is created separately.

Canonical-support refresh passes only public OAuth configuration, the CLI session reference and essential platform/home paths to its CLI child. It uses a fresh temporary cwd, so the CLI cannot load the operator checkout `.env`. Username/password, legacy API keys, unrelated secrets and shell configuration are not propagated. The caller must provide the account wrapper's expected project/user intent.

The consumer identity runner uses a fresh private cwd and an explicit environment allowlist. OAuth uses CLI-owned defaults or complete public configuration and an optional private session reference. Headless mode forwards the caller-supplied actor token only in the one CLI process environment, disables the session cache, removes its temporary environment binding after verification, and never stores or serializes the token. Current CLI headless receipts have no token-expiry timestamp; Foundry enforces fresh server identity and does not invent token lifetime evidence.

Constructing an internal `createFoundryApplication` does not call `loadRuntimeEnv`, discover a workspace or mutate process environment. The developer `main(argv)` explicitly performs its existing env loading before creating that application. This constructor guarantee does not qualify every legacy leaf command for consumer use; each leaf must receive the admitted runtime I/O and child-process environment before the facade exposes it.

Migration inventory never opens recognized `.env`, OAuth/session, token/cookie or private-account storage, or the independently selected session reference under any filename; it records only path/size/classification and omits content hashes. Transfer plans project explicit account intent as project/user only and never carry a session reference, environment map or grant. No migration environment variable or alternate trust-anchor source is introduced.
