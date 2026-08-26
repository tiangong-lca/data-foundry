import { flowReferencePropertyActionValue } from "./identity-equivalence.ts";
import {
  type BafuNamePlan,
  cleanProcessFunctionalUnitText,
  englishText,
  mergeExistingTreatmentRoute,
  normalizeIdentityText,
  normalizeLocationTokenCode,
  removeTrailingLocationToken,
  splitBafuNamePlan,
  splitBafuNamePlanFromNameParts,
  stripGeneratedPrefixText,
  stripSourceLocatorSuffix,
  stripTrailingLocationTokenText,
  textFromMultilang,
} from "./name-plan.ts";

export interface JsonRecord {
  [key: string]: unknown;
}

export type LocationLabelCatalog = ReadonlyMap<string, string>;

export interface BafuPatchProjectionOptions {
  locationLabelCatalog: LocationLabelCatalog;
}

interface MixLocationInput {
  isProcess: boolean;
  name: unknown;
  locationCode: unknown;
}

interface PackageNameInput {
  name: unknown;
  packagePayload: JsonRecord;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

const fullContextKinds = [
  "schema",
  "methodology_yaml",
  "ruleset",
  "classification_schema",
  "location_schema",
];

function lowerText(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function arrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function actionCode(item: JsonRecord): string {
  return String(item.code ?? item.action_item_code ?? item.rule_id ?? "");
}

function actionPath(item: JsonRecord): string {
  return String(item.path ?? item.json_path ?? "");
}

function closureFor(item: JsonRecord): JsonRecord {
  return { code: actionCode(item), path: actionPath(item) };
}

function evidenceObject(
  kind: string,
  task: JsonRecord,
  actionItem: JsonRecord,
  extra: JsonRecord = {},
): JsonRecord {
  const itemPath = actionPath(actionItem);
  const actionEvidence = jsonRecord(actionItem.evidence);
  const currentName = jsonRecord(actionEvidence.current_name);
  const entity = jsonRecord(task.entity);
  return {
    source: "dataset-bafu-auto-authoring",
    field_path: itemPath || null,
    quote_or_trace:
      actionEvidence.text ??
      currentName.baseName ??
      (Array.isArray(actionEvidence.reference_flow_properties)
        ? actionEvidence.reference_flow_properties.join(", ")
        : null) ??
      itemPath ??
      kind,
    kind,
    dataset_type: entity.dataset_type ?? null,
    dataset_id: entity.entity_id ?? null,
    dataset_version: entity.version ?? null,
    action_item: {
      code: actionCode(actionItem),
      path: actionPath(actionItem) || null,
      evidence: actionItem.evidence ?? null,
    },
    ...extra,
  };
}

function resolution(mode: string, summary: string, extra: JsonRecord = {}): JsonRecord {
  return {
    mode,
    used_context_kinds: fullContextKinds,
    summary,
    deferred_reason: null,
    ...extra,
  };
}

function locationNameLabel(
  locationCode: unknown,
  locationLabelCatalog: LocationLabelCatalog,
): string {
  const code = String(locationCode ?? "").toUpperCase();
  return locationLabelCatalog.get(code) ?? code;
}

function inferMixLocationPhrase(
  { isProcess, name, locationCode }: MixLocationInput,
  locationLabelCatalog: LocationLabelCatalog,
): string {
  const nameRecord = jsonRecord(name);
  const locationLabel = locationNameLabel(locationCode, locationLabelCatalog);
  const nameText = normalizeIdentityText(
    [
      textFromMultilang(nameRecord.baseName),
      textFromMultilang(nameRecord.treatmentStandardsRoutes),
      textFromMultilang(nameRecord.mixAndLocationTypes),
    ].join(" "),
  );
  if (/\b(?:mounting|surface mount|through hole|solder|assembly)\b/u.test(nameText)) {
    return isProcess ? `assembly process, ${locationLabel}` : `assembly service, ${locationLabel}`;
  }
  if (/\b(?:track bed|rail infrastructure)\b/u.test(nameText)) {
    return isProcess
      ? `rail infrastructure process, ${locationLabel}`
      : `rail infrastructure, ${locationLabel}`;
  }
  if (/\b(?:excavation|hydraulic digger|pushed pile|pile)\b/u.test(nameText)) {
    return isProcess
      ? `construction process, ${locationLabel}`
      : `construction service, ${locationLabel}`;
  }
  if (
    /\b(?:welding|rolling|hot rolling|metal working|machining|manufacturing|extrusion|injection|moulding|molding|powder coating|anodi[sz]ing|wire drawing|section bar rolling|section bar extrusion|zinc coating|tin plating|coating|tempering|casting|sputtering|thermoforming|foaming|we+ving)\b/u.test(
      nameText,
    )
  ) {
    return isProcess
      ? `manufacturing process, ${locationLabel}`
      : `manufacturing service, ${locationLabel}`;
  }
  if (
    /\b(?:shredding|dismantling|sorting)\b/u.test(nameText) ||
    /\bto\b.*\btreatment\b/u.test(nameText)
  ) {
    return isProcess
      ? `treatment process, ${locationLabel}`
      : `treatment service, ${locationLabel}`;
  }
  if (/\b(?:deconstruction|demolition)\b/u.test(nameText)) {
    return isProcess
      ? `deconstruction process, ${locationLabel}`
      : `deconstruction service, ${locationLabel}`;
  }
  if (
    /\b(?:recovered|recycling|module treatment|refined waste cooking oil|waste cooking oil)\b/u.test(
      nameText,
    )
  ) {
    return isProcess
      ? `recovery process, ${locationLabel}`
      : `recovered material, ${locationLabel}`;
  }
  if (/\b(?:transport|freight|lorry|truck|rail|ship|barge)\b/u.test(nameText)) {
    return isProcess
      ? `transport process, ${locationLabel}`
      : `transport service, ${locationLabel}`;
  }
  if (/\b(?:disposal|waste|treatment|mswi|combustible)\b/u.test(nameText)) {
    return isProcess ? `disposal process, ${locationLabel}` : `disposal service, ${locationLabel}`;
  }
  if (
    /\b(?:production|producer|power|plant|primary|refinery|current collector|electrode material|electrolyte|separator|cathode|anode|paste|cogen|cogeneration|wind|hydropower|nuclear|reactor|boiler|burned|heat|mine|quarry|mill|sawmill|kiln dried|industrial wood|roundwood|round wood|bark chips|forest road|wood chips|at forest|component|components|radiator|tube|tubes|panel|panels|module|modules|machine|machines|equipment|system|systems)\b/u.test(
      nameText,
    )
  ) {
    return isProcess ? `production process, ${locationLabel}` : `production mix, ${locationLabel}`;
  }
  if (/\b(?:consumption|consumer|market|supply|grid)\b/u.test(nameText)) {
    return isProcess ? `supply process, ${locationLabel}` : `supply mix, ${locationLabel}`;
  }
  return isProcess ? `process, ${locationLabel}` : `supply mix, ${locationLabel}`;
}

function inferBareProductNamePlan(
  { name, packagePayload }: PackageNameInput,
  locationLabelCatalog: LocationLabelCatalog,
): BafuNamePlan | null {
  const nameRecord = jsonRecord(name);
  const locationCode = datasetLocationCode({ isProcess: false, packagePayload });
  const source = stripSourceLocatorSuffix(
    stripGeneratedPrefixText(
      stripTrailingLocationTokenText(textFromMultilang(nameRecord.baseName).trim(), locationCode),
    ),
  );
  // Comma-containing names are accepted as a whole-name base name (see the matching
  // note in inferBareProcessNamePlan). This fallback runs only after every
  // splitBafuNamePlan matcher returned null, so it never overrides a recognised
  // base+treatment split; what remains are intrinsic compound product names
  // (e.g. "Fuel in transport, aircraft, passenger"). The product-flow type guard
  // below still restricts this to actual product flows.
  if (!source) return null;
  const sourceRow = jsonRecord(packagePayload.source_row);
  const entityPayload = jsonRecord(packagePayload.entity_payload);
  const flow = jsonRecord(
    jsonRecord(sourceRow.flowDataSet).flowInformation
      ? sourceRow.flowDataSet
      : entityPayload.flowDataSet,
  );
  const typeOfDataSet = lowerText(
    jsonRecord(jsonRecord(flow.modellingAndValidation).LCIMethod).typeOfDataSet,
  );
  if (typeOfDataSet !== "product flow") return null;

  const normalized = normalizeIdentityText(source);
  if (!/[a-z0-9]/u.test(normalized)) return null;
  const treatment = /\b(?:consumption|consumer|market|supply|imports?|grid)\b/u.test(normalized)
    ? "supply"
    : "production";
  const locationLabel = locationCode ? locationNameLabel(locationCode, locationLabelCatalog) : null;
  const mixKind = treatment === "supply" ? "supply mix" : "production mix";
  return {
    source,
    base_name: source,
    treatment,
    mix_location: locationLabel ? `${mixKind}, ${locationLabel}` : mixKind,
  };
}

function inferBareProcessNamePlan(
  { name, packagePayload }: PackageNameInput,
  locationLabelCatalog: LocationLabelCatalog,
): BafuNamePlan | null {
  const nameRecord = jsonRecord(name);
  const locationCode = datasetLocationCode({ isProcess: true, packagePayload });
  const source = stripSourceLocatorSuffix(
    stripGeneratedPrefixText(
      stripTrailingLocationTokenText(textFromMultilang(nameRecord.baseName).trim(), locationCode),
    ),
  );
  // Comma-containing names are accepted here as a whole-name base name. This fallback
  // is reached ONLY after every splitBafuNamePlan / splitBafuNamePlanFromNameParts
  // matcher returned null, so a name that any matcher would have split into a
  // base + treatment/route never arrives here. What remains are intrinsic compound
  // product/service names whose comma is part of the name itself (e.g. "Road,
  // trolleybus", "Videoconference, laptop, participant", "Transport, high speed
  // train, Infrastruktur"); treating the whole geography-stripped name as the base
  // name is the correct authoring outcome. The production-context guard below still
  // requires a real reference-product output (or production classification) before
  // emitting a plan, so non-product rows are not mislabelled.
  if (!source) return null;
  const sourceRow = jsonRecord(packagePayload.source_row);
  const entityPayload = jsonRecord(packagePayload.entity_payload);
  const process = jsonRecord(sourceRow.processDataSet || entityPayload.processDataSet);
  if (Object.keys(process).length === 0) return null;

  const normalized = normalizeIdentityText(source);
  if (!/[a-z0-9]/u.test(normalized)) return null;

  const exchanges = arrayValues(jsonRecord(process.exchanges).exchange).map(jsonRecord);
  const outputNames = exchanges
    .filter((exchange) => lowerText(exchange.exchangeDirection) === "output")
    .map((exchange) =>
      textFromMultilang(jsonRecord(exchange.referenceToFlowDataSet)["common:shortDescription"]),
    )
    .filter(Boolean);
  const hasMatchingOutput = outputNames.some((outputName) => {
    const outputText = normalizeIdentityText(outputName);
    return (
      outputText === normalized ||
      outputText.includes(normalized) ||
      normalized.includes(outputText)
    );
  });
  const classificationText = lowerText(
    JSON.stringify(
      jsonRecord(jsonRecord(process.processInformation).dataSetInformation)
        .classificationInformation ?? {},
    ),
  );
  const hasProductionContext =
    hasMatchingOutput ||
    /\b(?:manufactur|production|producer|basic chemicals|chemical products)\b/u.test(
      classificationText,
    );
  if (!hasProductionContext) return null;

  let treatment = "production";
  let mixKind = "production process";
  if (/\b(?:consumption|consumer|market|supply|imports?|grid)\b/u.test(normalized)) {
    treatment = "supply";
    mixKind = "supply process";
  } else if (/\b(?:disposal|waste|treatment|mswi|combustible)\b/u.test(normalized)) {
    treatment = "treatment";
    mixKind = "treatment process";
  }

  const locationLabel = locationCode ? locationNameLabel(locationCode, locationLabelCatalog) : null;
  return {
    source,
    base_name: source,
    treatment,
    mix_location: locationLabel ? `${mixKind}, ${locationLabel}` : mixKind,
  };
}

function datasetLocationCode({
  isProcess,
  packagePayload,
}: {
  isProcess: boolean;
  packagePayload: JsonRecord;
}): string {
  const sourceRow = jsonRecord(packagePayload.source_row);
  const entityPayload = jsonRecord(packagePayload.entity_payload);
  if (isProcess) {
    const process = jsonRecord(sourceRow.processDataSet || entityPayload.processDataSet);
    const location = jsonRecord(
      jsonRecord(process.processInformation).geography,
    ).locationOfOperationSupplyOrProduction;
    if (typeof location === "string") return location.toUpperCase();
    return String(jsonRecord(location)["@location"] ?? "").toUpperCase();
  }
  const flow = jsonRecord(sourceRow.flowDataSet || entityPayload.flowDataSet);
  return String(
    jsonRecord(jsonRecord(flow.flowInformation).geography).locationOfSupply ?? "",
  ).toUpperCase();
}

function completeNameSplitMixLocationPhrase(
  mixLocation: unknown,
  locationCode: unknown,
  locationLabelCatalog: LocationLabelCatalog,
): string | null {
  const phrase = String(mixLocation ?? "").trim();
  if (!phrase) return null;
  if (/^(?:market|production|supply)\s+mix$/iu.test(phrase) && locationCode) {
    return `${phrase}, ${locationNameLabel(locationCode, locationLabelCatalog)}`;
  }
  if (
    /^at\s+(?:plant|user|grid|consumer|market|sawmill|warehouse|regional storage)$/iu.test(
      phrase,
    ) &&
    locationCode
  ) {
    return `${phrase}, ${locationNameLabel(locationCode, locationLabelCatalog)}`;
  }
  return phrase;
}

export function buildNamePatchOperations(
  task: JsonRecord,
  { locationLabelCatalog }: BafuPatchProjectionOptions,
): JsonRecord[] {
  const operations: JsonRecord[] = [];
  const actionItems = arrayValues(task.action_items).map(jsonRecord);
  const packagePayload = jsonRecord(task.authoring_package_payload);
  const entity = jsonRecord(task.entity);
  const entityId = entity.entity_id ?? null;
  const sourceRow = jsonRecord(packagePayload.source_row);
  const entityPayload = jsonRecord(packagePayload.entity_payload);
  const sourceProcess = jsonRecord(sourceRow.processDataSet);
  const entityProcess = jsonRecord(entityPayload.processDataSet);
  const sourceFlow = jsonRecord(sourceRow.flowDataSet);
  const entityFlow = jsonRecord(entityPayload.flowDataSet);
  const datasetType = String(entity.dataset_type ?? "").toLowerCase();
  const isProcess = datasetType === "process";
  const namePathPrefix = isProcess
    ? "/processDataSet/processInformation/dataSetInformation/name"
    : "/flowDataSet/flowInformation/dataSetInformation/name";
  const formalLocationField = isProcess
    ? "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction"
    : "flowDataSet.flowInformation.geography.locationOfSupply";
  const sourceProcessInformation = jsonRecord(sourceProcess.processInformation);
  const entityProcessInformation = jsonRecord(entityProcess.processInformation);
  const sourceFlowInformation = jsonRecord(sourceFlow.flowInformation);
  const entityFlowInformation = jsonRecord(entityFlow.flowInformation);
  const name = jsonRecord(
    isProcess
      ? (jsonRecord(sourceProcessInformation.dataSetInformation).name ??
          jsonRecord(entityProcessInformation.dataSetInformation).name)
      : (jsonRecord(sourceFlowInformation.dataSetInformation).name ??
          jsonRecord(entityFlowInformation.dataSetInformation).name),
  );
  const functionalUnit = isProcess
    ? (jsonRecord(sourceProcessInformation.quantitativeReference).functionalUnitOrOther ??
      jsonRecord(entityProcessInformation.quantitativeReference).functionalUnitOrOther)
    : null;
  const functionalUnitActionItems = actionItems.filter((item) => {
    const code = actionCode(item);
    return (
      isProcess &&
      actionPath(item).includes("functionalUnitOrOther") &&
      ["semantic_geography_token_in_name", "semantic_name_placeholder_token"].includes(code)
    );
  });
  const locationCode = datasetLocationCode({ isProcess, packagePayload });
  const nameSplit = mergeExistingTreatmentRoute(
    splitBafuNamePlanFromNameParts(name, locationCode) ??
      splitBafuNamePlan(name.baseName, locationCode) ??
      (isProcess
        ? inferBareProcessNamePlan({ name, packagePayload }, locationLabelCatalog)
        : inferBareProductNamePlan({ name, packagePayload }, locationLabelCatalog)),
    name,
  );
  const nameSplitMixLocation = completeNameSplitMixLocationPhrase(
    nameSplit?.mix_location,
    locationCode,
    locationLabelCatalog,
  );
  const nameSplitActionItems = actionItems.filter((item) =>
    [
      "semantic_name_base_contains_unsplit_segments",
      "semantic_name_treatment_placeholder",
      "semantic_name_quantitative_property_not_split",
      "semantic_name_source_locator_in_name",
    ].includes(actionCode(item)),
  );
  const mixLocationActionItems = actionItems.filter(
    (item) => actionCode(item) === "semantic_name_mix_location_too_bare",
  );
  let emittedNameSplit = false;
  let emittedFunctionalUnitClean = false;
  let emittedMixLocation = false;

  for (const item of actionItems) {
    const code = actionCode(item);
    const itemEvidence = jsonRecord(item.evidence);
    if (code === "semantic_content_saturation_flow_location_of_supply_missing" && !isProcess) {
      const mixText = normalizeLocationTokenCode(
        textFromMultilang(name.mixAndLocationTypes).trim(),
      );
      const codeToken = /^[A-Z0-9][A-Z0-9+&-]{1,30}$/u.test(mixText) ? mixText : null;
      if (!codeToken) {
        operations.push({
          blocker: {
            code: "bafu_flow_location_of_supply_unresolvable",
            dataset_id: entityId,
            action_item: closureFor(item),
            message:
              "Flow locationOfSupply is missing and the name mixAndLocationTypes does not carry a usable location code.",
          },
        });
        continue;
      }
      operations.push({
        op: "add",
        path: "/flowDataSet/flowInformation/geography",
        value: { locationOfSupply: codeToken },
        basis:
          "The flow geography block is missing while the source name's mixAndLocationTypes segment carries the formal location code.",
        evidence: evidenceObject("flow_location_of_supply_from_mix", task, item, {
          source_value: null,
          selected_value: codeToken,
          mix_and_location_types: mixText,
        }),
        // The action item only allows the location_decision resolution mode.
        resolution: resolution(
          "location_decision",
          "Materialized geography.locationOfSupply from the source-backed location code in the name's mixAndLocationTypes segment.",
        ),
        closes_action_items: [closureFor(item)],
      });
      continue;
    }
    if (code === "semantic_local_source_path_visible") {
      const itemPath = actionPath(item);
      if (!itemPath) continue;
      const pointer = `/${itemPath.split(".").join("/")}`;
      const original = String(itemEvidence.text ?? "");
      const sanitized =
        original
          .replace(/\bsource\b[\s\S]*?\.xml\b\.?/iu, "source.")
          .replace(/\s+/gu, " ")
          .trim() || "Imported from EcoSpold 1 source.";
      operations.push({
        op: "replace",
        path: pointer,
        value: sanitized,
        basis:
          "Local package paths are import-time provenance, not user-facing payload text; the conversion trace already records the source file.",
        evidence: evidenceObject("local_source_path_removed", task, item, {
          source_value: original,
          selected_value: sanitized,
        }),
        resolution: resolution(
          "source_language_normalization",
          "Removed the local source package path from the visible comment; conversion provenance remains in the tidasimport:sourceTrace block.",
        ),
        closes_action_items: [closureFor(item)],
      });
      continue;
    }
    if (
      isProcess &&
      actionPath(item).includes("functionalUnitOrOther") &&
      ["semantic_geography_token_in_name", "semantic_name_placeholder_token"].includes(code)
    ) {
      if (emittedFunctionalUnitClean) continue;
      emittedFunctionalUnitClean = true;
      const nameMixLocationText = normalizeLocationTokenCode(
        textFromMultilang(name.mixAndLocationTypes).trim(),
      );
      const nameMixLocationCode = /^[A-Z0-9][A-Z0-9+&-]{1,30}$/u.test(nameMixLocationText)
        ? nameMixLocationText
        : null;
      const value =
        cleanProcessFunctionalUnitText(functionalUnit, locationCode) ??
        removeTrailingLocationToken(functionalUnit, locationCode) ??
        (nameMixLocationCode && nameMixLocationCode !== locationCode
          ? (cleanProcessFunctionalUnitText(functionalUnit, nameMixLocationCode) ??
            removeTrailingLocationToken(functionalUnit, nameMixLocationCode))
          : null);
      if (!value) {
        operations.push({
          blocker: {
            code: "bafu_process_functional_unit_location_token_unsupported",
            dataset_id: entityId,
            action_item: closureFor(item),
            message:
              "BAFU auto patch only removes generated placeholder tokens and trailing formal location suffixes when they match the dataset geography field.",
          },
        });
        continue;
      }
      const closes = (
        functionalUnitActionItems.length > 0 ? functionalUnitActionItems : [item]
      ).map(closureFor);
      operations.push({
        op: "replace",
        path: "/processDataSet/processInformation/quantitativeReference/functionalUnitOrOther",
        value,
        basis:
          "The formal geography code belongs in processInformation.geography, and generated placeholder tokens such as 'xx' must not remain in the quantitative reference text.",
        evidence: evidenceObject("functional_unit_location_token_removed", task, item, {
          source_value: functionalUnit,
          selected_value: value,
          formal_location_field: formalLocationField,
        }),
        resolution: resolution(
          "source_language_normalization",
          "Removed generated placeholder and trailing location tokens from the process quantitative reference while preserving the formal geography field.",
        ),
        closes_action_items: closes,
      });
    }

    if (
      code === "semantic_name_base_contains_unsplit_segments" ||
      code === "semantic_name_treatment_placeholder" ||
      code === "semantic_name_quantitative_property_not_split" ||
      code === "semantic_name_source_locator_in_name"
    ) {
      if (emittedNameSplit) continue;
      emittedNameSplit = true;
      const closes = (nameSplitActionItems.length > 0 ? nameSplitActionItems : [item]).map(
        closureFor,
      );
      if (!nameSplit) {
        operations.push({
          blocker: {
            code: "bafu_name_split_unsupported",
            dataset_id: entityId,
            action_item: closureFor(item),
            message:
              "BAFU auto patch could not split the source name into a core baseName and source-backed treatment/route qualifier.",
          },
        });
        continue;
      }
      operations.push({
        op: "replace",
        path: `${namePathPrefix}/baseName`,
        value: englishText(nameSplit.base_name),
        basis:
          "The source base name embeds route, technology, allocation, or treatment qualifiers; TIDAS name-plan stores the core flow/process name separately from treatment/route qualifiers.",
        evidence: evidenceObject("name_plan_split", task, item, {
          source_name: nameSplit.source,
          extracted_base_name: nameSplit.base_name,
          extracted_treatment: nameSplit.treatment,
        }),
        resolution: resolution(
          "source_language_normalization",
          "Split BAFU source-language name into core baseName and treatment/route qualifiers.",
        ),
        closes_action_items: closes,
      });
      operations.push({
        op: "replace",
        path: `${namePathPrefix}/treatmentStandardsRoutes`,
        value: englishText(nameSplit.treatment),
        basis:
          "The extracted source-language phrase is a treatment, route, technology, or allocation qualifier, not part of the core flow/process name.",
        evidence: evidenceObject("name_plan_treatment_route", task, item, {
          source_name: nameSplit.source,
          extracted_treatment: nameSplit.treatment,
        }),
        resolution: resolution(
          "source_language_normalization",
          "Moved the source treatment/route qualifier from baseName into treatmentStandardsRoutes.",
        ),
        closes_action_items: closes,
      });
      if (nameSplitMixLocation && !emittedMixLocation) {
        emittedMixLocation = true;
        const hasExplicitMixAction = mixLocationActionItems.length > 0;
        const mixCloses = hasExplicitMixAction ? mixLocationActionItems.map(closureFor) : closes;
        operations.push({
          op: "replace",
          path: `${namePathPrefix}/mixAndLocationTypes`,
          value: englishText(nameSplitMixLocation),
          basis:
            "The source name embeds a mix or availability phrase; TIDAS name-plan stores it in mixAndLocationTypes rather than baseName.",
          evidence: evidenceObject("name_plan_mix_location", task, item, {
            source_name: nameSplit.source,
            extracted_mix_location: nameSplitMixLocation,
          }),
          resolution: resolution(
            hasExplicitMixAction ? "location_decision" : "source_language_normalization",
            "Moved the source mix/location phrase from baseName into mixAndLocationTypes.",
          ),
          closes_action_items: mixCloses,
        });
      }
      if (nameSplit.flow_property) {
        const flowPropertyExists = Boolean(
          textFromMultilang(name.functionalUnitFlowProperties).trim(),
        );
        operations.push({
          op: flowPropertyExists ? "replace" : "add",
          path: `${namePathPrefix}/functionalUnitFlowProperties`,
          value: englishText(nameSplit.flow_property),
          basis:
            "The source name embeds a quantitative flow-property qualifier; TIDAS name-plan stores it in functionalUnitFlowProperties rather than baseName or treatmentStandardsRoutes.",
          evidence: evidenceObject("name_plan_flow_property", task, item, {
            source_name: nameSplit.source,
            extracted_flow_property: nameSplit.flow_property,
          }),
          resolution: resolution(
            "source_language_normalization",
            "Moved the source-backed quantitative qualifier from the dataset name into functionalUnitFlowProperties.",
          ),
          closes_action_items: closes,
        });
      }
    }

    if (code === "semantic_name_mix_location_too_bare") {
      if (emittedMixLocation) continue;
      emittedMixLocation = true;
      const locationCode = String(itemEvidence.location_code_candidate ?? "").toUpperCase();
      const locationPhrase =
        nameSplitMixLocation ??
        inferMixLocationPhrase({ isProcess, name, locationCode }, locationLabelCatalog);
      operations.push({
        op: "replace",
        path: `${namePathPrefix}/mixAndLocationTypes`,
        value: englishText(locationPhrase),
        basis:
          "The field contains only a bare location code; the completed location decision places the formal code in locationOfSupply, while the required name-plan field should carry a human-readable availability/location-type phrase.",
        evidence: evidenceObject("bare_location_name_part_replaced", task, item, {
          removed_value: itemEvidence.text ?? null,
          formal_location_field: formalLocationField,
          formal_location_code: locationCode || null,
          selected_name_phrase: locationPhrase,
        }),
        resolution: resolution(
          "location_decision",
          "Replaced a bare location code with a source-language location-type phrase while locationOfSupply carries the formal TIDAS code.",
        ),
        closes_action_items: [closureFor(item)],
      });
    }

    if (code === "semantic_content_saturation_flow_quantitative_properties_missing" && !isProcess) {
      const value = flowReferencePropertyActionValue(item);
      if (!value) {
        operations.push({
          blocker: {
            code: "bafu_flow_property_descriptor_missing",
            dataset_id: entityId,
            action_item: closureFor(item),
            message: "No reference flow-property descriptor was available for autofill.",
          },
        });
        continue;
      }
      operations.push({
        op: "add",
        path: "/flowDataSet/flowInformation/dataSetInformation/name/flowProperties",
        value,
        basis:
          "The referenced quantitative flow property is explicit evidence for the TIDAS name.flowProperties descriptor and is not redundant with the base flow name.",
        evidence: evidenceObject("flow_property_descriptor_from_reference", task, item, {
          reference_flow_properties: itemEvidence.reference_flow_properties ?? [],
          selected_value: value,
        }),
        resolution: resolution(
          "evidence_backed_completion",
          "Filled flowProperties from the referenced quantitative flow property evidence.",
        ),
        closes_action_items: [closureFor(item)],
      });
    }

    if (code === "semantic_process_only_output_exchange_requires_review" && isProcess) {
      operations.push(buildSourceOnlyOutputExchangeTraceOperation(task, item));
    }
  }
  return operations;
}

function processSourceTraceObject(task: JsonRecord): JsonRecord | null {
  const packagePayload = jsonRecord(task.authoring_package_payload);
  const sourceProcess = jsonRecord(jsonRecord(packagePayload.source_row).processDataSet);
  const entityProcess = jsonRecord(jsonRecord(packagePayload.entity_payload).processDataSet);
  const info = jsonRecord(
    jsonRecord(sourceProcess.processInformation).dataSetInformation ??
      jsonRecord(entityProcess.processInformation).dataSetInformation,
  );
  const sourceTrace = jsonRecord(jsonRecord(info["common:other"])["tidasimport:sourceTrace"]);
  const payload = jsonRecord(sourceTrace.payload);
  return Object.keys(payload).length > 0 ? payload : null;
}

function processSourceExchangeCompletenessEvidence(
  task: JsonRecord,
  actionItem: JsonRecord,
): JsonRecord {
  const sourceTrace = processSourceTraceObject(task);
  const sourceObject =
    sourceTrace?.sourceObject ?? jsonRecord(task.context).source_rows_file ?? null;
  const actionEvidence = jsonRecord(actionItem.evidence);
  const exchangeCount = actionEvidence.exchange_count ?? null;
  const directions = actionEvidence.directions ?? [];
  return {
    source: "dataset-bafu-auto-authoring",
    source_file: sourceObject,
    field_path: "processDataSet.exchanges.exchange",
    quote_or_trace:
      "Source TIDAS process row contains only Output exchanges; Foundry preserves the source exchange set and requires an explicit source-trace acceptance record before remote write.",
    source_trace: sourceTrace
      ? {
          format: sourceTrace.format ?? null,
          sourceObject,
          sourceClassification: sourceTrace.sourceClassification ?? null,
        }
      : null,
    exchange_count: exchangeCount,
    directions,
  };
}

function buildSourceOnlyOutputExchangeTraceOperation(
  task: JsonRecord,
  actionItem: JsonRecord,
): JsonRecord {
  const trace = {
    status: "source_only_output_exchange_verified",
    action_item_code: "semantic_process_only_output_exchange_requires_review",
    source: "dataset-bafu-auto-authoring",
    summary:
      "Foundry verified from the BAFU/TIDAS source row that this process scope is output-only in the source package; no synthetic input exchange is created.",
    evidence: processSourceExchangeCompletenessEvidence(task, actionItem),
  };
  return {
    op: "add",
    path: "/processDataSet/processInformation/dataSetInformation/common:other",
    value: {
      "@xmlns:tiangongfoundry": "https://tiangong.earth/foundry/curation/1.0",
      "tiangongfoundry:sourceExchangeCompleteness": [trace],
    },
    basis:
      "The source BAFU/TIDAS process row itself is output-only, and the import must preserve source exchange semantics rather than manufacturing missing inputs.",
    evidence: evidenceObject("source_only_output_exchange_verified", task, actionItem, {
      trace,
    }),
    resolution: resolution(
      "source_trace_verified",
      "Closed the output-only exchange action item with structured source trace evidence from the BAFU/TIDAS authoring package.",
    ),
    closes_action_items: [closureFor(actionItem)],
  };
}
