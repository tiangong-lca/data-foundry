import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInstalledTiangongLcaCliPackage } from "../lib/foundry-runtime-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const prepareCommandName = "dataset-bafu-leaf-classification-tasks-prepare";
const projectCommandName = "dataset-bafu-leaf-classification-category-map-project";
const DEFAULT_SHARD_SIZE = 100;
const DEFAULT_MAX_EXCHANGE_REFS = 48;
const DEFAULT_MAX_REFERENCES = 48;
const DEFAULT_TEXT_LIMIT = 2400;

function installedCliSchemaPath(fileName) {
  return path.join(resolveInstalledTiangongLcaCliPackage().schemaDir, fileName);
}

const bafuLeafRuntimeKeys = [
  "asText",
  "ensureArray",
  "integerOption",
  "positiveIntegerOption",
  "resolveRepoPath",
  "repoRelativeMaybe",
  "readJson",
  "readJsonLines",
  "writeJson",
  "writeJsonLines",
  "nowIso",
];

let bafuLeafRuntime = null;

function installBafuLeafRuntime(deps) {
  const missing = bafuLeafRuntimeKeys.filter((key) => typeof deps?.[key] !== "function");
  if (missing.length > 0) {
    throw new Error(
      `createBafuLeafClassificationTaskCommands missing dependencies: ${missing.join(", ")}`,
    );
  }
  bafuLeafRuntime = deps;
}

function runtime() {
  if (!bafuLeafRuntime) {
    throw new Error("createBafuLeafClassificationTaskCommands must install command dependencies.");
  }
  return bafuLeafRuntime;
}

function asText(value) {
  return runtime().asText(value);
}

function ensureArray(value) {
  return runtime().ensureArray(value);
}

function integerOption(value, fallback) {
  return runtime().integerOption(value, fallback);
}

function positiveIntegerOption(value, fallback) {
  return runtime().positiveIntegerOption(value, fallback);
}

function resolveRepoPath(filePath) {
  return runtime().resolveRepoPath(filePath);
}

function repoRelative(filePath) {
  return runtime().repoRelativeMaybe(filePath);
}

function readJson(filePath) {
  return runtime().readJson(filePath);
}

function readJsonLines(filePath) {
  return runtime().readJsonLines(filePath);
}

function copyFileIfExists(sourcePath, targetPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return false;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function optionList(value) {
  if (value === undefined || value === null || value === true || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function writeJson(filePath, value) {
  runtime().writeJson(filePath, value);
}

function writeJsonLines(filePath, rows) {
  runtime().writeJsonLines(filePath, rows);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function truncateText(value, maxLength = DEFAULT_TEXT_LIMIT) {
  const text = asText(value);
  if (!text || text.length <= maxLength) return text || null;
  return `${text.slice(0, maxLength)}...`;
}

function trimObjectStrings(value, maxLength = 800) {
  if (Array.isArray(value)) return value.map((item) => trimObjectStrings(item, maxLength));
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? truncateText(value, maxLength) : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, trimObjectStrings(entry, maxLength)]),
  );
}

function findNamedNode(node, wantedName, seen = new Set()) {
  if (!node || typeof node !== "object") return null;
  if (seen.has(node)) return null;
  seen.add(node);
  if (node.name === wantedName) return node;
  for (const child of ensureArray(node.children)) {
    const found = findNamedNode(child, wantedName, seen);
    if (found) return found;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "attributes" || key === "children") continue;
    if (!value || typeof value !== "object") continue;
    const found = findNamedNode(value, wantedName, seen);
    if (found) return found;
  }
  return null;
}

function attributesObject(node) {
  if (!node || typeof node !== "object") return {};
  return Object.fromEntries(
    ensureArray(node.attributes)
      .map((attribute) => [asText(attribute?.name), asText(attribute?.value)])
      .filter(([key]) => key),
  );
}

function classificationRows(row) {
  const classes =
    row?.processDataSet?.processInformation?.dataSetInformation?.classificationInformation?.[
      "common:classification"
    ]?.["common:class"];
  return ensureArray(classes).map((item) => ({
    level: asText(item?.["@level"]) || null,
    code: asText(item?.["@classId"]) || null,
    label: asText(item) || null,
  }));
}

function extractProcessPayloadContext(row) {
  const dataSetInformation = row?.processDataSet?.processInformation?.dataSetInformation ?? {};
  const name = dataSetInformation.name ?? {};
  const other = dataSetInformation["common:other"] ?? {};
  const sourceTracePayload = other?.["tidasimport:sourceTrace"]?.payload ?? null;
  const referenceFunction = findNamedNode(sourceTracePayload, "referenceFunction");
  const sourceGeography = findNamedNode(sourceTracePayload, "geography");
  const sourceTechnology = findNamedNode(sourceTracePayload, "technology");
  const sourceTimePeriod = findNamedNode(sourceTracePayload, "timePeriod");
  const classRows = classificationRows(row);

  return {
    name_parts: {
      base_name: truncateText(name.baseName),
      treatment_standards_routes: truncateText(name.treatmentStandardsRoutes),
      mix_and_location_types: truncateText(name.mixAndLocationTypes),
      functional_unit_flow_properties: truncateText(name.functionalUnitFlowProperties),
    },
    converted_classification_path: classRows
      .map((item) => item.label)
      .filter(Boolean)
      .join(" > "),
    converted_classification_classes: classRows,
    general_comment: truncateText(dataSetInformation["common:generalComment"]),
    source_trace: sourceTracePayload
      ? {
          source_object: truncateText(sourceTracePayload.sourceObject),
          source_classification: trimObjectStrings(sourceTracePayload.sourceClassification),
          reference_function_attributes: trimObjectStrings(attributesObject(referenceFunction)),
          geography_attributes: trimObjectStrings(attributesObject(sourceGeography)),
          technology_attributes: trimObjectStrings(attributesObject(sourceTechnology)),
          time_period_attributes: trimObjectStrings(attributesObject(sourceTimePeriod)),
        }
      : null,
  };
}

