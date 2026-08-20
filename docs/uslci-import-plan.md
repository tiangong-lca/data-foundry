---
title: Historical USLCI Import Plan
docType: reference
scope: import-profile/uslci-history
status: historical
authoritative: false
owner: tiangong-lca-data-foundry
language: zh
whenToUse:
  - when reconstructing the 2026-06 USLCI import decisions and evidence
whenToUpdate:
  - when a current contract changes how this historical plan should be interpreted
checkPaths:
  - docs/uslci-import-plan.md
  - docs/uslci-import-runbook.md
  - docs/import-profiles/uslci/**
  - specs/import-profiles.json
lastReviewedAt: 2026-07-27
lastReviewedCommit: d29e522562245956d5a146e582a26ddf2a68613e
related:
  - docs/uslci-import-runbook.md
  - docs/import-profiles/uslci/profile.md
  - inputs/source-packages/uslci-database-public.md
---

# USLCI 导入完整方案（USLCI Import Plan — complete）

> **Rust cutover note:** 本文中的 Python checkout、PyPI/SDK 版本、`--python`、`--tidas-tools-dir`、`import_lca` 与旧 CLI conversion/validation 命令仅是 2026-06 批次的历史重现记录，不再是 active contract。新执行必须使用 Foundry 的 `dataset-tidas-import` / `dataset-tidas-validate` 适配器调用兼容 0.2.x 的 Rust `tidas`。
>
> 版本：2026-06-25 · 基座：2026-06 ILCD-alignment 发布（tidas-tools 0.0.34 / tidas-sdk 0.1.45(npm)·0.2.14(PyPI) / @tiangong-lca/cli 0.0.19）+ P1b ref-unit 修复 + foundry USLCI runner。
>
> 本文是 **USLCI 导入的自包含完整方案**。`docs/uslci-import-runbook.md` 是逐会话演进的操作日志/快照入口；本文是端到端的权威计划，从源包事实到收尾交付一次讲清。读完应能独立执行整个导入，无需逆向工程历史。

---

## 1. 目标与收尾口径

**目标**：把 NREL USLCI Database Public（openLCA JSON-LD 包 + 已合并的 U.S. electricity baseline library）的 **1,358 个 process** 无损导入远端 TIDAS 库（Supabase），coverage gap = 0。

- **universe = 1,358**：1,341 个 USLCI 主包 process（1,316 UNIT_PROCESS + 25 LCI_RESULT）+ 17 个被 defaultProvider 传递引用的 library 电网 process。其余 754 个 library process 不被引用，不导入。
- **收尾态（对标 BAFU 99.94% close-out）**：每个 process 最终是
  - **verified** —— reuse 既有 canonical（公共库已有等价数据集）**或** created-account-local My Data（state_code=0），且 readback 比对通过；或
  - **registered-non-importable** —— 带逐项证据的极小残留（理论上接近 0，因为 account-local My Data 创建能力使绝大多数"无 canonical 匹配"项可建可导）。
- **质量要求：尽量无损**（用户 2026-06-23 明确）。源数据很丰富，下列字段必须落进 TIDAS 字段、不能只留 sourceTrace：
  - **pedigree 数据质量**：1,652 process 级条目（+ 逐 exchange）。
  - **不确定性分布**：5,651 exchange（含分布参数）。
  - **分配因子**：61 process。
  - **评审记录**：852 process。
  - 真正无 TIDAS 落点的字段必须逐项列原因（见 §10 保真账）。

---

## 2. 源包事实（权威：`inputs/source-packages/uslci-database-public.md`）

**主包**（openLCA JSON-LD v2，LCA Commons，NREL）：

| 文件夹                        | 计数                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| processes                     | 1,341（1,316 UNIT_PROCESS / 25 LCI_RESULT；77,986 exchange） |
| flows                         | 4,314（2,682 elementary / 1,437 product / 195 waste）        |
| actors / sources              | 70 / 557                                                     |
| flow_properties / unit_groups | 6 / 1（仅 niche；标准 FP/UG 在 library）                     |
| locations / currencies        | 317 / 12（currency 无 exchange 引用）                        |
| bin                           | 9（8 个源附件 PDF/JPG/PNG + 1 calculation-preferences.json） |
| categories.json               | 277 类目路径（仅目录清单；各实体 `category` 字段才权威）     |

**library 补充（已冻结在包内，2026-06-12 下载）**：`libraries/U.S._electricity_baseline_v1.2025-06.0.zip`（sha256 `367b7efe…e20a494`，19,231,416 bytes）。不含 library 时 80.4% process 有悬空引用。解开的 meta.zip 本身是完整 openLCA JSON-LD 包（8 actor / 2 dq_system / 37 FP / 2,310 flow / 82 location / 771 process / 22 source / 31 unit_group）。

**闭合验证事实（2026-06-12）**：主包与 library UUID 重叠 = 0；合并后悬空引用 = 0（0 缺 flow/defaultProvider/FP/UG）；1,341 USLCI process 的 defaultProvider 传递闭包恰好拉入 17 个 library process（无更深级联）→ universe 1,358。

**转换入口关键事实**：tidas-tools `openlca-jsonld` adapter 用 `rglob("*.json")` 递归扫描目录并按 `@type` 分类，**转换包根目录即得到合并闭合的输出**（`libraries/` 的 zip 本身不是 `.json`，不被扫描）。冒烟转换：contacts 78 / sources 580 / unitgroups 32 / flowproperties 43 / flows 6,624 / processes 2,112 / lifecyclemodels 1 / process_bundles 2,112，bundle `unresolved_references` = 0。

---

## 3. 工具链基座（2026-06 发布，已落地）

| 组件 | 版本 | 角色 | 状态 |
| --- | --- | --- | --- |
| tidas-tools | 0.0.34 (PyPI) | openLCA→TIDAS 转换器 + schema + validator | ✅ 已发布（submodule 6761cf0） |
| tidas-sdk | 0.1.45 (npm) / 0.2.14 (PyPI) | 从 schema 生成的校验 SDK（CLI 依赖） | ✅ 已发布 |
| @tiangong-lca/cli | 0.0.19 (npm) | dataset 转换/校验/远端写/readback 包装 | ✅ 已发布（foundry node_modules 待升，当前 0.0.18） |
| tiangong-lca-data-foundry | 本仓库 | 编排（决策回合 + per-scope 提交链 + runner） | 本地工作分支 |

**2026-06 发布修了什么（取代我方早期手工链 conversion-v2..v6）**——`_docs/tidas-ilcd-schema-correspondence-audit-2026-06-24.md`（42-bug 审计）的整改：

- 转换器伪造：elementary 隔间真值；product/process classification 不硬编码 CPC-94900/ISIC-9499 且写 `@name` + 多体系；referenceYear 源真值兜底不写 9999；location 保留 RoW 不塌 GLO + 占位可区分；contact/source/unitgroup classId 常量改派生；timestamp 确定性。
- 无损富字段：allocation 列表；uncertainty 分布参数 + pedigree DQ；**Perc 放宽到 eILCD（允许 >100/负）** → 不确定性 >100 现可保留。
- schema 收紧（`valid-tidas ⟹ valid-ILCD`）：@type 8 值枚举、@version/dataSetVersion `NN.NN(.NNN)`、Real `^` 锚、HK/MO/TW/AN/CS location、多体系 classification、subReference、referenceToDigitalFile 数组、lifecyclemodel @version、LCIA review 枚举。bundle⇄canonical 统一 + zh-lock。

**发布没覆盖、我方保留的两块**：

1. **P1b — UnitGroup `referenceToReferenceUnit` 选错**（新发现，不在审计、不在 0.0.34；`_unit_group_dataset` 仍硬编码 `"1"`=首单位，而 USLCI "Units of mass*length" 首单位 lb*mi、真参考 t\*km cf=1.0 → 指针与 meanValue 不一致）。修复在 tidas-tools 分支 `fix/unitgroup-reference-unit-selection`(ec95d8a，+2 测试)。**行动：PR 上游 → 0.0.35，并进 conversion-v7 构建**。
2. **foundry runner（编排层，与发布无关）**：USLCI runner、库-contact bootstrap、P1a FP/UG account-local mint、P3/P4。见 §6。foundry 分支 `feat/uslci-runner-and-library-contact-bootstrap`。

---

## 4. 三条原则（宪法，违反 = 返工）

1. **不影响平行功能**。绝不读写 BAFU 运行态（`$RUN_BAFU=.foundry/workspaces/bafu-full-import-20260607T080646Z` 等只许 forensic 参考）；不改任何 `dataset-bafu-*` 命令行为；共享代码改动必须 dataset-agnostic + `npm test` 全绿 + `doctor` 通过；共享缓存 `specs/canonical-support/flow-properties-unit-groups.json` 刷新要确认 BAFU 映射未被删改。**特别注意**：BAFU profile 也开了 account-local override，凡 USLCI 专属 mint 行为（如 P1a）必须用 USLCI 专属 flag 门控，不能用 override 门控，否则 BAFU 重跑会变行为。
2. **充分共用既有代码与设施**。转换 owner = tidas-tools + cli 包装，foundry 只编排；缺陷修在 owning 项目不在 foundry 打补丁；决策机制复用 BAFU 的 sha256 绑定 task bundle + deterministic apply。
3. **导入中持续完善本项目**。通用缺陷按归属修复并带测试；确认即修不绕过；每会话回写 runbook §6 快照 + `$RUN/phase-journal.md`；以主题 commit 落库。

---

## 5. 不变式

1. **canonical ledger sources**：成功证据只认 §11 列出的 ledger 目录；coverage 用 `dataset-import-ledger-report --ledger-dir` 逐目录汇总并显式列来源。candidate ≠ authoritative：AI 输出必须带 `authoring_context.context_bundle_sha256` 证据并经 deterministic apply 进库。
2. 每个新批次独立 `--out-dir` + 独立 report/run-manifest/ledger。
3. 所有支持 `--profile` 的命令显式传 `--profile uslci`；所有 decisions/resolution 路径显式传参（runner 默认值指向 BAFU 工件，绝不依赖默认）。
4. **远端写是人工门禁**：任务 frontmatter `allow_remote_commit`；翻转需用户批准账号/写入政策（§9）。在那之前到 dry-run / queue verify 为止。
5. **单位归一化是硬门禁**：override 不放松 `canonical_support_amount_scaling_required`；每次重转换后必须重跑单位校验全过才恢复 commit。

---

## 6. 架构与流水线

```
合并源包(inputs)
  └─ Phase 1: tidas-tools 0.0.34(+P1b) 转换  → $RUN/conversion-v7/  (tidas/ + process-bundles/ + report)
       └─ 新 schema 重校验 (tidas-tools/sdk validator)            → baseline
  └─ Phase 2: dataset-library-index-build                         → $RUN/library-index-v7/
  └─ Phase 3: 决策回合（identity-preflight / classification / location / canonical-support）
       └─ dataset-library-decisions-apply（+ uslci My Data override）→ $RUN/library-resolution-v9/ (ready-scopes + blocked-ledger)
  └─ Phase 4: USLCI runner 逐 scope 提交链
       dataset-uslci-batch-import-run  （复用 BAFU 引擎 + uslci 配置）
         per scope: materialize → 依赖 flow 提交（含 P1a FP/UG + 库contact support 先于 flow）
                    → finalize → mutation-manifest → curation-gate/cleanup
                    → commit-handoff → 远端写 → readback → post-write-closeout
  └─ Phase 5: coverage 闭环 + trace 工作簿 + 交付
```

命令清单：`node scripts/foundry.mjs --help`；逐命令 `node scripts/foundry.mjs <cmd> --help`。决策回合方法论与 BAFU 完全相同（`docs/bafu-import-runbook.md` §4），只换 profile/路径。

**目录地图**：

| 路径 | 是什么 |
| --- | --- |
| `inputs/National_Renewable_Energy_Laboratory-USLCI_Database_Public/` | 冻结源包 + `libraries/` 补充 |
| `$RUN/conversion-vN/` | 转换输出（tidas/ + process-bundles/ + conversion-report.json） |
| `$RUN/library-index-vN/` | entity index + scope projection |
| `$RUN/decisions-vN-*/` | identity/classification/location/canonical-support 决策 JSONL（sha 绑定 bundle 同目录） |
| `$RUN/library-resolution-vN/` | ready-scopes + blocked-scope-ledger |
| `$RUN/batch-import-vN/` | runner 工作台 + import-ledger |
| `$RUN/phase-journal.md` | 阶段日志 |

`$RUN = .foundry/workspaces/uslci-full-import-20260612T093202Z`（现行工作区）。

---

## 7. 双杠杆 importability 模型

每个 process 能否导入由两个杠杆决定（取代早期"931+139 永久非可导入尾巴"框架）：

- **杠杆 1 — classification 授权**（唯一硬必须的 AI 工作）：3,750 个 leaf 决策（process→ISIC4 + flow-product→CPC4-5；NAICS 仅弱提示），走 generic `dataset-classification-decisions.mjs`。0.0.34 转换器现在原生写 `@name` + 支持多体系，但 leaf code 不变，决策契约沿用。
- **杠杆 2 — account-local "My Data" override**（profile 数据驱动通用能力，零 gate 代码改动）：`specs/import-profiles.json` 的 `allow_account_local_support_and_elementary`（uslci `enabled:true`，D4 已授权）。把无公共 canonical 匹配的 elementary flow / 本地 FP / UG 铸为 account-local（state_code=0），而非留作非可导入。
  - elementary：remap-first（FEDEFL trace 全候选池 re-judge）/ mint-last。
  - FP/UG：按 §6 P1a 在依赖 flow 前 mint-once 并提交为 support。
  - **绝不污染共享 canonical-support 缓存**。

收尾 = verified(reuse + My Data) + 极小 registered-non-importable = 1,358，gap 0。

---

## 8. Runner 机制（foundry，本会话落地，2026-06 发布不含）

USLCI runner = `dataset-uslci-batch-import-run`（`scripts/commands/uslci-batch-import-run.mjs`），薄包装 `createBafuBatchImportRunCommands(deps, config)`，BAFU 引擎零回归（`npm test` 206/206）。uslci 配置：`profile:"uslci"`、autofill OFF、family-signatures OFF、NREL libraryContact、`commitFlowSupportInline:true`、`mintUnmatchedFpUgSupport:true`。

机制要点：

- **库-contact bootstrap**：首次导入一个全新库时，共享库 contact 从未在远端 → flow pre-finalize 的 reference-closure 卡死（BAFU 不踩坑因 FOEN 已在远端）。修：`post-authoring-finalize` 的 source/contact rewrite 放开到 `bafu||uslci`；`buildFinalizeArgs` 用 collision-free `--library-*` flag 把 NREL contact 透传 finalize 子进程；`bundle-sample-utils` 读 `library*` 前缀；flow 路径 gated 内联 `maybeCommitSupportThenRerunFinalize`（`commitFlowSupportInline`，仅 uslci）。
- **P1a — 未匹配 FP/UG 作为 account-local support 在依赖 flow 前 mint**：过滤器 = materialized FP/UG 中 UUID 不在 canonical 缓存的（reuse 的如 Mass 93a60a56 跳过；未匹配的如 mass×distance 838aaa20 mint）。UG 先于 FP（FP→UG 依赖）。经 source-contact "support"（mixed/auto）子-finalize + handoff + commit，verifiedSupportIdentities 跨 scope 去重。配套修：support dry-run/commit 传 `--allow-account-local-support`；closure 的 dry-run 证据查找覆盖 unitgroup/flowproperty；mutation-manifest 把对公共 canonical source（ILCD format/compliance）的直接引用判为 proven。**已验证**：mint scope 0001b273 的 UG 838aaa21 + FP 838aaa20 + contact 提交（3 support verified）、6 dependency flows verified。
- **P3 不铸孤立**：0 in-scope 引用的 support 不 mint（待实现，§12）。
- **P4 批内去重**：同语义 flow/source/FP 多 UUID → mint 一个其余 rewrite（待实现，§12）。

> ⚠️ 以上 runner 验证基于旧 schema(conversion-v6)。conversion-v7（新 schema）后需在 v7 上重验证；旧 schema 测试写入（e93ae1c1 等）需清理或 version-bump。

---

## 9. 账号与写入政策（D4，已授权）

- **导入账号**：linanenv@126.com → user_id `5c784552-09a5-43dc-b704-b96ed3239ecd`（apikey 在 `.env`，绝不外泄）。
- **写入态**：state_code=0（My Data / account-local），`--target-user-id` 绑定。
- **D2 署名**（已定）：库 contact = NREL / U.S. Federal LCA Commons；**不含任何 openLCA 软件信息**（openLCA 是软件不是 contact，导出可能污染）。实测 committed 报告 NREL×22 / FOEN×0 / openLCA×0 / GreenDelta×0。
- **D3-QA**（已定）：像 BAFU 一样 waive `process_material_balance_deviation`（唯一 warning）；LCI_RESULT(25) / amountFormula(1,425) 纳入首批。
- **运行环境**（每次 commit 前）：
  ```bash
  cd /Users/davidli/projects/workspace/tiangong-lca-data-foundry
  set -a; source .env 2>/dev/null; set +a
  export TIANGONG_LCA_CLI_BIN=$PWD/node_modules/.bin/tiangong-lca   # .env 里该值为空，必须 export
  TUID=5c784552-09a5-43dc-b704-b96ed3239ecd                          # zsh 中 UID 是保留字，用 TUID
  ```

---

## 10. 无损保真账（§1 无损要求的逐项落点）

发布的转换器（0.0.34）已把可无损映射的富字段原生落进 TIDAS 字段（conversion-v7 继承并应优于早期 conversion-v4）：

| 富字段 | 量 | TIDAS 目标字段 | 状态 |
| --- | --- | --- | --- |
| 评审记录 reviews | 852 process | `validation.review` | 保留（回归守护） |
| 不确定性分布 | 5,651 exchange | `relativeStandardDeviation95In`、`min/maxAmount` | 全落字段；**Perc 放宽后 >100 现可保留**（早期量化到 ≤100 已过时） |
| pedigree DQ（process 级） | 1,652 process | `validation.review.common:dataQualityIndicators` | 全落字段（1=best→Very good … 5→Very poor） |
| 分配因子 | 61 process（56 多功能） | exchange `allocations`（列表） | 无损落字段（per-exchange 多 co-product，分数和=100%；方法另在 `LCIMethodApproaches`） |

**已知有据残留**（无 TIDAS 忠实落点，完整数据留 sourceTrace，conversion-report fidelity summary 计数）：

- D1 逐-exchange flow pedigree（28,572）：ILCD 无 per-exchange DQ slot → trace。
- U1 三角分布 mode / D2 dqSystem 身份 / D3 exchange 派生类型（openLCA 无原生值，默认 Unknown derivation）：trace/默认。

**口径**：conversion-v7 后重跑 conversion-report 的 `rich_field_fidelity_summary` 确认上述全保持；单位归一化 78,757/78,757、隔间 0 错配、TIDAS 校验 0 必须全过。

---

## 11. 分阶段执行计划（基于 conversion-v7）

### Phase 0 — 源闭合（✅ 已完成 2026-06-12）

library 补充已下载冻结（sha256 记录）；合并闭合 0 悬空；universe 1,358 确定。见 §2。

### Phase 1 — 采用发布基座 + 重转换 → conversion-v7

1. foundry `npm install --no-save @tiangong-lca/cli@0.0.19`（当前 0.0.18）。
2. 转换引擎 = tidas-tools 0.0.34 **+ 合并 P1b(ec95d8a)**（PR 上游→0.0.35，或本地装该分支的构建）。
3. **从 0.0.34 重新同步 foundry 的 tidas-schema 镜像**（早期手工放宽 allocation 的那份已被上游取代，勿保留手工版）。
4. 重转换全部 2,113 process → `$RUN/conversion-v7/`（`dataset import-lca convert` 包装；`--python <venv 解释器>`）。原生得到正确隔间 / classification(@name+多体系) / referenceYear / location(RoW) / timestamp / allocation / uncertainty(Perc>100 保留) / ILCD-conforming @type·version·Real。
5. **新 schema 重校验 v7**（tidas-tools 0.0.34 / sdk 0.2.14 validator），目标 0 error；存档 baseline；重跑 `$RUN/unit-normalization-verify/verify.py` 全过。

### Phase 2 — library-index

`dataset-library-index-build` → `$RUN/library-index-v7/`（entity index + scope projection = {process: 2112}，0 lifecyclemodel scope，见 §13）。

### Phase 3 — 决策回合 + override

- **identity-preflight**（3,919 全量；远端 `flow_hybrid_search`/`process_hybrid_search`；500-bug 已修）。identity key 跨 schema 应稳定，沿用 decisions 主体；新转换若改了支持身份需复核。
- **classification 授权**（杠杆 1）：context-pack → bundle-sample-rows → per-type 去重队列 → task-build(sha) → AI 授权 ISIC/CPC leaf → `dataset-library-classification-decisions-project`（leaf 门禁）→ `dataset-classification-decisions-apply`。**2,990 决策需在 v7 上复核+重投影/重应用**（新转换写 @name/多体系，leaf code 不变但队列键/契约要对齐）。
- **location / canonical-support** 决策回合（同 BAFU 机制）。
- `dataset-library-decisions-apply --profile uslci`（override ON）→ `$RUN/library-resolution-v9/`：in-universe 1,358 ready（elementary 无匹配 + 本地 FP/UG 将在 commit 时 mint 为 My Data）。

### Phase 4 — 提交（USLCI runner）

1. **清理旧 schema(v6) 测试写入**：e93ea1c1... → e93ae1c1 + v7-mint 的 flows/FP/UG（account-local linanenv）删除或 version-bump，避免旧-schema 残留。
2. **单 scope 重验证**（v7）：reuse-only scope（如 e93ae1c1）+ mint scope（如 0001b273）各一，确认 P1a FP/UG mint + 库contact + flows + process 全链 verify。
3. **小批量验证**：`--limit N` 跑若干 scope，确认无新 blocker。
4. **scale**：去掉 `--limit`/`--process-id`，全量 1,358。命令骨架：
   ```bash
   node scripts/foundry.mjs dataset-uslci-batch-import-run \
     --run-dir "$RUN" \
     --scope-file "$RUN/library-resolution-v9/ready-scopes.jsonl" \
     --process-bundles-dir "$RUN/conversion-v7/process-bundles" \
     --library-classification-decisions "$RUN/decisions-v5/classification-decisions.jsonl" \
     --out-dir "$RUN/batch-import-v8" \
     --target-user-id "$TUID" --commit --parallel <N>
   ```

### Phase 5 — coverage 闭环 + 交付

- coverage：`dataset-import-ledger-report --ledger-dir` 逐目录汇总，目标 verified + 极小 registered-non-importable = 1,358，gap 0。
- trace 工作簿：fork `reports/bafu-import/build-bafu-trace-xlsx.py` → `reports/uslci-import/`（7-sheet：进展/人工校验/process trace/flow trace/转换映射/support identities/summary），非 drop-in。
- 交付：见 §14。

---

## 12. 已知 blocker 与分诊

| # | 问题 | 状态 / 处置 |
| --- | --- | --- |
| task #8 | process 评审报告悬空 source（`referenceToCompleteReviewReport → 75ac425f`，无 backing source → 闭包失败，block process commit） | **conversion-v7 后先复核是否仍在**（0.0.34 占位/源真值修复或已改发射）；若在：转换器建 review-report source（tidas-tools）或 curation externalize 悬空引用（foundry）。非 P1a 问题。 |
| P1b | UnitGroup referenceToReferenceUnit 选错 | tidas-tools ec95d8a，PR 上游→0.0.35，进 v7 构建 |
| P2 | elementary 复用太字面（漏同义/CAS/拼写/隔间归一化） | 0.0.34 隔间真值映射或已提升复用、降假 mint；**v7 后用新隔间复核 reuse-vs-mint**，再定 CAS/同义阈值（数据质量，需用户定阈） |
| P3 | 铸孤立 support（0 in-scope 引用） | foundry runner reference-closure 加"0 引用不 mint"（待实现） |
| P4 | 批内同语义 support 重复 mint | foundry runner 批内按语义键去重（待实现） |
| QA | amountFormula 1,425 仅存 trace | D3-QA 已纳入首批；公式本身未重缩放（trace），QA 定性 |
| 双语 | 纯英文源 vs TIDAS zh/en 双语 | curation gate 可能 block；定 transcreation 批量路径 |

**已澄清非 bug**：flowType 映射忠实（读 openLCA 显式 `flowType`，不用 input/outputGroup，0 错配）；currency(12)/location 实体/categories.json 不转为 TIDAS 实体（已定性）。

---

## 13. 与 BAFU 的差异（速查）

| 维度 | BAFU | USLCI |
| --- | --- | --- |
| 源格式 | ecoSpold1 →预转换 TIDAS | openLCA JSON-LD，Phase 1 现场转 |
| 引用闭合 | 包内自洽 | 依赖外部 library（已合并冻结） |
| 单位 | 天然同单位 | 12.2% exchange 需换算（单位归一化已闭环） |
| 名称 | 德文压缩名，需 name-split | 分号结构化英文名，无 name-split 回合 |
| 支持数据 | 合成 contact/source 居多 | 70 真实 actor + 557 真实 source |
| elementary 体系 | ecoinvent 隔间 | FEDEFL 隔间（0.0.34 原生映射真值） |
| 批量 runner | dataset-bafu-batch-import-run | **dataset-uslci-batch-import-run**（薄包 BAFU 引擎 + uslci 配置） |
| 库 contact | FOEN（早已在远端） | NREL（本导入首次 bootstrap，见 §8） |
| My Data override | 2026-06-15 enabled | enabled（D4-elementary 已授权） |
| coverage/trace 生成器 | bafu 硬编码 | fork 到 `reports/uslci-import/`（非 drop-in） |
| 导入单位 | process | **同样全是 process（不是 lifecyclemodel）** |

**导入单位澄清**：两种 openLCA processType 都映射成 TIDAS **process**（`UNIT_PROCESS → "Unit process, single operation"`；`LCI_RESULT → "LCI result"`，`typeOfDataSet` 是 process 数据集内部枚举）。conversion 产出的 1 个 lifecyclemodel 是从 defaultProvider 图派生的候选产物，**不是导入单位**；scope universe 是纯 process（{process: 2112}），1,358 in-scope 全是 process。产品系统/链接性作为 trace 保留在各 process 内，不展开成 2,112 个 lifecyclemodel。257 个 LCI_RESULT（主包 25 + library 232）导入为 process(`typeOfDataSet="LCI result"`)。

---

## 14. 交付（PR→main per submodule + docpact 预推门）

- **tidas-tools**：P1b ref-unit 修复 → PR `fix/unitgroup-reference-unit-selection`(ec95d8a) → main → 发 0.0.35（PyPI）。
- **tidas-sdk**：schema 改动经 GitHub `dispatch-tidas-sdk-sync.yml` 自动同步，勿手改副本；随 0.0.35 发 npm/PyPI。
- **@tiangong-lca/cli**：assets schema 镜像随 sdk 更新；合并即发 npm（约定）。
- **foundry**：`feat/uslci-runner-and-library-contact-bootstrap`（USLCI runner + 库-contact bootstrap + P1a + 分析文档 + 本 plan）→ PR → main。
- **元仓 lca-workspace**：各 submodule PR 合并后 bump 指针；docpact 预推门 = review mark + commit doc。
- 详见 memory [[lca-workspace-delivery]]。

---

## 15. 并行注意：BAFU 远端数据需独立迁移（不属本 plan）

BAFU 已入远端的 11,740 行用旧 schema 写入，新 schema 收紧后可能校验失败，需按 `_docs/tidas-schema-data-migration-2026-06.md` 的 §3（walker：@type 枚举 / version 规范 / B1 lifecyclemodel）+ §4（SQL：HK/MO/TW / lciamethods bool/枚举/键名）迁移。这是与 USLCI **并行的独立任务**；USLCI 用 conversion-v7（新 schema）直接写，**无需迁移**。

---

## 16. 一页执行清单

1. `npm i @tiangong-lca/cli@0.0.19`；合并 P1b 进 tidas-tools 构建；重同步 foundry schema 镜像。
2. 重转换 → conversion-v7；新 schema 校验 0 error + 单位校验全过 + fidelity summary 确认。
3. library-index-v7 → 决策回合（identity 沿用 / classification 2,990 复核重应用 / location / canonical-support）→ resolution-v9（override ON，1,358 ready）。
4. 清理旧 schema(v6) 测试写入。
5. USLCI runner：单 scope（reuse+mint）重验证 → 小批量 → scale 1,358。
6. 复核 task #8（评审悬空 source）+ P2 复用；实现 P3/P4。
7. coverage gap 0 + trace 工作簿 + per-submodule PR 交付。

> 状态快照与逐会话日志见 `docs/uslci-import-runbook.md` §6 + `$RUN/phase-journal.md`。本 plan 描述目标方案；运行态以 runbook/journal 为准。
