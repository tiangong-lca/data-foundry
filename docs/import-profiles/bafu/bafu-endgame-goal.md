---
title: Historical BAFU 2025 V2 Closeout Goal
docType: reference
scope: import-profile/bafu-history
status: historical
authoritative: false
owner: tiangong-lca-data-foundry
language: zh
whenToUse:
  - when reconstructing the 2026-06 BAFU closeout execution record
whenToUpdate:
  - when a current contract changes how this historical record should be interpreted
related:
  - docs/import-profiles/bafu/profile.md
  - docs/import-profiles/bafu/constraints.md
  - docs/bafu-import-runbook.md
---

# BAFU 2025 V2 收尾 Goal（历史归档 · v2）

> **已被取代（2026-07-12）**：本文只保留 2026-06 收尾批次的历史状态、数据量和 artifact 路径，不再是 agent 执行入口。当前可执行规则以 `profile.md`、`constraints.md` 和 `specs/import-profiles.json` 为准；其中已明确 public-canonical-first，但允许 profile-authorized、同一 BAFU owner、`state_code=0` 的 account-local FP/UG 和 elementary candidate。本文 §3-C、§5.5、§8 等“必须先建 public canonical / 不得私有 support”的旧规则不得继续执行。
>
> 目标读者：需要追溯旧 BAFU 收尾批次的审计者。本文保留当时的 **goal 模式**记录：state → 根因发现 → workstreams → execution rules → completion checks → references；后续策略变化不再回写旧批次数字。
>
> 上游全量导入已闭环（coverage v7：**5,575 verified + 6,172 non-importable = 11,747, gap 0**）。本 goal 把 6,172 non-importable 逐步解锁、并修正两个已确认的既存数据缺陷，直到全部 11,747 是 _verified_ 或 _有据维持 non-importable_。
>
> **v2 变更（2026-06-13）**：纳入对 workstream B「312 无近似」桶的深度重判（`missing-dependencies-b-full-312-review.json` 246 项 + `missing-dependencies-b-special-pending-groups.md` 66 项 = 312）。结论是「312 真缺失」严重高估——重判后**绝大多数可 remap 到现有 flow、或属 flow 类型误判、或后置到 LCIA/EF 层**，真正需要上游新增 elementary 的仅约 8 个（Noise non-material）。据此把 B 拆成 disposition 子轨（§3-B），并新增「flow 类型误判」根因（§2-C）。

工作根目录：`tiangong-lca-data-foundry`。`RUN=.foundry/workspaces/bafu-full-import-20260607T080646Z`（下文 `$RUN` 指它）。所有命令从仓库根跑。

---

## 1. 当前状态（2026-06-14，✅ GOAL 完成态达成）

- **✅ coverage v11 终验**：`$RUN/universe-coverage-v11-final/` = **6,743 verified + 5,004 non-importable = 11,747, gap=0, active_human_review=0, retry=0, pending=0**。npm test 193/193 + doctor passed。满足 §6 全部完成判据。
- **三轮自主 remap 累计 +1,168**（v7 终版 5,575 → 6,743）：B1(v53 +77) + rejudge-436(v54 +953) + full-pool(v55 +138)。262 个流经独立确定性校验 remap 到现有 flow。
- **5,004 登记 non-importable**（`non-importable-scopes-v2.jsonl` + `.report.json`，每行带依赖+disposition）：成因全为上游硬卡——缺失 elementary(无远端等价)/PM 分箱/Noise non-material(须上游新建)、5 对 FP/UG canonical(须上游建库)、converter 类型误判的 technosphere flow(须 tidas-tools 修 §2-C)。纯 remap 自主空间已用尽。

- **剩余 6,095 gap 精确分解**：4,348 卡「436 个未重判流」(91 remap+344 middle 桶) / **1,370 卡 5 对 FP/UG（上游硬卡）** / 312 桶剩余 disposition / 65 卡 Noise(上游)。自主天花板 ~4,660 可达；~1,435 只能登记 non-importable 收口。
- **第2轮（rejudge-436）已闭环**：确定性重判 435 未重判流 → 76 remap + 3 wastewater → `decisions-v14`→`resolution-v17` ready 6,605 → `batch-v54-rejudge436-commit` **ok=953/953 blocked=0**（断网致 129 finalize_stage_timeout，网络恢复后重跑全清）→ **coverage v9 `universe-coverage-v9-rejudge436` verified 6,605（+953，累计 +1,030 vs v7）, gap 5,142, retry/pending/HR=0**。canonical ledgers 现 10 个（+v54）。name-split 词表两轮补：housing/recultivation/silo/cattle/pig/mine（v53）+ grain drying/emulsion polymerisation/bonded boards（v54）。359 流 near_match top3 无净匹配，待 **top30 LLM 重判（下一轮最大杠杆）**。

