---
lastReviewedAt: 2026-08-26
lastReviewedCommit: af5573acf9d8731fc5d7445433f3f3caf633fa8e
lastReviewedNote: "Reviewed for Issue #67 final cutover: only the Foundry entry check path moves to native TypeScript; countable-product and functional-unit semantics are unchanged."
title: Countable Product Functional Unit Design
docType: design
scope: data-foundry
status: active
authoritative: true
owner: tiangong-lca-data-foundry
language: zh-CN
whenToUse:
  - when authoring product flows and processes for discrete durable goods
  - when deciding whether the quantitative reference should be mass, item, pair, service-hour, or another functional unit
  - when reviewing LCD monitor, apparel, footwear, appliance, vehicle, electronics, furniture, or other countable-product datasets
whenToUpdate:
  - when PEF/PEFCR, ILCD/TIDAS, or TianGong reference-flow policy changes
  - when CLI gates start enforcing countable-product reference-flow rules
  - when a countable-product target-quality exemplar is written and verified
checkPaths:
  - specs/data-foundry-service.md
  - scripts/foundry.ts
  - ../tiangong-lca-cli/src/**
  - ../tiangong-lca-data/tiangong_lca_data/external_docs/pef_method.pdf
  - ../tiangong-lca-data/tiangong_lca_data/external_docs/pefcr_guidance_v6.3-2.pdf
---

# Countable Product Functional Unit Design

## 背景

当前 LCD monitor repair 样例已经通过 schema、QA、remote reference、readback 和真实 UI `Data Check`。但进一步检查后发现，该 process 的主产品 output flow `0f14f2f1-768f-44cd-b5d7-b81ecbe1a9b8@01.01.000` 使用的 flow property 是 `Mass`，output amount 是 `1`。这等价于“1 kg 成品显示器制造”，不是“1 台 LCD 显示器提供显示功能”。

这两种模型都可能合法，但不能混用：

| 模型 | 适用场景 | quantitative reference | 功能单位 |
| --- | --- | --- | --- |
| mass-normalized production | 材料、散装产品、只做 kg 基准物料衡算 | `1 kg` product output | 通常不表达消费者功能。 |
| countable product | 显示器、衣服、鞋、家具、电器等离散产品 | `1 item` / `1 pair` product output | 在 process/model metadata 中表达产品服务功能和寿命。 |
| service-normalized lifecycle | PEF/产品比较、使用阶段和寿命重要的产品 | model-level service reference, e.g. `1 use`, `1 display-hour`, `1 day of wear` | 结果按服务单位归一化。 |

LCD 样例现在只能作为 `mass_normalized_production_fixture`；若目标是专家评审意义上的“成品 LCD monitor 数据”，还需要升级为 countable product / service-normalized design。

## PEF 服装规则给出的建模启发

PEF Apparel and Footwear 的核心不是把衣服按 `kg` 比较，而是把产品数量、质量、寿命和使用功能拆开：

- 官方 PEF Apparel and Footwear 页面说明该 PEFCR 覆盖服装和鞋类全生命周期，并把耐久性、维修性、洗护使用场景纳入规则；T-shirt 示例使用 `45` 次穿着作为寿命/使用次数语境。
- 2021 draft PEFCR Apparel and Footwear 的 3.3 节把 functional unit 定义为“提供服装或鞋类产品以满足消费者特定需要”；magnitude 是 `one apparel product`、`one pair of socks` 或 `one pair of footwear`；duration 是 `one day of wear`，并说明 `one use` 等同于一天穿着。
- 同一 draft PEFCR 还说明 reference flow 是满足该功能所需的产品生命周期份额，所有定量输入输出都应相对该 reference flow 计算。

参考来源：

- European Commission, `New EU rules for measuring environmental impact of clothes and shoes`, 2025-06-25: https://environment.ec.europa.eu/news/new-eu-rules-measuring-environmental-impact-clothes-and-shoes-2025-06-25_en
- PEF Apparel & Footwear, `What's behind the methodology?`: https://pefapparelandfootwear.eu/whats-behind-the-methodology/
- Draft PEFCR Apparel and Footwear v1.2, 2021-07-07, section 3.3: https://eeb.org/wp-content/uploads/2021/11/Draft-Product-Environmental-Footprint-Category-Rules-PEFCR-apparel-and-footwear.pdf
- Local PEF references: `../tiangong-lca-data/tiangong_lca_data/external_docs/pef_method.pdf`, `../tiangong-lca-data/tiangong_lca_data/external_docs/pefcr_guidance_v6.3-2.pdf`

## 设计原则

### 0. 必须先做 unit-of-analysis 决策

在写任何 process/flow payload 之前，build plan 必须先确定 `unit_of_analysis`。这个决策早于：

- flow identity preflight；
- reference flow reuse/create；
- process quantitative reference；
- exchange scaling；
- `annualSupplyOrProductionVolume`；
- lifecycle model / compute normalization。

原因是 reference flow 的 reference unit 一旦选错，后面所有 exchange amount、provider closure、annual volume、LCIA result 都会被错误单位污染。schema 和 UI 校验只能证明格式与引用闭合，不能证明功能单位正确。

PEF method 的通用关系是：

```text
Functional unit = 被研究产品系统提供的量化功能/服务。
Reference flow = 为了实现这个功能，需要多少产品输出。
Reference unit = reference flow 的计量单位，例如 kg、MJ、m3、item、pair、tkm、service-hour。
Declared unit = 无法或不应定义完整功能单位时，对中间产品使用的声明单位，例如 1 kg 材料。
```

因此，reference unit 不是 functional unit 本身；它是实现 functional unit 的可计量产品流单位。只有在中间产品或 mass-normalized 数据集中，declared unit / reference flow 可能看起来等同于 functional unit。

## 通用判断框架

### Step 1: 定义 functional unit 四问

每个目标数据集必须先回答：

| 问题 | 说明 | LCD 示例 | 服装示例 |
| --- | --- | --- | --- |
| What? | 产品/服务提供什么功能 | 为自动数据处理系统提供视觉显示 | 满足消费者穿着需求 |
| How much? | 功能规模 | 1 台显示器 / 指定显示面积或规格 | 1 件衣服 / 1 双鞋 |
| How well? | 质量或性能水平 | LCD 技术、尺寸、分辨率、亮度或代表产品级别 | 良好状态、耐久性、质量测试 |
| How long? | 使用时长或寿命 | 年限、显示小时数或使用场景 | 1 天穿着 / 一次使用 / 寿命穿着次数 |

如果这四问能回答，目标是 functional product / service dataset。若只能回答“生产了多少材料/中间品”，目标是 declared-unit dataset。

### Step 2: 判断产品系统类型

```text
if target is raw material, chemical, fuel, electricity, heat, water, or bulk commodity:
  use physical reference unit such as kg, MJ, kWh, m3
elif target is intermediate product with unknown final function:
  use declared unit such as 1 kg, 1 m2, 1 m3, 1 item only if industry convention counts it
elif target is discrete final product:
  use item/pair/set as physical product reference; record mass as supporting evidence
elif target is transport:
  use transport service unit such as tkm, pkm, vehicle-km, or shipment
elif target is treatment:
  use treated amount such as kg waste treated or m3 wastewater treated
elif target is use-phase/service:
  use service unit such as use, day, hour, wash cycle, display-hour, meal, or occupancy-night
else:
  mark unit_of_analysis=manual_review
```

### Step 3: 选择 reference flow 的 reference unit

| 类型 | 默认 reference unit | 什么时候允许换成 kg/MJ 等物理量 |
| --- | --- | --- |
| bulk material / chemical | kg、m3、mol | 默认即允许。 |
| energy carrier / electricity | MJ、kWh | 默认即允许。 |
| intermediate part | kg、m2、m、item | 看行业采购/工艺单位；若最终功能未知，用 declared unit。 |
| countable final product | item、pair、set | 只有明确声明为 `1 kg of product` 的 mass-normalized production 时。 |
| apparel / footwear | apparel product、pair、day of wear / use | kg 只用于 BOM、运输、损耗、材料输入。 |
| electronics / appliance | item 或 service-hour | kg 只用于 BOM、物流、材料/废弃物。 |
| transport | tkm、pkm、vehicle-km | kg 只表示货物质量，不能替代运输服务。 |
| waste treatment | kg waste treated | 若 treatment service 按 item 计费，也必须记录 mass conversion。 |

### Step 4: 建立 scaling equation

必须写出从 reference flow 到 inventory 的换算关系：

```text
inventory_amount = reference_amount * scaling_factor * allocation_factor
```

常见 scaling factor：

- `kg/item`: 离散产品质量；
- `uses/item`: 产品寿命使用次数；
- `hours/item`: 设备寿命服务小时数；
- `kg waste/item`: 使用或制造废弃物；
- `MJ/use`: 使用阶段能耗；
- `tkm/shipment`: 货运服务；
- `wash cycles/lifetime`: 服装洗护次数。

如果 scaling factor 没有 source evidence、行业默认值或可复核假设，就不能自动把 kg 数据转成 item/service 数据。

### Step 5: 输出 pre-authoring decision artifact

BuildPlan 必须包含：

```json
{
  "unit_of_analysis": {
    "target_kind": "countable_durable_product",
    "functional_unit": {
      "what": "provide visual display for automatic data processing",
      "how_much": "1 LCD monitor",
      "how_well": "representative LCD monitor specification",
      "how_long": "service lifetime or display-hours"
    },
    "reference_flow": {
      "flow_identity": "LCD monitor, finished product, manufactured",
      "reference_unit": "item",
      "reference_amount": 1,
      "flow_property": "Number of items"
    },
    "declared_unit_allowed": false,
    "scaling_evidence": [
      {
        "field": "product_mass",
        "unit": "kg/item",
        "status": "source_required"
      }
    ],
    "decision": "blocked_until_scaling_evidence"
  }
}
```

这个 artifact 是 skill/agent 语义判断、source review、process/flow materialization 和 compute readiness 之间的契约。实现边界应保持简单：

- skill / Codex workflow 负责语义判断：读取 source evidence、PEF/PCR、行业语境、目标数据用途，决定 functional unit、reference flow、reference unit 和 scaling evidence。
- CLI 不应另做一套行业判断器；CLI 只在既有 `build-plan validate`、`process QA`、`flow QA` 或 dataset gate 中检查 artifact 是否存在、字段是否完整、最终 payload 是否与 artifact 一致。
- QA 是复核层，不是首次决策层。若生成前缺少 `unit_of_analysis`，skill 应停止；若生成后 payload 背离 artifact，现有 QA/gate 应报 blocker。

允许的决策状态至少包括：

| decision | 含义 | 后续动作 |
| --- | --- | --- |
| `ready_for_materialization` | target kind、reference unit、reference flow property 和 scaling evidence 已闭合。 | 可以进入 flow/process materialize。 |
| `blocked_until_scaling_evidence` | reference unit 可判断，但从 reference flow 到 inventory 的换算证据不足。 | 补 source evidence、行业默认值或可复核假设。 |
| `manual_review` | target kind、功能范围或 reference unit 存在语义歧义。 | 进入人工/agent 语义复核，不能自动生成 payload。 |
| `declared_unit_dataset` | 数据集只适合中间品/材料声明单位。 | 使用 declared unit，不宣称完整产品功能单位。 |

### 1. Flow identity 不等于功能单位

Flow identity 应表达“什么东西/服务被交换”，flow property 表达“用什么物理或计数属性计量它”。功能单位表达“为什么使用它、使用多久、服务水平如何”。

例如 LCD monitor：

```text
Product flow:
  baseName: LCD monitor, principally used in an automatic data processing system
  flow property: Number of items
  reference unit: item
  amount: 1 item

Supporting property:
  product mass: <kg/item>, source-backed or blocked

Functional unit metadata:
  provide visual display for an automatic data processing system
  service duration: <years or display-hours>, source-backed or blocked
  quality/performance: size/resolution/luminance/technology if relevant
```

Mass stays in BOM, input exchanges, product properties, or conversion metadata. It should not become the reference unit for a countable product unless the dataset is explicitly scoped as `1 kg of product`.

### 2. Process qref 先选产品计数，再选服务归一化

For countable durable products:

1. Cradle-to-gate manufacturing process: quantitative reference should normally be `1 item` or `1 pair` of finished product at plant.
2. Full lifecycle product comparison: keep product flow as `1 item` / `1 pair`, then normalize the lifecycle result by service units such as `use`, `day of wear`, `year of service`, or `display-hour`.
3. If a service flow is explicitly modelled, it must be named as a service, e.g. `display service for ADP monitor`, not as the physical monitor product.

### 3. `annualSupplyOrProductionVolume` follows the chosen qref

The existing required-field fallback is still correct in structure, but the qref choice becomes critical:

- Mass-normalized product: fallback may be `1 kg/year`.
- Countable product: fallback should be `1 item/year` or `1 pair/year`.
- Service-normalized lifecycle model: fallback may be service-unit/year only if the service flow is the quantitative reference and the service amount is explicitly modelled.

Therefore, the automated required-field gate must not infer `kg/year` for a countable-product name merely because the current published flow only exposes `Mass`.

### 4. Evidence is required before converting kg to item

Changing `1 kg LCD monitor` into `1 LCD monitor` requires source-backed scaling:

- product mass, e.g. kg per monitor;
- BOM or component mass shares summing to the product mass plus manufacturing loss;
- product specification or representative size;
- service lifetime and use pattern if results are normalized to function.

If those are missing, the correct status is `manual_review` or `countable_product_scaling_blocked`, not silent conversion.

## Automation rules

### Authoring classification

The build plan should classify each target as one of:

```text
bulk_material
energy_carrier
countable_consumable
countable_durable_product
service
waste_treatment
transport_service
```

For `countable_durable_product`, construction gate requires:

- product count reference property (`Number of items`, `Number of pairs`, or domain-specific equivalent);
- product mass as supporting property or source-backed exchange evidence;
- documented service function;
- documented lifetime/use pattern if lifecycle results or comparisons use service normalization;
- explicit reason if the process remains mass-normalized.

### Preflight behavior

If an existing published flow has the correct product identity but the wrong reference property:

- do not overwrite the published flow;
- search for an existing item/pair/service flow with the same product identity;
- if none exists, create a new flow candidate with a different reference property and record the relationship to the mass flow as a conversion/proxy;
- mark any existing mass-normalized process as not functionally comparable until scaling evidence exists.

### Gate behavior

New gates should emit:

| Finding | Severity | Meaning |
| --- | --- | --- |
| `countable_product_uses_mass_qref` | blocker for target-quality | Discrete product is modelled as kg without explicit mass-normalized scope. |
| `countable_product_missing_item_flow` | blocker | No item/pair reference flow exists or can be reused. |
| `countable_product_mass_conversion_missing` | blocker | Cannot scale kg inventory to item inventory. |
| `service_normalization_missing` | warning/blocker by scope | Product comparison claims require use/lifetime service units but none are documented. |
| `mass_normalized_scope_explicit` | allowed | Dataset explicitly states `1 kg of product` and is not presented as functional product data. |

## LCD target redesign

The next high-quality LCD target should not mutate the existing published mass flow in place. It should create or reuse an item-based finished-product flow:

```text
Flow:
  LCD monitor, principally used in an automatic data processing system;
  finished product, manufactured;
  production mix, at plant, GLO
  reference flow property: Number of items
  reference unit: item

Process:
  Final assembly, testing and packaging of LCD monitor
  output: 1 item finished LCD monitor
  inputs: scaled to the selected representative monitor mass
  byproduct/waste: manufacturing loss in kg
  annualSupplyOrProductionVolume fallback: 1 item/year

Functional metadata:
  function: provide visual display for automatic data processing
  performance: representative display class and technology, source-backed
  lifetime/use: source-backed or blocked
```

If only the current kg-normalized evidence is available, the row should be renamed and governed as:

```text
Final assembly, testing and packaging of LCD monitor; finished product, manufactured; mass-normalized production, at plant, GLO
reference flow: 1 kg finished LCD monitor
```

That version may remain useful for material-flow closure tests, but it is not the final countable-product exemplar.
