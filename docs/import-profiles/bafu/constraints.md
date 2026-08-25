---
title: BAFU TIDAS Import Constraints
docType: import-constraints
scope: bafu
status: draft
owner: tiangong-lca-data-foundry
related:
  - docs/import-profiles/bafu/profile.md
  - docs/import-profiles/bafu/state-code-100-name-shapes.md
---

# BAFU TIDAS Import Constraints

本文记录 BAFU 数据处理约束，用于把完整 BAFU 转换结果整理成符合 TianGong TIDAS 要求、可写入 BAFU TianGong 账号的数据。本文件定义 BAFU-specific 规则和质量门禁；执行顺序、checkpoint 和恢复语义由 `docs/import-profiles/bafu/profile.md` 定义。

## 账号和写入边界

- 远端 Foundry / TianGong CLI 读写必须使用 BAFU account profile，并由运行态 task manifest / account profile / checkpoint 记录实际账号、session、命令前缀和 guard 结果。
- 仓库根目录或子项目根目录的 `.env` 只能提供运行态 credential / endpoint / 默认命令参数，不能替代 durable `source-manifest.json`、`profile-lock.json`、account/write guard report、checkpoint 和 artifact ledger。正式写入前必须能从 task workspace 证明当前 source、profile、目标账号、write policy 和待写 scope。
- 单次运行的 thread id、具体 user id、临时 env 值或一次性命令前缀不属于 durable constraints；这些内容只能写入运行态 workspace、checkpoint 或 run manifest。
- 所有写入必须通过官方 CLI / 平台路径执行；不得绕过 RLS，不得直接写 dataset tables。
- 符合 task write policy 的批量自动 commit 是允许的；人工审批用于 policy 变更、exceptional waiver、缺失 canonical database support、删除动作或其他 profile gate，不用于逐条确认已经通过所有硬门禁的独立 scope。
- 若运行态账号 guard 不能证明当前命令指向 BAFU account profile，应阻塞 remote write。

## 总体导入原则

- 不得把任何转换器的初始转换结果原样写入。历史批次的初始结果中存在 `TIDAS_IMPORT_PLACEHOLDER`、trace-only 字段、方向字段异常、单位/属性未标准化等问题。
- 这个原则同时适用于 TIDAS JSON 和 ILCD 文件包。ILCD 是交换/交付格式，不等于数据库写入计划；写入 TianGong 时不能因为 ILCD 包里有某个 contact、source、flow property、unit group、flow 或 process 文件，就直接新建对应数据库记录。
- 对 ILCD 包执行数据库写入前，也必须先做 TianGong 侧实体解析：已有记录优先复用；同 UUID/version 的私有记录使用 update/upsert；只有确认没有合适既有记录且符合对应数据集规范时才允许新建。
- 完整转入前必须完成：源数据依据整理、流匹配、单位/属性标准化、源语言名称整理、必填字段补齐、QA YAML 质量门禁、SDK/schema 验证、前端等价验证、远端回读验证。
- schema 验证只能证明结构基本符合，不足以证明业务字段完整。例如“年供应量或生产量”结构存在但语义为空时仍可能通过 schema，因此必须加 QA 和前端校验口径。
- BAFU flow / process / lifecyclemodel 写库前必须证明已经完成 full-context AI semantic completion：AI authoring package、classification decision task 或 location decision task 必须包含 SDK schema、methodology YAML、runtime ruleset、TIDAS classification category schemas、`tidas_locations_category.json`、profile constraints、queue/dependency closure、source row 和当前 entity payload；分类类 AI 输出必须经过 `dataset-classification-decisions-apply`，location 编码 AI 输出必须经过 `dataset-location-decisions-apply`，非分类/非 location 字段 patch 必须经过 `dataset-authoring-patch-collect` 和严格 `dataset-patch-apply`，并在 evidence 中保留上下文来源、关闭的 action item 或 queue item、以及完整 used-context 说明。没有这些证据，即使 schema/QA/dry-run/readback 通过，也不得进入 remote write planning。
- 任何补齐或替换都必须有来源：EcoSpold1 原字段、`mapping.csv`、转换报告、TIDAS/ILCD 规范、TianGong 数据库检索结果、已有公开 flow/property/unit group 记录、或明确的人工判断记录。

## 工作流触发和 Prewrite Evidence Gate

- BAFU 导入不能只把运行目录、checkpoint 文件或最终状态报告命名为 `external-dataset-curated-import`。必须实际执行 `external-dataset-curated-import` top-level skill 编排的 entity closure 流程，并保留子 skill / CLI evidence。
- `curation-queue next` 只适用于已经进入结构化 TIDAS/ILCD entity row 的研制阶段。若输入仍是 PDF、网页、报告、截图、自由文本、任意表格等非结构化资料，必须先走上游 source-evidence / draft-dataset authoring：抽取事实、记录引用、明确假设、形成 draft TIDAS rows，然后才允许 build curation queue。
- Codex 可以在新 profile 或非结构化来源阶段先梳理 run-level plan，但这个 plan 必须落成 profile constraints、source manifest、queue tasks、entity-run-plan、checkpoint 和 CLI/skill 命令后再执行。执行期不能让每个 worker 临场自由决定“这次怎么处理”，否则会回到不稳定批处理和本地脚本拼接的问题。
- CLI 的职责是稳定状态机、artifact contract、门禁和恢复点；Codex 的语义能力只在明确的 child skill 步骤中使用，例如 name-plan、分类判断、证据支持的字段补齐。不得用 CLI 代替 Codex 做语义研制，也不得绕过 CLI 让 Codex 直接写最终 row。
- 队列建立后，每个执行 worker 在修改任何 row 之前都必须先运行：
  - `tiangong-lca dataset curation-queue next --queue-dir .foundry/workspaces/<task-id>/curation-queue --entity-type <support|flow|process> --limit 1 --out-dir .foundry/workspaces/<task-id>/execution-next`
- worker 只能执行 `curation-queue next` 返回的 `next_tasks[].action`：若返回 CLI command，就按该命令执行；若返回 child skill，就按返回的 `skill`、`input_artifact`、`output_artifacts` 执行。完成后再次调用 `curation-queue next`。对导入、更新、写入、重跑类任务，必须持续循环，直到请求范围内的 support、flow、process scope 都返回 `status=complete`；只执行第一条 support / flow / process action 不能视为完成。
- BAFU 当前转换结果按 process bundle 拆分时，允许多个 worker 并行执行独立 `curation-queue next` 返回的任务。并行数必须来自 task workspace 的 `max_parallelism` / execution policy，不得写死在 BAFU 规则中；每个 worker 必须持有不同 `lock_key`，且其 `depends_on` checkpoint 已通过。一个 entity 或 dependency closure 被 blocker 阻塞时，只记录该 blocker 和受影响 scope，不能阻塞没有共享未完成依赖的其他 ready process bundle。
- 不得跳过 `curation-queue next` 自行选择“干净”的 process/flow/lifecyclemodel，也不得用 task-local 脚本批量生成 `rows/*.final.jsonl`、`rows/*.name-curated.jsonl` 或其他看似最终的行文件。
- 每次正式 remote write 前必须运行并通过：
  - `tiangong-lca dataset curation-queue verify --queue-dir .foundry/workspaces/<task-id>/curation-queue --out-dir .foundry/workspaces/<task-id>/prewrite-evidence-gate`
- `curation-queue verify` 的结果必须写入 stage 8 checkpoint 和 remote write status。若状态为 `blocked`，不得执行 commit。若任一 `curation-queue next` scope 仍返回 `status=ready`，该 blocked 只是说明队列尚未跑完，worker 必须继续执行 next 返回的 action；只有 next 本身 blocked、没有可执行 action 但 verify 仍 blocked，或遇到需要人工判断的 profile gate，才可以把 run 状态报告为阻塞。
- 对批量自动入库，`verify --type` 或 exact-scope verify 可以按 support / flow / process / bundle scope 分别证明。通过 verify 的独立 scope 可进入 finalize/commit/readback；未通过的 scope 必须留在 blocked ledger 中，等待人工或数据库侧补齐后重跑，不得混入本次 executable commit scope。
- 该 gate 必须证明每个 owned support / flow / process entity 均有：
  - `name-plan-units.jsonl`
  - Codex-authored `name-plan-draft.jsonl`
  - `name-plan-evidence.json`
  - `name-plan-apply-report.json`
  - `name-plan-validate-report.json`
