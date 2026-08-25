---
title: Historical USLCI Import Runbook
docType: runbook
scope: import-profile/uslci-history
status: historical
authoritative: false
owner: tiangong-lca-data-foundry
language: zh
whenToUse:
  - when reconstructing the 2026-06 USLCI import execution record and diagnostics
whenToUpdate:
  - when a current contract changes how this historical runbook should be interpreted
checkPaths:
  - docs/uslci-import-runbook.md
  - docs/uslci-import-plan.md
  - docs/import-profiles/uslci/**
  - scripts/lib/import-curation/**
lastReviewedAt: 2026-08-25
lastReviewedCommit: a2832001e1b67bdc8a1a9eb7707a99187f787a58
lastReviewedNote: "Reviewed for Issue #67 Wave 22b: the typed USLCI profile wrapper preserves its exact configuration and leaves this retained Python-era runbook historical and non-authoritative."
related:
  - docs/uslci-import-plan.md
  - docs/import-profiles/uslci/profile.md
  - inputs/source-packages/uslci-database-public.md
---

# USLCI 导入运行手册（goal 入口文档）

> **Rust cutover note:** 本文保留 2026-06 Python `tidas-tools`、PyPI/SDK 版本与旧 CLI wrapper 命令作为历史证据；这些路径不再是可执行入口，也不得用于新任务。当前确定性转换/校验统一使用 `node scripts/foundry.mjs dataset-tidas-import|dataset-tidas-validate` → Rust `tidas` 0.2.x；AI curation、QA、remote handoff 继续使用 Foundry/CLI。
>
> **完整方案见 [`docs/uslci-import-plan.md`](uslci-import-plan.md)（自包含、端到端的权威计划）。本文是逐会话的操作日志/快照入口（§6 当前状态、§R 摘要、分诊表）。**
>
> 目标读者：接手 USLCI 持续导入的任何一个 agent 会话或人工操作者。读完本文应能：知道当前阶段在哪、用哪条命令继续、遇到 blocker 怎么分诊，而不需要重新逆向工程。最后更新：2026-06-25（**§R 为当前权威计划**：2026-06 ILCD-alignment 发布 tidas-tools 0.0.34 / sdk 0.1.45·0.2.14 / cli 0.0.19 已修 42-bug 审计并收紧 schema → 计划改为 conversion-v7 重转换，手工补丁链 v2..v6 作废）。更新本文时同步更新「§6 当前状态快照」。

---

## 0. 三十秒定位

- **Goal**：把 `inputs/National_Renewable_Energy_Laboratory-USLCI_Database_Public` 的 **1,358** 个 process（1,341 USLCI + 17 个被传递引用的 library 电网过程）导入远端 TIDAS 库，gap 0。**收尾口径（对标 BAFU 99.94% close-out）**：每个 process 最终为 _verified_（reuse 既有 canonical **或** created-account-local My Data，readback-verified）或带逐项证据的 _registered-non-importable_。account-local My Data 创建能力使绝大多数原"无 canonical 匹配"项可建可导，非可导入应是极小残留。
- **质量要求：尽量无损导入**（用户 2026-06-23 明确）。USLCI 数据本身很丰富，这些必须落进 TIDAS 字段、不能只留在 sourceTrace：**881 个 process 的 pedigree 数据质量条目**（+ 逐 exchange pedigree）、**5,651 条 exchange 的不确定性分布（含分布参数）**、**61 个 process 的分配因子**、**852 个 process 的评审记录**。真正无 TIDAS 落点的字段必须逐项列出原因（见 §7.1 数据保真表）。落地见 CAP-20260623-002（tidas-tools 转换器增强 → conversion-v4 commit-canonical）。
- **Profile**：`uslci`（`specs/import-profiles.json`；约束见 `docs/import-profiles/uslci/`）。Lane：`external-dataset-curated-import`，**禁止新增 USLCI 专用 Foundry 代码路径，直到 pilot 证明必要**。
- **任务文件**：`tasks/active/external-import-20260612-uslci.md`（已 claim，state Doing；队列内容是本地运行态，不入 git）。
- **源包事实与 sha256**：`inputs/source-packages/uslci-database-public.md`（这是 source manifest，所有计数和复现命令在那里，本文不重复）。
- **工作区**：`RUN=.foundry/workspaces/uslci-full-import-<UTC时间戳>`（Phase 1 创建后回填到 §6；下文 `$RUN` 指它）。阶段日志：`$RUN/phase-journal.md`。
- **所有命令从仓库根目录跑**（`tiangong-lca-data-foundry/`）。

```bash
cd /Users/davidli/projects/workspace/tiangong-lca-data-foundry
# Phase 1 起：export RUN=.foundry/workspaces/uslci-full-import-<ts>
```

---

## R. 2026-06 ILCD-alignment 发布已落地 → 重转换计划（当前权威计划，取代手工补丁）

> 2026-06-25。四个项目发布了 2026-06 ILCD-alignment 修复——**tidas-tools 0.0.34 / tidas-sdk 0.1.45(npm)·0.2.14(PyPI) / @tiangong-lca/cli 0.0.19**——把 42-bug 审计（`_docs/tidas-ilcd-schema-correspondence-audit-2026-06-24.md`）里的转换器伪造 + schema 松弛 + bundle drift 都修了，并收紧 schema 使 `valid-tidas ⟹ valid-ILCD`。**§5 原 Phase 计划中"逐版 conversion-vN 手工补丁"的部分作废**——绝大多数手工修复现已在上游 0.0.34 原生修好。迁移指南：`_docs/tidas-schema-data-migration-2026-06.md`。

### R.1 发布修了什么（与 USLCI 直接相关，取代我方手工链 v2..v6）

- ✅ **转换器伪造修复**：elementary 隔间真值（cc3aaaf，取代 CAP-001/v3）；product/process classification 不再硬编码 CPC-94900/ISIC-9499 且**写 @name + 多体系**（09d293e）；referenceYear 源真值兜底、不写 9999（220d8fc，取代 v6 手工）；location 保留 **RoW** 不塌成 GLO、占位可区分（9593505）；contact/source/unitgroup classId 4/5/6 常量改为派生；timestamp 确定性。
- ✅ **无损富字段**：allocation 列表（d35b654）；uncertainty 分布参数 + pedigree DQ（0730b70）；**Perc 放宽到 eILCD（≤5 位、≤3 小数、允许 >100/负，adcc49b）** → `relativeStandardDeviation95In` >100 现可保留（**我之前把 GSD² 量化到 ≤100 丢弃 >100 的做法已过时，新转换原生保留，是无损提升**）。
- ✅ **schema 收紧**：GlobalReferenceType @type 8 值枚举、@version/dataSetVersion `NN.NN(.NNN)`、Real 加 `^` 锚、HK/MO/TW/AN/CS location、多体系 classification `anyOf[object,array]`+@name/@classes、subReference、referenceToDigitalFile 数组、lifecyclemodel @version、LCIA review 枚举等（c7dc15f / 0.0.31-0.0.33）。bundle⇄canonical schema 已统一 + zh-lock。

### R.2 发布**没有**覆盖的（仍需我方，全部保留）

- ⚠️ **UnitGroup `referenceToReferenceUnit` 选错**（我的 **P1b 新发现，不在 42-bug 审计、不在 0.0.34**）：`_unit_group_dataset` 仍硬编码 `"1"`（首单位），USLCI "Units of mass*length" 首单位 lb*mi、真参考 t\*km(cf 1.0) → 参考指针与 meanValue 不一致。修复在 tidas-tools 分支 `fix/unitgroup-reference-unit-selection`(ec95d8a，+2 测试/suite 98)。**行动：PR 上游 → 0.0.35；conversion-v7 必须用含此修复的 tidas-tools 构建**。
- ⚠️ **foundry runner 改动（编排层，与发布无关，0.0.34 不含，全部保留）**：USLCI runner `dataset-uslci-batch-import-run`、库-contact bootstrap、**P1a 未匹配 FP/UG 作为 account-local support 在依赖 flow 前 mint（已实现+验证：mint scope 0001b273 的 FP/UG 提交 + 6 flows verified）**、P3 不铸孤立、P4 批内去重。foundry 分支 `feat/uslci-runner-and-library-contact-bootstrap`（commits a51ef80/3bf2ed3/a4d672c + 早先）。

### R.3 重转换计划（conversion-v7 = 新 commit-canonical）

1. **采用发布基座**：foundry `npm i @tiangong-lca/cli@0.0.19`（当前 0.0.18）；转换引擎 = tidas-tools 0.0.34（submodule 已在 6761cf0）**+ 合并 P1b(ec95d8a)**（或本地装该分支）；**从 0.0.34 重新同步 foundry 的 tidas-schema 镜像**（我之前手工放宽 allocation 的那份已被上游取代，勿保留手工版）。
2. **重转换全部 2,113 process → conversion-v7**：原生得到正确隔间 / classification(@name+多体系) / referenceYear / location(RoW) / timestamp / allocation / uncertainty(Perc>100 保留) / ILCD-conforming @type·version·Real。**取代 conversion-v2..v6 整条手工链。**
3. **用新 schema 重校验 v7**（tidas-tools 0.0.34 / sdk 0.2.14 validator）：目标 0 error（同源转换器应通过）；存档 baseline 证无新失败。
4. **从 v7 重建 canonical 链**：library-index-v7 → decisions-v5（identity key 应稳定；**classification 2,990 决策需复核+重投影/重应用**——新转换写 @name/可能多体系，leaf code 不变但队列键/契约要对齐）→ library-resolution-v9（override ON → 1,358 ready）。
5. **重验证导入链**：USLCI runner 在 v7 上重跑 mint scope(0001b273) + reuse scope(e93ae1c1)，确认 P1a FP/UG mint + flows + process verify。**先清理 v6 测试写入**（e93ae1c1 + v7-mint 的 flows/FP/UG，account-local linanenv 账号）或 version-bump，避免旧-schema 残留。
6. **scale 到 1,358（v7）**，coverage 闭环 gap 0。

### R.4 重转换后复核的残留 blocker

- **process 评审报告悬空 source（task #8 / 75ac425f）**：转换器对 review 写 `referenceToCompleteReviewReport → source` 但不建该 source → 闭包失败。0.0.34 的占位/源真值修复**可能改变 review-source 发射**——conversion-v7 后**先复核是否仍在**；若在，按 task #8 处理（转换器建 review-report source，或 curation externalize 悬空引用）。
- **P2 elementary 复用**：0.0.34 隔间真值映射可能提升复用、降假 mint；v7 后用新隔间复核 reuse-vs-mint，再定 CAS/同义阈值（数据质量，需用户定阈）。

### R.5 注意：已入远端的 BAFU 数据需独立迁移（不属本 plan）

BAFU 11,740 行用旧 schema 写入，新 schema 收紧后**可能校验失败**，需按迁移指南 §3/§4 走 walker/SQL（@type 枚举、version 规范、HK/MO/TW、lciamethods bool/枚举/键名、lifecyclemodel @version 等）。这是与 USLCI **并行的独立任务**；USLCI 用 v7（新 schema）直接写，**无需迁移**。

---

## 1. 三条原则（本 goal 的宪法，违反 = 返工）

1. **不影响平行功能**。
   - 绝不读写 BAFU 的运行态：`$RUN_BAFU=.foundry/workspaces/bafu-full-import-20260607T080646Z` 及其全部 decisions/ledger/resolution 目录只许 forensic 参考，不许修改。BAFU 后续 unlock 回合（decisions-v13 路径）可能与本 goal 并行。
   - 不改变任何 `dataset-bafu-*` 命令的行为；共享代码（`scripts/lib`、`scripts/commands/` 中 profile 无关部分）的改动必须 dataset-agnostic 且 `npm test` 全绿 + `node scripts/foundry.mjs doctor` 通过后才能落地。
   - 共享资源注意：`specs/canonical-support/flow-properties-unit-groups.json` 是跨 profile 公共缓存，`dataset-support-cache-refresh` 是增量安全的，但刷新后要确认 BAFU 既有映射未被删改。
   - 单独数据集制备（`source-evidence-dataset-development` lane）与本 goal 无共享运行态，互不阻塞。
2. **充分共用既有代码与设施**。
   - 格式转换 owner 是 tidas-tools（`openlca-jsonld` adapter）+ tiangong-lca-cli 包装，Foundry 只编排（`docs/capability-ownership-policy.md`、`specs/workspace-capability-adapters.md` 的 `external-lca-package-conversion`）。转换器缺陷修在 tidas-tools，不在 Foundry 打补丁。
   - 编排走 generic 命令链（§4），决策机制完全复用 BAFU 打磨出的 sha256 绑定 task bundle + deterministic apply 体系。
3. **导入过程中持续迭代完善本项目**。
   - 每轮批次暴露的通用缺陷按归属修复：Foundry 编排层 → 本仓库 generic 层（带测试）；转换/校验 → tidas-tools（capability-development-request 任务，模板在 `tasks/templates/`）；CLI 包装 → tiangong-lca-cli。
   - **确认即修，不绕过**：导入中确认的转换器/校验缺陷（如已确认的单位归一化 a3e1aa9、elementary 隔间硬编码 CAP-20260623-001）在 owning 项目同步修复并带独立验证，**绝不在 foundry 打补丁掩盖**。已确认缺陷与已澄清非缺陷见 §9。
   - pilot 之后预期的两个 Foundry 演进项（届时按 P1 提）：把 `dataset-bafu-batch-import-run` 参数化为 profile 驱动的通用批量 runner；把 `dataset-bafu-universe-coverage-report` 推广为 profile 无关的 coverage 报告。
   - 每个会话结束前：回写 §6 快照 + `$RUN/phase-journal.md`；修复以主题 commit 落 foundry main。

## 2. 不变式（继承 BAFU 经验，从第一天就执行）

1. **canonical ledger sources**：成功证据只认 §6 列出的 ledger 目录；coverage 统计用 `dataset-import-ledger-report --ledger-dir` 逐目录汇总并显式列出来源（注意：`--ledger-source-dir` 这个 flag 只存在于 BAFU 专用 runner，generic 链没有，等 §1-3 的通用化演进后才可用）。candidate ≠ authoritative：AI 输出必须带 `authoring_context.context_bundle_sha256` 证据并经 deterministic apply 进库。
2. 每个新批次独立 `--out-dir`、独立 report / run-manifest / ledger。
3. 所有支持 `--profile` 的命令**显式传 `--profile uslci`**；所有 decisions/resolution 路径显式传参——`dataset-bafu-batch-import-run` 一类命令的默认值指向 BAFU 工件，绝不能依赖默认。
4. **远端写入是人工门禁**：任务 frontmatter `allow_remote_commit: false`；翻转它需要用户明确批准账号/写入政策（§5 D4）。在那之前一切到 dry-run / queue verify 为止。
5. **单位归一化硬门禁**：✅ 已满足（2026-06-12 关闭，tidas-tools a3e1aa9 + 独立校验器全对，见 §7-2）。规则保留：若未来重新转换（新 tidas-tools 版本/源包变更），必须重跑 `$RUN/unit-normalization-verify/verify.py` 全对后才可恢复 commit。
6. 高并行跑 CLI 时 `npm install --no-save @tiangong-lca/cli@latest && export TIANGONG_LCA_CLI_BIN=$PWD/node_modules/.bin/tiangong-lca`（npx 并发风暴会假性 blocked；BAFU 实测教训）。
7. 源包目录（含 `libraries/`）是冻结输入：任何变更必须同步更新 `inputs/source-packages/uslci-database-public.md` 的 sha256/日期。

## 3. 目录地图

| 路径 | 是什么 |
| --- | --- |
| `inputs/National_Renewable_Energy_Laboratory-USLCI_Database_Public/` | 冻结源包（openLCA JSON-LD v2）+ `libraries/` 补充数据（见 source manifest） |
| `inputs/source-packages/uslci-database-public.md` | source manifest：计数、sha256、闭合验证事实、复现命令 |
| `docs/import-profiles/uslci/` | profile.md（政策与 open decisions）、constraints.md（gate 约束） |
| `$RUN/conversion-vN/` | tidas-tools 转换输出（tidas/ + process-bundles/ + conversion-report.json），Phase 1 产生 |
| `$RUN/library-index/` | `dataset-library-index-build` 输出（entity index + scope projection） |
| `$RUN/decisions-vN-*/` | identity / classification / location / canonical-support 决策 JSONL（sha 绑定 bundle 证据同目录） |
| `$RUN/library-resolution-vN/` | `dataset-library-decisions-apply` 输出：ready-scopes + blocked-scope-ledger |
| `$RUN/batch-import-vN-*/` | 批次工作台与 import-ledger |
| `$RUN/phase-journal.md` | 阶段日志（每会话追加） |

## 4. 流水线总览

```
inputs(合并源包) → tidas-tools 转换（CLI 包装入口，见 §5 Phase 1）
  → dataset-library-index-build      ($RUN/library-index)
  → [决策回合] identity-preflight / classification / location / canonical-support  ($RUN/decisions-vN)
  → dataset-library-decisions-apply  ($RUN/library-resolution-vN)
  → generic 提交链（per scope）：tiangong-lca dataset curation-queue build/next/verify
      + dataset-curation-gate / dataset-curation-cleanup
      + dataset-post-authoring-finalize → dataset-mutation-manifest
      → dataset-commit-handoff-plan → remote write → readback → dataset-post-write-closeout
      （批量执行器：dataset-process-scope-run；不要用 dataset-bafu-batch-import-run）
  → dataset-import-ledger-report / coverage 统计 → 回写 §6
