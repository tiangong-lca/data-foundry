# Task Queue

The first tracker adapter is filesystem-backed. Tasks describe import work; reusable conversion, authoring, validation, QA, skill, and database behavior belongs in the CLI, skills, SDK, tools, or database-owned projects.

## Directories

- `inbox/`: new tasks
- `active/`: claimed or currently running tasks
- `done/`: terminal tasks
- `templates/`: reusable task skeletons, not part of the queue

Do not move files into `done/` by hand for committed imports. Use:

```bash
pnpm task:complete -- \
  --task <task-id> \
  --completion-report .foundry/workspaces/<task-id>/import-completion/dataset-import-completion-report.json
```

`task:complete` only moves a task from `active/` to `done/` when the completion report is `completed`, its `task_id` matches the active task id, it contains at least one post-write closeout scope, and every profile-required full-context scope proves AI semantic completion from the full schema/YAML/context package.

## Supported Task Kinds

Use `external-dataset-curated-import` for zipped or directory-based LCA packages that `tidas-tools` can detect or convert.

Use `source-evidence-dataset-development` for PDF, Excel, web exports, screenshots, or free text that must be authored into TIDAS candidate rows.

Set `profile` explicitly in task frontmatter. `bafu` requires full-context AI semantic completion for flow, process, and lifecyclemodel data; generic tasks do not get that waiver unless their closeout profile requires it.

## Routing

```bash
pnpm task:route -- --kind external-dataset-curated-import --dataset-type process --required-gates contract,schema,qa,curation
pnpm task:route -- --kind source-evidence-dataset-development --dataset-type process --required-gates context,schema,qa,curation
```

Use `templates/capability-development-request.md` when a task needs a missing reusable capability in another workspace project.

Task seed reports and other safe source inputs should not live in the repository root. Put them under `inputs/<kind>/`, reference them from task frontmatter, and update `docs/file-location-registry.json` in the same change when the location is durable.