- **第3轮（full-pool 重判）已闭环**：359 无 top3 匹配流改用【全候选池(≤80/流，含 version)】确定性重判 → **+63 remap** → `decisions-v15-fullpool-leaf`→`resolution-v18` ready 6,743 → `batch-v55-fullpool-commit`(138 scope, 运行中)。**自主 remap 见底**：262 流(123+76+63)已 remap。剩 296 still-no-match 分类：215 真缺失上游(13,807·次) + 19 PM 上游(5,019·次) + 62 B2 inputGroup5 改型(837·次)。即 **234 流只能上游补库→登记 non-importable**，62 需 flow-type 改型(下一轮 agent 可做但需改型机制)。

- **最新 coverage v8**：`$RUN/universe-coverage-v8-b1-remap/` = **5,652 verified + 6,095 待解锁**（B1 第1批 +77），retry/pending=0，1 上游 human-review。canonical ledger sources 现为 9（v35…v52 + **v53-b1-remap-commit**）。
- **B1 remap 第1批已闭环（2026-06-14）**：123 独立验证 → `decisions-v13-b1-remap-leaf`（2,722 行）→ `library-resolution-v16-b1-remap`（ready 5,649）→ `batch-import-v53-b1-remap-commit` **ok=77/77 blocked=0**。途中修复：name-split 词表补 housing/recultivation/silo/cattle/pig/mine 产品族（已提交 + 测试）；contact 引用闭包首跑 transient（重跑全证）。**下一批解锁靠累积**：scope 需全部缺失流都解决才 ready，故须继续处理 B1-water(49)/wastewater(3)/B2 类型改判(82)/flagged 复核(17)，与已解的 123 复合后才能放更多多依赖 scope。
- **coverage v7（前一终版）**：`$RUN/universe-coverage-v7-final/` = 5,575 verified + 6,172 non-importable，human-review/retry/pending 全 0，npm test + doctor 通过。
- **6,172 non-importable 去重后 = 747 缺失 elementary flow（依赖）+ 5 对 FP/UG**。
- 评审包就绪：`$RUN/non-importable-review-v1/`（README + index.html + missing-dependencies-report.md/.xlsx + 富化 CSV/JSON）。其原始三档（91 疑似 remap / 344 有近似待判 / 312 无近似）中的 **312「无近似」桶已被深度重判**（见 §3-B、§4 disposition 表）——该桶不是「真缺失」，而是评估器过严产生的假阴性 + flow 类型误判 + 地理后置项。
- FP/UG 代码侧已落地：mapping schema 加 scale、rewrite scale-aware、3 条 pending mapping（详 `fp-ug-canonical-support-governance.md`）。
- **三个已确认的根因发现**：转换器隔间污染（§2-A）、单位尺度缺陷（§2-B）、flow 类型误判（§2-C，v2 新增）。
- **B1 独立校验已完成（2026-06-13）**：`$RUN/b1-remap-validation-20260613/`。对 312-review 的 164 个具体候选 remap 做独立确定性校验（源 flow sourceTrace 隔间 traceCompartment 复刻 + 名等价 exact/词序/land 术语 + 维度匹配），结果：**123 验证通过**（94 高置信 + 29 land 术语中置信，8,663 blocked·次，**待建 decisions-v13**）/ **24 改归 B2**（候选实为 product/service flow）/ **17 须复核**（7 维度冲突如 crude oil kg→NCV 疑为 re-judge 越界 + 10 杂项）。结果分档落盘 `b1-*.json` + `SUMMARY.json`。
  - **下一步**：为 123 validated 取候选 version（12 已有 / 75 须从 identity-preflight 候选 artifact 或 `flow get` 取）→ 建 reuse_existing_reference 决策（full apply 合同：canonical + used_context_kinds + closes_action_items + authoring_package + evidence）→ decisions-v13 → resolution v16 → batch v53 → coverage v8。