```

命令清单：`node scripts/foundry.mjs --help`；逐命令参数 `node scripts/foundry.mjs <cmd> --help`。决策回合的方法论直接参照 `docs/bafu-import-runbook.md` §4（机制完全相同，只是 profile/路径换成 uslci）。

## 5. 阶段计划

### Phase 0 — 补充数据与可转换性验证 ✅（2026-06-12 本会话完成）

- library zip 下载冻结 + meta 解压进 `libraries/`；UUID 零冲突、引用闭合 0 缺失、传递 provider 闭包 = 17 个 library 过程——全部验证通过（证据与命令：source manifest）。
- 合并包根目录全量冒烟转换（tidas-tools 0.0.29 checkout）：0 错误、TIDAS 校验 0 issue、2,112 bundles、`unresolved_references` 0。CLI 包装入口（@tiangong-lca/cli 0.0.16）端到端验证通过。输出在 /tmp（一次性，Phase 1 正式重跑进 $RUN）。

### Phase 1 — 入场与正式转换

1. claim 任务（inbox → active），`mkdir -p .foundry/workspaces/uslci-full-import-<ts>`，回填 §6 的 $RUN，开 phase-journal。
2. 正式转换（文档入口，@tiangong-lca/cli ≥0.0.16；注意包装裸调 `python3`，必须 `--python` 指向带 tidas-tools 依赖的解释器）：
   ```bash
   npm install --no-save @tiangong-lca/cli@latest
   ./node_modules/.bin/tiangong-lca dataset import-lca convert \
     --input "inputs/National_Renewable_Energy_Laboratory-USLCI_Database_Public" \
     --output-dir "$RUN/conversion-v1" \
     --from-format openlca-jsonld --target tidas --validation-jobs 0 \
     --python /Users/davidli/projects/workspace/tidas-tools/.venv/bin/python \
     --tidas-tools-dir /Users/davidli/projects/workspace/tidas-tools --json
   ```
   备选（包装不可用时等价）：`cd tidas-tools && PYTHONPATH=src .venv/bin/python -m tidas_tools.import_lca.cli --input … --output-dir … --from-format openlca-jsonld --target tidas --validation-jobs 0`。预期 ≈2-4 分钟、1.9 GB。出场标准：conversion-report 0 error；TIDAS validation ok；bundle index `unresolved_references == 0`；数字与 source manifest 冒烟一致。
3. `dataset-library-index-build` 指向 `$RUN/conversion-v1/process-bundles` 建库存索引。
4. **范围决策 D1（默认推荐已给）**：universe = 1,341 USLCI + 17 provider 过程 = 1,358；其余 754 个 library 过程不在本 goal 范围（未来可另立 goal）。在 phase-journal 记录 universe 清单文件。

### Phase 2 / identity ✅（2026-06-12/13 完成）

单位归一化（tidas-tools a3e1aa9）+ identity evaluator openLCA-compartment 修复（foundry 9136031）已闭环：conversion-v2 9,478 处换算、独立校验器 78,757/78,757 全对；elementary identity reuse 2,988/3,919（0 假阳性）。详见 §6 与 phase-journal。

> **战略升级（2026-06-23，基于 foundry main 新能力重制）**：BAFU 已 **GOAL COMPLETE（11,740/11,747 verified = 99.94%，仅 7 个 mega-scope 残留）**。它不是靠"大量 non-importable"收尾，而是用 **account-local "My Data" 创建**把原本无 canonical 匹配的 elementary/FP/UG **建成自有数据（state_code=0）**后导入。这条路径现在是 **profile 数据驱动的通用能力**（commit 8f28e91），USLCI 加一段 profile 配置即可启用，**无需任何 foundry 代码改动**。因此原 §6 把"931 manual + 139 FP/UG"当永久非可导入尾巴的框架作废，改为下面的**双杠杆**。

**双杠杆解锁模型**（合在一起 → 2,112 个 scope 全部 ready）：

- **杠杆 1 = classification 授权**（Phase 3A，唯一硬必须的 AI 工作；override 不触及它）：3,750 条 leaf 分类决策。
- **杠杆 2 = account-local My Data override**（Phase 3-PRE，一次性 profile 配置 + 人工授权）：自动清除 elementary identity（931）+ FP/UG（7+4）三类 blocker，把残余建为 My Data。

### Phase 3-PRE — 状态同步 + 授权 override（profile 数据改动 + 人工门禁）

1. **同步 §6**（已在本文件完成）：live 链 = conversion-v2 + library-index-v2 + decisions-v3（identity 2,988 + canonical-support 20）+ library-resolution-v4 + identity-from-preflight-v3；测试基线 `npm test` **206/206** + doctor 绿。
2. **人工门禁 D4-elementary（阻塞本 Phase）**：override 反转了"reference-only / elementary 只许 reuse"的既定治理，**必须用户显式授权**才能开。逐字记录 `authorized_by`（对标 BAFU 2026-06-15 override）。可逆：`enabled=false` 即还原。
3. 在 `specs/import-profiles.json` 的 **uslci** 条目加 `allow_account_local_support_and_elementary` block（照抄 bafu 形状：`enabled:true` + `authorized_by` + `scope:[elementary_flow_write, elementary_flow_create_new, flowproperty_write, unitgroup_write, canonical_support_local_mint]` + note）。**纯数据改动，零 gate 代码改动**。跑 `npm test`/doctor 必须保持绿（建议加一条 uslci-on 的 dataset-agnostic 断言到 `bafu-mydata-override.test.mjs`）。
4. 写 `docs/import-profiles/uslci/constraints.md`（当前 constraints 是"无 waiver"占位）+ 更新 profile.md，**显式授权** override 并带审计字段（否则治理文档与 JSON 冲突）。topic commit 落 foundry main。
5. **不变量**：override **不放松** 单位尺度门禁 `canonical_support_amount_scaling_required`；conversion-v2 的单位归一化（§7-2）是安全网，My Data 行保留源单位故自洽。

### Phase 3A — classification 授权（process 2,112 + flow-product 1,638 = 3,750，杠杆 1）✅ 链已验证

走**完全 generic、profile 中立**的链（`classification-decisions.ts` 零 bafu 引用）。**pilot（15 process + 85 flow-product）已端到端打通**：6 scope 仅凭 classification 即 ready、pilot-15 classification blocker 归零。**经验证的精确配方 + 坑**（细节见 `$RUN/phase-journal.md`）：

1. **context pack**（USLCI 此前无，必须生成；process/flow 各一次，profile 值是 `ai-import` 不是 uslci）： `tiangong-lca dataset context-pack --type <process|flow> --profile ai-import --out-dir <SR>/context/<type> --json`。
2. **队列**：`dataset-bundle-sample-rows --profile uslci --bundles-dir $RUN/conversion-v3/process-bundles [--sample-size N] --out-dir <SR>` → `classification-authoring-queue.jsonl`（含两类）+ `rows/*.jsonl`。⚠️ `authoring-plan-v1` 模板和 resolution blocked-ledger **都不能替代**队列（缺 `classification_workflow.commands.input_rows`）。
3. **按 category_type 拆队列 + 按 dataset_id 去重**（一个 flow 被 k 个 process 引用就出现 k 次；apply 拒绝重复队列行/重复决策）。
4. **task-build 按类型、对 per-type 去重队列**：`dataset-classification-decision-task-build --profile uslci --classification-queue <per-type-deduped-queue> --rows-file <SR>/rows/<processes|flows>.jsonl --schema-file/--yaml-file/--ruleset-file <SR>/context/<type>/outputs/* --classification-schema tidas_<processes|flows_product>_category.json --location-schema … --category-type <process|flow-product> --chunk-label … --shared-context-cache-dir <一个目录> --out-dir …`。⚠️ task 记录的 `task_queue` = 该队列文件 → 后续 project/apply **必须用同一队列文件**（否则 `classification_decision_task_queue_mismatch`）；改队列即换 sha → 决策须从新模板**重新加盖** `authoring_context`。
5. **AI 授权合同（按语义分类）**：process → ISIC 4 位 leaf（`tidas_processes_category.json`）；flow-product → CPC level-4（5 位）leaf（`tidas_flows_product_category.json`）。**NAICS 弱提示通常为空**（被剥离）→ 纯按含义分类。每行需 `code`+`selected_code` + `decision_status:completed` + basis + confidence + `used_context_kinds[schema,methodology_yaml,ruleset,classification_schema]` + `evidence{}` + 保留 `authoring_context.context_bundle_sha256`。**按 dataset_id 去重决策**。**绝不无 sha-bundle 证据授权**（BAFU appended-rows 事故教训）。
6. **project 按类型**（单 `--decision-task`，**不可重复**，传两个会抛错）：`dataset-library-classification-decisions-project --profile uslci --classification-queue <per-type-queue> --library-decisions <authored> --decision-task <per-type-task> --out-dir …`（强制 leaf-only，拒 `library_classification_decision_not_leaf`）。出场 errors 0 / manual_review 0。
7. **apply 按类型** → `decisions/<type>-classification-decisions.jsonl`。
8. 合并两类的 `decisions/*-classification-decisions.jsonl` 为 decisions-vN 目录的 `classification-decisions.jsonl` → `dataset-library-decisions-apply` → resolution。

- **不要**用 `dataset-bafu-leaf-classification-*`（ecoinvent 名称→code 硬编码，不吃 USLCI 名）。
- **全量放大**：对全部 2,112 scope 跑 bundle-sample（不加 --sample-size）→ 拆+去重 → ~90-100 行/shard 分片 task-build → 并行 AI 授权代理（每 shard 一个，对标 BAFU）→ project+apply → decisions-v4 → resolution-v5。预期 ~1,056 scope 仅凭 classification 即 ready，其余需杠杆 2。

### Phase 3B — elementary：remap-first, mint-last（931 deps / 986 scopes，杠杆 2 之一）

931 manual **主要是匹配问题不是创建负担**：reason 分布 no_candidate 698 / multiple_plausible 220 / create_new_forbidden 12 / score_too_low 1。

1. **先 re-judge（remap-first）**：220 multiple_plausible 多是同一 canonical flow 的子隔间重复（AI/确定性挑对子隔间 → reuse）；698 里大量是同 CAS/同名仅因 `category_or_compartment_conflict` 被拒（隔间感知 re-judge 可救回为 reuse）。对标 BAFU `fullpool-rejudge.py`（全候选池 ~80，要求同隔间 sourceClassification + 名称等价 + 维度匹配）。设 `BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE` 加速 3,919 条重判。**隔间权威源永远是 `sourceTrace.payload` 的 openLCA 路径，绝不用转换器写死的 elementaryFlowCategorization**（§7-3）。
2. 救回的写成 reuse_existing_reference（需 canonical ref_object_id/version）入 decisions-v4；re-apply 重测残余。
3. **mint-last**：真正零候选残余（12 个 create_new_forbidden：Coal bituminous/sub-bituminous、Oil shale、Shale gas、Phosphate ore、Ulexite、Lutetium ore、Gangue、Saponifiable oils/fats、Total oil and grease less TPH、Unused primary solar、PM>10um + re-judge 后仍无物理等价的）→ 在 `--profile uslci`（override 已开）下写 **create_new** identity 决策（无需 canonical 目标，需 status=completed + basis + 结构化 evidence FEDEFL UUID/CAS/隔间 + used_context_kinds）。commit 时经 elementary save-draft 路径建为 My Data（state_code=0，保留源单位）。
   - ✅ **mint 前置已满足（§7-6 / §9 / CAP-20260623-001 Done）**：隔间硬编码 bug 已修（tidas-tools cc3aaaf），**conversion-v3** 隔间正确（4,872 elementary 0 错配）+ 单位校验全过。mint 路径用 conversion-v3（重建 library-index-v3 等下游链时切到 v3；identity 决策键于 dataset_id/version，v2→v3 不变，decisions-v3 可沿用）。
4. re-apply → resolution-v5：确认 `elementary_flow_requires_existing_database_match` 归 0。

- **决策合同没有新值**：identity 仍只接受 `reuse_existing_reference | create_new | block_unresolved`；override 只是不再 block elementary 的 create_new。

### Phase 3C — FP/UG：mint-or-non-importable（7 FP + 4 UG / 139 scopes，杠杆 2 之二）

7 个本地特殊 FP（Taxes/Jobs/Wages/Producer price/Market value/Duration/Person transport）+ 4 UG（Currencies×2/time/person\*length）确认无 canonical 等价 → override 下其 blocker（`canonical_flow_property/unit_group_reference_unresolved`）**自动清除**，源 FP/UG ref 保留源单位建为 My Data。

- **污染陷阱（BAFU 26912eb 教训）**：**绝不**把这些 account-local My Data UUID 写进共享的 `specs/canonical-support/flow-properties-unit-groups.json` 的 `flow_property_mappings`（会污染其他账户的全局 canonical-support 解析，有 support-cache 测试守着）。共享映射留 pending，仅按 scope 就地 mint。
- commit 经 `dataset save-draft --type flowproperty|unitgroup --allow-account-local-support --commit`（commit-handoff 路径）。`dataset-support-cache-refresh` 后核对 BAFU 既有映射未被删改（原则 1）。

### Phase 4 — Pilot 批次 + 关闭 D2/D3/D4 人工门禁（首个 commit）

1. 从 resolution-v5 ready-scopes 选 20-50 个干净 scope（无 allocation/amountFormula/单位不一致，不依赖 17 library provider）。
2. **generic runner**（**不用** `dataset-bafu-batch-import-run`，它 ledger-source-dir 硬编码 bafu）：
   ```bash
   npm install --no-save @tiangong-lca/cli@latest
   export TIANGONG_LCA_CLI_BIN=$PWD/node_modules/.bin/tiangong-lca   # 否则 npx@latest 卡死
   node scripts/foundry.mjs dataset-process-scope-run \
     --process-bundles-dir "$RUN/conversion-v2/process-bundles" \
     --library-resolution "$RUN/library-resolution-v5/library-resolution.json" \
     --scope-file <ready-scopes.jsonl> --profile uslci --parallel 5 --dry-run
   ```
   走完整 generic 链：curation-gate → curation-cleanup → post-authoring-finalize → mutation-manifest → commit-handoff-plan → （dry-run）。
3. 凭 pilot 证据关闭：**D2** source 署名（NREL contact/database fallback + bin/ 8 附件取舍）；**D3** QA warning-vs-blocker（25 LCI_RESULT / 61 allocationFactors / 1,425 amountFormula / 本地 FP-UG）；**D4** 账号/state-code/写入（**用户批准后**才翻 `allow_remote_commit:true`）。落地到 profile.md/constraints.md/import-profiles.json waivers。
4. 首批 `--commit` + readback verify + `dataset-post-write-closeout`；建立第一个 canonical ledger source 登记 §6。

### Phase 5 — 批量推进 + coverage 闭环（gap 0）

- 回合：缺口分析 → decisions-vN（全量超集）→ resolution-vN → 批次 vN（独立 out-dir）→ `dataset-import-ledger-report` / `dataset-import-completion-report` → 重测。My Data 行 readback-verified 后**计入 verified**（BAFU 第三态）。每轮 mint 后预期**复合解锁**（多依赖，少量 mint 解锁大量下游）。
- 非可导入登记文件（逐项 reason+evidence+disposition，对标 BAFU `non-importable-scopes-v2.jsonl`）。override 下 USLCI 预期 **gap 0 无需上游补充**（不同于 BAFU 的 TiO₂/Ulexite 需建 468 上游 flow）。
- **收尾口径（对标 BAFU close-out）**：verified（reuse + created-account-local，readback-verified）+ registered-non-importable = 1,358，gap 0；blocked/failed_retryable/human_review/retry/pending 全 0；npm test + doctor 绿。
- **最终交付物 = USLCI trace/进展工作簿**：fork `reports/bafu-import/build-bafu-trace-xlsx.py`（BAFU 路径硬编码，非 drop-in）到 `reports/uslci-import/`，改 USLCI 路径/标签，或从 ledger/completion report 构建。7 sheet：说明 / 导入进展 Summary / 待人工校验 / Process Trace / Flow Trace / 转换映射 / Support Identities。goal 关闭，`npm run task:complete` 归档。

## 6. 当前状态快照（每会话结束前更新）

- **🔑 当前权威计划 = §R（2026-06 ILCD-alignment 重转换）**。2026-06-25：发布 tidas-tools 0.0.34 / sdk 0.1.45·0.2.14 / cli 0.0.19 把 42-bug 审计的转换器伪造 + schema 松弛全修了并收紧 schema。**下一步 = 按 §R.3 做 conversion-v7**（采用 0.0.34 基座 + 合并 P1b ec95d8a + cli 0.0.19 → 重转换 2,113 process → 新 schema 重校验 → 从 v7 重建 canonical 链 → 重验证导入链 → scale）。conversion-v2..v6 的手工补丁链作废（已被上游原生取代）。
- **已验证但基于旧 schema（v6）的成果，重转换后复用/复核**：
- **阶段**：Phase 4 进行中 — **首个真实远端 commit 已成功并全链验证**（2026-06-24，旧 schema v6 数据；v7 重转换后需复核/清理这些测试写入）。USLCI runner（`dataset-uslci-batch-import-run`，复用 BAFU 引擎 + uslci 配置）已落地，BAFU 零回归（npm test 206/206）。
  - ✅ **reuse-only scope `e93ae1c1` 已真实写入远端**（`process get` 实测：state_code=0 My Data、version 00.01.004、modified 2026-06-24T03:55:33；账号 linanenv@126.com → user_id 5c784552…）。全链 stage 全 exit 0：flow.support.commit → post_write_verify → closeout → finalize_after_support → flow.commit → post_write_verify；process 同。**D2 实测干净**：committed 报告 NREL×22 / FOEN×0 / openLCA×0 / GreenDelta×0。证据 `$RUN/batch-import-v2/scopes/e93ae1c1…/scope-run-report.json`。
  - ✅ **根因修复（已落 foundry，gated 不碰 BAFU）**：库 contact 从未 bootstrap 到远端 → flow pre-finalize 的 reference-closure 卡死。修法见 §9 路由表「库 contact + FP/UG/elementary My Data support 提交」一行。
  - ✅ **P1a 已实现+验证（2026-06-24）**：未匹配 FP/UG 作为 account-local support 在依赖 flow 前 mint。mint scope 0001b273 实测：UG 838aaa21 + FP 838aaa20 + contact 提交（verified_support_identities 3）、6 dependency flows verified。过滤器实测正确（838aaa20 US-单位 mass×distance → mint；93a60a56 Mass canonical UUID → reuse）。foundry commits a51ef80/3bf2ed3/a4d672c。**该 scope 的 process 仍 block 于独立的评审报告悬空 source（task #8 / 75ac425f），与 P1a 无关**。
  - **⚠️ 上述均基于旧 schema(conversion-v6)**。按 §R：v7 重转换后这些验证需在新 schema 上重跑；旧 schema 测试写入需清理或 version-bump。P1b（UnitGroup 参考单位）仍需合并上游再进 v7。
- **$RUN**：`.foundry/workspaces/uslci-full-import-20260612T093202Z`（task：external-import-20260612-uslci，active/Doing；`$RUN/phase-journal.md` 有 NEXT SESSION ENTRY POINT）。
- **canonical 链（盘上）**：**`conversion-v6` = commit-canonical**（v5 + 稀疏过程修复：referenceYear creationDate 兜底、dataSources 块始终输出；tidas-tools 220d8fc。74 个 9999 referenceYear + 9 个缺 dataSources 在源头清零）（隔间修复 + 无损保真：不确定性/pedigree/**分配** 全落字段）；`library-index-v4` + `decisions-v4`（identity 2,988 + support 20 + classification 2,990）+ **`library-resolution-v6-override`（override ON → ready 1,358）**。注意：v4/v5 仅 classification 不触及的字段变化，dataset_id 键不变；commit 前用 conversion-v5 重建 library-index（mint 写库用 v5 的字段）。
- **universe**：1,358（`$RUN/universe-v1/`；排除 754 个 out-of-scope library 过程）。
- **classification ✅ 全量 + D4 override ✅ 已授权**：35 shard 授权 2,990（0 非法 code）→ project/apply 35/35。`--profile uslci` 的 override ON 后 **resolution-v6 = 1,358/1,358 in-universe ready**（elementary 无匹配 + 7 FP + 4 UG 将在 commit 时 mint 为 My Data）；剩 754 全是 out-of-universe library 过程不导入。
- **D3 分配无损 ✅**（走 A）：TIDAS schema 放宽为分配列表 + 转换器写列表 → conversion-v5 56 process 落字段；详见 §7.1。
- **新能力**：account-local My Data override **uslci 已开 enabled:true**（specs/import-profiles.json，user 2026-06-23 D4-elementary 授权，可逆）；constraints.md 已记授权与保留门禁。
- **BAFU 参照**：GOAL COMPLETE 11,740/11,747 verified（99.94%）；最终交付物 `reports/bafu-import/build-bafu-trace-xlsx.py`（7-sheet 工作簿）是 USLCI 收尾模板。
- **canonical ledger sources**：无（首个在 Phase 4 产生）。**`allow_remote_commit:false`（D4 账号/写入政策批准前不写远端）**。
- **测试基线**：foundry `npm test` **206/206** + doctor 绿；tidas-tools **95 passed**（2026-06-23）。

## 7. 已知问题与 blocker 分诊

| # | 问题 | 影响 | 处置 |
| --- | --- | --- | --- |
| 1 | ~~tiangong-lca-cli ≤0.0.14 向 tidas-tools ≥0.0.28 传已移除的 `--process-bundles` flag，文档入口直接失败~~ **已解决**：cli 0.0.16（commit 98104c9，2026-06-11）已适配，2026-06-12 端到端验证通过 | 无（历史） | 留意两点：包装默认裸调 `python3`，要传 `--python <venv解释器>`；`npm install --no-save @tiangong-lca/cli@latest` 保持 ≥0.0.16 |
| 2 | ~~转换器不做单位换算，数值错最高 1000×~~ **已解决**：tidas-tools a3e1aa9（2026-06-12）在 openlca adapter 加归一化 pass；conversion-v2 修正 9,478 条（unresolved 0），独立校验器 78,757/78,757 全对 | 无（历史） | 留意：474 条 amountFormula 公式本身未重缩放（仅存 trace，QA 在 pilot 定性）；84 条 ref_unit_name_mismatch 为源数据 refUnit 文本怪癖，数值已验证正确 |
| 3 | ~~FEDEFL elementary 匹配率未知~~ **已量化**：reuse 2,988/3,919（76%）。残余 931 不再是死路——override 下可 remap-first/mint-last（Phase 3B） | 不再是永久尾巴 | ⚠️ **隔间权威源 = `sourceTrace.payload` 的 openLCA 路径，绝不用转换器写死的 elementaryFlowCategorization**；re-judge 需适配 FEDEFL trace 形状（generic + 测试），否则隔间污染产生错误决策 |
| 3b | **My Data override 未在 uslci profile 启用** | 931 elementary + 7 FP + 4 UG 仍 blocked | Phase 3-PRE 加 `allow_account_local_support_and_elementary` block（待 D4-elementary 用户授权）；纯 profile 数据，零 gate 代码改动 |
| 4 | ~~数据保真缺口~~ **已全部落地**（CAP-20260623-002 → conversion-v5）：不确定性 5,129+522、process pedigree 1,652、**分配 56 process（D3 走 A：schema 放宽为列表 + 转换器）** 全落 TIDAS 字段；reviews 保留 | 无（历史） | 残留仅逐 exchange pedigree（D1）等无 ILCD slot 项，详见 §7.1 |
| 5 | bin/ 8 个 source 附件（PDF/JPG）转换时丢弃 | 来源证据不全 | D2 一并定（附件→TIDAS digital file 或 trace 记录） |
| 6 | ~~转换器对所有 elementary flow 硬编码隔间 `Emissions to air, unspecified`~~ **已修复**：tidas-tools `cc3aaaf` 加 `_elementary_categorization` 映射真实 FEDEFL 隔间；**conversion-v3** 实测 4,872 个 elementary **0 隔间错配**、TIDAS 校验 0、单位归一化仍 78,757/78,757 全对（CAP-20260623-001 → Done） | 无（历史） | mint 用 **conversion-v3**（非 v2）；35 个 economic/non-FEDEFL 回退默认（可接受残留） |
| 7 | 1,425 条 amountFormula 公式仅存 trace（**注**：25 个 LCI_RESULT 是带 `typeOfDataSet="LCI result"` 的正常 TIDAS **process**，非 trace-only，见 §8） | QA 定性未定 | pilot 时定 warning vs blocker（D3） |
| 8 | 纯英文源 vs TIDAS zh/en 双语治理 | curation gate 可能 block | Phase 3-5 定 transcreation 批量路径 |
| 9 | 12 个 currency、399 个 location 实体、categories.json 不转换为 TIDAS 实体 | 无（currency 零引用；location 仅供代码解析；类目以各实体 `category` 字段为准） | 已定性，无需处理 |

### 7.1 数据保真 / lossless fidelity（§0 无损要求的逐项账）✅ 已落地（conversion-v4）

CAP-20260623-002（tidas-tools commit `0730b70`）已把可无损映射的富字段落进 TIDAS 字段。**conversion-v4** 实测（conversion-report `rich_field_fidelity_summary`）：

| 富字段 | 量 | conversion-v4 结果 | TIDAS 目标字段 |
| --- | --- | --- | --- |
| 评审记录 reviews | 852 process（v4 有 687 带真实评审类型） | ✅ **保留**（回归守护通过） | `validation.review` |
| 不确定性分布 | 5,651 exchange | ✅ **全部落字段**：5,129 log-normal geomSd→`relativeStandardDeviation95In`（=GSD²，0 个 >100 残留）+ 522 triangle/uniform min/max | `relativeStandardDeviation95In`、`min/maxAmount` |
| pedigree 数据质量（process 级） | 1,652 process | ✅ **全部落字段**：dqEntry + dqSystem 指标名→ILCD `dataQualityIndicators`（1=best→Very good…5→Very poor） | `validation.review.common:dataQualityIndicators` |
| 分配因子 allocationFactors | 61 process | ✅ **已无损落字段**（D3 走 A）：56 个多功能过程的 per-exchange allocation **列表**（每 exchange 多 co-product，分数和=100%）；方法另在 `LCIMethodApproaches` | exchange `allocations`（列表） |

**D3 分配解法（已落地，2026-06-23）**：原以为是 ILCD 模型限制，实为 **TIDAS JSON schema 把 eILCD 的分配列表收窄成了单对象**。eILCD `ILCD_ProcessDataSet.xsd` 明确 `allocation maxOccurs="unbounded"`。修法 = **放宽 TIDAS process schema `allocations.allocation` 为 anyOf [object, array]**（source-of-truth = `tidas-tools/src/tidas_tools/tidas/schemas/tidas_processes.json` + schemas_zh + lock；**push 后经 GitHub `dispatch-tidas-sdk-sync.yml` 自动同步 tidas-sdk**，勿手改其副本；CLI assets 手动镜像已同步）+ 转换器 `_apply_exchange_allocations` 写列表（稀疏 0 项省略，非零和=100%）。**lifecyclemodel(models) 模型不适用**（零 allocation 字段，仅表达系统链接）。conversion-v5：56 process 写入、a591c53f 722 exchange 分数全和=100%、TIDAS 校验 0、单位 78,757/78,757、隔间 0 错配。

**已知有据残留**（无 TIDAS 忠实落点，完整数据留 sourceTrace，fidelity summary 计数）：

- **D1 逐-exchange flow pedigree**（28,572）：ILCD 无 per-exchange DQ slot → trace。
- **U1 三角分布 mode** / **U2 GSD²>100**（USLCI 实际 0 个）/ **D2 dqSystem 身份** / **D3 exchange 派生类型**（openLCA 无原生值，默认 Unknown derivation）：均 trace/默认。

**口径**：**最终 commit 用 conversion-v4**（=v3 隔间修复 + 本保真增强）。classification（基于 conversion-v3）不触及这些字段，已 pilot 验证可并行；mint/commit 前切 conversion-v4 重建下游链（identity 决策键不变可沿用）。TIDAS 校验 0、单位归一化 78,757/78,757、隔间 0 错配——v4 全部保持。

## 8. 与 BAFU 的差异速查

| 维度 | BAFU | USLCI |
| --- | --- | --- |
| 源格式 | ecoSpold1 →（预转换）TIDAS 入库 inputs | openLCA JSON-LD 原始包入库 inputs，转换在 Phase 1 现场跑 |
| 引用闭合 | 包内自洽 | 依赖外部 library（已合并冻结，Phase 0 闭合） |
| 单位 | 天然同单位 | 12.2% exchange 需换算（§7-2） |
| 名称形态 | 德文压缩名，需大量 name-split 规则 | 分号结构化英文名，预期无 name-split 回合 |
| 支持数据 | 合成 contact/source 居多 | 70 真实 actor + 557 真实 source，质量更好 |
| elementary 体系 | ecoinvent 隔间（trace 恢复） | FEDEFL 隔间（openLcaCompartmentClassification 已适配，9136031） |
| 批量 runner | dataset-bafu-batch-import-run（bafu 硬编码） | **generic `dataset-process-scope-run`**（threads profileFor，accepts --dry-run/--commit） |
| My Data override | enabled:true（2026-06-15） | 待 Phase 3-PRE 启用（D4-elementary 用户授权） |
| coverage/trace 生成器 | `build-bafu-trace-xlsx.py`（路径硬编码） | fork 到 `reports/uslci-import/`（非 drop-in） |
| 导入单位 | process（unit process） | **同样是 process**（不是 LCA model，见下方说明） |
| LCI_RESULT/聚合结果 | 几乎无 | 257 个 LCI_RESULT（USLCI 主包 25 + electricity library 232）→ TIDAS process `typeOfDataSet="LCI result"`；D3 定是否导入/标注 |
| 收尾态 | verified(reuse+MyData) + 7 残留 = 99.94% | 目标同口径：verified + 少量 registered-non-importable = 1,358 |

### 8.1 导入单位澄清：USLCI 全部导入为 process，不是 LCA model（已核验）

> 常见误解：USLCI 是连通数据库，是否会有大量数据导入为 LCA models / lifecyclemodels？**不会。**

- **两种 openLCA processType 都映射成 TIDAS process**（`tidas_json.py:_process_type` 985-993）：`UNIT_PROCESS → typeOfDataSet "Unit process, single operation"`；`LCI_RESULT → "LCI result"`。`typeOfDataSet` 是 ILCD/TIDAS **process 数据集内部**的枚举字段——这四种全是 process，**没有一个变成 lifecyclemodel**。实测 LCI_RESULT（如 "Steel; hot rolled coil"）转出确为 `processDataSet` 带 `typeOfDataSet=LCI result`。
- **conversion-v2 产出 = 2,112 process + 1 lifecyclemodel**。那 1 个 lifecyclemodel 是转换器从全包 defaultProvider 图**派生的候选产物**，不是导入单位。
- **导入 scope universe 是纯 process**：`scope-projection.jsonl` = `{process: 2112}`，0 个 lifecyclemodel scope。本 goal 的 1,358 in-scope 全是 process。
- **链接性的去向**：4,474 条带 defaultProvider 的 exchange 形成的产品系统图，作为 trace/链接保留在各 process 内 + 1 个候选 lifecyclemodel，**不会**展开成 2,112 个 lifecyclemodel。若未来要"产品系统/生命周期模型"视图，是导入后基于已入库 process 另建的下游工作，不在本 process 导入 goal 内。

## 9. 需路由的缺陷 / 能力缺口（按归属）

> **原则（写入 §1-3 的延伸）**：导入过程中确认的转换/校验缺陷，按归属在 owning 项目同步修复（converter/校验 → tidas-tools；CLI 包装 → tiangong-lca-cli），**绝不在 foundry 打补丁绕过**。确认即开 capability-development-request 任务（模板 `tasks/templates/`），带独立验证 + 全测试，对标已闭环的单位归一化（a3e1aa9）与本会话的 CAP-20260623-001。

- **tidas-tools（待修，CAP-20260623-002，commit 前置）**：富字段无损保真——pedigree DQ（881 process + 逐 exchange）、不确定性分布参数（5,651 exchange，log-normal 的 geomSd 等）、分配因子（61 process）现仅进 sourceTrace，须落 TIDAS 字段（`dataQualityIndicators`/`dataDerivationTypeStatus`、`relativeStandardDeviation95In`/min-max、`allocations`，schema 已支持）。修后重转换 **conversion-v4**（commit-canonical）+ 确定性保真扫描。reviews（852）已保留，作回归守护。详见 §7.1。
- **tidas-tools（✅ 已修复 BUG，CAP-20260623-001 → Done）**：`_flow_classification()` 原对**所有** elementary flow 硬编码 `Emissions to air, unspecified`，无视真实隔间（water 1,966 / soil 703 / **resource 360** 全写成"空气排放"，resource 连类目大类都错）。**修复 = tidas-tools commit `cc3aaaf`**：加 `_elementary_categorization` 把 FEDEFL `/` 路径映射进 TIDAS `common:elementaryFlowCategorization` 正确叶子（catId 按 `tidas_flows_elementary_category.json`），dataset-agnostic（ecoSpold 单 token/无路径回退默认，**BAFU 零回归**），+1 测试套件 92 passed。**conversion-v3** 实测：4,872 elementary **0 隔间错配**（原 ~3,072 错）、TIDAS 校验 0、单位归一化 78,757/78,757 全对。**mint 必须用 conversion-v3**（reused flow 用 canonical 分类不受此限）。
- **tidas-tools（已澄清，非 bug）**：flowType 映射**忠实无误判**。`_flow_type`（`tidas_json.py:1398`）直接读 openLCA 显式 `flowType` 字段，**不用 input/outputGroup**；盘上 6,624 flow 源 flowType→TIDAS typeOfDataSet **0 错配**。"按 input/outputGroup 把 technosphere 误判为 elementary"是 **ecoSpold1 特有担忧，对 openLCA/USLCI 不成立**，无需改动。
- **tidas-tools（已闭环，作为不变量）**：单位归一化（a3e1aa9）。override **不放松** `canonical_support_amount_scaling_required`——若 USLCI 重新转换（新 tidas-tools/源，**含上面的 conversion-v3**），必须重跑 `$RUN/unit-normalization-verify/verify.py` 全过才恢复 commit。
- **foundry-generic（可能需要，带测试 + dataset-agnostic）**：FEDEFL trace 形状的全候选池确定性 re-judge（对标 BAFU `fullpool-rejudge.py`）。`openLcaCompartmentClassification`（9136031）已覆盖隔间恢复；先查 USLCI 实际 `sourceTrace.payload` 结构确认是配置-only 还是需代码改动。
- **foundry-generic（新 line-item）**：无 profile 中立的 coverage/trace 生成器与 batch runner。`dataset-bafu-batch-import-run` / `dataset-bafu-universe-coverage-report` / `build-bafu-trace-xlsx.py` 均 bafu 硬编码。Phase 5 fork trace 生成器；若吞吐不足再把 batch runner 参数化为 profile 驱动（P1，连带 mega-scope 基础设施一并通用化）。