function readOptionalProcessContext(filePath) {
  const resolved = resolveRepoPath(filePath);
  if (!resolved || !fs.existsSync(resolved)) return null;
  try {
    return extractProcessPayloadContext(readJson(resolved));
  } catch {
    return null;
  }
}

function libraryIndexPaths(inputPath) {
  const resolved = resolveRepoPath(inputPath);
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error("--library-index must point to a library index directory.");
  }
  const stats = fs.statSync(resolved);
  const indexDir = stats.isDirectory() ? resolved : path.dirname(resolved);
  return {
    indexDir,
    entityIndex: path.join(indexDir, "library-entity-index.jsonl"),
    scopeProjection: path.join(indexDir, "scope-projection.jsonl"),
  };
}

function entityKey(type, id, version) {
  return `${type}:${id}:${version}`;
}

function decisionKey(type, id, version) {
  return `${type}::${id}::${version}`;
}

function classificationLibraryKey(row) {
  const categoryType = asText(row?.category_type ?? row?.schema_type);
  const datasetType =
    asText(row?.dataset_type ?? row?.type) ||
    (categoryType === "process"
      ? "process"
      : categoryType === "flow-product" || categoryType === "flow-elementary"
        ? "flow"
        : categoryType);
  return [
    datasetType,
    asText(row?.dataset_id ?? row?.datasetId ?? row?.id ?? row?.uuid),
    asText(row?.dataset_version ?? row?.datasetVersion ?? row?.version) || "00.00.001",
  ].join(":");
}

function dependencyCounts(scopeRow) {
  const dependencies = scopeRow?.dependency_ids ?? {};
  return Object.fromEntries(
    Object.entries(dependencies).map(([key, value]) => [key, ensureArray(value).length]),
  );
}

function limitRows(rows, limit) {
  const safeRows = ensureArray(rows);
  return {
    rows: safeRows.slice(0, limit),
    total_rows: safeRows.length,
    truncated: safeRows.length > limit,
  };
}

function processReferences(entityRow, maxReferences) {
  const references = ensureArray(entityRow?.references);
  const sourceReferences = references.filter((item) => asText(item?.type) === "source data set");
  const contactReferences = references.filter((item) => asText(item?.type) === "contact data set");
  const flowReferences = references.filter((item) => asText(item?.type) === "flow data set");
  return {
    source_references: limitRows(sourceReferences, maxReferences),
    contact_references: limitRows(contactReferences, maxReferences),
    flow_references: limitRows(flowReferences, maxReferences),
  };
}

function compactExistingDecision(decision) {
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

function collectCategorySchemaEntries(schema) {
  const byCode = new Map();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    const properties = value.properties ?? {};
    const code = asText(properties["@classId"]?.const);
    if (code && !byCode.has(code)) {
      byCode.set(code, {
        code,
        level: asText(properties["@level"]?.const) || null,
        label: asText(properties["#text"]?.const) || null,
      });
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(schema);
  return [...byCode.values()];
}

function loadProcessCategorySchema(schemaPath) {
  const resolved =
    resolveRepoPath(schemaPath) || installedCliSchemaPath("tidas_processes_category.json");
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(
      "--process-category-schema is required unless the installed @tiangong-lca/cli@0.1.0 process category schema exists.",
    );
  }
  const schema = readJson(resolved);
  const entries = ensureArray(schema.oneOf ?? schema.anyOf)
    .map((entry) => {
      const properties = entry?.properties ?? {};
      const code = asText(properties["@classId"]?.const);
      if (!code) return null;
      return {
        code,
        level: asText(properties["@level"]?.const) || null,
        label: asText(properties["#text"]?.const) || null,
      };
    })
    .filter(Boolean);
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const leafCodes = new Set(
    entries
      .filter((entry) => /^\d{4}$/u.test(entry.code) || entry.level === "3")
      .map((entry) => entry.code),
  );
  return {
    path: resolved,
    entries,
    byCode,
    leafCodes,
  };
}

function loadFlowProductCategorySchema(schemaPath) {
  const resolved =
    resolveRepoPath(schemaPath) || installedCliSchemaPath("tidas_flows_product_category.json");
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(
      "--flow-product-category-schema is required unless the installed @tiangong-lca/cli@0.1.0 flow product category schema exists.",
    );
  }
  const entries = collectCategorySchemaEntries(readJson(resolved));
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const leafCodes = new Set(
    entries
      .filter(
        (entry) =>
          !entries.some(
            (candidate) =>
              candidate.code !== entry.code &&
              candidate.code.startsWith(entry.code) &&
              Number(candidate.level) > Number(entry.level),
          ),
      )
      .map((entry) => entry.code),
  );
  return {
    path: resolved,
    entries,
    byCode,
    leafCodes,
  };
}