- 只存在 schema validate、name-quality validate、remote dry-run、readback verify 或由 finalizer 汇总生成的 `checkpoints/*.json`，不能证明完整流程已经执行。尤其不得用 Foundry-local hardcoded rule / regex / glossary 脚本直接生成 `name.*` 或分类后再让验证通过。
- 任务本地脚本可以做选择、组装输入、汇总报告和生成 human-readable status；可复用的研制逻辑必须进入 skill 或 CLI。任何直接生成最终语义字段的本地脚本都只能作为临时实验，不能作为 BAFU 正式导入依据。

## Compliance 与 DataSet Format 约束

- BAFU EcoSpold1 来源未声明 ILCD compliance system。转换产物中由占位逻辑生成的 `TIDAS_IMPORT_PLACEHOLDER:COMPLIANCE_NOT_DEFINED` / `Compliance systems` source dataset 不得写入 BAFU 账号。
- TIDAS 设计口径是：正式入库的数据集应使用平台认可的 compliance declaration。当前应引用 TianGong public canonical 的 `ILCD Data Network - Entry-level` compliance system：
  - UUID：`d92a1a12-2545-49e2-a585-55c259997756`
  - version：`20.20.002`
  - type：`source data set`
  - shortDescription：`ILCD Data Network - Entry-level`
- `ILCD Entry-level` 声明适用于转入并修复后的 TIDAS 目标数据集，不是 BAFU 原始 EcoSpold1 包自带的声明。必须在 provenance / `common:other` 中明确记录：BAFU EcoSpold1 source did not declare an ILCD compliance system; TianGong LCA transformed, completed, normalised, validated, and published the datasets under the BAFU account, and the resulting TIDAS datasets meet ILCD Entry-level / TianGong import-readiness requirements.
- 只有完成 schema、QA YAML、前端等价校验、引用闭包检查和远端回读验证后，才允许把 `common:approvalOfOverallCompliance` 写为 `Fully compliant`。在 dry-run 或修复未完成阶段不得提前写成 fully compliant。
- 不得因为 TIDAS/ILCD schema 中存在 `complianceDeclarations`，就新建 BAFU 私有的 compliance system source。合规声明引用的是目标数据集按哪个合规体系被声明和评审，不是源 EcoSpold1 包自然具备的元数据。
- 若 TianGong public canonical 的 `ILCD Data Network - Entry-level` compliance source 不存在或不可引用，应阻塞写入并先补公共支撑对象，不得在 BAFU 账号下临时新建占位 compliance system。
- `referenceToDataSetFormat` 同样应优先引用 TianGong 公共库已有的 canonical data format source，例如平台标准的 TIDAS/ILCD format 记录；不得把转换包生成的临时 source 当作 BAFU-owned source 写入。
- 本文件中的 `support` 是 workflow umbrella，不是一个单独 TIDAS dataset type。普通 support writer 的 BAFU 可写 scope 只允许真实 `source` 和 canonical BAFU/FOEN `contact`；compliance system 与 data set format 始终属于 public canonical reference reuse / provenance rewrite。flow property 与 unit group 默认同样复用 public canonical，但在 profile lock 明确启用 `allow_account_local_support_and_elementary` 且公共库确无可辩护候选时，可以进入独立的 account-local candidate registry，并且只能通过 current-user owner-draft 专用路径维护，不能混入普通 support scope。
- `source` 表只能写入真实文献、报告、出版物、数据库文档或可追溯来源记录。`ILCD format`、`Not specified`、compliance system、data format、`Created for EcoSpold 1 compatibility` 等转换/格式/兼容性占位不得作为真实 source 名称写库；这些只能作为 canonical reference rewrite/provenance trace 保留。若 source description 中包含 `Original title`、`First author`、`Year` 等报告元数据，应先修复 source shortName/sourceCitation，并同步修复 process `referenceToDataSource.common:shortDescription`。
- 若 process `referenceToDataSource` 指向上述占位 support source，Foundry 必须先用完整 bundle context 查找同一 process scope 内可证明的真实报告、论文、数据库文档或数据来源；只有存在唯一且语义明确的 true source 时才自动改写到该 source。若没有任何来源线索，才允许改写到统一的 `BAFU 2025 Version 2 LCA database` database-level fallback source，并在 `source-reference-rewrites.jsonl` / `source-semantics.jsonl` 中记录 fallback 理由。不得因为原始转换 source 是占位就盲目写库，也不得在多个可能 true source 间无证据任选。
- 若 process 的 `common:generalComment`、technology、data-source treatment 等上下文明确写出 `Original source`、DOI、标题、年份和作者，且该来源比转换出的 package-level true source 更具体，Foundry 必须生成或复用该 process-context source，并将 process `referenceToDataSource` 改写到该来源；原转换 source 若在当前 scope 内不再被 process 引用，不得进入 support 写入。
- 若 true source 的 `sourceDescriptionOrComment` 为空或只有 `Report` / `Publication` / `Source` 这类类型词，应使用 `sourceCitation` 或 `common:shortName` 生成可读的报告/出版物说明，不能把空描述或单独 `Report` 当作最终来源描述。写库前 mutation manifest 必须阻断仍带这些占位 identity 的 support/source rows。
- mutation manifest 必须把 compliance system / data set format reference rewrite 单独列出：原始引用 UUID、原始 shortDescription、目标 canonical UUID/version、处理动作、理由和来源证据。
- 最终远端回读必须确认所有 compliance/data format 引用都指向 TianGong public canonical 支撑对象，且没有 `TIDAS_IMPORT_PLACEHOLDER:COMPLIANCE_NOT_DEFINED`、`COMPLIANCE_NOT_DEFINED` 或仅本地存在的 compliance source。

## Flow 处理约束

- 写入前必须先检索 TianGong 数据库已有 flow。不能只按本地转换 flow 文件盲目新建，也不能只做名称 exact match 后就判定“库里没有”。
- Flow 检索必须采用两阶段流程：
  1. UUID/version 精确检索：
     - 先从 EcoSpold1、TIDAS JSON、ILCD、`mapping.csv` 和 trace 中提取源 flow UUID、version、type、direction、classification、reference property/unit、geography 和名称组件。
     - 先用 UUID/version 在目标 BAFU 账号和 TianGong 公共库中检索。若命中，应继续核对 type、classification、reference property/unit、geography、version 语义和可见性，不能只因 UUID 命中就无条件复用。
     - 若 UUID 命中公共库且语义一致，应优先复用公共库记录；若 UUID 命中 BAFU 账号历史记录，应按当前规范决定 update 或替换引用，不应重复新建。
     - 若 UUID 命中但 type、属性、单位或语义明显不一致，应作为数据冲突进入人工/规则化判定，不能静默复用。
  2. 结构化语义检索：
     - 只有在 UUID/version 未命中、或 UUID 命中但经核对不可复用时，才进入语义检索。
     - 语义检索必须使用结构化字段、源语言名称和同义词扩展，而不是只用源英文完整名称。检索字段至少包括 base name、treatment/technology、mix type、location/geography、flow properties、classification、flow type、reference property/unit、CAS/chemical formula（若存在）、market/plant/grid/to-user 等上下文。
     - 语义检索结果必须打分并记录证据：为什么复用、为什么不复用、哪个字段不匹配、是否需要新建 BAFU flow。
     - 若语义检索发现公共库已有高置信候选，应优先复用公共库；只有没有合适公共/账号内候选时，才允许保留 BAFU 源 UUID 按 TIDAS flow 规范新建。
- Product / waste / intermediate flow：
  - 优先复用数据库中名称、类型、分类、参考属性、参考单位、地理和技术范围均匹配的已有 flow。
  - 若没有合适已有 flow，才可以按 TIDAS flow 规范新建。
  - 新建不是“随便生成一个新 flow”：应保留源 UUID/version 作为可追溯身份，并补齐规范要求的 name、classification、flow property、unit group、reference unit、source/review 依据。
  - 即使决定保留 BAFU 原始 flow UUID/version 并新建或更新该 flow，也不得直接沿用转换包里临时生成的 flow property、unit group 或 reference unit。flow identity 的保留只解决 flow 自身身份和溯源，不代表其依赖的属性/单位实体也应新建。
