---
title: Source Evidence Dataset Development Top-Level Skill Design
docType: design
scope: skill-orchestration
status: draft
owner: tiangong-lca-data-foundry
related:
  - docs/skill-orchestration/dataset-authoring-skill-architecture.md
  - docs/runtime-skill-management.md
  - docs/import-profiles/bafu/profile.md
  - docs/import-profiles/bafu/constraints.md
  - ../AGENTS.md
---

# Source Evidence Dataset Development Top-Level Skill Design

本文设计一个面向无结构化资料的数据集开发 top-level skill。它对应 `dataset-authoring-skill-architecture.md` 中的 `source-evidence-dataset-development`，但本文只定义工作流和输入契约，不实现 skill、CLI 或 wrapper。

## 目标定位

这个 top-level skill 用于没有结构化 LCA 包的场景，例如从产品页、技术白皮书、企业报告、标准、论文、EPD/PCR、统计年鉴、法规文件、供应商文档或人工给定资料中开发 TianGong TIDAS 数据集。

它沿用 BAFU 工作验证过的层级关系：

```text
Foundry task / user entry
  -> Foundry router, workspace, profile, account context, checkpoint ledger
    -> source-evidence-dataset-development top-level skill
      -> reusable child skills
        -> Rust tidas plus public tiangong-lca-cli search, QA, curation, and publish commands
```

Foundry 负责工作区、任务状态、账号/profile、source/evidence 冻结、checkpoint 恢复和缺口登记。Top-level skill 负责阶段顺序、输入是否足够、调用哪些子 skill、何时停止。子 skill 负责 flow/process/support 等可复用实体工作流。CLI 负责确定性执行、schema/QA、引用刷新、远端写入和回读验证。

## 与结构化导入的区别

`external-dataset-curated-import` 从 source package、normalized rows、conversion mapping 开始；本 skill 从 seed 和 evidence dossier 开始。

因此没有“normalize source package”这个阶段。非结构化场景的关键风险不是格式转换，而是：

- seed 不足导致检索范围失控；
- 证据没有冻结，后续字段无法审计；
- goal/scope 没定义清楚就开始建 process；
- flow 和 support 还没解析就生成 process；
- 用猜测补字段而不是把证据缺口变成 blocker；
- 写入成功后没有 readback verify。

## Seed Input Contract

Seed input 是启动 source evidence 检索和数据集设计的最小可执行输入。它不是“随便一个产品名”。Top-level skill 必须先把 seed 固化为 `seed-manifest.json`，再进入 evidence search。

### 最小必填 seed

一个可执行 seed 至少需要：

- `seed_type`: `product`, `process`, `service`, `material`, `technology`, `site`, `market`, or `product_system`.
- `target_entity`: 期望产出，通常是 `process`; 可选 `flow`, `lifecyclemodel`, `support_only`。
- `name`: 产品/过程/服务的明确名称，保留原文和用户语言。
- `functional_intent`: 数据集要表达什么功能，例如生产 1 kg 产品、提供 1 kWh 电力、处理 1 kg 废物、运输 1 tkm。
- `geography`: 地理范围或明确的 unknown 状态。
- `time_scope`: 年份、数据期、版本期或明确的 unknown 状态。
- `source_starting_points`: 至少一个可检索起点，例如 URL、PDF 路径、报告名、标准号、供应商名、数据库引用、人工上传文件、或可信 source citation。
- `target_account_or_profile`: 账号/profile guard，不能从 chat memory 推断。
- `intended_use`: 用途，例如 screening LCA、published dataset、internal draft、factor support、flow/process prototype。

如果缺少 `source_starting_points`，skill 只能产出 seed clarification，不应开始 evidence search。如果缺少 geography/time/function，允许进入有限检索，但必须把这些字段标为 `evidence_gap`，不能直接 materialize process。

### 推荐 seed

推荐同时提供：

