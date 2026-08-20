---
title: Runtime Skill Management
docType: contract
scope: skill-orchestration
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when resolving runtime skills for Foundry source-evidence or maintenance tasks
  - when deciding whether to vendor, pin, update, or record external skills
whenToUpdate:
  - when runtime skill ownership, update, or recording policy changes
  - when Foundry adds or removes top-level shared workflow skill routes
checkPaths:
  - docs/runtime-skill-management.md
  - README.md
  - AGENTS.md
  - package.json
  - .agents/shared-skills.json
  - .agents/skills/**
lastReviewedAt: 2026-06-04
lastReviewedCommit: 0fc91c903b375a013a5d5f912db957132f5fe18f
related:
  - AGENTS.md
  - WORKFLOW.md
  - docs/skill-orchestration/source-evidence-top-level-skill-design.md
  - specs/automated-lca-capability-registry.json
---

# Runtime Skill Management

Foundry treats skills as execution surfaces, not as a place to copy reusable business logic.

`.agents/skills` is the single project-visible skill root. Project-owned Foundry skills live there and are tracked by git. Shared or public runtime skills may also be installed into the same directory so agents can read them locally, but installation and update must use the npm `skills` package. `.agents/shared-skills.json` is a command inventory and ownership record, not a custom skill manager. Runtime-installed shared skill directories are ignored by git, and each source-evidence run records the resolved upstream ref as task evidence.

## Skill Classes

| Class | Source | Storage rule | Update rule |
| --- | --- | --- | --- |
| Foundry-local orchestration skills | this repository | tracked under `.agents/skills` and listed in `.agents/shared-skills.json` | changed through normal Foundry PRs |
| TianGong LCA shared skills | sibling `tiangong-lca-skills` | installed into `.agents/skills` by `npx --yes skills@latest add`; ignored in this repo | update the sibling checkout, then run `npm run skills:install:shared` or `npm run skills:update` |
| Source-evidence and document-extraction skills | external skill repos such as `tiangong-ai/skills` | installed or read into `.agents/skills` runtime state; ignored in this repo | resolve latest before each source-evidence run |

Runtime skill names must not collide with Foundry-local skill names. The external source-evidence class is intentionally floating. Reproducibility is kept by task artifacts that record the resolved repository ref, command, retrieved evidence, and timestamps, not by committing a copied skill version to Foundry.

## Required Tiangong AI Runtime Skills

For source-document fulltext extraction, agents must use the latest `document-granular-decompose` skill from:

```text
https://github.com/tiangong-ai/skills/tree/main/document-granular-decompose
```

For academic paper and scientific journal evidence, agents must use the latest `tiangong-kb-sci-search` skill from:

```text
https://github.com/tiangong-ai/skills/tree/main/tiangong-kb-sci-search
```

`document-granular-decompose` is for source-document fulltext extraction before field-level evidence review. `tiangong-kb-sci-search` is for the `sci` source channel. It must not be treated as a report, patent, general web, or all-source search wrapper. If a field requires reports, patents, standards, company disclosures, or web pages, route those channels through separate evidence steps and keep their evidence records distinct.

## Runtime Commands

Install or refresh configured shared runtime skills into `.agents/skills`:

```bash
npm run skills:install:shared
```

Update locally installed project skills:

```bash
npm run skills:update
```

Inspect local project skill state:

```bash
npm run skills:list
```

List available remote Tiangong AI skills:

```bash
npx --yes skills@latest add https://github.com/tiangong-ai/skills --list --full-depth
```

Read and use the latest document extraction or SCI skill instructions for the current agent turn:

```bash
npx --yes skills@latest use https://github.com/tiangong-ai/skills \
  --skill document-granular-decompose \
  --full-depth

npx --yes skills@latest use https://github.com/tiangong-ai/skills \
  --skill tiangong-kb-sci-search \
  --full-depth
```

Install only Tiangong AI runtime skills into the local checkout:

```bash
npx --yes skills@latest add https://github.com/tiangong-ai/skills \
  --skill tiangong-kb-sci-search document-granular-decompose \
  --agent '*' \
  --yes \
  --full-depth
```

Confirm the latest upstream ref when a task needs an audit trail:

```bash
git ls-remote https://github.com/tiangong-ai/skills.git refs/heads/main
```

For GitHub URL sources, do not use `<repo>@<skill>` syntax. Use the repository URL plus `--skill <skill-name>`.

## Environment Matrix

Runtime skills use the same `.env` file as Foundry. Keep `.env.example` as the public key inventory and keep real values only in local `.env`.

| Skill | Required env | Optional env | Notes |
| --- | --- | --- | --- |
| `$dataset-rls-maintenance` | `TIANGONG_LCA_API_BASE_URL`, `TIANGONG_LCA_API_KEY`, `TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` when remote snapshot/apply/verify is needed | `TIANGONG_LCA_SESSION_FILE`, `TIANGONG_LCA_DISABLE_SESSION_CACHE`, `TIANGONG_LCA_FORCE_REAUTH`, `FOUNDRY_ACCOUNT_LABEL`, `FOUNDRY_ENABLE_REMOTE_COMMIT`, `FOUNDRY_SINGLE_RECORD_COMMIT`, `FOUNDRY_REMOTE_COMMIT_LIMIT` | No skill-private Supabase env. The skill must use CLI-owned current-user RLS paths and Foundry commit gates. |
| `$external-dataset-curated-import`, `$foundry-tidas-import`, `$foundry-tidas-authoring` | Rust `tidas` 0.2.x on `PATH` or selected by `TIDAS_BIN`; a working CLI for context/QA/curation/handoff | `TIDAS_CONFIG`, `TIDAS_MEMORY_BUDGET_MIB`, `TIDAS_QUEUE_CAPACITY`, `TIANGONG_LCA_CLI_BIN`, `TIANGONG_LCA_CLI_DIR`, `TIANGONG_LCA_SKILLS_ROOT`, `FOUNDRY_AGENT_SKILLS_ROOT`, current-user LCA account env for remote readback/write handoff | Rust tidas owns deterministic conversion and schema validation. CLI owns context, QA/curation, and remote stages; remote stages require the LCA account block above. |
| `$source-evidence-dataset-development` | source-dependent | `TIANGONG_AI_APIKEY`, `TIANGONG_AI_API_BASE_URL`, `TIANGONG_AI_CLI`, `TIANGONG_AI_CLI_BIN`, `TIANGONG_LCA_KB_SEARCH_API_BASE_URL`, `TIANGONG_LCA_KB_SEARCH_API_KEY`, `TIANGONG_LCA_KB_SEARCH_REGION` | Source documents use `$document-granular-decompose`; SCI literature uses `$tiangong-kb-sci-search`; LCA CLI evidence-search helpers use the `TIANGONG_LCA_KB_SEARCH_*` family. |
| `$tiangong-kb-sci-search` | `TIANGONG_AI_APIKEY` unless `api_key` or `sci_api_key` is passed in the wrapper JSON | `TIANGONG_AI_API_BASE_URL`, `TIANGONG_AI_CLI`, `TIANGONG_AI_CLI_BIN` | Searches only the `sci` source through `@tiangong-ai/cli`; record the upstream skill ref in task artifacts. |
| `$document-granular-decompose` | `UNSTRUCTURED_API_BASE_URL`, `UNSTRUCTURED_AUTH_TOKEN` | `UNSTRUCTURED_PROVIDER`, `UNSTRUCTURED_MODEL` | Runtime-installed from `https://github.com/tiangong-ai/skills`. The CLI document-authoring path uses `TIANGONG_LCA_UNSTRUCTURED_*`; local `.env` should keep the `UNSTRUCTURED_*` aliases in sync for this skill. |
| CLI QA with LLM review | none unless `--enable-llm` is used | `TIANGONG_LCA_REVIEW_LLM_BASE_URL`, `TIANGONG_LCA_REVIEW_LLM_API_KEY`, `TIANGONG_LCA_REVIEW_LLM_MODEL` | Deterministic QA does not need these keys. |

Foundry Node commands load the repository `.env` automatically. Direct skill shell/Python wrappers do not all do that. When invoking a wrapper directly, either export the needed variables in the shell first or use the wrapper's `env_file` option when it supports one. `$tiangong-kb-sci-search` supports `env_file`; `$document-granular-decompose` reads only process environment variables.

## Task Artifact Contract

Each `source-evidence-dataset-development` workspace that uses runtime skills should write:

```text
.foundry/workspaces/<task-id>/runtime-skills/runtime-skill-resolution.json
```

Minimum fields:

```json
{
  "resolved_at_utc": "2026-06-04T00:00:00Z",
  "skills_cli_package": "skills@latest",
  "source_repo": "https://github.com/tiangong-ai/skills",
  "source_ref": "refs/heads/main",
  "resolved_commit": "<git-ls-remote-sha>",
  "skill_name": "document-granular-decompose",
  "install_command": "npx --yes skills@latest add https://github.com/tiangong-ai/skills --skill document-granular-decompose --agent '*' --yes --full-depth",
  "use_command": "npx --yes skills@latest use https://github.com/tiangong-ai/skills --skill document-granular-decompose --full-depth",
  "evidence_channel": "document-fulltext",
  "local_install_path": ".agents/skills/document-granular-decompose",
  "output_artifacts": ["evidence/fulltext.txt", "evidence/source-extract.json"]
}
```

If an operator installs shared/runtime skills locally, `.agents/skills/tiangong-kb-*/`, `.agents/skills/document-granular-decompose/`, `.agents/skills/external-dataset-curated-import/`, `.agents/skills/source-evidence-dataset-development/`, `.agents/skills/dataset-rls-maintenance/`, and `skills-lock.json` remain local runtime state by default. Commit them only when the task deliberately changes from a floating-latest policy to a pinned reproducibility policy, and record that decision in the relevant issue or design document.

## Agent Rules

- Run `npm run skills:install:shared` when configured shared/runtime skills may be missing or stale.
- Run `npm run skills:update` to refresh already installed project skills.
- Resolve latest external source-evidence skills before source-document extraction or SCI evidence retrieval.
- Read the current remote skill instructions in the same session before relying on them.
- Record the resolved upstream commit and command in the task workspace.
- Treat search results as evidence candidates until they are captured in the evidence dossier with field-level support and limitations.
- Keep Foundry code free of copied retrieval logic from external skill repositories.
- Do not let a runtime skill write database rows. Source-evidence skills may retrieve and summarize evidence; Foundry and CLI gates still own row authoring, curation, dry-run, commit handoff, and readback verification.
- For bad-import cleanup or redo under current-user RLS, use the checked-in `$dataset-rls-maintenance` workflow from `tiangong-lca-skills`. It may orchestrate CLI maintenance artifacts, but it must not add direct database CRUD or RLS bypass behavior.