- Flow 分类选择：
  - 若复用 TianGong 公共库或 BAFU 账号内已有 flow，应复用目标 flow 已有的正式分类；不得由 BAFU 源分类覆盖目标分类。
  - 若必须新建或更新 BAFU-owned product / waste / intermediate flow，正式 `classificationInformation` 必须按 TianGong/TIDAS flow 新建规范选择目标分类。选择时应使用分类目录/CLI 候选和结构化字段，由 flow type、四段式 name、flow property/reference unit、地理、技术、源 process 和 source context 共同支撑，不得只把 EcoSpold1 或转换包里的源分类原样写成目标分类。
  - 源 EcoSpold1/转换包分类应作为来源证据保留在 `common:generalComment`、trace/provenance 或 mapping 中；只有在经分类目录匹配和语义判断后确认与 TianGong/TIDAS 目标分类一致时，才可以作为目标分类依据之一。
  - 明显工业/电池/化学数据不得沿用 `Activities of membership organizations`、`Community, social and personal services`、`Other environmental protection services n.e.c.` 等源转换错分；出现这类组合时必须阻塞并返回 full-context AI classification decision。
  - `mapping.csv` 或配套分类证据必须记录 `source_classification`、`selected_tidas_classification`、`classification_basis`、`candidate_categories`、`decision_status`。若未生成这些证据，不得正式写入。
  - Flow schema 校验只证明 `classificationInformation` 字段结构可被解析，不代表分类语义正确，也不代表目标分类属于 TianGong/TIDAS 分类树中的合适位置。发布前必须额外通过 flow classification decision gate：没有分类决策证据、源分类未被保留为溯源、或把源分类无依据地复制成目标分类，均应阻塞写入。
- Elementary flow：
  - 默认必须使用 TianGong 数据库已有的 elementary flow，匹配顺序为：UUID/version 精确检索、CAS/name/category/synonym 确定性匹配、结构化语义检索、已评审的人工/规则化候选。
  - LCIA 因子依赖既有 elementary flow 身份，因此“公共库没有候选”本身不能授权新建。只有 profile lock 明确启用 `allow_account_local_support_and_elementary`、完整候选检索证明不存在可辩护 public/existing canonical、且保留源 elementary identity、分类/compartment、CAS/name、方向、单位和 provenance 时，才允许把缺口保留为当前 BAFU owner 的 `state_code=0` account-local elementary candidate。
  - account-local elementary candidate 只服务于同一 owner 的私有清洗、建模和试算；不得进入全局 LCIA flow cache，不得被 public 或其他 owner 的 process 引用，也不能因为标记了 `LCIA characterization pending` 就视为已完成专家评审或具备公开资格。
  - 有可采用候选的 source elementary flow，必须使用选定的 TianGong existing/public flow，并在 mapping/provenance 中保留候选等级、源 UUID/version、候选 UUID/version、选择理由和风险说明。
  - 没有可辩护 existing/public 候选且 profile override 未生效或证据不完整时，不改成 product flow、不强行映射到不等价 public flow，也不写入 BAFU-owned elementary flow；必须保留在 elementary flow mapping/curation queue 中，并阻塞引用它的 process 写入。override 与证据都有效时，可继续同 owner、全闭包 `state_code=0` 的私有流程，但公开发布仍被阻塞。
- 历史 BAFU-owned elementary flow 必须逐条重新做 public reuse audit：有可辩护 canonical 候选时改写 process exchange；无候选但满足 profile-authorized account-local 条件时登记为私有候选；未登记、无引用或不满足条件的记录进入待人工删除/退役清单。自动导入流程不得直接 delete，也不能把删除候选当作已清理。
- Generic `Carbon dioxide` / `Carbon monoxide` air-emission elementary flow 必须显式记录 fossil / biogenic / land-use-change 判定：
  - 当源 flow 名称正好是 generic `Carbon dioxide` 或 `Carbon monoxide`，且 trace category 是 air-emission compartment，而 TianGong public elementary library 没有同名不分型 air-emission flow 时，映射到同 air compartment 的 public `fossil` variant，作为保守的 impact-bearing 默认值。
  - `Carbon dioxide, land transformation` 等明确源名映射到 land-use-change variant；`Carbon dioxide, in air` 作为 resource 时映射到 public resource uptake candidate。
  - mapping/provenance 必须说明源 BAFU/EcoSpold1 未标注 fossil/biogenic/LUC qualifier，以及本次采用何种判定方案和理由。
- 确定性 public elementary alias / aggregate 规则可用于本批导入，但必须同时保留 category/direction 证据：
  - 已评审的 EcoSpold1 命名变体可映射到 TianGong public elementary 名称，例如 `1-Pentanol -> pentan-1-ol`、`1-Propanol -> n-propanol`、`3-Methyl-1-butanol -> 3-methylbutan-1-ol`、`4,4'-Biphenol -> biphenyl-4,4'-diol`、`Acrylate -> Acrylate, ion`、`Chloramine -> chloramide`、`Chlorosulfonic acid -> chlorosulphuric acid`、`Chrysotile -> asbestos (white)`、`Ethanol, 2-ethoxy- -> 2-ethoxyethanol`、`N-octane -> octane`、`p-Cresol -> para-cresol`、`Petrol -> gasoline`、`Solids, inorganic -> Dissolved solids` 等。
  - land occupation/transformation 可在 direction 保持一致时使用 public aggregate land-use elementary flow；ore-grade resource 可在 ground/non-renewable element resource 分类一致时映射到同一金属元素资源；`Oils, biogenic` 可在 compartment 匹配时映射到 `Oils, non-fossil`。
  - source resource classification 明显错误时可按证据修正到 biosphere renewable material resources，例如 standing wood；若 public support 只有 soft wood / primary forest wood / energy wood，hard/unspecified standing wood 仍按候选或例外规则处理，不能静默降级。

### 电力 Flow 语义检索补充

- 电力类 product flow 是上述两阶段检索的一个典型场景。必须先按 UUID/version 检索；若 UUID 未命中或不可复用，再做结构化语义检索。不能只用 BAFU/EcoSpold1 英文源名做 exact match 检索，也不能因为 `Electricity, low voltage, at grid {CH}` 这类英文检索没有命中 exact candidate，就判定 TianGong 公共库没有对应 flow。
- 写入前必须做 TIDAS 结构化语义检索和打分，至少包括：
  - `Electricity` / `alternating current` / `交流电`；
  - `electricity mix` / `电力混合`；
  - `consumption mix` / `消费组合`；
  - `to consumers` / `到用户`；
  - 电压等级归一化：`<1kV`、`1-35kV`、`35-330kV`、low voltage、medium voltage、high voltage；
  - 地理字段：`CH`、`CN`、`GLO`、source geography、locationOfSupply、market/plant/grid 语义。
- 已确认远端 TianGong 公共库存在电力开放数据候选，例如：
  - `<1kV` consumption mix candidate：`50657322-939c-4829-a87b-47c093bfa6a7@01.01.001`，名称结构为 `交流电; 电力混合; 消费组合，到用户; <1kV`；
  - `1-35kV` consumption mix candidate：`3d76981f-964a-4865-b588-0e067a2a1163@01.01.001`，名称结构为 `交流电; 电力混合; 消费组合, 到用户; 1-35kV`；
  - `35-330kV` consumption mix candidate：`4d0361a3-56cc-45f9-aa42-bb9103285bf9@01.01.001`，名称结构为 `交流电; 电力混合; 消费组合，到用户; 35-330kV`。
- 上述公共库候选只是候选，不是对所有 BAFU electricity exchange 的自动映射。最终复用必须同时比较电压等级、消费/生产混合语义、grid/to-user/plant 语义、地理范围、flow type、flow property、reference unit 和 source context。
- 已明确：TianGong 公共库中部分 energy / electricity flow 因历史上缺少 Energy / Amount-in-kWh 等单位支撑，沿用了 `Net calorific value` 作为 flow property。对 BAFU 导入而言，这个属性口径差异本身不再作为复用公共电力 flow 的硬性否决条件；应记录为 TianGong 公共库 legacy support / 待公共库升级事项。
- 复用公共电力 flow 时，仍必须核对 flow identity 语义：电压等级、消费/生产混合、grid/to-user/plant 边界、地理范围、flow type、source context 和数量单位换算。只有 `Net calorific value` 这一项不一致时，不应因此新建 BAFU 私有 electricity flow。
- 电力 flow 匹配脚本必须扩大候选检索范围，不能只取英文源名 top 10。建议先用源名检索，再用结构化同义词二次检索，并输出候选打分证据；未复用公共库 flow 时，必须说明是地理/电压/语义/属性不匹配，而不是简单写“数据库没有”。
- 电力 flow 的 mutation manifest 不得只写 `uuid_not_found_semantic_no_suitable_candidate` 作为最终理由。对每个未复用公共库的电力 flow，必须附候选评估表，至少列出已知公共候选 UUID/version、名称组件、电压等级、消费/生产语义、地理范围、flow property/reference unit、可复用结论和拒绝理由。
- 对 `Electricity, low voltage, production ENTSO-E, at grid {ENTSO-E}` 这类源 flow，若当前公共库只有 `交流电; 电力混合; 消费组合，到用户; <1kV/1-35kV/35-330kV` 等 consumption mix 候选，不能自动映射；但也不能直接新建并结束。必须明确判断：
  - `production ENTSO-E` 与 `consumption mix, to user` 是否代表不同 supply-chain boundary；
  - `ENTSO-E` 地理范围是否可接受映射到 `GLO`、`RER`、`CN` 或其他公共候选；
  - `low voltage` 是否应映射到 `<1kV`；
  - 公共候选使用 `Net calorific value` 是否只是 TianGong 公共库 energy/unit support 的 legacy 表达；若其它语义字段匹配，不得仅因该属性名称拒绝复用。
