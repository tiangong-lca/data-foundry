export type JsonRecord = Record<string, unknown>;

export interface LeafCategoryEntry extends JsonRecord {
  code: string;
  level: string | null;
  label: string | null;
}

export interface LeafCategorySchema {
  byCode: ReadonlyMap<string, LeafCategoryEntry>;
  leafCodes: ReadonlySet<string>;
}

export interface LeafRepairRule extends JsonRecord {
  code: string;
  rule: string;
  basis: string;
}

export interface RepairCandidateOptions {
  candidateType: string;
  ruleSource: string;
}

export interface ProcessRepairInput {
  task: JsonRecord;
  categoryKey: string;
  existingDecision: JsonRecord | null | undefined;
  processSchema: LeafCategorySchema;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function ensureArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function truncateText(value: unknown, maxLength = 2400): string | null {
  const text = asText(value);
  if (!text || text.length <= maxLength) return text || null;
  return `${text.slice(0, maxLength)}...`;
}

function entityKey(type: string, id: string, version: string): string {
  return `${type}:${id}:${version}`;
}

export function compactExistingDecision(
  decision: JsonRecord | null | undefined,
): JsonRecord | null {
  if (!decision) return null;
  return {
    selected_code: asText(decision.selected_code ?? decision.code ?? decision.leaf_code) || null,
    basis: truncateText(decision.basis),
    confidence: asText(decision.confidence) || null,
    source_name: truncateText(decision.source_name),
    converted_classification_reference: truncateText(decision.converted_classification_reference),
    classification_decision_level: asText(decision.classification_decision_level) || null,
    rule_hits: ensureArray(decision.rule_hits),
    converted_classification_reference_policy:
      asText(decision.converted_classification_reference_policy) || null,
  };
}

export function normalizedText(value: unknown): string {
  return asText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[{}()[\],;:|/_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function classificationDecisionIsBroadFlowProduct(row: JsonRecord): boolean {
  if (asText(row?.category_type ?? row?.categoryType) !== "flow-product") return false;
  const code = asText(row?.selected_code ?? row?.code ?? row?.leaf_code);
  const level = asText(row?.classification_decision_level ?? row?.classificationDecisionLevel);
  return level === "broad_section" || /^\d{1,3}$/u.test(code);
}

export function normalizedSourceName(row: JsonRecord): string {
  return normalizedText(row?.source_name).replace(/^x{1,3}\s+/u, "");
}

export function flowProductLeafRepairRule(row: JsonRecord): LeafRepairRule | null {
  const sourceName = normalizedSourceName(row);
  const basis = normalizedText(row?.basis);
  const converted = normalizedText(row?.converted_classification_reference);
  const evidenceText = [sourceName, basis, converted].filter(Boolean).join(" ");
  const startsWith = (pattern: RegExp): boolean => pattern.test(sourceName);
  const contains = (pattern: RegExp): boolean => pattern.test(evidenceText);

  if (startsWith(/^electricity\b/u)) {
    return {
      code: "17100",
      rule: "electricity_flow_to_17100",
      basis:
        "BAFU flow-product leaf repair: the source name starts with electricity and denotes electrical energy, not equipment or installation.",
    };
  }
  if (
    startsWith(/^heat\b/u) &&
    !contains(/\b(?:heat exchanger|heat pump|heat production system)\b/u)
  ) {
    return {
      code: "17300",
      rule: "thermal_energy_flow_to_17300",
      basis:
        "BAFU flow-product leaf repair: the source name denotes delivered heat/thermal energy, mapped to steam and hot water.",
    };
  }
  if (startsWith(/^natural gas\b/u)) {
    return {
      code: "12020",
      rule: "natural_gas_flow_to_12020",
      basis:
        "BAFU flow-product leaf repair: the source name denotes natural gas in gaseous or liquefied form.",
    };
  }
  if (sourceName === "hard coal coke" || startsWith(/^hard coal coke\b/u)) {
    return {
      code: "33110",
      rule: "hard_coal_coke_flow_to_33110",
      basis: "BAFU flow-product leaf repair: the source name denotes coal coke.",
    };
  }
  if (startsWith(/^hard coal\b/u)) {
    return {
      code: "11012",
      rule: "hard_coal_flow_to_11012",
      basis: "BAFU flow-product leaf repair: the source name denotes bituminous coal.",
    };
  }
  if (startsWith(/^lignite\b/u)) {
    return {
      code: "11032",
      rule: "lignite_flow_to_11032",
      basis: "BAFU flow-product leaf repair: the source name denotes lignite.",
    };
  }
  if (startsWith(/^crude oil\b/u)) {
    return {
      code: "12011",
      rule: "crude_oil_flow_to_12011",
      basis: "BAFU flow-product leaf repair: the source name denotes crude oil.",
    };
  }
  if (startsWith(/^diesel\b/u)) {
    return {
      code: "33360",
      rule: "diesel_flow_to_33360",
      basis: "BAFU flow-product leaf repair: the source name denotes diesel or gas oil.",
    };
  }
  if (startsWith(/^(?:petrol|gasoline|motor gasoline)\b/u)) {
    return {
      code: "33311",
      rule: "motor_gasoline_flow_to_33311",
      basis: "BAFU flow-product leaf repair: the source name denotes motor gasoline.",
    };
  }
  if (startsWith(/^light fuel oil\b/u)) {
    return {
      code: "33370",
      rule: "light_fuel_oil_flow_to_33370",
      basis: "BAFU flow-product leaf repair: the source name denotes refined fuel oil.",
    };
  }
  if (startsWith(/^heavy fuel oil\b/u)) {
    return {
      code: "33370",
      rule: "heavy_fuel_oil_flow_to_33370",
      basis: "BAFU flow-product leaf repair: the source name denotes refined heavy fuel oil.",
    };
  }
  if (startsWith(/^(?:lubricating oil|lubricant)\b/u)) {
    return {
      code: "33380",
      rule: "lubricant_flow_to_33380",
      basis: "BAFU flow-product leaf repair: the source name denotes lubricating oil.",
    };
  }
  if (startsWith(/^uranium enriched\b/u)) {
    return {
      code: "33620",
      rule: "enriched_uranium_flow_to_33620",
      basis: "BAFU flow-product leaf repair: the source name denotes uranium enriched in U235.",
    };
  }
  if (startsWith(/^uranium natural\b/u)) {
    return {
      code: "33610",
      rule: "natural_uranium_flow_to_33610",
      basis: "BAFU flow-product leaf repair: the source name denotes natural uranium.",
    };
  }

  if (startsWith(/^hydrogen peroxide\b/u)) {
    return {
      code: "34280",
      rule: "hydrogen_peroxide_flow_to_34280",
      basis: "BAFU flow-product leaf repair: the source name denotes hydrogen peroxide.",
    };
  }
  if (startsWith(/^phosphoric acid\b/u)) {
    return {
      code: "34232",
      rule: "phosphoric_acid_flow_to_34232",
      basis: "BAFU flow-product leaf repair: the source name denotes phosphoric acid.",
    };
  }
  if (startsWith(/^nitric acid\b/u)) {
    return {
      code: "34233",
      rule: "nitric_acid_flow_to_34233",
      basis: "BAFU flow-product leaf repair: the source name denotes nitric acid.",
    };
  }
  if (
    startsWith(
      /^(?:sulphur hexafluoride|sulfur hexafluoride|sodium hydroxide|hydrochloric acid|sulphuric acid|sulfuric acid)\b/u,
    )
  ) {
    return {
      code: "34231",
      rule: "inorganic_acid_or_base_flow_to_34231",
      basis:
        "BAFU flow-product leaf repair: the source name denotes a specific inorganic acid/base or sulphur hexafluoride.",
    };
  }
  if (startsWith(/^ammonia\s+anhydrous\b/u)) {
    return {
      code: "34651",
      rule: "anhydrous_ammonia_flow_to_34651",
      basis: "BAFU flow-product leaf repair: the source name denotes anhydrous ammonia.",
    };
  }
  if (startsWith(/^(?:hydrogen|carbon dioxide|oxygen|nitrogen)\b/u)) {
    return {
      code: "34210",
      rule: "industrial_inorganic_gas_flow_to_34210",
      basis:
        "BAFU flow-product leaf repair: the source name denotes hydrogen, oxygen, nitrogen, or carbon dioxide.",
    };
  }

  if (sourceName === "road") {
    return {
      code: "53211",
      rule: "road_asset_flow_to_53211",
      basis: "BAFU flow-product leaf repair: the source name exactly denotes a road asset.",
    };
  }
  if (startsWith(/^transmission network electricity\b/u)) {
    return {
      code: "53242",
      rule: "electricity_transmission_network_to_53242",
      basis:
        "BAFU flow-product leaf repair: the source name denotes an electricity transmission network.",
    };
  }
  if (startsWith(/^distribution network electricity\b/u)) {
    return {
      code: "53252",
      rule: "electricity_distribution_network_to_53252",
      basis:
        "BAFU flow-product leaf repair: the source name denotes a local electricity distribution network.",
    };
  }
  if (startsWith(/^pipeline\b/u) && contains(/\b(?:distribution|local|low pressure)\b/u)) {
    return {
      code: "53251",
      rule: "local_pipeline_asset_to_53251",
      basis:
        "BAFU flow-product leaf repair: the source name denotes a local or distribution pipeline asset.",
    };
  }
  if (startsWith(/^pipeline\b/u)) {
    return {
      code: "53241",
      rule: "long_distance_pipeline_asset_to_53241",
      basis:
        "BAFU flow-product leaf repair: the source name denotes a pipeline asset without local/distribution evidence.",
    };
  }

  if (
    startsWith(/^transport\s+freight\s+lorry\b/u) ||
    startsWith(/^transport\s+freight\s+truck\b/u)
  ) {
    return {
      code: "65119",
      rule: "freight_lorry_transport_service_to_65119",
      basis:
        "BAFU flow-product leaf repair: source name starts with transport, freight, lorry/truck, denoting a road freight transport service.",
    };
  }
  if (startsWith(/^transport\s+freight\s+rail\b/u)) {
    return {
      code: "65129",
      rule: "rail_freight_transport_service_to_65129",
      basis:
        "BAFU flow-product leaf repair: source name starts with transport, freight, rail, denoting railway freight transport service.",
    };
  }
  if (startsWith(/^transport\s+(?:natural gas|crude oil)\b/u) && contains(/\bpipeline\b/u)) {
    return {
      code: "65131",
      rule: "petroleum_or_natural_gas_pipeline_transport_service_to_65131",
      basis:
        "BAFU flow-product leaf repair: source name denotes transport of petroleum or natural gas via pipeline.",
    };
  }
  if (startsWith(/^transport\s+transoceanic\s+freight\s+ship\b/u)) {
    return {
      code: "65219",
      rule: "transoceanic_freight_ship_transport_service_to_65219",
      basis:
        "BAFU flow-product leaf repair: source name denotes transoceanic freight ship transport service.",
    };
  }
  if (
    startsWith(/^transport\s+lng\s+freight\s+ship\b/u) ||
    (startsWith(/^transport\s+liquefied\s+natural\s+gas\b/u) && contains(/\bfreight\s+ship\b/u))
  ) {
    return {
      code: "65212",
      rule: "lng_tanker_transport_service_to_65212",
      basis:
        "BAFU flow-product leaf repair: source name denotes LNG tanker freight transport service.",
    };
  }
  if (startsWith(/^transport\s+(?:passenger car|motorbike|passenger bus)\b/u)) {
    return {
      code: "64119",
      rule: "passenger_land_transport_service_to_64119",
      basis:
        "BAFU flow-product leaf repair: source name starts with transport and denotes passenger land transport service.",
    };
  }
  if (startsWith(/^transport\s+aircraft\s+freight\b/u)) {
    return {
      code: "65319",
      rule: "air_freight_transport_service_to_65319",
      basis:
        "BAFU flow-product leaf repair: source name starts with transport, aircraft, freight, denoting air freight transport service.",
    };
  }

  if (startsWith(/^tap water\b/u)) {
    return {
      code: "18000",
      rule: "tap_water_flow_to_18000",
      basis:
        "BAFU flow-product leaf repair: the source name denotes supplied tap water as a natural water flow.",
    };
  }

  if (startsWith(/^photovoltaic\s+(?:cell|module|panel|laminate)\b/u)) {
    return {
      code: "46113",
      rule: "photovoltaic_cell_module_panel_or_laminate_to_46113",
      basis:
        "BAFU flow-product leaf repair: source name denotes photovoltaic cell/module/panel/laminate equipment, not electricity.",
    };
  }
  if (/^\d+\s*kwp\s+installation\b/u.test(sourceName)) {
    return {
      code: "46113",
      rule: "photovoltaic_kwp_installation_to_46113",
      basis:
        "BAFU flow-product leaf repair: source name denotes a kWp photovoltaic generator installation.",
    };
  }
  if (startsWith(/^passenger car\b/u)) {
    return {
      code: "49113",
      rule: "passenger_car_asset_to_49113",
      basis:
        "BAFU flow-product leaf repair: source name denotes the passenger car asset, not a transport service.",
    };
  }
  if (startsWith(/^passenger bus\b/u)) {
    return {
      code: "49112",
      rule: "passenger_bus_asset_to_49112",
      basis:
        "BAFU flow-product leaf repair: source name denotes a public-transport type passenger motor vehicle asset.",
    };
  }
  if (startsWith(/^(?:heavy|medium|light) duty truck\b/u)) {
    return {
      code: "49114",
      rule: "truck_asset_to_49114",
      basis:
        "BAFU flow-product leaf repair: source name denotes a goods-transport motor vehicle asset, not a transport service.",
    };
  }

  if (startsWith(/^printed wiring board\b/u)) {
    return {
      code: "47130",
      rule: "printed_wiring_board_flow_to_47130",
      basis: "BAFU flow-product leaf repair: source name denotes a printed circuit board.",
    };
  }

  if (startsWith(/^(?:cathode|anode|separator|electrolyte)\b/u) && contains(/\bbattery\b/u)) {
    return {
      code: "46430",
      rule: "battery_part_flow_to_46430",
      basis:
        "BAFU flow-product leaf repair: source name denotes a battery component/part such as cathode, anode, separator, or electrolyte.",
    };
  }
  if (
    startsWith(
      /^(?:battery|battery cell|lead acid battery|single cell lithium ion|lithium ion battery|li ion battery)\b/u,
    )
  ) {
    return {
      code: "46420",
      rule: "battery_product_flow_to_46420",
      basis:
        "BAFU flow-product leaf repair: source name denotes an electric accumulator or rechargeable battery product.",
    };
  }
  const mentionsBattery =
    /\b(?:battery|batteries|li\s*ions?|li\s*ion|lithium\s*ion|nimh|accumulator|accumulators)\b/u.test(
      evidenceText,
    );
  const mentionsWasteMaterial =
    /\b(?:waste|scrap|spent|eol|end\s+of\s+life|electronics\s+waste)\b/u.test(evidenceText);
  if (!startsWith(/^(?:disposal|treatment)\b/u) && mentionsBattery && mentionsWasteMaterial) {
    return {
      code: "39380",
      rule: "spent_or_waste_battery_material_flow_to_39380",
      basis:
        "BAFU flow-product leaf repair: source name/context denotes spent or waste battery material, not the disposal service.",
    };
  }

  if (startsWith(/^polyethylene terephthalate\b/u) || startsWith(/^pet\b/u)) {
    return {
      code: "34740",
      rule: "polyethylene_terephthalate_flow_to_34740",
      basis: "BAFU flow-product leaf repair: the source name denotes PET/polyester resin.",
    };
  }
  if (startsWith(/^polyethylene\b/u) || startsWith(/^pe\b/u)) {
    return {
      code: "34710",
      rule: "polyethylene_flow_to_34710",
      basis: "BAFU flow-product leaf repair: the source name denotes polyethylene resin.",
    };
  }
  if (startsWith(/^polyvinyl chloride\b/u) || startsWith(/^pvc\b/u)) {
    return {
      code: "34730",
      rule: "polyvinyl_chloride_flow_to_34730",
      basis: "BAFU flow-product leaf repair: the source name denotes PVC resin.",
    };
  }
  if (startsWith(/^polypropylene\b/u) || startsWith(/^pp\b/u)) {
    return {
      code: "34790",
      rule: "polypropylene_flow_to_34790",
      basis: "BAFU flow-product leaf repair: the source name denotes polypropylene resin.",
    };
  }
  if (startsWith(/^polystyrene\b/u) || startsWith(/^ps\b/u)) {
    return {
      code: "34720",
      rule: "polystyrene_flow_to_34720",
      basis: "BAFU flow-product leaf repair: the source name denotes polystyrene resin.",
    };
  }
  if (startsWith(/^synthetic rubber\b/u)) {
    return {
      code: "34800",
      rule: "synthetic_rubber_flow_to_34800",
      basis: "BAFU flow-product leaf repair: the source name denotes synthetic rubber.",
    };
  }

  if (startsWith(/^concrete\b/u)) {
    return {
      code: "37510",
      rule: "concrete_flow_to_37510",
      basis: "BAFU flow-product leaf repair: the source name denotes concrete.",
    };
  }
  if (startsWith(/^cement\b/u)) {
    return {
      code: "37440",
      rule: "cement_flow_to_37440",
      basis: "BAFU flow-product leaf repair: the source name denotes hydraulic cement.",
    };
  }
  if (startsWith(/^mineral wool insulation\b/u)) {
    return {
      code: "37990",
      rule: "mineral_wool_insulation_flow_to_37990",
      basis: "BAFU flow-product leaf repair: the source name denotes mineral wool insulation.",
    };
  }

  if (startsWith(/^(?:sawnwood|sawn timber)\b/u) && contains(/\bsoftwood\b/u)) {
    return {
      code: "31101",
      rule: "softwood_sawnwood_to_31101",
      basis: "BAFU flow-product leaf repair: source name denotes sawn softwood.",
    };
  }
  if (startsWith(/^(?:sawnwood|sawn timber)\b/u) && contains(/\bhardwood\b/u)) {
    return {
      code: "31102",
      rule: "hardwood_sawnwood_to_31102",
      basis: "BAFU flow-product leaf repair: source name denotes sawn hardwood.",
    };
  }
  if (startsWith(/^(?:bark|wood chips)\b/u)) {
    return {
      code: "31230",
      rule: "bark_or_wood_chips_to_31230",
      basis: "BAFU flow-product leaf repair: source name denotes bark, wood chips, or particles.",
    };
  }
  if (startsWith(/^(?:industrial residue wood|residual wood)\b/u)) {
    return {
      code: "39283",
      rule: "residual_wood_waste_to_39283",
      basis: "BAFU flow-product leaf repair: source name denotes residual wood waste or scrap.",
    };
  }
  if (startsWith(/^(?:window frame wood|wooden window frame)\b/u)) {
    return {
      code: "31621",
      rule: "wooden_window_frame_to_31621",
      basis: "BAFU flow-product leaf repair: source name denotes a wooden window frame.",
    };
  }
  if (startsWith(/^glued laminated timber\b/u)) {
    return {
      code: "31627",
      rule: "glued_laminated_timber_to_31627",
      basis: "BAFU flow-product leaf repair: source name denotes engineered structural timber.",
    };
  }
  if (startsWith(/^particle board\b/u)) {
    return {
      code: "31431",
      rule: "particle_board_to_31431",
      basis: "BAFU flow-product leaf repair: source name denotes particle board of wood.",
    };
  }
  if (startsWith(/^laser machining\s+metal\b/u)) {
    return {
      code: "88732",
      rule: "laser_machining_metal_service_to_88732",
      basis:
        "BAFU flow-product leaf repair: source name denotes metal machining service, not a machine tool product.",
    };
  }

  if (startsWith(/^treatment\s+sewage\b/u) || contains(/\bto wastewater treatment\b/u)) {
    return {
      code: "94110",
      rule: "sewage_or_wastewater_treatment_service_to_94110",
      basis:
        "BAFU flow-product leaf repair: source name denotes sewerage or sewage/wastewater treatment service.",
    };
  }
  if (
    startsWith(/^(?:disposal|treatment)\b/u) &&
    contains(/\b(?:hazardous|weee|battery|batteries|nimh|li ion|lithium ion|hydrometallurgical)\b/u)
  ) {
    return {
      code: "94321",
      rule: "hazardous_or_battery_waste_treatment_service_to_94321",
      basis:
        "BAFU flow-product leaf repair: source name denotes hazardous, WEEE, or battery waste treatment/disposal service.",
    };
  }
  if (
    startsWith(/^disposal\b/u) &&
    contains(/\b(?:municipal waste incineration|mswi|municipal incineration)\b/u)
  ) {
    return {
      code: "94333",
      rule: "municipal_waste_incineration_service_to_94333",
      basis:
        "BAFU flow-product leaf repair: source name denotes incineration of non-hazardous municipal waste.",
    };
  }
  if (startsWith(/^disposal\b/u) && contains(/\bsanitary landfill\b/u)) {
    return {
      code: "94331",
      rule: "sanitary_landfill_service_to_94331",
      basis:
        "BAFU flow-product leaf repair: source name denotes sanitary landfill service for non-hazardous waste.",
    };
  }
  if (
    startsWith(/^disposal\b/u) &&
    contains(
      /\b(?:landfill|final disposal type e|residual material|construction waste landfill)\b/u,
    )
  ) {
    return {
      code: "94332",
      rule: "other_non_hazardous_landfill_service_to_94332",
      basis:
        "BAFU flow-product leaf repair: source name denotes other landfill service for non-hazardous waste.",
    };
  }
  if (startsWith(/^disposal\b/u)) {
    return {
      code: "94339",
      rule: "other_non_hazardous_waste_treatment_service_to_94339",
      basis:
        "BAFU flow-product leaf repair: source name denotes waste treatment/disposal service without stronger landfill, incineration, or hazardous evidence.",
    };
  }

  return null;
}

export function repairBroadFlowProductDecision(
  row: JsonRecord,
  flowProductSchema: LeafCategorySchema,
): JsonRecord | null {
  if (!classificationDecisionIsBroadFlowProduct(row)) return null;
  const repair = flowProductLeafRepairRule(row);
  if (!repair) return null;
  const selectedCode = asText(repair.code);
  const schemaEntry = flowProductSchema.byCode.get(selectedCode);
  if (!flowProductSchema.leafCodes.has(selectedCode) || !schemaEntry) return null;
  const mentionsBattery =
    /\b(?:battery|batteries|li\s*ions?|li\s*ion|lithium\s*ion|nimh|accumulator|accumulators)\b/u.test(
      normalizedText([row?.source_name, row?.basis].filter(Boolean).join(" ")),
    );
  const previousDecision = compactExistingDecision(row);
  return {
    ...row,
    selected_code: selectedCode,
    code: selectedCode,
    selected_label: schemaEntry.label,
    decision_status: "completed",
    classification_decision_level: "leaf",
    basis: repair.basis,
    confidence: "high",
    converted_classification_reference_policy: "weak_hint_ignored",
    used_context_kinds: [
      ...new Set([
        ...ensureArray(row?.used_context_kinds),
        "bafu_flow_product_leaf_repair",
        "tidas_flow_product_category_schema",
      ]),
    ],
    evidence: {
      source: "bafu_flow_product_leaf_repair",
      repair_rule: repair.rule,
      source_name: row?.source_name ?? null,
      selected_code: selectedCode,
      selected_label: schemaEntry.label,
      previous_decision: previousDecision,
      guard_conditions: {
        mentions_battery: mentionsBattery,
        normalized_source_name: normalizedSourceName(row),
      },
    },
  };
}

export function classificationRepairCandidate(
  row: JsonRecord,
  { candidateType, ruleSource }: RepairCandidateOptions,
): JsonRecord {
  return {
    ...row,
    decision_status: "candidate_requires_ai_or_human_review",
    status: "candidate_requires_ai_or_human_review",
    candidate_type: candidateType,
    candidate_policy: "not_authoritative",
    authoring_context: row?.authoring_context ?? null,
    required_resolution:
      "Review this candidate under a full-context AI or human classification task, then write a completed task-bound classification decision with authoring_context.context_bundle_sha256.",
    evidence: {
      ...(row?.evidence && typeof row.evidence === "object" ? row.evidence : {}),
      candidate_source: ruleSource,
      not_projected_reason:
        "Foundry BAFU rules may suggest category candidates, but they do not own final semantic classification decisions.",
    },
  };
}

export function categoryKeyFromParts(category: unknown, subcategory: unknown): string {
  return [asText(category), asText(subcategory)].filter(Boolean).join(" > ");
}

export function sourceClassificationFromTask(task: JsonRecord): JsonRecord | null {
  const processContext = jsonRecord(task.process_context);
  const sourceTrace = jsonRecord(processContext.source_trace);
  const sourceClassification = jsonRecord(sourceTrace.source_classification);
  return Object.keys(sourceClassification).length > 0 ? sourceClassification : null;
}

export function categoryKeyForLeafTask(task: JsonRecord): string {
  const sourceClassification = sourceClassificationFromTask(task);
  if (!sourceClassification) return "";
  return categoryKeyFromParts(
    sourceClassification.category ?? sourceClassification.localCategory,
    sourceClassification.subCategory ??
      sourceClassification.subcategory ??
      sourceClassification.localSubCategory,
  );
}

export function categoryKeyForMapDecision(row: JsonRecord): string {
  return (
    asText(row?.category_key) ||
    categoryKeyFromParts(
      row?.source_category ?? row?.category,
      row?.source_subcategory ?? row?.sourceSubcategory ?? row?.subCategory ?? row?.subcategory,
    )
  );
}

export function normalizedTaskProcessName(task: JsonRecord): string {
  return normalizedText(jsonRecord(task.process_context).name).replace(/^x{1,3}\s+/u, "");
}

export function taskSourceTraceText(task: JsonRecord): string {
  const processContext = jsonRecord(task.process_context);
  const trace = jsonRecord(processContext.source_trace);
  const attrs = jsonRecord(trace.reference_function_attributes);
  const sourceClassification = jsonRecord(trace.source_classification);
  return normalizedText(
    [
      processContext.name,
      processContext.general_comment,
      attrs.name,
      attrs.localName,
      attrs.unit,
      attrs.category,
      attrs.subCategory,
      attrs.localCategory,
      attrs.localSubCategory,
      attrs.includedProcesses,
      sourceClassification.category,
      sourceClassification.subCategory,
      sourceClassification.localCategory,
      sourceClassification.localSubCategory,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function taskReferenceUnit(task: JsonRecord): string {
  const processContext = jsonRecord(task.process_context);
  const sourceTrace = jsonRecord(processContext.source_trace);
  const referenceAttributes = jsonRecord(sourceTrace.reference_function_attributes);
  const nameParts = jsonRecord(processContext.name_parts);
  return normalizedText(referenceAttributes.unit ?? nameParts.functional_unit_flow_properties);
}

export function processLeafRepairRule(task: JsonRecord): LeafRepairRule | null {
  const sourceName = normalizedTaskProcessName(task);
  const evidenceText = taskSourceTraceText(task);
  const unit = taskReferenceUnit(task);
  const startsWith = (pattern: RegExp): boolean => pattern.test(sourceName);
  const contains = (pattern: RegExp): boolean => pattern.test(evidenceText);
  const excludesActivityAmbiguity = !contains(
    /\b(?:operation|maintenance|use|production plant|chemical plant|system|infrastructure)\b/u,
  );

  if (
    startsWith(/^heat\b/u) &&
    unit === "mj" &&
    !contains(
      /\b(?:disposal|infrastructure|heat pump|heat exchanger|component|production system)\b/u,
    )
  ) {
    return {
      code: "3530",
      rule: "heat_supply_process_to_3530",
      basis:
        "BAFU process leaf repair: source process outputs heat in MJ and denotes heat supply, not equipment, disposal, or infrastructure.",
    };
  }

  if (startsWith(/^electricity\b/u) && unit === "kwh") {
    if (contains(/\b(?:biomass|biogas|biomethane|wood|hydropower|photovoltaic|wind)\b/u)) {
      return {
        code: "3512",
        rule: "renewable_electricity_generation_process_to_3512",
        basis:
          "BAFU process leaf repair: electricity process has explicit renewable generation evidence and kWh reference unit.",
      };
    }
    if (contains(/\b(?:natural gas|coal|hard coal|lignite|oil|fuel oil|peat|nuclear)\b/u)) {
      return {
        code: "3511",
        rule: "non_renewable_electricity_generation_process_to_3511",
        basis:
          "BAFU process leaf repair: electricity process has explicit non-renewable generation evidence and kWh reference unit.",
      };
    }
  }

  if (startsWith(/^natural gas\b/u) && contains(/\bpipeline\b/u)) {
    return {
      code: "4930",
      rule: "natural_gas_pipeline_transport_process_to_4930",
      basis:
        "BAFU process leaf repair: natural gas process context explicitly denotes pipeline transport.",
    };
  }
  if (
    startsWith(/^natural gas\b/u) &&
    contains(
      /\b(?:consumer|service station|evaporation plant|distribution network|gasification|gas mix)\b/u,
    )
  ) {
    return {
      code: "3520",
      rule: "gas_distribution_process_to_3520",
      basis:
        "BAFU process leaf repair: natural gas process context denotes gaseous fuel distribution/manufacture through mains rather than pipeline transport.",
    };
  }

  if (startsWith(/^treatment\b/u) && contains(/\bwastewater treatment\b/u)) {
    return {
      code: "3700",
      rule: "wastewater_treatment_process_to_3700",
      basis: "BAFU process leaf repair: source process denotes sewage or wastewater treatment.",
    };
  }

  if (
    startsWith(/^disposal\b/u) &&
    contains(
      /\b(?:municipal incineration|municipal waste incineration|mswi|residual material landfill|sanitary landfill|final disposal|building waste)\b/u,
    ) &&
    !contains(/\b(?:hazardous|battery|batteries|radioactive|weee|heat pump)\b/u)
  ) {
    return {
      code: "3821",
      rule: "non_hazardous_waste_disposal_process_to_3821",
      basis:
        "BAFU process leaf repair: disposal process denotes non-hazardous waste treatment/disposal with no hazardous, battery, radioactive, or WEEE evidence.",
    };
  }

  if (startsWith(/^transport\b/u)) {
    if (unit === "tkm" && contains(/\b(?:lorry|truck|road freight)\b/u)) {
      return {
        code: "4923",
        rule: "road_freight_transport_process_to_4923",
        basis:
          "BAFU process leaf repair: transport process uses tkm and denotes road freight by lorry/truck.",
      };
    }
    if (unit === "tkm" && contains(/\brail\b/u)) {
      return {
        code: "4912",
        rule: "rail_freight_transport_process_to_4912",
        basis: "BAFU process leaf repair: transport process uses tkm and denotes rail freight.",
      };
    }
    if (unit === "personkm" && contains(/\brail\b/u)) {
      return {
        code: "4911",
        rule: "passenger_rail_transport_process_to_4911",
        basis:
          "BAFU process leaf repair: transport process uses personkm and denotes passenger rail transport.",
      };
    }
    if (unit === "personkm" && contains(/\b(?:urban|suburban|city)\b/u) && contains(/\bbus\b/u)) {
      return {
        code: "4921",
        rule: "urban_bus_transport_process_to_4921",
        basis:
          "BAFU process leaf repair: transport process denotes urban/suburban passenger bus transport.",
      };
    }
    if (
      unit === "personkm" &&
      contains(/\b(?:passenger car|passenger bus|motorbike|coach|bus)\b/u)
    ) {
      return {
        code: "4922",
        rule: "other_road_passenger_transport_process_to_4922",
        basis:
          "BAFU process leaf repair: transport process uses personkm and denotes road passenger transport.",
      };
    }
    if (contains(/\baircraft\b/u) && contains(/\bfreight\b/u)) {
      return {
        code: "5120",
        rule: "air_freight_transport_process_to_5120",
        basis: "BAFU process leaf repair: transport process denotes air freight transport.",
      };
    }
    if (contains(/\baircraft\b/u) && contains(/\bpassenger\b/u)) {
      return {
        code: "5110",
        rule: "passenger_air_transport_process_to_5110",
        basis: "BAFU process leaf repair: transport process denotes passenger air transport.",
      };
    }
    if (unit === "tkm" && contains(/\b(?:freight ship|tanker|transoceanic|ocean)\b/u)) {
      return {
        code: "5012",
        rule: "sea_freight_transport_process_to_5012",
        basis:
          "BAFU process leaf repair: transport process uses tkm and denotes sea/coastal freight water transport.",
      };
    }
  }

  if (
    excludesActivityAmbiguity &&
    startsWith(/^photovoltaic\s+(?:cell|panel|laminate|inverter)\b/u)
  ) {
    return {
      code: "2611",
      rule: "photovoltaic_component_manufacture_process_to_2611",
      basis:
        "BAFU process leaf repair: source process denotes manufacture of photovoltaic cells, panels, laminates, or inverters.",
    };
  }
  if (
    excludesActivityAmbiguity &&
    startsWith(/^(?:printed wiring board|printed circuit board|circuit board)\b/u)
  ) {
    return {
      code: "2619",
      rule: "electronic_board_component_manufacture_process_to_2619",
      basis:
        "BAFU process leaf repair: source process denotes manufacture of electronic components or printed boards.",
    };
  }

  if (startsWith(/^tap water\b/u) && /^(?:kg|m3)$/u.test(unit)) {
    return {
      code: "3600",
      rule: "tap_water_supply_process_to_3600",
      basis:
        "BAFU process leaf repair: source process denotes tap water supply/treatment with water mass or volume reference unit.",
    };
  }

  if (
    excludesActivityAmbiguity &&
    contains(/\b(?:pesticide|herbicide|fungicide|insecticide|agrochemical)\b/u) &&
    !startsWith(/^disposal\b/u)
  ) {
    return {
      code: "2021",
      rule: "pesticide_or_agrochemical_manufacture_process_to_2021",
      basis:
        "BAFU process leaf repair: source process denotes pesticide or agrochemical manufacture and is not a disposal/waste row.",
    };
  }

  return null;
}

export function repairProcessLeafDecision({
  task,
  categoryKey,
  existingDecision,
  processSchema,
}: ProcessRepairInput): JsonRecord | null {
  const repair = processLeafRepairRule(task);
  if (!repair) return null;
  const repairCode = asText(repair.code);
  const schemaEntry = processSchema.byCode.get(repairCode);
  if (!processSchema.leafCodes.has(repairCode) || !schemaEntry) return null;
  const processId = asText(task.dataset_id);
  const processVersion = asText(task.dataset_version) || "00.00.001";
  const processContext = jsonRecord(task.process_context);
  const libraryIndexContext = jsonRecord(task.library_index_context);
  const exchangeContext = jsonRecord(task.exchange_context);
  return {
    schema_version: 1,
    dataset_type: "process",
    dataset_id: processId,
    dataset_version: processVersion,
    entity_key: task.entity_key ?? entityKey("process", processId, processVersion),
    category_type: "process",
    decision_status: "completed",
    selected_code: repair.code,
    code: repair.code,
    selected_label: schemaEntry.label,
    basis: repair.basis,
    confidence: "high",
    classification_decision_level: "leaf",
    source_name: processContext.name ?? null,
    converted_classification_reference: processContext.converted_classification_path ?? null,
    converted_classification_reference_policy: "weak_hint_ignored",
    used_context_kinds: [
      "library_entity_index",
      "scope_projection",
      "blocked_scope_ledger",
      "process_payload_context",
      "process_exchange_context",
      "bafu_process_leaf_repair",
      "tidas_process_category_schema",
    ],
    evidence: {
      source: "bafu_process_leaf_repair",
      repair_rule: repair.rule,
      category_key: categoryKey || null,
      source_name: processContext.name ?? null,
      selected_code: repair.code,
      selected_label: schemaEntry.label,
      task: {
        task_id: task.task_id ?? null,
        process_id: processId,
        process_version: processVersion,
        source_file: libraryIndexContext.root_process_file ?? null,
        bundle_process_file: libraryIndexContext.bundle_process_file ?? null,
        payload_sha256: libraryIndexContext.payload_sha256 ?? null,
        name_parts: processContext.name_parts ?? null,
        source_classification: sourceClassificationFromTask(task),
        reference_unit: taskReferenceUnit(task) || null,
        output_flows: exchangeContext.output_flows ?? null,
      },
      broad_decision_replaced: existingDecision ?? null,
      guard_conditions: {
        normalized_source_name: normalizedTaskProcessName(task),
        normalized_reference_unit: taskReferenceUnit(task) || null,
      },
    },
  };
}
