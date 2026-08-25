# BAFU FlowProperty / UnitGroup canonical support — governance & unit-scale findings

入口：本文档承接 5 组 non-importable FlowProperty/UnitGroup blocker 的去重治理方案，并记录核查中确认的一个**既存单位尺度问题**。两件事相关但独立。

> 当前可执行入口是 [`profile.md`](./profile.md)、[`constraints.md`](./constraints.md) 与 `specs/import-profiles.json`。[`bafu-endgame-goal.md`](./bafu-endgame-goal.md) 仅保留旧收尾批次的历史全景，不得继续作为 agent 执行入口；本文档保留其中 FP/UG 与单位尺度的审计事实，并以当前 private-incubation 规则为准。

代码侧已落地（本仓库）：

- `scripts/lib/canonical-support-mappings.ts` — mapping schema 增加 `canonical_reference_unit` + `source_unit_scales`，回填全部既有映射的换算因子（取自 canonical UnitGroup 的 mean_value），并加入 3 条 pending mapping。
- `specs/canonical-support/flow-properties-unit-groups.json` — 同步上述（rewrite 实际读取此缓存，不读 .mjs）。
- `scripts/lib/canonical-support-rewrites.ts` — rewrite 变 scale-aware：在 rewrite 行与报告中记录 `amount_scale_to_canonical_reference`；当 scale≠1 写入 `canonical-support-amount-scaling.jsonl` 与 `amount_scaling_requirements`；`--block-on-unscaled-canonical-support` 时升级为硬 blocker；pending mapping 产出 `canonical_support_pending_upstream` blocker。
- `dataset-bundle-sample-rows` — materialization 必须把同一 scaling requirement、block flag 和 blocker 传入 canonical rewrite；一旦提前把源 FP 改为 canonical UUID，后续 finalize 已无法从 canonical 引用恢复原始单位尺度。带 flag 的 scale≠1 scope 会进入 `process-scope-ledger.jsonl` 的 `needs_ai_authoring`，并保留独立 scaling JSONL。
- blocking flag 下 scale 合同 fail-closed：已知、有限且为正的非 1 因子使用 `canonical_support_amount_scaling_required`；缺失、NaN、无限、0 或负数使用 `canonical_support_amount_scale_unresolved`。后者不得被当作普通 scale≠1，也不得用 account-local override 放行。
- 当前保留的独立 precedence 决策：若引用已是 canonical UUID 但版本过旧、cache 又缺该 FP 的 Unit Group proof，显式 account-local override 会跳过 proof blocker，同时不做 version bump，结果为 `completed_no_rewrites`；后续 readback 仍可能因 stale version 阻断。Wave 9 仅锁定该既有行为，是否改为 fail-closed/bump 必须另行评审，不能夹带在 TS 迁移中。
- `test/commands/canonical-support-rewrites.test.mts` — 覆盖 scale 记录 / 阻断 flag / factor=1 不触发 / pending blocker。

---

## 1. 去重决策（5 源单位 → 3 量纲）

| 源单位 | 引用 flow 数 | 量纲 | canonical 目标 | 参考单位 | 换算因子 |
| --- | --: | --- | --- | --- | --- |
| `my` | 19 | length×time | `Length*time` / `Units of length*time` | `m*a` | 1.0 |
| `kmy` | 13 | length×time | 同上 | `m*a` | **1000** |
| `a` | 87 | time | `Time` / `Units of time` | `a`（year） | 1.0 |
| `hr` | 19 | time | 同上 | `a`（year） | **1/8760 ≈ 1.14155e-4** |
| `personkm` | 169 | person×distance | `Person*distance` / `Units of person*distance` | `personkm` | 1.0 |

核查要点（已逐条验证）：

- `a` = **year/annum**，不是 are（面积）。87 个引用 flow 全是设备/载具运行年（`Use, computer ...`），grep `land|occupation|area|m2` 零命中。⚠️ canonical `Units of area` 里有一个字面单位 `a`=are=100 m²——**绝不能**因符号相同把 `a` 并入 Area。
- `my`/`kmy` 全是线性交通基础设施（`Tram track` / `Railway track on bridge`），同属 length×time。
- `personkm` 全是客运周转，**不是** mass×distance（`kg*km`），零 freight 污染。
- 三个目标量纲在 canonical 缓存中确实缺失（有 Area*time/Volume*time/Mass*time/mass*distance，无 Length*time/Time/Person*distance）。
- 不把 state_code=0 的 `Unit of working time (LCWE)` 当作 public canonical；如在 BAFU 账号内评估复用，仍须证明其量纲、单位和 owner-draft 闭包，且不能进入公共缓存。

参考单位选择使换算最小化：Length*time 选 `m*a`（仅 13 个 kmy 需换算 < 19 个 my）、Time 选 `a`（仅 19 个 hr 需换算 < 87 个 a）、Person\*distance 单一单位零换算。全局仅 32 个 flow（kmy 13 + hr 19）需要数值换算。

---

## 2. Account-local 孵化与最终 canonical 决策

BAFU profile 已授权缺少 public canonical 时先使用本账号 `state_code=0` 的 FP/UG 候选。下列三对 support 在私有清洗阶段保持 account-local，Foundry 只维护证据、候选 registry 和执行门禁；是否进入 public canonical 必须由后续独立专家审批决定：

**Length\*time**：FP `Length*time | 长度*时间`（classification: Technical flow properties）→ UG `Units of length*time | 长度*时间`（Technical unit groups），单位表至少 `m*a`(ref, 1.0)、`km*a`(1000)；建议 alias `my`=`m*a`、`kmy`=`km*a`。