function normalizedText(value) {
  return asText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[{}()[\],;:|/_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function classificationDecisionIsBroadFlowProduct(row) {
  if (asText(row?.category_type ?? row?.categoryType) !== "flow-product") return false;
  const code = asText(row?.selected_code ?? row?.code ?? row?.leaf_code);
  const level = asText(row?.classification_decision_level ?? row?.classificationDecisionLevel);
  return level === "broad_section" || /^\d{1,3}$/u.test(code);
}

function normalizedSourceName(row) {
  return normalizedText(row?.source_name).replace(/^x{1,3}\s+/u, "");
}

function flowProductLeafRepairRule(row) {
  const sourceName = normalizedSourceName(row);
  const basis = normalizedText(row?.basis);
  const converted = normalizedText(row?.converted_classification_reference);
  const evidenceText = [sourceName, basis, converted].filter(Boolean).join(" ");
  const startsWith = (pattern) => pattern.test(sourceName);
  const contains = (pattern) => pattern.test(evidenceText);

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

function repairBroadFlowProductDecision(row, flowProductSchema) {
  if (!classificationDecisionIsBroadFlowProduct(row)) return null;
  const repair = flowProductLeafRepairRule(row);
  if (!repair) return null;
  const selectedCode = repair.code;
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

function classificationRepairCandidate(row, { candidateType, ruleSource }) {
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

function categoryKeyFromParts(category, subcategory) {
  return [asText(category), asText(subcategory)].filter(Boolean).join(" > ");
}

function sourceClassificationFromTask(task) {
  return task?.process_context?.source_trace?.source_classification ?? {};
}

function categoryKeyForLeafTask(task) {
  const sourceClassification = sourceClassificationFromTask(task);
  return categoryKeyFromParts(
    sourceClassification.category ?? sourceClassification.localCategory,
    sourceClassification.subCategory ??
      sourceClassification.subcategory ??
      sourceClassification.localSubCategory,
  );
}

function categoryKeyForMapDecision(row) {
  return (
    asText(row?.category_key) ||
    categoryKeyFromParts(
      row?.source_category ?? row?.category,
      row?.source_subcategory ?? row?.sourceSubcategory ?? row?.subCategory ?? row?.subcategory,
    )
  );
}

function categoryMapDecisionFiles(rawOptions) {
  const explicitFiles = optionList(
    rawOptions.categoryMapDecisions || rawOptions.categoryDecisions || rawOptions.decisions,
  )
    .map(resolveRepoPath)
    .filter(Boolean);
  if (explicitFiles.length > 0) return explicitFiles;
  const decisionsDir = resolveRepoPath(
    rawOptions.categoryMapDecisionsDir ||
      rawOptions.categoryDecisionsDir ||
      rawOptions.categoryMapDir,
  );
  if (!decisionsDir || !fs.existsSync(decisionsDir)) {
    throw new Error(
      "--category-map-decisions-dir or --category-map-decisions is required for category-map projection.",
    );
  }
  return fs
    .readdirSync(decisionsDir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => path.join(decisionsDir, name));
}

function completedCategoryMapDecision(row) {
  return asText(row?.decision_status ?? row?.decisionStatus ?? row?.status) === "completed";
}

function categoryMapDecisionCode(row) {
  return asText(row?.selected_code ?? row?.selectedCode ?? row?.code);
}

function readCategoryMapDecisions(rawOptions, processSchema) {
  const files = categoryMapDecisionFiles(rawOptions);
  const byCategory = new Map();
  const rows = [];
  for (const filePath of files) {
    for (const [lineIndex, row] of readJsonLines(filePath).entries()) {
      const categoryKey = categoryKeyForMapDecision(row);
      const enriched = {
        row,
        categoryKey,
        file: filePath,
        lineIndex: lineIndex + 1,
      };
      rows.push(enriched);
      if (!categoryKey) continue;
      const entry = byCategory.get(categoryKey) ?? [];
      entry.push(enriched);
      byCategory.set(categoryKey, entry);
    }
  }

  const resolved = new Map();
  const manualReview = [];
  for (const [categoryKey, decisionRows] of byCategory.entries()) {
    const completedRows = decisionRows.filter(({ row }) => completedCategoryMapDecision(row));
    if (completedRows.length === 0) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_not_completed",
        decision_rows: decisionRows.map(({ file, lineIndex, row }) => ({
          file: repoRelative(file),
          line: lineIndex,
          decision_status: asText(row?.decision_status ?? row?.status) || null,
          basis: truncateText(row?.basis),
        })),
        required_human_action:
          "Provide a completed category-map decision with a valid TIDAS process leaf code.",
      });
      continue;
    }
    const uniqueCodes = [...new Set(completedRows.map(({ row }) => categoryMapDecisionCode(row)))];
    if (uniqueCodes.length !== 1) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_conflict",
        selected_codes: uniqueCodes,
        decision_rows: completedRows.map(({ file, lineIndex, row }) => ({
          file: repoRelative(file),
          line: lineIndex,
          selected_code: categoryMapDecisionCode(row) || null,
          basis: truncateText(row?.basis),
        })),
        required_human_action:
          "Resolve conflicting category-map decisions to one TIDAS process leaf code.",
      });
      continue;
    }
    const code = uniqueCodes[0];
    const schemaEntry = processSchema.byCode.get(code);
    if (!code || !processSchema.leafCodes.has(code) || !schemaEntry) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_code_invalid",
        selected_code: code || null,
        decision_rows: completedRows.map(({ file, lineIndex }) => ({
          file: repoRelative(file),
          line: lineIndex,
        })),
        required_human_action:
          "Replace the selected code with a valid TIDAS process leaf code from the process category schema.",
      });
      continue;
    }
    const chosen = completedRows[0];
    const contextBundleSha256 = asText(chosen.row?.authoring_context?.context_bundle_sha256);
    if (!contextBundleSha256) {
      manualReview.push({
        schema_version: 1,
        category_key: categoryKey,
        status: "manual_review",
        reason: "category_map_decision_context_bundle_missing",
        selected_code: code,
        decision_rows: completedRows.map(({ file, lineIndex }) => ({
          file: repoRelative(file),
          line: lineIndex,
        })),
        required_human_action:
          "Regenerate this category-map decision from an exact AI task bundle and include authoring_context.context_bundle_sha256 before projection.",
      });
      continue;
    }
    resolved.set(categoryKey, {
      categoryKey,
      code,
      label: schemaEntry.label,
      schemaLevel: schemaEntry.level,
      row: chosen.row,
      file: chosen.file,
      lineIndex: chosen.lineIndex,
    });
  }
  return {
    files,
    rows,
    resolved,
    manualReview,
  };
}