- 若检索过程只使用英文源名、没有覆盖同义词和平台已有候选名称，或候选结果主要是 unrelated plant-specific electricity，则该次检索证据不足；不得把该结果作为“新建 BAFU electricity flow”的充分依据，必须补做结构化语义检索后再写入或更新。

## 中间流与非中间流约束

- “中间流”定义为：同一 flow 在某个 process 中作为 output，同时在另一个不同 process 中作为 input。
- 中间流是 process 间供应链连接点，必须保持身份一致：
  - 如果复用已有数据库 flow，所有相关 process 都应指向同一个目标 flow。
  - 如果新建 flow，相关 process 必须引用同一 UUID/version，不得拆成多个近似流。
- “非中间流”指没有在本批 process 内形成 output-input 连接的非 elementary flow。
  - 非中间流也要优先检索并复用 TianGong 数据库已有 flow。
  - 只有没有合适匹配时才允许新建，并记录为什么不能复用。

## 单位、属性与参考单位约束

- EcoSpold1 的单位不能直接等同于 TIDAS reference unit。必须映射到 TIDAS flow property、unit group、reference unit 的规范结构。
- Flow property、unit group、reference unit 必须优先复用 TianGong 数据库已有的 public canonical 记录。只有 profile lock 明确启用 `allow_account_local_support_and_elementary`，且公共库确无可辩护候选时，才允许把缺口物化为 BAFU 当前账号拥有的 `state_code=0` My Data 候选；这类候选不是 public canonical，也不能供其他账号隐式复用。
- BAFU account-local FP/UG 必须保留源量纲、源单位、reference unit、换算口径和完整 mapping/provenance，使账号内 flow/process 闭包在清洗期间自洽。它们进入独立的 account-local candidate registry，不得写入或冒充 `specs/canonical-support/flow-properties-unit-groups.json` 的 public canonical cache。
- account-local 例外只解除“必须等公共 support 才能继续”的治理墙，不解除 schema、单位尺度、内容饱和、引用闭包、owner/state、计划 hash、审计和 readback 门禁。任何 source/target/flow/process 跨 owner、非 `state_code=0` 或混合可见性批次都必须阻塞。
- 已确认的单位/属性处理口径：
  - `p` 应映射为 `Number of items` / `Units of items`，参考单位使用 `Item(s)`；不能把 `p` 当作 TIDAS reference unit。
  - `kg` 映射到 Mass / Units of mass。
  - `m2` 映射到 Area / Units of area。
  - `tkm` 映射为质量距离量纲，按 `1000 kg*km` 处理。
  - `kWh` 映射为 Energy，换算到 `MJ` 时系数为 `3.6`。
  - `MJ` 映射为 Energy / MJ。
  - `Nm3` / `Amount in Nm3` 映射到 TianGong public `Volume` / volume unit group；`Nm3` 作为源单位证据保留在 mapping/provenance 中。不得为 `Nm3` 新建 BAFU 私有 flow property。若 public Volume unit group 暂缺 `Nm3` alias，应记录为公共库 unit alias 后续事项，而不是阻塞 BAFU 私有 property。
- Flow property / unit group 引用必须解析到数据库中精确存在且当前账号可见的记录：优先使用 public canonical cache；无 public 候选且 profile override 生效时，可使用同一 BAFU owner 的 `state_code=0` account-local FP/UG 对。两者不得在同一 alias batch 中混合，且 private FP 的 reference unit group 必须是同一 owner/state 的精确版本。
- 若源单位可以可靠映射到现有 public canonical support，必须重写 `referenceToFlowPropertyDataSet` / `referenceToReferenceUnitGroup` 到该公开记录，并把源单位、源属性名和映射理由保存在 mapping/provenance 中。
- 若源单位或量纲没有可辩护的 public canonical support，例如 person transport、duration、length\*time，可先使用经 profile lock 授权的 BAFU account-local FP/UG 继续私有清洗和试算，同时保留公共库候选评审待办。能否最终公开由量纲、单位、命名、来源、复用价值和专家审批决定，不能用 LCIA 方法是否覆盖直接代替该判断。
- Energy 类 `kWh` / `MJ` 当前可按现有 public `Net calorific value` legacy support 处理并记录 legacy note；后续若公共库新增 generic `Energy` support，再通过迁移映射重写引用。不得创建 BAFU 私有 Energy support。
- `unitgroups.jsonl` 和 `flowproperties.jsonl` 仍与 source/contact `support.jsonl` 分离。profile override 生效时，它们可进入专用 account-local candidate/handoff，但只能通过 current-user、owner-draft、计划绑定的官方 CLI/数据库路径维护；不得由 generic support writer、Foundry 直写或 `publish-support` 作为私有清洗前置。

## Process 字段补齐约束

- 每个必填项都要有正式内容，不能保留 trace、placeholder、空字符串、`UNSPECIFIED_TEXT` 或本地路径。
- `functionalUnitOrOther`、exchange `shortDescription`、quantitative reference 等字段应与标准化后的 flow/unit 文本一致。
- process exchange 中 `referenceToFlowDataSet/common:shortDescription` 必须从被引用 flow 的正式权威 `name` 结构物化，不能只取 `baseName`。组合顺序为 `baseName`、`treatmentStandardsRoutes`、`mixAndLocationTypes`、`functionalUnitFlowProperties`，跳过空字段，并按语言分别组合。该字段是引用显示文本，不得由 process 独立翻译或手写；更新 flow name 后必须重新 build authority catalog、materialize process refs、validate refs，并在写入后回读确认。
- “年供应量或生产量”字段需要同时满足 SDK/schema 和前端校验：
  - 使用多语言数组结构，实际文本写在 `#text`。
  - 文本必须以真实数值和空格开头，并显式表达年化单位，例如 `1.0 Item(s)/year ...`、`3.6 MJ/year ...` 或 `3.6 MJ/年 ...`。只写“参考流描述”不能通过新版 SDK/schema。
  - 如果源数据没有独立年度市场供应量，不能编造市场量；应以 EcoSpold1 quantitative reference 的参考流数量作为有来源的年化代表生产量，并明确说明“来源未另行声明独立的年度市场供应量”。
- 时间字段也必须做语义清洗，不能只满足 schema：
  - `common:referenceYear` 中的 `9999`、`0`、`0000`、空字符串、`Not defined`、`Unknown` 等值均视为占位/哨兵值，不得正式写入数据库。
  - 若 EcoSpold1 的 `startDate` / `endDate` 为空，仅有 `dataValidForEntirePeriod=true`，不得把转换器生成的 `9999` 保留下来，也不得把 `9999` 写入 `timeRepresentativenessDescription`。
  - 必须从可追溯来源补真实年份：优先使用源 EcoSpold1 的有效 `startDate` / `endDate`；若缺失，可使用源文献年份、数据源报告年份、技术数据年份、包版本/发布年份或人工评审确认年份，但必须在 `timeRepresentativenessDescription` 或 provenance 中说明采用哪个年份、来自哪个字段/source/comment、为什么适合做 reference year。
  - 对缺少 `startDate` / `endDate` 和可解析 source citation year 的 BAFU 2025 行，可使用 `2025` 作为 reference year，证据为 BAFU 2025 package identity。该方案比 EcoSpold1 export/edit timestamp 更稳定，并可追溯到本包身份。
  - 若个别行只能从 EcoSpold1 dataset `timestamp` 推导 reference year，该方案对本批受影响 process 可接受，但 `timeRepresentativenessDescription` 必须明确说明：该 timestamp 可能代表导出/编辑时间；由于未找到更强的 reference-year 证据，本次将其作为可追溯年份使用。
  - 若无法找到任何可追溯年份或可接受 fallback，应阻塞写入或把记录列入人工修复清单；不得为了通过前端/schema 验证而编造年份。
  - 对已写入的 BAFU 数据，远端回读必须扫描 `common:referenceYear` 和时间说明文本，确认不存在 `9999` 这类占位值。