- `declared_unit_or_reference_flow`: 例如 `1 kg`, `1 item`, `1 kWh`, `1 tkm`。
- `system_boundary_hint`: cradle-to-gate、gate-to-gate、use phase、end-of-life、market mix 等。
- `technology_hint`: 工艺路线、设备类型、原料、能效、产能、产品规格。
- `known_inputs_outputs`: 已知投入产出、能源、排放或废物流。
- `preferred_sources`: 官方、企业、标准、统计、论文、已有 TianGong/public rows 的优先级。
- `exclusions`: 明确不纳入的边界。
- `quality_target`: required evidence level、review strictness、是否允许 proxy。

### Seed 不足时的停止规则

以下情况必须停止在 intake，不进入开发：

- 没有任何 source starting point，且目标不是纯检索计划；
- 目标账号/profile 缺失；
- 产品/过程名称过于泛化，无法形成检索查询，例如只有“塑料”“电力”“运输”；
- intended use 要求正式发布，但 geography、time_scope、functional_intent 全部未知；
- 用户要求写入远端，但没有账号 guard 或 remote write policy。

## User-Facing Intake Flow

用户不需要一次性提供完整 seed schema。自然语言入口是合法的，例如：

```text
我想做个电池的 LCA 数据。
```

但这种输入只是 `raw_intent`，不是可执行 seed。Top-level skill 必须先进入 seed clarification，不得直接 evidence search、build plan、materialize 或 remote write。

### Seed maturity levels

把 seed 分成三档，便于和用户交互，也便于 Foundry 判定能否进入下一阶段：

| Level | Meaning | Allowed next action |
| --- | --- | --- |
| `raw_intent` | 用户的一句话意图，可能只有产品大类或目标方向。 | 只能澄清或生成 scope options。 |
| `clarified_seed` | 已经知道对象、目标实体、功能意图、边界或地理时间中的关键项，足够做有限 source discovery。 | 可以做 source discovery / evidence-search plan；不能 materialize 或 publish。 |
| `execution_seed` | 已冻结账号/profile、source starting points、goal/scope、quality target 和 checkpoint workspace。 | 可以进入正式 evidence intake 和后续 authoring workflow。 |

### First clarification turn

第一轮澄清只问决定检索边界的少量问题，避免把内部 schema 暴露给用户。推荐问题：

1. 你要做哪一种对象？
   - 例：锂离子电芯、磷酸铁锂电池包、三元电池、铅酸电池、储能电池系统。
2. 你要表达哪个产品或过程边界？
   - 例：生产 1 kg 电芯、生产 1 kWh 电池包、使用阶段、回收处理、cradle-to-gate。
3. 地理和时间范围是什么？
   - 例：中国 2025、全球平均、某企业某年份、未知但可检索。
4. 你有指定来源吗？
   - 例：PDF、企业报告、论文、EPD、PCR、网页；如果没有，可以先做 source discovery。

如果用户只回答部分问题，skill 应保留已知项，标记 unknown 项，并判断是否足够形成 `clarified_seed`。

### Intake defaults and unknowns

允许用户回答“不知道”，但 unknown 只能推动调研，不能推动发布：

- geography unknown：可先做 global / unspecified source discovery；正式 process build 前必须选择地理或记录 scoped proxy。
- time_scope unknown：可检索最新可用资料；字段写入前必须引用证据年份或记录 evidence gap。
- functional unit unknown：可生成 declared-unit options；不能进入 process build-plan materialize。
- system boundary unknown：可先生成 boundary options，例如 cradle-to-gate、gate-to-gate、use phase、end-of-life；不能默认发布。
- source_starting_points absent：可做 source discovery；发现的 source 必须冻结后才能成为正式 evidence。

### Seed preview before execution

在进入正式 evidence intake 前，系统应向用户或 Foundry task record 回显 seed preview。示例：