function projectedClassificationDecision({ task, categoryKey, decision }) {
  const processId = asText(task.dataset_id);
  const processVersion = asText(task.dataset_version) || "00.00.001";
  return {
    schema_version: 1,
    dataset_type: "process",
    dataset_id: processId,
    dataset_version: processVersion,
    entity_key: task.entity_key ?? entityKey("process", processId, processVersion),
    category_type: "process",
    decision_status: "completed",
    selected_code: decision.code,
    code: decision.code,
    selected_label: decision.label ?? (asText(decision.row?.selected_label) || null),
    basis:
      asText(decision.row?.basis) ||
      `Projected from completed BAFU source category mapping ${categoryKey}.`,
    confidence: asText(decision.row?.confidence) || null,
    authoring_context: decision.row?.authoring_context ?? null,
    classification_decision_level: "leaf",
    source_name: task.process_context?.name ?? null,
    converted_classification_reference: task.process_context?.converted_classification_path ?? null,
    converted_classification_reference_policy: "weak_hint_only",
    used_context_kinds: [
      ...new Set([
        ...ensureArray(decision.row?.used_context_kinds),
        "library_entity_index",
        "scope_projection",
        "blocked_scope_ledger",
        "process_payload_context",
        "process_exchange_context",
        "bafu_category_map_decision",
        "tidas_process_category_schema",
      ]),
    ],
    evidence: {
      source: "bafu_process_leaf_category_map_projection",
      category_key: categoryKey,
      category_decision: {
        file: repoRelative(decision.file),
        line: decision.lineIndex,
        selected_code: decision.code,
        selected_label: decision.label ?? (asText(decision.row?.selected_label) || null),
        basis: truncateText(decision.row?.basis),
        confidence: asText(decision.row?.confidence) || null,
        category_semantics: truncateText(decision.row?.evidence?.category_semantics),
        examples_used: ensureArray(decision.row?.evidence?.examples_used),
      },
      task: {
        task_id: task.task_id ?? null,
        process_id: processId,
        process_version: processVersion,
        source_file: task.library_index_context?.root_process_file ?? null,
        bundle_process_file: task.library_index_context?.bundle_process_file ?? null,
        payload_sha256: task.library_index_context?.payload_sha256 ?? null,
        name_parts: task.process_context?.name_parts ?? null,
        source_classification: sourceClassificationFromTask(task),
        output_flows: task.exchange_context?.output_flows ?? null,
      },
      broad_decision_replaced:
        task.decision_template?.evidence?.broad_decision_replaced ??
        task.existing_library_decision ??
        null,
    },
  };
}

function normalizedTaskProcessName(task) {
  return normalizedText(task?.process_context?.name).replace(/^x{1,3}\s+/u, "");
}