---

## 2. 已确认的根因发现

### A. 转换器隔间污染：所有 elementary flow 被写成「Emissions to air, unspecified」

**症状**：BAFU→TIDAS（ecoSpold1 转换）输出的 `classificationInformation.common:elementaryFlowCategorization` 对**所有** elementary flow 一律写 `Emissions > Emissions to air > Emissions to air, unspecified`，无论实际是 resource / water / soil / land use。 **根因**：转换器硬编码默认分类 —— `tidas-tools` 的 `src/tidas_tools/import_lca/writers/tidas_json.py` 的 `_flow_classification()`（约 line 1568）。（tidas-tools 在另一台机器，foundry 仓库内不可读。） **实证**：Peat `bdd07621-508b-5d4a-974d-54c72ba141a5` 写 air-unspecified，但 `…dataSetInformation.common:other.tidasimport:sourceTrace.payload.sourceClassification` = `{category: resources, subCategory: biotic, inputGroup: 4}`（源 ecoSpold exchange `category=resources`）→ 应 remap 到 `Peat, in ground / Resources from biosphere`。766f2900 同理。 **权威字段**：隔间判断**必须**读 `dataSetInformation.common:other.tidasimport:sourceTrace.payload.sourceClassification`，**不要**用被污染的 `elementaryFlowCategorization`（注意 classificationInformation 下还有个只含 sourceFlowType 的 sourceTrace，别用错）。 **现状（已缓解）**：foundry 评估器与缺失流报告均已改用 sourceTrace。从源头修需改 tidas-tools（上游）。

### B. 单位尺度缺陷：canonical support rewrite 不换算数值

profile 文档要求 kWh→MJ ×3.6、tkm→kg\*km ×1000 且禁止「silent」，但实现只换 FP 指针、从不换算 exchange 数值 → **3,506 个已验证 process / 24,318 条 exchange** 在严格 ILCD 下带 ×3.6~×1000 误差。详 `fp-ug-canonical-support-governance.md` §3。代码侧已加 scale 感知 + `--block-on-unscaled-canonical-support` + pending blocker；回补存量为 pending 决策。

### C. flow 类型误判：ecoSpold input/outputGroup 语义未被尊重（v2 新增）

**症状**：312 桶深度重判发现，相当一部分「缺失 elementary flow」其实**根本不是 elementary**——它们是 technosphere product / service / waste flow 被误当作 elementary 处理。 **信号**：ecoSpold1 的 `inputGroup` / `outputGroup` 是 flow 类型权威：`inputGroup=4`=FromNature（资源/elementary 输入）、`inputGroup=5`=FromTechnosphere（产品/服务）、`inputGroup=3`/service=服务；`outputGroup=4`=ToNature（排放/elementary 输出）、`outputGroup=3`=WasteToTreatment。重判里 ~82 项的源 category 实为 `inputGroup=5` / treatment-service / 含水率 accounting，**应判 flow 类型而非强行找 elementary 候选**（典型：`inputGroup=5` 工业用水应先修正为 product flow；wastewater treatment service → 库内 Sewage treatment/Wastewater product flow；含水率 accounting flow → exclude）。 **与 A 的关系**：A 是隔间（compartment）污染，C 是 flow **类型**（elementary vs product/service/waste）判定；都源于转换没充分用 ecoSpold sourceTrace（category + input/outputGroup）。判定 flow 类型与隔间都应回到 sourceTrace，而非转换写出的默认。

---

## 3. Workstreams（状态 / 下一步 / 负责方 / 阻塞）

> 负责方：**[code]** foundry 代码（agent 可做）；**[authoring]** AI authoring/重判轮（agent 可做，须 sha-bundle + 校验）；**[expert]** 领域专家确认；**[upstream]** 数据库/转换器治理（agent 不能做）。所有 disposition（remap 目标 / 类型改判 / 排除）都是**提案**，须经标准校验（候选 UUID 远端存在 + 物理等价 + sha bundle）才能进 decisions-v13。candidate ≠ authoritative。

### A. elementary 隔间权威化 —— [code] 已完成 / [upstream] 转换器待修

评估器与报告已改用 sourceTrace。待上游修 tidas-tools `_flow_classification()`，从源头消除隔间 + 类型默认污染。