- TIDAS/ILCD `dateTime` 源值可合法携带 timezone offset，例如 `+08:00` 或 `+00:00`；但 BAFU 导入进入 TianGong 写入 payload 前必须规范化为 UTC `Z` 形式，便于远端 diff、readback verify 和 mapping 稳定比较。不得把合法 offset 当作源数据错误，也不得把非 `Z` offset 原样写入最终 TianGong payload。
- 采样程序、数据代表性、数据完整性、审查、source/contact 引用、平台 canonical compliance/data format 引用必须基于源字段、平台 canonical 支撑对象或可验证的合理补齐，不得只填占位描述。

## Contact 与归属约束

- BAFU 2025 数据导入不得继续使用占位联系人，例如 `BAFU 2025 package import contact`。
- BAFU contact 可以由 AI 生成/修复，且必须作为一次性的 canonical support authoring task 被所有 bundle 复用。AI 任务必须带 FOEN/BAFU 官方来源证据、当前转换 contact payload、SDK/schema、profile constraints 和固定 UUID/version；输出必须经过 patch collect/apply、schema/name-plan/location/manifest/readback 门禁后再被所有 bundle 复用。
- 本批 BAFU / FOEN 数据的 canonical contact 使用：
  - UUID：`a6db11f5-1cb4-579a-b503-bd17c361b8c2`
  - version：`00.00.001`
  - shortName：`Federal Office for the Environment FOEN (BAFU)` / `瑞士联邦环境署（FOEN/BAFU）`
  - name：`Swiss Federal Administration - Federal Office for the Environment (FOEN)` / `瑞士联邦政府 - 联邦环境署（FOEN/BAFU）`
  - classification：`Organisations` / `Governmental organisations`
  - address：`Federal Office for the Environment FOEN, 3003 Bern, Switzerland`
  - telephone：`+41 58 462 93 11`
  - email：`info@bafu.admin.ch`
  - WWWAddress：`https://www.bafu.admin.ch/en/contact-en`
- 上述联系人信息来源为 FOEN / BAFU 官方 contact page。后续批量导入前应再次核对官方网页；若官方联系信息变更，应更新 contact dataset 并记录来源日期。
- BAFU 导入包里的 commissioner、ownership，以及没有更具体来源人的 BAFU source/contact 引用，应统一指向上述 canonical BAFU / FOEN contact，不得保留临时导入联系人名称。
- 同一个 BAFU 数据库/整库导入只允许使用这一条 canonical BAFU / FOEN contact 作为归属 contact。转换工具生成的 `TianGong LCA import tooling`、本地脚本、临时操作者等 contact 只能作为 provenance/trace 说明，不得作为 commissioner、ownership 或 source/contact support row 写入。
- TianGong LCA 在本批数据中承担转换、字段补齐、flow reference 修复、验证和数据库发布处理工作，但不应因此被写成 BAFU 源数据的 commissioner 或 owner。
- TianGong 的处理角色应记录在 `administrativeInformation.dataEntryBy.common:other` 或等价 provenance 字段中，例如说明 TianGong LCA prepared the TIDAS conversion, source-language field completion, flow-reference repair, validation, and database publication under the BAFU account。若以后引入单独的 TianGong contact，可在 `dataEntryBy.referenceToPersonOrEntityEnteringTheData` 中引用 TianGong contact，但不得替代 BAFU / FOEN 的 source ownership / commissioner attribution。

## 源语言内容约束

- BAFU 导入行应保持源语言内容。不得在数据库导入前生成额外多语言文本，也不得把缺少中文作为导入 blocker。
- 不使用机器翻译 API，也不通过给某个 LLM key 的方式批量机翻。
- 对 dataset `name` 这类结构化字段，必须把同一 `name` 组内的 `baseName`、`treatmentStandardsRoutes`、`mixAndLocationTypes`、`functionalUnitFlowProperties` 一起作为上下文进入 source-language name-plan 判断；输出仍按对应 `field_path` 写回单个字段。
- 可写支撑数据集也必须使用同一套 source-language name-plan evidence 流程，不能回退到脚本词表翻译或正则拼接。`source` / `contact` 继续走普通 support curation；profile-authorized account-local `unitgroup` / `flowproperty` 走独立候选 registry、单位证据和 owner-draft 维护合同，不能冒充 public canonical cache。
- 远端写入 source/contact support rows 必须使用 `tiangong-lca dataset save-draft --type auto --commit` 或 profile 指定的官方 support commit handoff。account-local unitgroup/flowproperty 只能使用专用 current-user owner-draft 命令；两类路径都必须保留 schema validation、curation lineage、计划 hash、数据库审计和 readback 到 stage 8 checkpoint。不得使用 Foundry-local writer 或直接表写。
- 保留 LCA、TIDAS、ILCD、EcoSpold、化学式、CAS、标准号、UUID、单位、地理代码和技术边界等专业语义。若无法凭来源证据确定 source-language 字段内容，应形成 `manual_review` blocker，而不是生成猜测文本。
- 若源数据没有单独声明地理或供应场景字段，只能在 generalComment、mapping 或其他 provenance 字段说明，不得写入 `name.mixAndLocationTypes` 或任何 `name.*` 字段。`name.mixAndLocationTypes` 必须是可得性/地点/组合类型的名称片段，例如 `at plant {RER}`、`at grid {ENTSO-E}`、`at user {CH}`、`production mix, Switzerland {CH}`；无法从证据拆出时应形成 review blocker。
- process 正文中的通用字段缺失、补齐或代表性说明应使用“源数据”而不是反复写 “EcoSpold1”，例如 `源数据未声明...`、`基于源数据定量参考流...`、`源数据的 startDate/endDate...`。但用于溯源的具体证据必须保留原始格式名，例如 exchange generalComment 中的 `Source EcoSpold1 exchange number`、源包未声明 ILCD compliance system 的 dataEntryBy provenance、以及明确说明由 EcoSpold1 转换的 intended application。
- 可见业务字段不得保留导入占位或源系统噪声：`xx`、`{GLO}` 这类未拆分 name token、`Not declared in source package`、`Not specified by the BAFU ecoSpold1 source.`、`No ... BAFU ecoSpold1 source.`、本地路径、zip 内路径等必须进入 Foundry AI authoring action item。若字段确实未知，用户可见文本只写 `Not specified` 或按 schema 省略；BAFU/ecoSpold 只作为 provenance/evidence，不作为业务字段 filler。
- BAFU 的 full-context AI completion 要求写入规划前完成内容字段饱和。`tidasimport:sourceTrace`、TIDAS schema/YAML、分类/location schema 或 profile context 能证明正式字段值时，必须在同一次 AI authoring package 中尽量补全，不能先写库再靠人工巡检补。典型字段包括 process `common:synonyms`、`percentageSupplyOrProductionCovered`、`uncertaintyAdjustments`，flow `locationOfSupply`、`name.flowProperties`、source-backed `common:generalComment`，source `sourceDescriptionOrComment` 中的作者/年份/标题/出版地/出版社/卷号，以及 FOEN/BAFU contact 的官网、邮箱、电话、地址和 central contact point。无法证明或候选冲突时才 block/review；可证明字段缺失时 curation gate 必须阻断。
- Flow `locationOfSupply` 的证据不只来自 flow 自身已有 geography 字段。`name.mixAndLocationTypes` 中的明确 location code、引用该 flow 的 process `locationOfOperationSupplyOrProduction.@location`、exchange `location` 以及 source trace 中的地理字段都必须进入 flow authoring context；能证明为 TIDAS/ILCD location code 时必须补齐，候选冲突或非 code 描述才进入 location authoring/review。
- `common:other` 只能保存不能安全推断的 provenance/trace，不得替代 schema 必填字段或正式名称、functional unit、classification、reference flow 等业务字段。只有 action item 的 `allowed_resolution_modes` 明确包含 `deferred_to_common_other` 时，才允许延期；functional unit / classification / reference flow 这类正式字段必须补 evidence-backed 真值或保持阻塞。`annualSupplyOrProductionVolume` 是 schema 必填项，不得转入 `common:other`；若原始数据缺少年供应量，Foundry deterministic cleanup 写入 `9999 missing-data-sentinel/year`，这是有意无物理意义、便于批量查询定位的占位值，后续由数据库侧 curation 替换为真实值。允许 `resolution.mode=deferred_to_common_other` 的 action item 必须写入 `common:other.tiangongfoundry:unresolvedTrace`，且包含 `status`、`action_item_code`、`blocked_path`、`reason`、结构化 `evidence` 和 `next_action`；`evidence` 必须包含 source 以及 quote / trace / path / citation 等可追踪指针。
- 最终 rows 中的 `common:other.tiangongfoundry:unresolvedTrace` 和 `common:other.tiangongfoundry:sourceExchangeCompleteness` 必须由同一行的 AI patch evidence，或由 cleanup report 为同一 final row 生成的确定性 proof 放行；手工预置或 identity/classification/location 决策不能替代该证据。其中 unresolved trace 使用 `resolution.mode=deferred_to_common_other` 并关闭匹配 action item；source-only-output 接受使用 `resolution.mode=source_trace_verified`，或由 `dataset-curation-cleanup --source-rows-file <source rows>` 证明源 process row 本身 Output-only 且最终 row 保留非 `referenceToFlowDataSet` exchange signature。Commit handoff 必须先从最终 rows 推导这些 trace，并逐条匹配 mutation/finalize 保留的 trace queue JSONL；stale/extra/missing trace 都不能生成可执行 commit 命令。Post-write closeout 必须在读回验证后复核同一覆盖关系。
- process / flow / lifecycle model 的 `name` 子字段是名称片段，不是 provenance 或字段缺失说明，不得写入 `源数据未声明...`、`no separate ... was declared...` 这类句子。若源数据未单独给出某个 name 子字段，应从源全名、分类、地理代码、技术描述和来源字段中做可辩护拆分；仍无法确定时形成 review blocker，或在非 name 的 provenance 字段说明，不得用说明句占位。
- 所有 `name.*` LangText 中不得出现 `xx` / `xxx` / `XX` 等源数据标记或导入标记，不得出现 `TIDAS_IMPORT_PLACEHOLDER`、trace-only 文本、本地路径，也不得出现中文分号 `；` 或英文分号 `;`。TIDAS/ILCD name 子字段应使用逗号分隔的技术短语，不能使用分号连接说明句。
- `name` / name-like display 字段必须先使用 `tidas-name-plan-authoring` skill + `tiangong-lca dataset name-plan extract/validate/apply` 流程生成 source-language `name_plan`。不能靠穷举词表、简单正则替换或 Foundry-local 字典脚本完成：
  - `extract` 产出 `outputs/name-plan-units.jsonl`，每个 unit 必须包含 `source_full_name`、当前 name 四段、字段定义、分类/地理/技术/flow property/unit 等上下文，以及 `name_plan_prompt`；
  - Codex 只基于 `name_plan_prompt` 和来源证据生成 `name-plan-draft.jsonl`；
  - `validate` 必须阻断分号、`xx/xxx`、trace-only、provenance 说明句和字段缺失说明句；
  - `apply` 必须生成 name-planned rows 和 `outputs/name-plan-evidence.json`；
    - 对可写 support rows，`source_full_name` 不拆成 flow/process 四段；draft 只能填写该 unit 的 `target_name_fields`。当前 BAFU 导入的可写 support 字段口径如下：source 用 `sourceInformation.dataSetInformation.common:shortName`；contact 用 `contactInformation.dataSetInformation.common:name` 和 `common:shortName`。unit group / flow property 默认只引用现有 public canonical rows；profile override 生效且公共库确无可辩护候选时，BAFU 私有 FP/UG 候选的名称只能在独立 account-local candidate registry 中依据单位/量纲/provenance 证据编写，并经专用 owner-draft 计划、审计与 readback 路径维护，不得进入 generic support name-plan/write 路径或 public canonical cache。
  - `baseName`：只保留核心产品/废物流/服务/过程名称和必要的基本加工层级；去除前缀 `xx` / `xxx`，并尽量不要混入地点可得性、市场/生产组合、地理代码、路线说明或功能单位属性。
  - `treatmentStandardsRoutes`：放处理方式、标准、质量等级、用途、生产路线、原料/educt、primary / secondary 等技术限定；例如废弃物去向或处理路线若是过程/流的技术路线，应放在此字段。
  - `mixAndLocationTypes`：放 production mix / consumption mix / market mix、location type of availability、origin / destination、`at plant` / `at user` / `at grid` / `to consumer` / `at regional storage` 等可得性和地点类型信息；`工厂端 {KR}` / `at plant {KR}` 这类内容应优先拆入此字段，同时地理代码仍应写入 geography/location 或等价结构。
  - process 的 `functionalUnitFlowProperties` / flow 的 `flowProperties`：放定量限定属性，例如浓度、含水率、能量含量、U 值、功率、单位相关的产品/过程属性等；非限定性的 CAS、公式、同义词不放在 name 子字段。