```text
I will start from this execution seed:
- Object: lithium iron phosphate traction battery pack
- Target entity: process
- Functional intent: production of 1 kWh battery pack capacity
- Boundary: cradle-to-gate
- Geography: China
- Time scope: 2024-2025; missing field-level evidence becomes an evidence gap
- Source strategy: prioritize official sources, company reports, papers, EPD/PCR, and existing TianGong/public rows
- Output: source evidence dossier, support/flow/process build plan, mapping/provenance, and optional publish handoff
```

Only after this preview is accepted, or recorded as accepted by the Foundry task policy, may the skill promote `clarified_seed` to `execution_seed`.

### Example: battery raw intent

User input:

```text
我想做个电池的 LCA 数据。
```

The skill should respond with clarification rather than execution:

```text
可以。为了把它变成可检索、可审计的 LCA 数据任务，我需要先确认四件事：

1. 电池类型：锂离子电芯、磷酸铁锂电池包、三元电池、铅酸电池，还是别的？
2. 数据边界：生产 1 kg 电芯、生产 1 kWh 电池包、使用阶段、回收处理，还是完整 cradle-to-gate？
3. 地理和年份：中国/全球/某企业？2025、最近年份，还是未知先检索？
4. 来源：你有 PDF/报告/网页/论文/EPD/PCR 吗？没有的话我先做 source discovery。
```

If the user answers:

```text
做中国 2025 年磷酸铁锂动力电池包，先按 1 kWh，cradle-to-gate，没有指定来源。
```

Then the skill may create a `clarified_seed` and first run source discovery. It still may not publish until source evidence is frozen, goal/scope is accepted, build plans pass, and readback verification is possible.

## Runtime Skill Resolution

Source-evidence extraction and retrieval may need fast-moving skills that are not owned by Foundry. These skills are runtime dependencies, configured in `.agents/shared-skills.json`, installed or read through the npm `skills` package, and left untracked under `.agents/skills` unless a task explicitly chooses pinned reproducibility.

For source document fulltext extraction, the required runtime skill is:

```text
document-granular-decompose
source repo: https://github.com/tiangong-ai/skills
evidence channel: document-fulltext
```

For SCI paper and academic journal evidence, the required runtime skill is:

```text
tiangong-kb-sci-search
source repo: https://github.com/tiangong-ai/skills
evidence channel: sci
```

Before document extraction or SCI retrieval, the top-level skill must:

1. Resolve or read the latest remote skill instructions with `pnpm dlx skills@latest use https://github.com/tiangong-ai/skills --skill document-granular-decompose --full-depth` or `pnpm dlx skills@latest use https://github.com/tiangong-ai/skills --skill tiangong-kb-sci-search --full-depth`.
2. Record the upstream `refs/heads/main` commit from `git ls-remote https://github.com/tiangong-ai/skills.git refs/heads/main`.
3. Write `.foundry/workspaces/<task-id>/runtime-skills/runtime-skill-resolution.json`.
4. Keep SCI evidence separate from report, patent, standard, official, or web-page evidence channels.

The resolved skill can extract document fulltext or retrieve paper evidence, but it does not authorize TIDAS field values by itself. Extracted text and retrieved papers become evidence candidates. Field-level extraction, limitations, conflicts, source rows, mapping, curation, dry-run, and write gates remain in the Foundry/CLI workflow.

## Evidence Contract

Source evidence 不是临时搜索结果，而是后续字段、映射和 reviewer 能追溯的证据包。每条 evidence record 至少包含：

- source id、title、publisher、author/organization、date/version；
- source type：official, standard, report, paper, supplier_doc, web_page, database_row, user_file, expert_note；
- retrieval path：URL、local path、database id、query；
- capture timestamp、checksum 或 snapshot id；
- licensing/access note；
- relevant excerpt summary；
- supported fields，例如 geography、reference year、unit process boundary、exchange amount、flow identity、source citation；
- confidence、limitations、conflicts；
- downstream field paths that may use this evidence。