### B. 747 缺失 elementary flow —— 按 disposition 分子轨推进

312「无近似」桶已重判为下列 disposition（246 JSON + 66 markdown，详 §4 表）。**优先做 B1（最大、且都 remap 到现有 flow，不依赖上游）**：

- **B1 remap 到现有 flow**（~216：164 JSON 带具体候选 UUID + 49 water + 3 wastewater）—— [authoring]→[code]。这些不是真缺失，是原评估器对 compartment 过严的假阴性；用 land-术语归一 + ecoSpold sourceTrace 同隔间重检索 + 接受上位候选即可命中。验证候选 UUID 远端存在 + 物理等价 → 进 decisions-v13。阻塞 ~11,900 scope·次（含 water/wastewater）。
- **B2 flow 类型改判（非 elementary）**（~82：42 NEW_PRODUCT_OR_SERVICE + 32 NEW_SERVICE + 8 product/waste）—— [authoring]/[expert]。改为 product/service/waste flow（部分映射库内现有如 Sewage treatment / Compressed air；部分需新增对应 technosphere/waste flow）。见 §2-C。
- **B3 新增 non-material elementary**（8 Noise = JSON 2 + md 6）—— [upstream] 真需新建（noise 无等价、不用弱近似占位）。阻塞 ~1,417 scope·次。
- **B4 排除 accounting flow**（~5 含水率 economic flow）—— [authoring]。不映射为资源/排放水，转写到受影响 ref/exclude。
- **B5 water 地理/EF 后置**（49 带国别后缀的 Water）—— [code]/[upstream]。按隔间 map 到现有 Water flow，地理差异后置到 LCIA/EF import 或 exchange geography 层（本地 LCIA factor 的 location 字段全空，避免 EF 丢失地域信息）。
- **B6 review_required**（1）—— [expert]。
- 原始三档里的 **91 疑似 remap**（report A.1/A.2）与 **344 有近似待判**同样走 B1/B2 口径处理（344 尚未单独重判，是后续重判输入）。
- 优先级（curve 实测）：前 5 流解锁 1,049、前 50 解锁 2,550、前 100 解锁 3,211。Top1 NMVOC(low.pop) 压 1,694。

### C. 5 对 FP/UG canonical support —— [upstream] 建库 → [code] 激活

去重 5→3 维度 + 参考单位 + 因子已定，3 条 pending mapping 已就位（安全阻断 `canonical_support_pending_upstream`）。待上游建 3 对 canonical FP/UG（state_code=100），激活步骤见 `fp-ug-canonical-support-governance.md` §2。

### D. kWh/tkm/km 单位尺度回补 —— [decision] → [code]

待决策是否回补存量（详 §2-B / governance §3）。回补脚本属 [code] 可做，但触及已验证数据，需用户拍板。

### E. 重跑闭环 —— [code]，每轮收尾

新决策（decisions-v13）→ resolution（v16）→ 新批次（v53，沿用 v52 脚本模板、新 out-dir、ledger sources 追加 v52）→ coverage v8 → 从 `non-importable-scopes-v1.jsonl` 移除已解锁行、重生成评审包。每轮用 coverage 量进度。

---

## 4. 312 桶 disposition 速查（重判结果）

来源：`inputs/.../missing-dependencies-b-full-312-review.json`（246）+ `…-b-special-pending-groups.md`（66）。**dispositions 为提案，落决策前须验证候选存在 + 物理等价。**

| disposition | 项数 | blocked scope·次 | 子轨 | 含义 / 处置 |
| --- | --: | --: | --- | --- |
| remap 到现有 flow（具体候选 UUID） | 164 | ~11,219 | B1 | land use / 水 / 资源 / 同名近名，原评估器假阴性 |
| flow 类型改判 → product/service | 74 | ~1,152 | B2 | ecoSpold inputGroup=5 / service，非 elementary |
| ↳ + markdown product/waste 待定 | 8 | ~335 | B2 | Oils biogenic / polluted water / pesticide 等 outputGroup=4 |
| 新增 non-material elementary（Noise） | 8（JSON 2 + md 6） | ~1,417 | B3 | 真需上游新建 |
| 排除 accounting flow | 5 | ~13 | B4 | 含水率 economic accounting |
| water 地理/EF 后置 | 49 | ~210 | B5 | map 到现有 Water，地理后置 LCIA/EF 层 |
| wastewater → 现有 Product flow | 3 | ~63 | B1/B2 | 库内 Wastewater product flow [Volume/Mass] |
| review_required | 1 | ~7 | B6 | 待人工 |