- 为了可回写和审计，源数据原始完整 name 必须保存在 mapping/provenance 中；不得为了回写便利而把未拆分的完整源名原样保留在 `baseName` 并在其他 name 字段重复补充。若复用 TianGong 公共库已有 flow/process 的 canonical name，可保留公共库 canonical name，同时在 mapping 中记录 BAFU 源名与 canonical name 的差异。
- name-plan 质量是写入前硬门禁，不是 UI 展示优化。若 `baseName` 仍包含 `production mix`、`production OM`、`at freight ship`、`at plant`、`at sawmill`、`{CH}` 等未拆源名片段，或包含 `wet, measured as dry mass`、`allocation exergy` 等应进入 functional/flow property 的限定，必须阻断并走 AI name-plan patch；`treatmentStandardsRoutes = source-described route` 属于生成占位，必须阻断；`mixAndLocationTypes` 只有 `CH`、`JP`、`RER` 这类裸 location code 时也必须阻断，除非同一 name-plan evidence 证明源数据确实没有可得性/地点类型片段且该字段应省略。

## QA 与验证门禁

- process 的 QA YAML 是独立质量门禁，必须至少检查：
  - 必填字段是否结构和语义都完整；
  - 是否仍有 placeholder、trace-only 文本、本地路径；
  - flow 引用是否真实存在；
  - elementary flow 是否优先复用公开数据库 flow；若属于 profile-authorized BAFU account-local candidate，是否已保留原始 elementary identity、完整候选检索、public 候选不可辩护理由、owner/state 闭包和 LCIA characterization 待处理状态；
  - product/intermediate flow 是否完成已有库检索和复用/新建理由；
  - flow 正式分类是否来自 TianGong/TIDAS 分类目录和语义决策证据，而不是仅复制源 EcoSpold1/转换包分类；
  - 源 flow 分类是否已保留在 generalComment、trace/provenance 或 mapping 中，且未被当作唯一目标分类依据；
  - reference flow、单位、flow property 是否一致；
  - 年供应量或生产量是否能通过前端口径。
