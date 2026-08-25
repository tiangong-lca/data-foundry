---
title: Repository File Organization
docType: policy
scope: repository
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: en
whenToUse:
  - when deciding where a new tracked or runtime file belongs
  - when maintaining the durable file-location registry
whenToUpdate:
  - when repository placement rules or registered durable locations change
checkPaths:
  - docs/file-organization.md
  - docs/file-location-registry.json
  - test/unit/zero-javascript-ratchet.test.mts
lastReviewedAt: 2026-08-25
lastReviewedCommit: c996633832ea23bf7883c7b219f524bf28e6ce7e
lastReviewedNote: "Reviewed for Issue #63: pnpm acceptance commands and the checked TypeScript migration inventory location."
---

# Repository File Organization

Foundry files must have a clear home. Do not leave task inputs, reports, specs, or runtime artifacts in the repository root unless the file is a root entrypoint.

## Placement Principle

Before creating or moving a file, classify it by role:

- root entrypoints: `README.md`, `WORKFLOW.md`, `AGENTS.md`, package/tooling files
- task records: `tasks/inbox`, `tasks/active`, `tasks/done`
- reusable task templates: `tasks/templates`
- safe source inputs: `inputs/<kind>/`
- private or large runtime outputs: `.foundry/workspaces/<task-id>/`
- reusable policies and operator guides: `docs/`
- executable contracts and schemas: `specs/`
- local utilities: `scripts/`
- permanent zero-JavaScript and toolchain contracts: `test/unit/zero-javascript-ratchet.test.mts`, `test/unit/toolchain-contract.test.mts`, and focused tests under `test/unit/`

If a file does not fit one of these roles, create or update the smallest repo-owned placement rule before adding it.

## Location Registry

Use `docs/file-location-registry.json` for files whose location matters for future agents, especially:

- moved files
- task seed inputs
- generated-but-tracked summaries
- files with privacy or sensitivity constraints
- files that are referenced from task frontmatter, acceptance contracts, or source manifests

Update the registry in the same change that moves the file. The previous path should be listed so stale references can be detected.

## Harness Design Borrowed Into Foundry

The external `agent-harness-cli` design is useful because it makes agent work inspectable through artifact contracts, narrow deterministic checks, structured JSON reports, and warning/error severities. Foundry keeps domain logic in this repository and adjacent TianGong CLI/skills, but adopts the same acceptance-loop shape:

1. define required artifacts and their expected paths;
2. run deterministic schema and QA checks before semantic curation;
3. write machine-readable check reports;
4. use blocking failures as the next repair prompt instead of treating a chat answer as completion.

Current repo-native commands:

```bash
pnpm storage:check
pnpm acceptance:check
```