长文档应先做 source summary 和 chunk index，再进入字段级 evidence extraction。字段值必须引用 evidence record，不允许只引用“检索过”。

## Workflow Stages

### 1. Seed intake and source freeze

目标：确认 seed 是否足够启动，冻结输入、账号/profile、workspace 和检索起点。

输出：

- `seed-manifest.json`
- `source-starting-points.jsonl`
- `account-guard.json`
- checkpoint `01-seed-intake.json`

Gate：

- seed 满足最小必填或有明确的 limited-scope waiver；
- 账号/profile guard 存在；
- source starting points 可定位。

### 2. Goal, scope, and evidence-search plan

目标：把 seed 转成可执行的数据集目标、边界和 evidence search matrix。

必须定义：

- dataset goal and intended use；
- target entity plan：support、flow、process、lifecyclemodel 是否需要；
- system boundary；
- functional unit / declared unit / unit of analysis 初步方案；
- geography/time/technology/data quality 要求；
- evidence questions by field。

输出：

- `goal-scope.md`
- `entity-plan.json`
- `evidence-search.request.jsonl`
- checkpoint `02-goal-scope.json`

Gate：

- 每个关键字段都有 evidence question、已知来源、允许 proxy 或明确 blocker；
- 没有 scope 冲突，例如 declared unit 与目标 process 类型不一致。

### 3. Source evidence intake

目标：检索、读取、摘要、分块、抽取字段证据，形成 evidence dossier。

优先顺序：

1. 用户提供文件或 URL；
2. 官方/标准/企业/统计/论文等 primary source；
3. 现有 TianGong/public datasets；
4. 次级网页或聚合资料，仅作候选，不直接作为高置信字段证据。

子 skill / CLI：

- `process-automated-builder` 的 `evidence-search plan/run`；
- 文档全文抽取使用 runtime `document-granular-decompose`，SCI 论文和期刊证据使用 runtime `tiangong-kb-sci-search`，按 `docs/runtime-skill-management.md` 解析最新版本并记录 skill resolution；
- 必要时使用项目文档、输入证据和外部来源上下文；
- 需要确定性 artifact 时通过 `tiangong-lca dataset evidence-search plan/run`。

输出：

- `runtime-skills/runtime-skill-resolution.json`，当使用 runtime source-evidence skill 时；
- `evidence/sources.jsonl`
- `evidence/chunks.jsonl`
- `evidence/field-evidence.jsonl`
- `evidence/conflicts.jsonl`
- `evidence/evidence-dossier.md`
- checkpoint `03-source-evidence-intake.json`

Gate：

- runtime source-evidence skill 已解析并记录 upstream ref，或当前 task 不需要外部 runtime skill；
- goal/scope 的 critical fields 有足够证据，或明确成为 blocker/proxy；
- 证据冲突已记录；
- 没有把搜索摘要当作字段证据。

### 4. Support curation

目标：先处理 contact、source、data format、compliance、unit group、flow property 等上游支撑对象。

规则：

- 已有 TianGong/public support 优先复用；
- 新建 support 必须有 source evidence；
- flow property / unit group 必须说明量纲、reference unit 和换算；
- source-language descriptive fields have evidence-backed content.

子 skill / CLI：

- `tiangong-lca dataset verify-remote` 做 remote visibility / verify；
- CLI schema/QA/verify 命令做确定性 gate。

输出：

- `support/support-decisions.jsonl`
- `rows/support.*.jsonl`
- `support/support-mapping.csv`
- checkpoint `04-support-curation.json`

Gate：

- 后续 flow/process 需要的 support refs 都可解析；
- 没有 placeholder support；
- 新建 support 有证据和 owner/profile 依据。

### 5. Flow design and resolution

目标：定义和解析所有 process 会引用的 flow，包括 reference flow、technosphere flows、elementary flows、waste flows。