- BAFU 账号级物料平衡处理口径：
  - CLI process QA 只产出 deterministic QA metrics/findings；Foundry 的 process curation gate 才负责 profile policy、AI authoring package、import-only trace cleanup、waiver 和最终 prewrite 状态。
  - AI authoring 只能输出结构化 identity decision、classification decision、location decision、patch 或 build-plan。identity blocker 必须先通过 `node scripts/foundry.ts dataset-identity-decision-task-build --curation-gate-report <dataset-curation-gate-report.json> --out-dir <task-dir>` 转成明确的 AI decision task；分类 blocker 必须先通过 `node scripts/foundry.ts dataset-classification-decision-task-build --classification-queue <classification-authoring-queue.jsonl> --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <runtime-ruleset.json> --classification-schema <tidas_*_category.json> --location-schema <tidas_locations_category.json> --out-dir <task-dir>` 转成明确的 AI decision task；location blocker 必须先通过 `node scripts/foundry.ts dataset-location-decision-task-build --location-queue <location-authoring-queue.jsonl> --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <runtime-ruleset.json> --classification-schema <tidas_*_category.json> --location-schema <tidas_locations_category.json> --out-dir <task-dir>` 转成明确的 AI decision task。Decision task status 必须是 ready；若返回 `blocked_missing_full_context`，说明 schema、methodology YAML、runtime ruleset、分类/地点 schema、identity authoring package 或转换后的原始 row payload 不完整，必须先补齐，不能交给 AI 猜。非 identity/分类/location blocked authoring package 必须先通过 `node scripts/foundry.ts dataset-authoring-task-build --authoring-package <package> --out-dir <task-dir>` 转成明确的 AI task、patch template 和 deterministic apply 命令；task manifest 必须是 `ready_for_ai_authoring_batch`，若是 `blocked_missing_full_context` 必须先补齐 context，不能让 Codex/skill 直接手工改 rows。
  - Identity decision 输出必须先通过 `node scripts/foundry.ts dataset-identity-decisions-apply --type <flow|process> --rows-file <rows.jsonl> --decisions <identity-decisions.jsonl> --out-dir <apply-dir>`，由 Foundry 按 AI 决策确定性拆分 write candidates、reference reuse rows 和 `identity-reference-rewrites.jsonl`。decision 必须保留 `decision_status=completed`、`authoring_package`、`authoring_package_sha256`、`used_context_kinds`、`basis`、结构化 evidence 和关闭的 identity action item；若 decision 留有 `__AI_FILL_*` 模板占位、缺 canonical reuse 目标或缺 evidence/context，应返回 AI authoring 修复。elementary flow 的 `create_new` 只有在 profile lock 授权且 decision 明确标记 account-local candidate、绑定候选检索与 owner/state/LCIA 缺口证据时才可进入 mutation manifest；其他 elementary `create_new` 一律阻塞。
  - 分类 decision 输出必须先通过 `node scripts/foundry.ts dataset-classification-decisions-apply --classification-queue <classification-authoring-queue.jsonl> --decisions <classification-decisions.jsonl> --decision-task <classification-decision-task.json> --out-dir <apply-dir>`，由 CLI 根据 TIDAS 分类 schema 生成 canonical class path；decision 必须保留模板中的 `decision_status=completed` 和 `authoring_context.context_bundle_sha256`，且该 hash 必须来自对应 `classification-decision-task.json` 的 `context_bundle.sha256`，不得误用 shared context bundle hash；apply report 必须绑定 decision task/context bundle；apply report 未完成、decision 缺 completed 状态 / context bundle / evidence / basis、code 非法、或 queue item 未关闭时，应返回 AI authoring 修复。大队列可用 `--dataset-type`、`--bundle-id`/`--process-id`、`--limit`、`--offset`、`--chunk-label` 分块；若多个 chunk task 的决策合并应用到原始 queue，必须重复传入每个 `--decision-task`。
  - Location decision 输出必须先通过 `node scripts/foundry.ts dataset-location-decisions-apply --location-queue <location-authoring-queue.jsonl> --decisions <location-decisions.jsonl> --decision-task <location-decision-task.json> --out-dir <apply-dir>`，由 CLI 根据 `tidas_locations_category.json` 写入 canonical location code；decision 必须保留模板中的 `decision_status=completed` 和 `authoring_context.context_bundle_sha256`，且该 hash 必须来自对应 `location-decision-task.json` 的 `context_bundle.sha256`，不得误用 shared context bundle hash；apply report 必须绑定 decision task/context bundle；apply report 未完成、decision 缺 completed 状态 / context bundle / target_path / evidence / basis、code 非法、或 queue item 未关闭时，应返回 AI authoring 修复。大队列可用 `--dataset-type`、`--bundle-id`/`--process-id`、`--limit`、`--offset`、`--chunk-label` 分块；若多个 chunk task 的决策合并应用到原始 queue，必须重复传入每个 `--decision-task`。
  - 批量 authoring task 的 AI patch 输出必须先通过 `node scripts/foundry.ts dataset-authoring-patch-collect --task-manifest <authoring-task-manifest.json>` 收集成 batch patch；每个 AI patch 文件必须显式声明 `patch_status=completed`。collect 若发现缺 patch 文件、patch 状态缺失/非 completed、未完成模板、`__AI_FILL_*` 占位符、格式错误、authoring package 不匹配、缺 evidence、action item 未关闭，或 task/manifest 已失去完整 schema/YAML/ruleset/category/location/source-row context 证明，应返回 AI authoring 修复。
  - 字段修改必须通过 `node scripts/foundry.ts dataset-patch-apply` 或 `tiangong-lca dataset patch apply` 落地，且 apply report 必须为 `completed`。BAFU 导入流程应使用 `--authoring-package-dir`、`--require-authoring-package` 和 `--require-action-item-closure`，使每个 patch set 绑定对应 AI authoring package，并显式关闭其解决的 `action_items`。分类/location 确定性 apply 之后，后续 full-context patch、identity decision、finalize 和 commit 必须以上一阶段 apply 输出 rows 为输入，不得回退到 apply 前的 cleanup rows；process/flow patch 后必须刷新 exact-payload identity preflight 并 merge 回当前 scope index 后才能 finalize/write。若 patch apply 被 `test` 失败、缺证据、路径缺失、row selector 问题、authoring package 不匹配或 action item 未关闭阻塞，应返回 AI authoring 修复，不得手工改 rows 后继续写库。
  - 对写入 BAFU TianGong 账号的 BAFU 数据，`process_material_balance_deviation` 不作为 remote write blocker。该规则适用于本账号后续所有 BAFU 导入、更新和批量修复任务。
  - 物料平衡仍应由 QA 工具计算并写入 QA report、mapping/report 或 QA artifact，作为源数据特征和后续人工分析信息；但不得因为 `raw material input != product + by-product + waste` 阻塞 schema 已通过、引用已验证、必填字段已补齐的 BAFU 数据写入。
  - 该豁免只覆盖物料平衡偏差本身，不覆盖 exchange amount 缺失、单位换算缺失、exchangeDirection 错误、flow 引用不可解析、reference unit/property 不一致、trace/placeholder 残留、年供应量缺失或其他 QA/schema/frontend-equivalent blocker。
  - 执行时必须在 stage 6 checkpoint、mapping/report 和 remote write manifest 中记录 `process_material_balance_deviation` 已按 BAFU account policy waived，并保留偏差数值、QA report 路径和采用该账号级规则的约束文件快照。
- 完整写入流程需要远端回读验证：写入后按 BAFU profile 重新读取 process/flow/lifecyclemodel/contact/source 等记录，确认实际数据库内容与本地计划一致。
- 对已经存在于数据库的 BAFU 记录应使用 update/upsert_current_version 类路径，不应重复创建同一数据集。

## 已知转换质量门禁

- 早期完整 BAFU TIDAS JSON 曾出现 process exchange 的 `exchangeDirection` 全部为 `Output`。后续完整转入前必须重新统计 `exchangeDirection` 与 EcoSpold1 trace 中 `inputGroup` / `outputGroup` 的一致性；若 mismatch 不为 0，应阻塞写入。
- 若源 EcoSpold1/TIDAS 文件本身只有 output exchange，也不能静默写库。优先由 Foundry deterministic cleanup 在传入 `source_rows_file` 后比较源 row 与最终 row：源 row 必须 Output-only，最终 row 也必须 Output-only，并且除允许的 `referenceToFlowDataSet` canonical rewrite 外 exchange signature 一致；通过时写入 `common:other.tiangongfoundry:sourceExchangeCompleteness` 和 cleanup proof。若无法做该确定性证明，AI 必须读取 source XML/TIDAS trace 与 process context 后记录 `status=source_only_output_exchange_verified`（或修复 exchange set），并保留结构化证据；证据必须包含 source 以及 quote / trace / path / citation 等可追踪指针。没有 deterministic proof 或 AI evidence 时 process curation gate 必须阻塞。
- 历史证据：2026-05-23 使用当时的 Python converter 重新转换 `BAFU-2025 Version 2 - ecoSpold1 2026-03-09.zip` 后，完整 TIDAS 结果为 `Input=143105`、`Output=274604`、trace mismatch `0`，因此“全部 Output”异常在该转换结果中已不再发生；该旧 converter 路径不是当前执行入口。
- 初始转换 flow 文件夹包含未被 process 引用的 flow；后续不能因为 flow 文件存在就全部写入账号。
- 10 条样本修复中曾发现自建 elementary flow `Heat, waste` 被 process 引用；已改为公开 `waste heat` flow。完整转换时同类问题必须按批量规则处理。

## 整库写入约束