> 净效应：原报告口径「312 真缺失 → upstream_add」严重高估。重判后真正依赖上游新增 elementary 的只剩 ~8 个 Noise；其余 ~216 remap 现有 + ~82 改类型 + ~49 地理后置 + ~5 排除，**多数可在 foundry 侧用 authoring 重判轮推进，不必等上游补 700 流**。

---

## 5. Execution Rules（违反任一 = 返工）

1. **Canonical ledger sources**（新批次全部显式携带）：v35 / v41 / v42 / v45 / v49 / v50 / v51 / v52 的 `import-ledger`。v12/v46/v47/v48 仅 forensic。
2. **commit 必带** `--target-user-id dab05739-1a42-421b-8170-3b77146d1d64`（溯源 `$RUN/account-write-guard.json`）。
3. **candidate ≠ authoritative**：classification/location/identity/authoring/重判的 AI 输出必须带 sha bundle 证据并经 deterministic apply/projection；规则推导 / 重判 disposition 只是 candidate。
4. **elementary flow 的隔间【和类型】判断都用 sourceTrace（payload.sourceClassification 的 category + subCategory + input/outputGroup），不用被污染的 elementaryFlowCategorization**（§2-A/C）。
5. **FP/UG / elementary flow 不得新建 BAFU 私有 support**：缺则阻塞并形成上游 canonical 待办；rewrite 的 `canonical_*_unproven` / `canonical_support_pending_upstream` blocker 即门禁。product/service/waste flow 的新增走正常 flow 路径（非 support）。
6. **canonical support 换算落点**：scale 因子放 mapping 的 `source_unit_scales`（rewrite 读 cache JSON，不读 .mjs，两边双写保持一致）；数值换算落 process exchange 层，不是逐 flow 改 meanValue，也不在 rewrite pass。
7. **--pending-only 会跳过源 ledger 中 blocked-active 的 scope**：跨批次残余须显式 `--process-id-file` sweep。
8. 每个新批次独立 out-dir / report / run-manifest / ledger；coverage 显式列 ledger sources；恢复批次前 rm pause flag + pgrep 旧进程 + 以 run-manifest 恢复参数。
9. 长驻 runner 启动时加载代码：提交修复后须 pause→relaunch 换代。

---

## 6. 进度度量 & Completion Checks

度量：跑 coverage 报告（命令见 `bafu-import-runbook.md` §5.4，ledger sources 追加最新批次 + `--non-importable-scopes-file`）。

完成（全部满足）：

- `process-bundles/index.json` unique = 11,747 = `tidas/processes` unique。
- 11,747 全部 verified 或登记 non-importable；coverage `process_coverage_gap_rows = 0`、`active_human_review/retry/pending = 0`。
- 单位尺度缺陷（§2-B）已回补或经用户明确接受并记录。
- 747 缺失流（含 312 桶）全部有 disposition 落地：remap/改类型的进 verified；新增 elementary（Noise）/FP-UG 已激活或经确认上游阻塞维持登记；地理后置项有明确 LCIA/EF 处理路径。
- npm test + npm run doctor 通过；保存最终 batch report / canonical ledger / coverage / 评审包 / 重判 JSON 路径。

---

## 8. 上游补齐手册（如何解锁剩余 5,004 个 non-importable）

> goal 已达完成态（6,743 verified + 5,004 登记 non-importable, gap=0）。这 5,004 的成因去重后 = **468 个待建/待修 flow + 5 对 FP/UG**，全为上游硬卡。下面写清**该建/修哪些、怎么建、补齐后怎么解锁**。可分批做，每批做完即可用本仓库已就绪的确定性流水线立即解锁对应 scope。

**逐流清单（可直接交上游执行）**：`$RUN/upstream-supplementation-20260614/`

- `README.md` —— 三类补齐的 how-to（本节的展开版，含转换器 input/outputGroup→type 映射表、ecoinvent→ILCD 隔间映射、解锁流水线步骤）。
- `upstream-flows-to-create.csv` / `.json` —— **468 流逐行**：flow_id / disposition / blocked_scopes / name / cas / reference_flow_property / source 隔间 + input/outputGroup（每列直接对应新建 flow 的规格）。
- `upstream-fpug.json` —— 10 个 FP/UG（5 对）。