顺序：

1. 从 evidence 和 entity plan 生成 `flow-requirements.jsonl`；
2. exact UUID/version lookup；
3. public/account semantic candidate search；
4. reuse/update/create/exception 决策；
5. classification、name parts、property/unit、provenance；
6. identity preflight、build-plan validate/materialize。

子 skill / CLI：

- `flow-governance-review` 作为当前 flow-authoring child skill；
- `flow-hybrid-search` 只作为候选生成器；
- `tiangong-lca flow identity-preflight`；
- `tiangong-lca flow build-plan validate/materialize`；

输出：

- `flow/flow-requirements.jsonl`
- `flow/flow-candidates.jsonl`
- `flow/flow-decisions.jsonl`
- `rows/flows.final.jsonl`
- `flow/flow-provenance.jsonl`
- checkpoint `05-flow-design-resolution.json`

Gate：

- 每个 process exchange 都有 resolved flow 或 explicit blocker；
- elementary flow 不重复造 public canonical；
- classification 和 name parts 有决策证据；
- flow identity preflight 没有 `block_duplicate` 或未处理 `manual_review`。

### 6. Process build

目标：从 evidence、flow decisions 和 support refs 构建 process dataset。

必须显式生成：

- unit of analysis；
- quantitative reference；
- exchange list with amount/unit/direction/evidence；
- geography/time/technology descriptions；
- data sources treatment and representativeness；
- annual supply/production volume 或 evidence-backed absence/proxy；
- source/contact/compliance/data format refs；
- source-language descriptive fields。

子 skill / CLI：

- `process-automated-builder`；
- `tiangong-lca process identity-preflight`；
- `tiangong-lca process build-plan validate/materialize`；
- `tiangong-lca process complete-required-fields`；
- `tiangong-lca dataset references refresh-remote`；

输出：

- `process/process-build-plan.json`
- `process/process-evidence-map.jsonl`
- `rows/processes.materialized.jsonl`
- `rows/processes.final.jsonl`
- checkpoint `06-process-build.json`

Gate：

- unit_of_analysis decision 是 automatic-ready 或 declared-unit-ready；
- 所有 critical values 有 evidence/proxy/waiver；
- reference flow 和 exchange refs 指向 finalized flow；
- schema、required fields 和 semantic QA 通过。

### 7. Process QA and readback preflight

目标：在写入前做本地 QA、远端引用可达性和前端等价语义检查。

输出：

- `qa/process-qa-report.json`
- `qa/reference-closure-report.json`
- `qa/frontend-equivalence-report.json`，如适用；
- `qa/blockers.json`
- checkpoint `07-process-qa.json`

Gate：

- QA blockers 为零，或有 profile-declared waiver；
- remote-visible refs 可达；
- 没有 placeholder、trace-only、本地路径、unsupported language mixed text。

### 8. Mapping and provenance

目标：把 seed、证据、support/flow/process 决策、字段值、引用重写和 QA 结果合并成最终可审计记录。

输出：

- `mapping.csv`
- `mapping.jsonl`
- `provenance-report.md`
- `unresolved-issues.jsonl`
- `principles-new-add.md`，如发现新原则；
- checkpoint `08-mapping-provenance.json`

Mapping 每行至少包含：

- dataset type/id/version；
- field path；
- source value / evidence value / final value；
- action：reuse, create, update, proxy, waive, block；
- evidence ids；
- confidence；
- responsible stage；
- reviewer notes。

Gate：

- 所有 authored final fields 能追到 evidence、profile rule、remote reuse decision 或 explicit waiver；
- unresolved issue 不影响当前 remote write scope。

### 9. Remote write

目标：通过官方 CLI/platform 路径写入，保留 dry-run、commit、retry artifact。

子 skill / CLI：