- 完整写入前必须生成 mutation manifest，至少列出计划写入、更新、跳过、复用或引用的 `contacts`、`sources`、`unitgroups`、`flowproperties`、`flows`、`processes`，以及每条记录的 UUID、version、目标 owner、state_code、依赖关系和处理理由。`unitgroups` / `flowproperties` 默认标记为 reference-only public canonical reuse；profile override 生效时，确无可辩护 public 候选的记录可以标记为 account-local candidate，但必须绑定 profile-lock、独立 UUID/version、当前 owner、`state_code=0`、单位换算与引用闭包证据，并走专用 owner-draft handoff。
- process / flow / lifecyclemodel 写入范围的 mutation manifest 必须由 `node scripts/foundry.ts dataset-mutation-manifest --type <process|flow|lifecyclemodel>` 生成，并引用 schema validation、post-authoring Foundry curation gate、AI semantic evidence（identity 预检使用 identity decision apply report 且该 report 必须绑定 authoring package/sha/action item；分类队列使用 classification decision apply report 且该 report 必须绑定 classification decision task/context bundle；location 队列使用 location decision apply report 且该 report 必须绑定 location decision task/context bundle；其他字段修复使用 AI patch collect/apply report/evidence）、cleanup、dry-run、remote verification、target owner 和 reference-reuse 证据；这些证据必须对应同一 exact rows-file scope：schema / remote verification 的 `input_path` 指向 manifest rows，curation gate 的 `rows_file` 指向 manifest rows，curation gate 引用的 deterministic QA report 的 `rows_file` / `input_path` 指向 manifest rows，cleanup 的 `cleaned_rows_file` 指向 manifest rows，identity/classification/location decision apply 的 `files.output_rows` 或 AI patch apply 的输出必须链到 cleanup 输入。零散 dry-run 输出不能单独替代该 manifest。若 manifest 输出 unresolved/source-exchange trace queue，commit handoff 和 post-write closeout 都必须证明这些 queue 与最终 rows 的 `common:other` trace 逐条一致，作为后续数据库侧治理入口。
- process / flow / lifecyclemodel 写库前必须在 mutation manifest 阶段证明引用闭包：当前 exact write scope 内的引用可以由本次 rows 证明；互相引用的可写 contact/source 必须先合并为 `support` scope，通过 `dataset-post-authoring-finalize --type support`、`tiangong-lca dataset save-draft --type auto --commit` 和 post-write verify/closeout；unitgroup/flowproperty 引用必须由 public canonical support cache + 远端公开库验证，或由 profile-authorized account-local candidate registry + 同 owner/state 的远端精确回读证明；scope 外的 flow/source/contact 等可写引用，必须在上游 scope 已写入后通过 `tiangong-lca dataset verify-remote` 证明远端存在并匹配。否则 `dataset-post-authoring-finalize` 必须停在 `reference_closure_remote_verify_required`、`reference_closure_unproven` 或 `reference_only_support_type_write_blocked`，不得生成可执行 commit handoff。
- 完整写入前必须锁定本文件 sha256 和原则快照；每条 row receipt、mutation manifest 和最终 mapping CSV/JSON 都必须记录该快照 hash。若本文件发生变化，必须重新生成 plan、row receipts、flow resolution 和 write plan，不得沿用旧产物。
- mutation manifest 可以额外产出 `delete_candidates`，但该字段只表示“建议人工检查并删除”的候选清单，不得触发自动删除。
- 写入范围必须以 process 实际引用闭包为准：
  - process 未引用的 flow 文件不应仅因存在于 flow 文件夹就写入；
  - flow 未引用的 flow property / unit group 不应写入；
  - source/contact 也应按实际引用闭包和必要的 provenance 引用确定。
- 完整写入必须分阶段执行并留下 artifact：
  1. 远端 before snapshot；
  2. source/contact 写入计划，以及 unitgroup/flowproperty public canonical reuse 或 profile-authorized account-local candidate 计划；
  3. flow 映射和写入计划；
  4. process exchange reference rewrite 计划；
  5. dry-run 报告；
  6. commit 报告；
  7. 远端 after snapshot；
  8. schema/QA/frontend-equivalent/readback 验证报告。
- 所有远端写入必须幂等：
  - 同 UUID/version 已存在于 BAFU 账号时使用 update/upsert_current_version；
  - 不得重复 create 同一 UUID/version；
  - 若目标记录已经是 public 或其他 owner 的记录，不得直接覆盖，必须转为引用复用；profile-authorized BAFU account-local unitgroup/flowproperty 必须使用独立 UUID/version、当前 owner 和 `state_code=0`，不得影子覆盖 public identity。
- 完整写入流程不得执行物理删除。确认未被引用且属于 BAFU 账号的历史残留记录时，只能输出待人工删除清单，列明 UUID、version、entity type、owner、引用检查结果、建议删除原因和风险说明；真正删除动作由人另行确认并执行。
- 所有引用必须在最终远端回读中可解析：
  - process exchange 引用的 flow 要么是 TianGong public/existing canonical，要么是本次 BAFU owner-draft 闭包内、经 profile lock 授权并有 remote verify 的 flow（包括尚无公共候选的 account-local elementary flow）；任何 public process 不得引用 private flow；
  - flow 引用的 flow property / unit group 必须是 TianGong public canonical，或同一 BAFU owner、同为 `state_code=0` 的精确 account-local FP/UG 对，并有 public cache 或 account-local registry + remote verify 证据；
  - contact/source/compliance/data format 引用必须真实存在，不能只在本地包里存在；compliance/data format 必须使用 TianGong public canonical 支撑对象。
- 完整写入不得把 `lciamethods`、LCIA 因子或未评审的影响评价支撑对象顺带写入。若未来要导入 LCIA 相关数据，必须另设规则，因为 elementary flow identity 与 LCIA factor 对应关系是独立质量门禁。
- 完整写入后必须检查 BAFU 账号内是否存在 orphan support records：
  - BAFU-owned flow property / unit group 必须能在 account-local candidate registry 中解释其量纲、单位、引用闭包和后续评审状态；未登记或无引用的记录进入人工处置候选；
  - 未被任何 process/flow/source/provenance 引用的 contact/source；
  - 已被 public canonical 替代但仍残留的旧私有 support。这些记录应进入待人工删除清单，不得混入“本次导入成功”口径。
- 完整写入必须保留 source-to-target mapping CSV/JSON：
  - flow mapping；
  - elementary flow mapping；
  - flow property / unit group mapping；
  - unit conversion mapping；
  - contact/source mapping；
  - compliance system / data set format reference rewrite mapping；
  - process exchange rewrite mapping。这些 mapping 是后续审计、回滚和迁移到 public canonical 的依据。
- 大批量写入需要控制批次和失败恢复：
  - 每个批次必须可重跑；
  - commit 报告必须列出成功、失败、跳过、更新和插入；
  - 远端写入必须按 exact write scope / process bundle closure 形成 dry-run、mutation manifest、commit handoff、commit report、readback verify 和 closeout；
  - 任一 scope 出现引用不完整、schema invalid、前端必填校验失败、unitgroup/flowproperty 既无 public canonical 又无合规的 profile-authorized account-local candidate，或 elementary flow 既未解析 public/existing canonical 又不满足 account-local candidate 门禁，应阻塞该 scope 及依赖它的闭包，并把 blocker 写入 blocked ledger；不得阻塞已经证明依赖独立且门禁通过的其他批次继续自动 commit/readback。

## Mapping Evidence And CSV Contract

- 完整导入必须输出 source-to-target mapping CSV/JSON。mapping 是审计、回滚、LCIA 后续补齐、公共库迁移和远端回读 diff 的依据，不是可选报告。
- mapping 至少覆盖：
  - source package / source dataset / normalized TIDAS / final TianGong dataset 的 id 和 version；
  - contact、source、compliance system、data set format、unit group、flow property、flow、process、exchange、classification、source-language text、unit conversion、reference year、annual supply/production volume；
  - reuse / update / upsert / create / skip / exception / delete-candidate 等动作；
  - source value、normalized value、final value、change reason、evidence、confidence 或 decision status；
  - checkpoint stage、rule snapshot hash、command/report path、review status 和 residual blockers。
- 对 flow classification，mapping 必须记录 `source_classification`、`selected_tidas_classification`、`classification_basis`、`candidate_categories`、`decision_status`。
- 对 elementary flow，mapping 必须区分 public/existing canonical reuse、profile-authorized account-local candidate、forced candidate 和 unresolved blocker；account-local flow 不得进入全局 LCIA 正式缓存，试验因子只能走 BAFU staging overlay。
- 对 support records，mapping 必须说明 source/contact 写入理由、unitgroup/flowproperty public canonical reuse 证据，或 account-local candidate 的 profile-lock、owner/state、单位尺度、引用闭包和专家评审状态。任何未登记的 BAFU-owned unitgroup/flowproperty 才视为历史残留或错误写入候选。
- 执行顺序、checkpoint 和中断恢复机制不在本文重复维护；必须按 `docs/import-profiles/bafu/profile.md` 的九阶段 workflow 执行。