**三类上游补齐**：

1. **缺失 elementary flow（305 个）**—— [upstream canonical DB]。`disposition=upstream_new_elementary_*`：280 物质 + 17 PM 分箱 + 8 Noise。远端确无等价（80 候选/流穷尽重判过）。按 CSV 建：`name`→baseName、`cas`→CASNumber、`source_category/subCategory`→目标 ILCD 隔间（映射规则 = `library-scope-workflow.mjs` 的 `traceCompartment`）、`reference_flow_property`→参考属性。优先：`Particulates <2.5um`(2,254 scope)、`Dinitrogen monoxide`(639)、Noise 系列。
2. **converter 类型误判（163 个）**—— [upstream tidas-tools]。`disposition=flow_type_retype_converter_upstream`：§2-C 根因，technosphere product/service 被误写成 elementary。修 `_flow_classification()` 按 ecoSpold group→type 映射（inputGroup=4/outputGroup=4→Elementary；inputGroup=5→Product；inputGroup=3/service→Service；outputGroup=3→Waste；见 README 表）。重转后这些成 product/waste/service flow → 正常导入（product flow 可新建，非 reference-only）。
3. **5 对 FP/UG**—— [upstream canonical DB]。完整规格 + 激活步骤见 `fp-ug-canonical-support-governance.md` §2（去重 3 维度 Length\*time/Time/Person\*distance，pending mapping 已就位待填 UUID）。

**解锁流水线（每批补齐后执行，已就绪不需重造）**：

- 缺失 elementary：上游建好并发布 → 重跑 identity-preflight → 用 `rejudge-436-20260614/fullpool-rejudge.py` 同款确定性重判（候选含 version）→ reuse 决策追加 `decisions-vN` → `dataset-library-decisions-apply` 出 resolution → batch（v55 脚本模板：`--process-id-file` 取新 ready 差集、全 canonical ledger sources、parallel 10-14、本地 CLI）→ coverage。
- 类型改判：修转换器重转 → 成 product/waste flow → 正常进 ready → batch。
- FP/UG：填 mapping UUID + 刷缓存 → `canonical_support_pending_upstream` blocker 解除 → 进 ready → batch。
- 每批后从 `non-importable-scopes-v2.jsonl` 移除已解锁行 + 重出 coverage，验证 gap 单调下降。

> scope 是多依赖的——一个 scope 常同时缺多个流，故各类「直接阻塞」有重叠，实际解锁随补齐范围**复合上升**（参考三轮自主 remap：解 262 流 → +1,168 verified）。

---

## 7. References

- 评审包：`$RUN/non-importable-review-v1/`（README.md、index.html、missing-dependencies-report.md/.xlsx、data/）。
- **312 桶重判**：`inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09/missing-dependencies-b-full-312-review.json`（246 项，含 negative_near_matches / rejudged_status / candidate_uuid / judgment）+ `…-b-special-pending-groups.md`（66 项：product/waste 8、wastewater 3、Noise 6、water 地理 49）。
- FP/UG + 单位尺度治理详档：`docs/import-profiles/bafu/fp-ug-canonical-support-governance.md`。
- 运行手册（命令模板/分诊表/恢复清单）：`docs/bafu-import-runbook.md`。
- Profile 约束（含单位/隔间/类型口径）：`docs/import-profiles/bafu/constraints.md`。
- 登记文件：`$RUN/non-importable-scopes-v1.jsonl` + `.report.json`（依赖列表截断于 40，完整以 ledger / scopes.csv 为准）。
- 记忆：`bafu-v50-import-phase.md`（隔间修复、合同链、单位尺度、类型误判等沿革）。
- **上游补齐手册 + 逐流清单**：`$RUN/upstream-supplementation-20260614/`（README.md + upstream-flows-to-create.csv/json 468 流 + upstream-fpug.json）—— 见 §8。
- 最终登记：`$RUN/non-importable-scopes-v2.jsonl` + `.report.json`（5,004 scope，逐 scope 依赖 + disposition）。终验 coverage：`$RUN/universe-coverage-v11-final/`。