- `lca-publish-executor` for `tiangong-lca publish run` bundles；
- `tiangong-lca dataset publish-support` for writable source/contact support rows; unitgroup/flowproperty refs are selected from existing canonical database rows；
- `tiangong-lca flow publish-reviewed-data` / `flow publish-version`；
- process/source/lifecyclemodel entity-specific publish/save-draft commands；

输出：

- `remote/write-request.json`
- `remote/dry-run-report.json`
- `remote/publish-report.json`
- `remote/retry-report.json`，如适用；
- checkpoint `09-remote-write.json`

Gate：

- dry-run 先通过；
- commit 使用 account guard；
- 没有 direct table write、RLS bypass、自动 delete；
- partial failure 必须转为 targeted retry plan。

### 10. Readback verify

目标：写入成功不等于完成。必须从远端重新读取或验证 rows，比较最终 payload、mapping 和引用闭包。

子 skill / CLI：

- `tiangong-lca dataset verify-remote`；
- `tiangong-lca dataset verify-remote`；
- 需要时用 entity-specific get/list 命令冻结 readback snapshot。

输出：

- `readback/readback-snapshots.jsonl`
- `readback/readback-diff.json`
- `readback/reference-resolution-report.json`
- `readback/final-verification-summary.md`
- checkpoint `10-readback-verify.json`

Gate：

- committed root rows 都能远端读回；
- referenced support/flow rows 都能解析；
- readback payload 与 final rows 一致，或 accepted differences 已记录证据和理由；
- 只有 readback checkpoint passed 或 evidence-backed waiver 后，任务才算完成。

## Child Skill Map

- Document fulltext extraction: runtime `document-granular-decompose` from `https://github.com/tiangong-ai/skills`, resolved through `pnpm dlx skills@latest` and recorded in the task workspace.
- SCI literature evidence: runtime `tiangong-kb-sci-search` from `https://github.com/tiangong-ai/skills`, resolved through `pnpm dlx skills@latest` and recorded in the task workspace.
- Evidence search and process evidence fields: `process-automated-builder` evidence-search mode。
- Flow authoring: `flow-governance-review`，必要时 `flow-hybrid-search` 只做 candidate retrieval。
- Process authoring: `process-automated-builder`。
- Reference refresh / remote verify: `tiangong-lca dataset references refresh-remote` and `tiangong-lca dataset verify-remote`。
- Publish facade: `lca-publish-executor`。
- Lifecycle model: `lifecyclemodel-recursive-orchestrator` / `lifecyclemodel-automated-builder` only when entity plan requires product-system graph。

如果缺少确定性 primitive，先记录 CLI capability gap；如果只是 agent-facing 编排不清晰，再新增 thin child skill 或 alias。不要把 reusable runtime logic 放进 `.foundry/workspaces/<task-id>/scripts`。

## Stop Rules

必须停止并保留 artifacts：

- seed 不满足最小输入且无法形成 limited evidence plan；
- 账号/profile guard 缺失；
- evidence search 对 critical field 返回 no sufficient evidence；
- scope、functional unit、system boundary 或 target entity plan 冲突；
- support/flow/process identity preflight 返回 block_duplicate 或 unresolved manual_review；
- flow/process build plan 缺少 evidence-backed unit、amount、direction、reference year 或 required refs；
- schema、QA、reference closure、remote verify 有 blocker；
- remote write partial failure 需要 targeted retry；
- 任何阶段需要 Foundry-local 脚本替代本应属于 CLI 的确定性能力。

## Done Criteria

任务完成必须同时满足：

- seed、goal/scope、evidence dossier、entity plan 已冻结；
- support、flow、process/lifecyclemodel final rows 存在，且都有 mapping/provenance；
- 所有 stage checkpoint passed 或 evidence-backed waived；
- remote write report 存在，且写入范围与 mapping 一致；
- readback verify passed；
- unresolved issues、proxy assumptions、new principles、CLI/skill gaps 已写入 artifact，而不是只留在聊天记录。