function taskSourceTraceText(task) {
  const trace = task?.process_context?.source_trace ?? {};
  const attrs = trace.reference_function_attributes ?? {};
  return normalizedText(
    [
      task?.process_context?.name,
      task?.process_context?.general_comment,
      attrs.name,
      attrs.localName,
      attrs.unit,
      attrs.category,
      attrs.subCategory,
      attrs.localCategory,
      attrs.localSubCategory,
      attrs.includedProcesses,
      trace.source_classification?.category,
      trace.source_classification?.subCategory,
      trace.source_classification?.localCategory,
      trace.source_classification?.localSubCategory,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function taskReferenceUnit(task) {
  return normalizedText(
    task?.process_context?.source_trace?.reference_function_attributes?.unit ??
      task?.process_context?.name_parts?.functional_unit_flow_properties,
  );
}

function processLeafRepairRule(task) {
  const sourceName = normalizedTaskProcessName(task);
  const evidenceText = taskSourceTraceText(task);
  const unit = taskReferenceUnit(task);
  const startsWith = (pattern) => pattern.test(sourceName);
  const contains = (pattern) => pattern.test(evidenceText);
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

function repairProcessLeafDecision({ task, categoryKey, existingDecision, processSchema }) {
  const repair = processLeafRepairRule(task);
  if (!repair) return null;
  const schemaEntry = processSchema.byCode.get(repair.code);
  if (!processSchema.leafCodes.has(repair.code) || !schemaEntry) return null;
  const processId = asText(task.dataset_id);
  const processVersion = asText(task.dataset_version) || "00.00.001";
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
    source_name: task.process_context?.name ?? null,
    converted_classification_reference: task.process_context?.converted_classification_path ?? null,
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
      source_name: task.process_context?.name ?? null,
      selected_code: repair.code,
      selected_label: schemaEntry.label,
      task: {
        task_id: task.task_id ?? null,
        process_id: processId,
        process_version: processVersion,
        source_file: task.library_index_context?.root_process_file ?? null,
        bundle_process_file: task.library_index_context?.bundle_process_file ?? null,
        payload_sha256: task.library_index_context?.payload_sha256 ?? null,
        name_parts: task.process_context?.name_parts ?? null,
        source_classification: sourceClassificationFromTask(task),
        reference_unit: taskReferenceUnit(task) || null,
        output_flows: task.exchange_context?.output_flows ?? null,
      },
      broad_decision_replaced: existingDecision ?? null,
      guard_conditions: {
        normalized_source_name: normalizedTaskProcessName(task),
        normalized_reference_unit: taskReferenceUnit(task) || null,
      },
    },
  };
}

function buildDecisionTemplate({
  processId,
  processVersion,
  key,
  entityRow,
  existingDecision,
  taskId,
}) {
  return {
    schema_version: 1,
    dataset_type: "process",
    dataset_id: processId,
    dataset_version: processVersion,
    entity_key: key,
    category_type: "process",
    decision_status: "completed",
    selected_code: "__AI_SELECT_TIDAS_PROCESS_LEAF_CODE__",
    basis: "__AI_FILL_PROCESS_LEAF_CLASSIFICATION_BASIS__",
    confidence: "__AI_FILL_CONFIDENCE_high_medium_low__",
    classification_decision_level: "leaf",
    source_name: entityRow?.name ?? existingDecision?.source_name ?? null,
    converted_classification_reference:
      entityRow?.classification_path ??
      existingDecision?.converted_classification_reference ??
      null,
    required_resolution:
      "Select a full TIDAS process leaf code from process category context. Converted classifications and broad section decisions are weak hints only.",
    used_context_kinds: [
      "library_entity_index",
      "scope_projection",
      "blocked_scope_ledger",
      "process_payload_context",
      "process_exchange_context",
      "tidas_process_category_schema",
    ],
    evidence: {
      source: "bafu_process_leaf_classification_authoring_task",
      task_id: taskId,
      broad_decision_replaced: compactExistingDecision(existingDecision),
      source_file: entityRow?.source_file ?? null,
      source_files: ensureArray(entityRow?.source_files),
      payload_sha256: entityRow?.payload_sha256 ?? null,
      semantic_key: entityRow?.semantic_key ?? null,
    },
  };
}

function buildTaskRow({ ledgerRow, entityRow, scopeRow, existingDecision, options }) {
  const processId = asText(ledgerRow.blocked_process_id ?? ledgerRow.blocking_dependency?.id);
  const processVersion = asText(
    ledgerRow.blocked_process_version ?? ledgerRow.blocking_dependency?.version,
  );
  const key = entityKey("process", processId, processVersion);
  const processContext =
    readOptionalProcessContext(scopeRow?.process_file) ??
    readOptionalProcessContext(entityRow?.source_file) ??
    {};
  const exchangeRefs = ensureArray(scopeRow?.usage_refs?.process_exchange_flow_refs);
  const outputRefs = exchangeRefs.filter(
    (item) => asText(item?.direction).toLowerCase() === "output",
  );
  const taskId = key;

  return {
    schema_version: 1,
    task_kind: "bafu_process_leaf_classification_authoring",
    task_id: taskId,
    status: "needs_leaf_classification_decision",
    dataset_type: "process",
    dataset_id: processId,
    dataset_version: processVersion,
    entity_key: key,
    blocked_scope: {
      blocked_process_id: processId,
      blocked_process_version: processVersion,
      reason: ledgerRow.reason ?? null,
      message: ledgerRow.message ?? null,
      required_human_action: ledgerRow.required_human_action ?? null,
      rerun_command: ledgerRow.rerun_command ?? null,
    },
    library_index_context: {
      entity_row_found: Boolean(entityRow),
      scope_projection_found: Boolean(scopeRow),
      root_process_file: entityRow?.source_file ?? null,
      bundle_process_file: scopeRow?.process_file ?? null,
      bundle_dir: scopeRow?.bundle_dir ?? null,
      manifest: scopeRow?.manifest ?? null,
      tidas_dir: scopeRow?.tidas_dir ?? null,
      payload_sha256: entityRow?.payload_sha256 ?? null,
      semantic_key: entityRow?.semantic_key ?? null,
      semantic_hash: entityRow?.semantic_hash ?? null,
      estimated_weight: scopeRow?.estimated_weight ?? null,
      dependency_counts: dependencyCounts(scopeRow),
    },
    process_context: {
      name: entityRow?.name ?? processContext.name_parts?.base_name ?? null,
      name_parts: processContext.name_parts ?? null,
      converted_classification_path:
        entityRow?.classification_path ?? processContext.converted_classification_path ?? null,
      converted_classification_classes: processContext.converted_classification_classes ?? [],
      converted_classification_policy: "weak_hint_only",
      general_comment: processContext.general_comment ?? null,
      source_trace: processContext.source_trace ?? null,
    },
    reference_context: processReferences(entityRow, options.maxReferences),
    exchange_context: {
      output_flows: limitRows(outputRefs, options.maxExchangeRefs),
      exchange_flow_refs: limitRows(exchangeRefs, options.maxExchangeRefs),
    },
    existing_library_decision: compactExistingDecision(existingDecision),
    authoring_requirement: {
      output_jsonl: "classification-decisions.jsonl",
      category_type: "process",
      required_decision_status: "completed",
      required_leaf_code: true,
      broad_code_policy:
        "Reject single-letter section codes and short process section/division/group codes.",
      preserve_source_classification_as_evidence: true,
      do_not_edit_rows_directly: true,
      deterministic_rerun:
        "node scripts/foundry.mjs dataset-library-decisions-apply --library-index <library-index> --decisions-dir <decisions-dir> --out-dir <library-resolution>",
    },
    decision_template: buildDecisionTemplate({
      processId,
      processVersion,
      key,
      entityRow,
      existingDecision,
      taskId,
    }),
  };
}

export function prepareBafuLeafClassificationTasks(rawOptions) {
  if (rawOptions.help) {
    return {
      schema_version: 1,
      status: "help",
      command: prepareCommandName,
      usage: [
        "node scripts/foundry.mjs dataset-bafu-leaf-classification-tasks-prepare --library-index <library-index-dir> --blocked-ledger <blocked-scope-ledger.jsonl> --out-dir <task-dir> [--library-decisions <classification-decisions.jsonl>] [--shard-size 100]",
      ],
      purpose:
        "Prepare sharded AI authoring tasks for BAFU process classifications blocked by leaf gating.",
    };
  }

  const libraryIndexInput = rawOptions.libraryIndex || rawOptions.index;
  const blockedLedgerPath = resolveRepoPath(rawOptions.blockedLedger || rawOptions.ledger);
  if (!libraryIndexInput) throw new Error("--library-index is required.");
  if (!blockedLedgerPath || !fs.existsSync(blockedLedgerPath)) {
    throw new Error("--blocked-ledger must point to blocked-scope-ledger.jsonl.");
  }
  const { indexDir, entityIndex, scopeProjection } = libraryIndexPaths(libraryIndexInput);
  if (!fs.existsSync(entityIndex) || !fs.existsSync(scopeProjection)) {
    throw new Error(
      "--library-index must contain library-entity-index.jsonl and scope-projection.jsonl.",
    );
  }

  const outDir = resolveRepoPath(
    rawOptions.outDir || ".foundry/workspaces/bafu-leaf-classification-authoring",
  );
  const shardSize = positiveIntegerOption(rawOptions.shardSize, DEFAULT_SHARD_SIZE);
  const offset = Math.max(0, integerOption(rawOptions.offset, 0));
  const limit = integerOption(rawOptions.limit, null);
  const options = {
    maxExchangeRefs: positiveIntegerOption(rawOptions.maxExchangeRefs, DEFAULT_MAX_EXCHANGE_REFS),
    maxReferences: positiveIntegerOption(rawOptions.maxReferences, DEFAULT_MAX_REFERENCES),
  };

  const entityRows = readJsonLines(entityIndex);
  const scopeRows = readJsonLines(scopeProjection);
  const blockedRows = readJsonLines(blockedLedgerPath);
  const decisionsPath = resolveRepoPath(rawOptions.libraryDecisions || rawOptions.decisions);
  const decisionRows =
    decisionsPath && fs.existsSync(decisionsPath) ? readJsonLines(decisionsPath) : [];

  const processEntities = new Map(
    entityRows
      .filter((row) => row.dataset_type === "process")
      .map((row) => [entityKey("process", row.dataset_id, row.dataset_version), row]),
  );
  const scopes = new Map(
    scopeRows.map((row) => [
      entityKey("process", row.process_id, row.process_version ?? "00.00.001"),
      row,
    ]),
  );
  const decisions = new Map(
    decisionRows
      .filter((row) => row.dataset_type === "process" || row.category_type === "process")
      .map((row) => [
        decisionKey("process", row.dataset_id ?? row.id, row.dataset_version ?? row.version),
        row,
      ]),
  );
  const blockedByProcess = new Map();
  for (const row of blockedRows) {
    if (row.reason !== "process_classification_requires_leaf_authoring") continue;
    const processId = asText(row.blocked_process_id ?? row.blocking_dependency?.id);
    const processVersion = asText(
      row.blocked_process_version ?? row.blocking_dependency?.version ?? "00.00.001",
    );
    if (!processId) continue;
    const key = entityKey("process", processId, processVersion);
    if (!blockedByProcess.has(key)) blockedByProcess.set(key, row);
  }

  const selectedBlocked = [...blockedByProcess.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(offset, limit === null ? undefined : offset + Math.max(0, limit));
  const tasks = selectedBlocked.map(([key, ledgerRow]) => {
    const processId = asText(ledgerRow.blocked_process_id ?? ledgerRow.blocking_dependency?.id);
    const processVersion = asText(
      ledgerRow.blocked_process_version ?? ledgerRow.blocking_dependency?.version ?? "00.00.001",
    );
    return buildTaskRow({
      ledgerRow,
      entityRow: processEntities.get(key),
      scopeRow: scopes.get(key),
      existingDecision: decisions.get(decisionKey("process", processId, processVersion)),
      options,
    });
  });

  const taskIndexPath = path.join(outDir, "leaf-process-classification-tasks.jsonl");
  const templatePath = path.join(outDir, "classification-decisions.template.jsonl");
  const reportPath = path.join(outDir, "leaf-process-classification-task-report.json");
  const shardsDir = path.join(outDir, "shards");
  writeJsonLines(taskIndexPath, tasks);
  writeJsonLines(
    templatePath,
    tasks.map((task) => task.decision_template),
  );

  const shards = [];
  for (let start = 0; start < tasks.length; start += shardSize) {
    const shardIndex = Math.floor(start / shardSize);
    const shardId = String(shardIndex).padStart(4, "0");
    const shardTasks = tasks.slice(start, start + shardSize);
    const shardTaskPath = path.join(
      shardsDir,
      `leaf-process-classification-tasks-${shardId}.jsonl`,
    );
    const shardTemplatePath = path.join(
      shardsDir,
      `classification-decisions-${shardId}.template.jsonl`,
    );
    writeJsonLines(shardTaskPath, shardTasks);
    writeJsonLines(
      shardTemplatePath,
      shardTasks.map((task) => task.decision_template),
    );
    shards.push({
      shard_id: shardId,
      task_count: shardTasks.length,
      tasks: repoRelative(shardTaskPath),
      template: repoRelative(shardTemplatePath),
    });
  }

  const missingEntityRows = tasks.filter((task) => !task.library_index_context.entity_row_found);
  const missingScopeRows = tasks.filter(
    (task) => !task.library_index_context.scope_projection_found,
  );
  const report = {
    schema_version: 1,
    generated_at_utc: runtime().nowIso(),
    status:
      tasks.length === 0
        ? "ready_no_leaf_classification_blockers"
        : missingEntityRows.length || missingScopeRows.length
          ? "completed_with_context_gaps"
          : "completed",
    command: prepareCommandName,
    inputs: {
      library_index: repoRelative(indexDir),
      library_entity_index: repoRelative(entityIndex),
      scope_projection: repoRelative(scopeProjection),
      blocked_ledger: repoRelative(blockedLedgerPath),
      library_decisions:
        decisionsPath && fs.existsSync(decisionsPath) ? repoRelative(decisionsPath) : null,
    },
    input_hashes: {
      library_entity_index_sha256: sha256File(entityIndex),
      scope_projection_sha256: sha256File(scopeProjection),
      blocked_ledger_sha256: sha256File(blockedLedgerPath),
      library_decisions_sha256:
        decisionsPath && fs.existsSync(decisionsPath) ? sha256File(decisionsPath) : null,
    },
    counts: {
      blocked_ledger_rows: blockedRows.length,
      unique_leaf_classification_blocked_processes: blockedByProcess.size,
      selected_tasks: tasks.length,
      shards: shards.length,
      missing_library_entity_rows: missingEntityRows.length,
      missing_scope_projection_rows: missingScopeRows.length,
      attached_existing_library_decisions: tasks.filter((task) => task.existing_library_decision)
        .length,
    },
    selection: {
      offset,
      limit,
      shard_size: shardSize,
      max_exchange_refs_per_task: options.maxExchangeRefs,
      max_references_per_task: options.maxReferences,
    },
    files: {
      report: repoRelative(reportPath),
      tasks: repoRelative(taskIndexPath),
      template: repoRelative(templatePath),
      shards,
    },
    expected_ai_output: {
      file: "classification-decisions.jsonl",
      row_contract:
        "One completed process decision per task with dataset_type, dataset_id, dataset_version, category_type=process, selected_code=<TIDAS process leaf code>, basis, confidence, classification_decision_level=leaf, authoring_context.context_bundle_sha256, used_context_kinds, and structured evidence.",
      broad_codes_rejected: true,
    },
    next_step:
      "Merge completed shard decisions into the library decisions directory, rerun dataset-library-decisions-apply, then continue only ready scopes.",
  };
  writeJson(reportPath, report);
  return report;
}

export function projectBafuLeafCategoryMapDecisions(rawOptions) {
  if (rawOptions.help) {
    return {
      schema_version: 1,
      status: "help",
      command: projectCommandName,
      usage: [
        "node scripts/foundry.mjs dataset-bafu-leaf-classification-category-map-project --task-dir <leaf-authoring-dir> --category-map-decisions-dir <category-map-decisions-dir> --source-decisions-dir <run-dir>/decisions --out-dir <run-dir>/decisions-v4-leaf-category-map --process-category-schema <tidas_processes_category.json> [--flow-product-category-schema <tidas_flows_product_category.json>]",
      ],
      purpose:
        "Project task-bound BAFU category-cluster process leaf decisions into library-level classification-decisions.jsonl, while writing rule-derived suggestions only as non-authoritative candidate rows.",
    };
  }

  const taskDir = resolveRepoPath(rawOptions.taskDir || rawOptions.authoringDir);
  const tasksPath = resolveRepoPath(
    rawOptions.tasks ||
      rawOptions.leafTasks ||
      (taskDir ? path.join(taskDir, "leaf-process-classification-tasks.jsonl") : null),
  );
  if (!tasksPath || !fs.existsSync(tasksPath)) {
    throw new Error(
      "--task-dir or --tasks is required and must point to leaf-process-classification-tasks.jsonl.",
    );
  }
  const sourceDecisionsDir = resolveRepoPath(
    rawOptions.sourceDecisionsDir ||
      rawOptions.baseDecisionsDir ||
      rawOptions.libraryDecisionsDir ||
      rawOptions.decisionsDir,
  );
  if (!sourceDecisionsDir || !fs.existsSync(sourceDecisionsDir)) {
    throw new Error(
      "--source-decisions-dir must point to the current library decisions directory.",
    );
  }
  const outDir = resolveRepoPath(
    rawOptions.outDir || path.join(path.dirname(sourceDecisionsDir), "decisions-leaf-projected"),
  );
  const processSchema = loadProcessCategorySchema(rawOptions.processCategorySchema);
  const flowProductSchema = loadFlowProductCategorySchema(rawOptions.flowProductCategorySchema);
  const tasks = readJsonLines(tasksPath);
  const originalClassificationPath = path.join(
    sourceDecisionsDir,
    "classification-decisions.jsonl",
  );
  const originalClassificationRows = fs.existsSync(originalClassificationPath)
    ? readJsonLines(originalClassificationPath)
    : [];
  const categoryMap = readCategoryMapDecisions(rawOptions, processSchema);

  const originalByKey = new Map(
    originalClassificationRows.map((row) => [classificationLibraryKey(row), row]),
  );
  const projectedRows = [];
  const projectionManualReview = [];
  const processLeafCandidates = [];
  const flowProductCandidates = [];
  const flowProductManualReview = [];
  const categoriesSeenByTasks = new Map();

  for (const task of tasks) {
    const categoryKey = categoryKeyForLeafTask(task);
    if (!categoriesSeenByTasks.has(categoryKey)) {
      categoriesSeenByTasks.set(categoryKey, {
        category_key: categoryKey || null,
        affected_process_count: 0,
        examples: [],
      });
    }
    const categorySummary = categoriesSeenByTasks.get(categoryKey);
    categorySummary.affected_process_count += 1;
    if (categorySummary.examples.length < 8) {
      categorySummary.examples.push({
        dataset_id: task.dataset_id,
        dataset_version: task.dataset_version,
        name: task.process_context?.name ?? null,
      });
    }

    const processKey = classificationLibraryKey({
      dataset_type: "process",
      dataset_id: task.dataset_id,
      dataset_version: task.dataset_version,
      category_type: "process",
    });
    const decision = categoryMap.resolved.get(categoryKey);
    if (!decision) {
      const repaired = repairProcessLeafDecision({
        task,
        categoryKey,
        existingDecision: compactExistingDecision(originalByKey.get(processKey)),
        processSchema,
      });
      if (repaired) {
        const candidate = classificationRepairCandidate(repaired, {
          candidateType: "process_leaf",
          ruleSource: "bafu_process_leaf_repair",
        });
        processLeafCandidates.push(candidate);
      }
      projectionManualReview.push({
        schema_version: 1,
        status: "manual_review",
        reason: repaired
          ? "category_map_decision_missing_with_rule_candidate"
          : categoryKey
            ? "category_map_decision_missing_or_unresolved"
            : "task_source_category_key_missing",
        category_key: categoryKey || null,
        dataset_type: "process",
        dataset_id: task.dataset_id,
        dataset_version: task.dataset_version,
        source_classification: sourceClassificationFromTask(task),
        existing_decision: compactExistingDecision(originalByKey.get(processKey)),
        candidate_decision: repaired
          ? {
              selected_code: repaired.selected_code,
              selected_label: repaired.selected_label,
              repair_rule: repaired.evidence?.repair_rule ?? null,
              candidate_file: "process-leaf-classification-candidates.jsonl",
            }
          : null,
        required_human_action:
          "Provide a completed task-bound category-map/process leaf decision with authoring_context.context_bundle_sha256, then rerun projection and library decisions apply.",
      });
      continue;
    }
    const projected = projectedClassificationDecision({ task, categoryKey, decision });
    originalByKey.set(processKey, projected);
    projectedRows.push(projected);
  }

  for (const [decisionKey, decision] of [...originalByKey.entries()]) {
    if (!classificationDecisionIsBroadFlowProduct(decision)) continue;
    const repaired = repairBroadFlowProductDecision(decision, flowProductSchema);
    if (repaired) {
      flowProductCandidates.push(
        classificationRepairCandidate(repaired, {
          candidateType: "flow_product_leaf",
          ruleSource: "bafu_flow_product_leaf_repair",
        }),
      );
    }
    flowProductManualReview.push({
      schema_version: 1,
      status: "manual_review",
      reason: repaired
        ? "flow_product_classification_decision_not_leaf_with_rule_candidate"
        : "flow_product_classification_decision_not_leaf",
      decision_key: decisionKey,
      dataset_type: decision.dataset_type ?? "flow",
      dataset_id: decision.dataset_id ?? null,
      dataset_version: decision.dataset_version ?? null,
      category_type: decision.category_type ?? "flow-product",
      selected_code: decision.selected_code ?? decision.code ?? null,
      existing_decision: compactExistingDecision(decision),
      candidate_decision: repaired
        ? {
            selected_code: repaired.selected_code,
            selected_label: repaired.selected_label,
            repair_rule: repaired.evidence?.repair_rule ?? null,
            candidate_file: "flow-product-classification-candidates.jsonl",
          }
        : null,
      required_human_action:
        "Replace the broad flow-product classification with a full TIDAS flow-product leaf code selected through dataset classification children/path, include authoring_context.context_bundle_sha256, then rerun this projection.",
    });
    originalByKey.delete(decisionKey);
  }

  const classificationRows = [...originalByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => row);
  const classificationOut = path.join(outDir, "classification-decisions.jsonl");
  const manualReviewOut = path.join(outDir, "classification-decisions.manual-review.jsonl");
  const processLeafCandidatesOut = path.join(
    outDir,
    "process-leaf-classification-candidates.jsonl",
  );
  const flowProductCandidatesOut = path.join(
    outDir,
    "flow-product-classification-candidates.jsonl",
  );
  const categoryManualReviewOut = path.join(outDir, "category-map-decisions.manual-review.jsonl");
  const reportPath = path.join(outDir, "bafu-leaf-category-map-project-report.json");

  writeJsonLines(classificationOut, classificationRows);
  writeJsonLines(manualReviewOut, [...projectionManualReview, ...flowProductManualReview]);
  writeJsonLines(processLeafCandidatesOut, processLeafCandidates);
  writeJsonLines(flowProductCandidatesOut, flowProductCandidates);
  const categoryManualReview = [
    ...categoryMap.manualReview,
    ...[...categoriesSeenByTasks.values()]
      .filter(
        (category) => category.category_key && !categoryMap.resolved.has(category.category_key),
      )
      .map((category) => ({
        schema_version: 1,
        status: "manual_review",
        reason: "category_map_decision_missing_or_unresolved",
        ...category,
        required_human_action:
          "Provide a completed task-bound category-map process leaf decision for this BAFU source category.",
      })),
  ];
  writeJsonLines(categoryManualReviewOut, categoryManualReview);

  const copiedDecisionFiles = [];
  for (const fileName of ["identity-decisions.jsonl", "canonical-support-mappings.jsonl"]) {
    const copied = copyFileIfExists(
      path.join(sourceDecisionsDir, fileName),
      path.join(outDir, fileName),
    );
    if (copied) copiedDecisionFiles.push(fileName);
  }

  const report = {
    schema_version: 1,
    generated_at_utc: runtime().nowIso(),
    status:
      projectionManualReview.length > 0 || flowProductManualReview.length > 0
        ? "completed_with_manual_review"
        : "completed",
    command: projectCommandName,
    inputs: {
      tasks: repoRelative(tasksPath),
      source_decisions_dir: repoRelative(sourceDecisionsDir),
      process_category_schema: repoRelative(processSchema.path),
      flow_product_category_schema: repoRelative(flowProductSchema.path),
      category_map_decisions: categoryMap.files.map(repoRelative),
    },
    input_hashes: {
      tasks_sha256: sha256File(tasksPath),
      process_category_schema_sha256: sha256File(processSchema.path),
      flow_product_category_schema_sha256: sha256File(flowProductSchema.path),
      classification_decisions_sha256: fs.existsSync(originalClassificationPath)
        ? sha256File(originalClassificationPath)
        : null,
      category_map_decisions_sha256: categoryMap.files.map((filePath) => ({
        file: repoRelative(filePath),
        sha256: sha256File(filePath),
      })),
    },
    counts: {
      tasks: tasks.length,
      task_categories: categoriesSeenByTasks.size,
      process_category_schema_entries: processSchema.entries.length,
      process_category_leaf_codes: processSchema.leafCodes.size,
      flow_product_category_schema_entries: flowProductSchema.entries.length,
      flow_product_category_leaf_codes: flowProductSchema.leafCodes.size,
      original_classification_decisions: originalClassificationRows.length,
      category_map_decision_rows: categoryMap.rows.length,
      category_map_resolved: categoryMap.resolved.size,
      category_map_manual_review: categoryMap.manualReview.length,
      projected_process_decisions: projectedRows.length,
      process_leaf_classification_candidates: processLeafCandidates.length,
      flow_product_classification_candidates: flowProductCandidates.length,
      classification_decisions_out: classificationRows.length,
      projection_manual_review_rows: projectionManualReview.length + flowProductManualReview.length,
      flow_product_manual_review_rows: flowProductManualReview.length,
      category_manual_review_rows: categoryManualReview.length,
    },
    copied_decision_files: copiedDecisionFiles,
    policy: {
      tidas_tools_classification_policy: "weak_hint_only",
      ai_decision_boundary:
        "Category-map decisions are semantic AI choices. This command validates task-bound leaf codes and deterministically projects only those choices; BAFU repair rules are emitted as non-authoritative candidates.",
      manual_review_policy:
        "Unresolved, missing, conflicting, invalid, unbound, or rule-candidate-only category decisions are not projected; affected process scopes remain blocked_deferred on the next library decisions apply.",
    },
    files: {
      report: repoRelative(reportPath),
      classification_decisions: repoRelative(classificationOut),
      projection_manual_review: repoRelative(manualReviewOut),
      process_leaf_classification_candidates: repoRelative(processLeafCandidatesOut),
      flow_product_classification_candidates: repoRelative(flowProductCandidatesOut),
      category_manual_review: repoRelative(categoryManualReviewOut),
      copied_decision_files: copiedDecisionFiles.map((fileName) =>
        repoRelative(path.join(outDir, fileName)),
      ),
    },
    next_step:
      "Run dataset-library-decisions-apply with this output directory, then continue only ready scopes.",
  };
  writeJson(reportPath, report);
  return report;
}

export function createBafuLeafClassificationTaskCommands(deps) {
  installBafuLeafRuntime(deps);
  return {
    runDatasetBafuLeafClassificationTasksPrepare: prepareBafuLeafClassificationTasks,
    runDatasetBafuLeafClassificationCategoryMapProject: projectBafuLeafCategoryMapDecisions,
  };
}