**Time**：FP `Time | 时间` → UG `Units of time | 时间`，参考单位 `a`(=year, **NOT** are=100 m²；在 generalComment 注明)，单位至少 `a`(1.0)、`hr`(1/8760)。落库前确认 year 取 **365 还是 365.25**（仅影响 hr 的 19 个 flow，最坏 0.068% 偏差）。

**Person\*distance**：FP `person*distance | 人*距离`（对齐既有 `mass*distance` 小写风格）→ UG `Unit of personkm`，参考单位 `personkm`(1.0)。

### 私有激活步骤

1. 在 account-local candidate registry 中冻结三对 FP/UG 的精确 ID/version、owner、`state_code=0`、payload/`modified_at` hash、reference unit 和单位表；不得写入 public canonical cache。
2. 人工确认 Time 的 year 采用 365 还是 365.25 天；未确认前包含 `hr` 的完整 alias plan 保持阻塞。
3. 通过 DB #233 / CLI #155 的 owner-draft 模式生成一个完整计划，其中包含 `hr -> Time` 与 `kmy -> Length*time` 两个逻辑 batch；数据库必须在同一事务中一次执行全部 52 个变更行和 59 条 exchange（118 个 amount 字段），任一 batch 的 owner/state、快照、引用闭包、换算因子、审计或回读证据漂移都回滚整个计划。source/target support、flow、process 全部必须是当前 owner 的 `state_code=0`，309 条无关 exchange 必须保持不变。
4. 完成 comment/source/elementary mapping/LCIA coverage 等私有清洗和试算。`Person*distance` 与两条 Noise elementary flow 分开评审。
5. 专家可分别批准三对 support；允许最终公开 0/2/4/6 条。批准记录绑定精确 ID/version、payload hash、plan SHA、reviewer role 和 LCIA cache version。
6. 只有批准后才使用受控 promotion 工具改变状态；随后刷新 public canonical cache。若仍保持 private，则继续只在 account-local registry 中使用。

> FP/UG 是否值得公开取决于量纲、单位、命名、来源和复用价值；LCIA 是否命中取决于 elementary flow UUID + direction。两者是独立门禁，不能互相替代。

---

## 3. ⚠️ 既存单位尺度问题（独立于上面 5 单位，需决策）

### 结论：这是「文档化政策 vs 实现」的缺口，不是可接受的约定

profile 文档**明确要求**单位换算，且把漏掉换算定性为严重错误：

- `constraints.md:168`：「`kWh` 映射为 Energy，换算到 `MJ` 时系数为 **3.6**」。
- `constraints.md:155`：「`tkm` ... 按 **1000 kg\*km** 处理」。
- `constraints.md:137`：复用公共电力 flow「仍必须核对...**数量单位换算**」。
- `hiq-issue-02:110`：「the amount **must be scaled by 1000** ... **not silent generic adapter magic**. Impact: Missing the scale factor causes a **three-order-of-magnitude error**.」
- `hiq-governance:51`：freight 换算「Apply explicit scaling decision in canonical support mapping, **not silently**.」

但实现里 mapping schema 此前**无 scale 字段**，`canonical-support-rewrites.ts` 只换 `referenceToFlowPropertyDataSet` 指针、**从不换算数值**（全代码库无任何 exchange amount 换算逻辑）。`kWh→Net calorific value` 的 **FP 名复用**是已接受的 legacy；但**数值不换算**正是文档点名禁止的「silent magic」。

### 端到端实证（canonical 已验证数据）

flow `b84dea0f`（"Electricity, at cogen with biogas engine"，经 process `c908cd1b` 在 canonical 账本 v50 验证）：源 `Amount in kWh` + exchange `0.00344991` → 写入态 flow FP 变 `Net calorific value`(参考 MJ)、meanValue 仍 1、exchange 数值仍 `0.00344991` → 远端存成 `0.00344991 MJ`，物理应为 `0.0124 MJ`（×3.6）。

### canonical-verified 爆炸半径（按 8 个 canonical 账本统计，非 census）

- 受影响参考单位/因子：`kWh→MJ`(×3.6)、`tkm→kg*km`(×1000)、`km→m`(×1000)（参考单位见缓存 UG mean_value）。
- **3,506 个已验证 process / 24,318 条 exchange**（kwh 19,413 + tkm 3,467 + km 1,438）引用了这类 flow 且 amount≠1。
- 此问题与 Task #7「828 隔室零暴露」正交（那是 elementary flow 隔室，不是单位尺度），此前从未清算。

### 回补（pending 决策；本文档不擅自改已验证数据）

1. 用 `--block-on-unscaled-canonical-support` 重跑 bundle sampling/canonical-support rewrite，定位全部 `amount_scaling_required` 行（两条路径均保留 `canonical-support-amount-scaling.jsonl`；bundle sampling 同步写 scope ledger blocker）。
2. 对每条受影响 **process exchange** 的 `meanAmount`/`resultingAmount` 乘 `amount_scale_to_canonical_reference`（kWh ×3.6、tkm/km ×1000），附换算证据；这是跨数据集步骤（flow rewrite 那一 pass 不碰 process 数值）。
3. 重新 readback 校验。
4. 若上游后续提供 generic `Energy` FP（参考单位即 kWh）等「参考单位 = 源单位」的 canonical，则该量纲换算因子归 1，从根上消除此类风险。

> 注意：直接给现有 kWh/tkm/km 映射打开 `--block-on-unscaled-canonical-support` 会在重跑时阻断约 3,000+ 已验证 scope（这正是文档要求的「blocks import: yes」行为），属回补决策的一部分，不要无准备开启。
