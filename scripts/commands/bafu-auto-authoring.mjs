import fs from "node:fs";
import path from "node:path";
import { resolveInstalledTiangongLcaCliPackage } from "../lib/foundry-runtime-utils.mjs";

const fullContextKinds = [
  "schema",
  "methodology_yaml",
  "ruleset",
  "classification_schema",
  "location_schema",
];

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function lowerText(value) {
  return String(value ?? "").toLowerCase();
}

function arrayValues(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function textFromMultilang(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return String(value["#text"] ?? value.text ?? "");
  }
  return "";
}

function englishText(text) {
  return { "@xml:lang": "en", "#text": text };
}

function actionCode(item) {
  return String(item?.code ?? item?.action_item_code ?? item?.rule_id ?? "");
}

function actionPath(item) {
  return String(item?.path ?? item?.json_path ?? "");
}

function closureFor(item) {
  return { code: actionCode(item), path: actionPath(item) };
}

function evidenceObject(kind, task, actionItem, extra = {}) {
  const itemPath = actionPath(actionItem);
  return {
    source: "dataset-bafu-auto-authoring",
    field_path: itemPath || null,
    quote_or_trace:
      actionItem?.evidence?.text ??
      actionItem?.evidence?.current_name?.baseName ??
      actionItem?.evidence?.reference_flow_properties?.join?.(", ") ??
      itemPath ??
      kind,
    kind,
    dataset_type: task?.entity?.dataset_type ?? null,
    dataset_id: task?.entity?.entity_id ?? null,
    dataset_version: task?.entity?.version ?? null,
    action_item: {
      code: actionCode(actionItem),
      path: actionPath(actionItem) || null,
      evidence: actionItem?.evidence ?? null,
    },
    ...extra,
  };
}

function resolution(mode, summary, extra = {}) {
  return {
    mode,
    used_context_kinds: fullContextKinds,
    summary,
    deferred_reason: null,
    ...extra,
  };
}

function splitBafuWasteDisposalName(baseName) {
  const text = textFromMultilang(baseName).trim();
  const match = /^(?<core>.+?),\s*(?<treatment>as building waste)$/iu.exec(text);
  if (!match?.groups?.core || !match?.groups?.treatment) return null;
  return {
    source: text,
    base_name: match.groups.core.trim(),
    treatment: match.groups.treatment.trim(),
  };
}

function normalizeLocationTokenCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function trailingLocationToken(value) {
  const text = String(value ?? "").trim();
  const match =
    /\s*\{(?<code>[A-Z0-9][A-Z0-9+&-]{1,30})\}\s*(?:[A-Z]\s*)?(?:-\s*(?<suffix>[A-Z0-9][A-Z0-9+&-]{1,30}))?\s*$/u.exec(
      text,
    );
  if (!match?.groups?.code) return null;
  const code = normalizeLocationTokenCode(match.groups.code);
  const suffix = normalizeLocationTokenCode(match.groups.suffix);
  if (suffix && suffix !== code) return null;
  return {
    code,
    cleaned: text.slice(0, match.index).trim(),
  };
}

function stripTrailingLocationTokenText(value, expectedLocationCode = null) {
  const text = String(value ?? "").trim();
  const token = trailingLocationToken(text);
  if (!token) return text;
  const expected = normalizeLocationTokenCode(expectedLocationCode);
  if (expected && token.code !== expected) return text;
  return token.cleaned;
}

function stripGeneratedPrefixText(value) {
  return String(value ?? "")
    .replace(/^\s*x{2,}\s+/iu, "")
    .trim();
}

function cleanNamePlanPart(value) {
  return String(value ?? "")
    .replace(/\s+,/gu, ",")
    .replace(/,\s*/gu, ", ")
    .replace(/\s+/gu, " ")
    .trim();
}

function splitCommaDelimitedMarketMixPart(value) {
  const parts = String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const marketMixIndex = parts.findIndex((part) => normalizeIdentityText(part) === "market mix");
  if (marketMixIndex < 0) return null;
  const remainingParts = parts.filter((_, index) => index !== marketMixIndex);
  if (remainingParts.length === 0) return null;
  return {
    base_name: cleanNamePlanPart(remainingParts.join(", ")),
    mix_location: "market mix",
  };
}

function sourceLocatorMarkerInText(value) {
  const text = String(value ?? "");
  return [
    /\b(?!(?:summer|winter|spring|autumn|fall)\s)[A-Z][A-Za-z]+(?:\s+et\s+al\.)?\s+(?:19|20)\d{2}\b/iu,
    /[\p{Script=Han}·]{2,12}\s*(?:19|20)\d{2}/u,
    /\b(?:Table|Tbl\.)\s*\d+[A-Za-z]?\b/iu,
    /表\s*\d+/u,
    /\b(?:Figure|Fig\.)\s*\d+[A-Za-z]?\b/iu,
    /图\s*\d+/u,
  ].some((regex) => regex.test(text));
}

// Strip a methodology/source citation ("... according to MoeK 2013", "... as per
// Smith et al. 2020") from a name, wherever it appears. Such latin-author-year
// locators are source provenance and trip the semantic_name_source_locator_in_name
// gate when left in a name field; the conversion trace / referenced sources already
// record the citation. The citation can sit mid-string when an availability segment
// follows it ("water balance according to MoeK 2013, at user"), so the match is NOT
// anchored to the end; only the preposition-led "according to|as per|based on
// <Author> <Year>" form is removed, leaving the surrounding name tokens intact for the
// downstream matchers to split.
function stripSourceLocatorSuffix(value) {
  return String(value ?? "")
    .replace(
      /\s*,?\s*(?:according to|as per|based on)\s+[A-Z][A-Za-z.'-]+(?:\s+et\s+al\.?)?\s+(?:19|20)\d{2}\b/giu,
      "",
    )
    .replace(/\s*,(?:\s*,)+/gu, ",")
    .replace(/^\s*,\s*/u, "")
    .replace(/\s*,\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function recyclingShareDescriptor(value) {
  const text = String(value ?? "");
  const percentMatch =
    /\brecycling\s+share\s+(?:(?:19|20)\d{2}\s*)?\(?\s*(?<percent>\d+(?:\.\d+)?)\s*%\s*(?:Rec\.)?\s*\)?/iu.exec(
      text,
    );
  if (percentMatch?.groups?.percent) {
    return `recycling share ${percentMatch.groups.percent}%`;
  }
  return null;
}

function splitBafuNamePlan(baseName, expectedLocationCode = null) {
  const wasteSplit = splitBafuWasteDisposalName(baseName);
  if (wasteSplit) return wasteSplit;

  const text = stripSourceLocatorSuffix(
    stripGeneratedPrefixText(
      stripTrailingLocationTokenText(textFromMultilang(baseName).trim(), expectedLocationCode),
    ),
  );
  // Exact-name overrides for BAFU product flows whose core/treatment boundary is
  // unambiguous but does not match the structural patterns below. Keyed on the
  // location- and generated-prefix-stripped name so they cannot over-match other
  // flows (exact string equality only). Reviewed manually; ambiguous names
  // (e.g. "Production, washing machine, V-ZUG", "Assembly, LCD screen") are
  // deliberately omitted and remain human-review residue.
  const exactNameSplitOverrides = {
    "Fireproofed jute fibers, recycled": {
      base_name: "Fireproofed jute fibers",
      treatment: "recycled",
    },
    "Jute fibers, recycled": { base_name: "Jute fibers", treatment: "recycled" },
    "Rectangular straw bale, baling and loading bales": {
      base_name: "Rectangular straw bale",
      treatment: "baling and loading bales",
    },
    "Rectangular straw bale, straw cultivation": {
      base_name: "Rectangular straw bale",
      treatment: "straw cultivation",
    },
    "Rammed earth wall, earth extraction": {
      base_name: "Rammed earth wall",
      treatment: "earth extraction",
    },
    "Wheat grains conventional, Barrois, at farm": {
      base_name: "Wheat grains conventional, Barrois",
      treatment: "at farm",
    },
    "Barley grains conventional, Barrois, at farm": {
      base_name: "Barley grains conventional, Barrois",
      treatment: "at farm",
    },
    "Tap water, desalinated sea water, at user": {
      base_name: "Tap water, desalinated sea water",
      treatment: "at user",
    },
    "Production, washing machine, V-ZUG": {
      base_name: "washing machine, V-ZUG",
      treatment: "Production",
    },
    "Assembly, LCD screen": {
      base_name: "LCD screen",
      treatment: "Assembly",
    },
  };
  if (Object.prototype.hasOwnProperty.call(exactNameSplitOverrides, text)) {
    const override = exactNameSplitOverrides[text];
    return { source: text, base_name: override.base_name, treatment: override.treatment };
  }
  const sourceLocatorRecyclingMatch =
    /^(?<core>aluminium\s+profile|aluminium\s+sheet|steel\s+profile|steel\s+sheet|copper\s+sheet|sealing\s+sheet,\s*aluminium|chromium(?:-nickel)?\s+steel(?:\s+sheet)?(?:\s+18\/8)?|steel,\s*low\s+alloyed)(?:,\s*(?<treatment>uncoated|tin-coated|zinc-coated))?,\s*(?:(?<source>[A-Z][A-Za-z]+(?:\s+et\s+al\.)?\s+(?:19|20)\d{2})\s*,\s*)?(?<property>(?:high\s+)?recycling\s+share\s+.+?)(?:,\s*(?<mix>at\s+plant))?(?:,\s*(?<rescorr>with\s+resource\s+correction))?$/iu.exec(
      text,
    );
  if (sourceLocatorRecyclingMatch?.groups?.core && sourceLocatorRecyclingMatch?.groups?.property) {
    return {
      source: text,
      base_name: cleanNamePlanPart(sourceLocatorRecyclingMatch.groups.core),
      treatment: cleanNamePlanPart(
        `${sourceLocatorRecyclingMatch.groups.treatment ?? "recycled content"}${
          sourceLocatorRecyclingMatch.groups.rescorr ? ", with resource correction" : ""
        }`,
      ),
      flow_property:
        recyclingShareDescriptor(sourceLocatorRecyclingMatch.groups.property) ??
        cleanNamePlanPart(sourceLocatorRecyclingMatch.groups.property),
      mix_location: sourceLocatorRecyclingMatch.groups.mix
        ? cleanNamePlanPart(sourceLocatorRecyclingMatch.groups.mix)
        : "production mix",
      clean_existing_treatment: true,
    };
  }
  const secondaryProductionRouteMatch =
    /^(?<core>(?:steel|copper|aluminium|chromium|sealing|zinc|brass)[^,]*(?:,\s*(?:uncoated|tin-coated|low\s+alloyed|aluminium|copper|steel|zinc))?),\s*(?<route>(?:secondary\s+production|high\s+recycling\s+share)\s*\([^)]*\))$/iu.exec(
      text,
    );
  if (secondaryProductionRouteMatch?.groups?.core && secondaryProductionRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: cleanNamePlanPart(secondaryProductionRouteMatch.groups.core),
      treatment: cleanNamePlanPart(secondaryProductionRouteMatch.groups.route),
    };
  }
  const biogasPurificationMatch =
    /^(?<core>biogas\s+purification),\s*(?<route>to\s+methane.*)$/iu.exec(text);
  if (biogasPurificationMatch?.groups?.core && biogasPurificationMatch?.groups?.route) {
    return {
      source: text,
      base_name: biogasPurificationMatch.groups.core.trim(),
      treatment: biogasPurificationMatch.groups.route.trim(),
    };
  }
  const selectiveCoatingMatch =
    /^(?<core>selective\s+coating),\s*(?<route>(?:aluminium|copper|steel)\s+sheet.*)$/iu.exec(text);
  if (selectiveCoatingMatch?.groups?.core && selectiveCoatingMatch?.groups?.route) {
    return {
      source: text,
      base_name: selectiveCoatingMatch.groups.core.trim(),
      treatment: selectiveCoatingMatch.groups.route.trim(),
    };
  }
  const leadingGeneratedHeatMatch = /^xx\s+(?<core>heat,\s*.+?),\s*(?<route>at\s+.+)$/iu.exec(text);
  if (leadingGeneratedHeatMatch?.groups?.core && leadingGeneratedHeatMatch?.groups?.route) {
    return {
      source: text,
      base_name: leadingGeneratedHeatMatch.groups.core.trim(),
      treatment: stripTrailingLocationTokenText(
        leadingGeneratedHeatMatch.groups.route,
        expectedLocationCode,
      ),
    };
  }
  const naturalGasBurnedMatch = /^(?<core>natural\s+gas),\s*(?<route>burned\s+in\s+.+)$/iu.exec(
    text,
  );
  if (naturalGasBurnedMatch?.groups?.core && naturalGasBurnedMatch?.groups?.route) {
    return {
      source: text,
      base_name: naturalGasBurnedMatch.groups.core.trim(),
      treatment: stripTrailingLocationTokenText(
        naturalGasBurnedMatch.groups.route,
        expectedLocationCode,
      ),
    };
  }
  const heatAtCombustionUnitMatch =
    /^(?<core>heat,\s*.+?),\s*(?<route>at\s+(?:boiler|furnace|stove)\s+.+|at\s+(?:heat\s+radiator|floor\s+heating)(?:\s+.+)?)$/iu.exec(
      text,
    );
  if (heatAtCombustionUnitMatch?.groups?.core && heatAtCombustionUnitMatch?.groups?.route) {
    return {
      source: text,
      base_name: heatAtCombustionUnitMatch.groups.core.trim(),
      treatment: stripTrailingLocationTokenText(
        heatAtCombustionUnitMatch.groups.route,
        expectedLocationCode,
      ),
    };
  }
  const energyAtPlantMatch =
    /^(?<core>(?:heat|electricity),\s*[^,]+),\s*(?<route>at\s+(?:CHP\s+)?(?:power|heat)\s+plant)$/iu.exec(
      text,
    );
  if (energyAtPlantMatch?.groups?.core && energyAtPlantMatch?.groups?.route) {
    return {
      source: text,
      base_name: energyAtPlantMatch.groups.core.trim(),
      treatment: stripTrailingLocationTokenText(
        energyAtPlantMatch.groups.route,
        expectedLocationCode,
      ),
    };
  }
  const fuelBurnedMatch = /^(?<core>.+?),\s*(?<route>burned\s+in\s+.+)$/iu.exec(text);
  if (fuelBurnedMatch?.groups?.core && fuelBurnedMatch?.groups?.route) {
    return {
      source: text,
      base_name: fuelBurnedMatch.groups.core.trim(),
      treatment: stripTrailingLocationTokenText(fuelBurnedMatch.groups.route, expectedLocationCode),
    };
  }
  const pipeSeparatedNameMatch = /^(?<core>.+?)\s+\|\s+(?<route>.+)$/u.exec(text);
  if (pipeSeparatedNameMatch?.groups?.core && pipeSeparatedNameMatch?.groups?.route) {
    return {
      source: text,
      base_name: stripTrailingLocationTokenText(
        pipeSeparatedNameMatch.groups.core.trim(),
        expectedLocationCode,
      ),
      treatment: pipeSeparatedNameMatch.groups.route.trim().replace(/\s+\|\s+/gu, ", "),
    };
  }
  const electricityStoragePumpsMatch =
    /^electricity[,\s]+(?<voltage>(?:high|medium|low)\s+voltage,\s*)?(?:mix,\s*)?operation\s+storage\s+pumps?,\s*(?<grid>ENTSO(?:-E)?|UCTE),\s*(?<period>(?:summer|winter)\s+\d{4}|\d{4})\b/iu.exec(
      text,
    );
  if (electricityStoragePumpsMatch?.groups?.grid && electricityStoragePumpsMatch?.groups?.period) {
    // Reconstruct the canonical plan from matched groups: these names arrive with
    // duplicated segments after join/split cycles ("..., at plant, at plant, mix, ..."),
    // so rebuilding from groups keeps the patch idempotent.
    const voltage = electricityStoragePumpsMatch.groups.voltage
      ? cleanNamePlanPart(electricityStoragePumpsMatch.groups.voltage.replace(/,\s*$/u, ""))
      : null;
    const hadMix =
      /^electricity[,\s]+(?:high\s+voltage,\s*|medium\s+voltage,\s*|low\s+voltage,\s*)?mix,/iu.test(
        text,
      );
    const tail = /at\s+grid/iu.test(text)
      ? ", at grid"
      : /at\s+plant/iu.test(text)
        ? ", at plant"
        : "";
    return {
      source: text,
      base_name: voltage ? `Electricity, ${voltage}` : "Electricity",
      treatment: `${hadMix ? "mix, " : ""}operation storage pumps, ${electricityStoragePumpsMatch.groups.grid.toUpperCase()}, ${electricityStoragePumpsMatch.groups.period.toLowerCase()}${tail}`,
      clean_existing_treatment: true,
    };
  }
  const photovoltaicProductionCountryMatch =
    /^(?<core>photovoltaic\s+(?:laminate|panel|cell|module)(?:,\s*[^,]+?)?),\s*(?<route>production\s+[A-Z]{2,4}),\s*(?<mix>at\s+(?:regional\s+storage|plant))$/iu.exec(
      text,
    );
  if (
    photovoltaicProductionCountryMatch?.groups?.core &&
    photovoltaicProductionCountryMatch?.groups?.route
  ) {
    return {
      source: text,
      base_name: cleanNamePlanPart(photovoltaicProductionCountryMatch.groups.core),
      treatment: cleanNamePlanPart(photovoltaicProductionCountryMatch.groups.route),
      mix_location: photovoltaicProductionCountryMatch.groups.mix.trim(),
    };
  }
  const metalProductionMixForMatch =
    /^(?<core>aluminium|copper|steel|zinc),\s*(?<route>production\s+mix\s+for\s+[a-z][a-z ]+?),\s*[A-Z][A-Za-z]*\s+(?:19|20)\d{2},\s*(?<mix>at\s+plant)$/iu.exec(
      text,
    );
  if (metalProductionMixForMatch?.groups?.core && metalProductionMixForMatch?.groups?.route) {
    return {
      source: text,
      base_name: cleanNamePlanPart(metalProductionMixForMatch.groups.core),
      treatment: cleanNamePlanPart(metalProductionMixForMatch.groups.route),
      mix_location: metalProductionMixForMatch.groups.mix.trim(),
      clean_existing_treatment: true,
    };
  }
  const electricityBfeConsumerMatch =
    /^electricity[,\s]+(?<voltage>(?:high|medium|low)\s+voltage,\s*)?(?:mix,\s*)?consumer,\s*according\s+to\s+BFE\s+(?:19|20)\d{2}\b/iu.exec(
      text,
    );
  if (electricityBfeConsumerMatch) {
    // Same join/split duplication hazard as the ENTSO storage-pump names: rebuild the
    // canonical plan from groups; the BFE statistics citation moves to provenance.
    const voltage = electricityBfeConsumerMatch.groups.voltage
      ? cleanNamePlanPart(electricityBfeConsumerMatch.groups.voltage.replace(/,\s*$/u, ""))
      : null;
    const hadMix =
      /^electricity[,\s]+(?:high\s+voltage,\s*|medium\s+voltage,\s*|low\s+voltage,\s*)?mix,/iu.test(
        text,
      );
    const tail = /at\s+grid/iu.test(text)
      ? ", at grid"
      : /at\s+plant/iu.test(text)
        ? ", at plant"
        : "";
    return {
      source: text,
      base_name: voltage ? `Electricity, ${voltage}` : "Electricity",
      treatment: `${hadMix ? "mix, " : ""}consumer${tail}`,
      clean_existing_treatment: true,
    };
  }
  const electricityBareMixMatch = /^(?<core>electricity)\s+(?<route>imports|mix)$/iu.exec(text);
  if (electricityBareMixMatch?.groups?.core && electricityBareMixMatch?.groups?.route) {
    return {
      source: text,
      base_name: "Electricity",
      treatment: electricityBareMixMatch.groups.route.trim(),
    };
  }
  const electricityMixQualifierMatch = /^(?<core>electricity)\s+mix,\s*(?<route>.+)$/iu.exec(text);
  if (electricityMixQualifierMatch?.groups?.core && electricityMixQualifierMatch?.groups?.route) {
    return {
      source: text,
      base_name: "Electricity",
      treatment: `mix, ${electricityMixQualifierMatch.groups.route.trim()}`,
    };
  }
  const supplyMixMatch = /^(?<core>.+?)\s+supply\s+mix$/iu.exec(text);
  if (supplyMixMatch?.groups?.core) {
    return {
      source: text,
      base_name: supplyMixMatch.groups.core.trim(),
      treatment: "supply",
      mix_location: "supply mix",
    };
  }
  const electricityCommaQualifierMatch = /^(?<core>electricity),\s*(?<route>[^,]+)$/iu.exec(text);
  if (
    electricityCommaQualifierMatch?.groups?.core &&
    electricityCommaQualifierMatch?.groups?.route
  ) {
    return {
      source: text,
      base_name: "Electricity",
      treatment: electricityCommaQualifierMatch.groups.route.trim(),
    };
  }
  const fuelSupplyMatch = /^(?<core>fuel\s+supply)\s+(?<route>for\s+.+)$/iu.exec(text);
  if (fuelSupplyMatch?.groups?.core && fuelSupplyMatch?.groups?.route) {
    return {
      source: text,
      base_name: fuelSupplyMatch.groups.core.trim(),
      treatment: fuelSupplyMatch.groups.route.trim(),
    };
  }
  const bulkGoodsIncinerationMatch =
    /^(?<core>bulk\s+goods),\s*(?<route>construction,\s*combustible,\s*in\s+MSWI)$/iu.exec(text);
  if (bulkGoodsIncinerationMatch?.groups?.core && bulkGoodsIncinerationMatch?.groups?.route) {
    return {
      source: text,
      base_name: bulkGoodsIncinerationMatch.groups.core.trim(),
      treatment: bulkGoodsIncinerationMatch.groups.route.trim(),
    };
  }
  const disposalBuildingMarketMixMatch =
    /^(?<core>disposal,\s*building,\s*.+?),\s*market\s+mix,\s*(?<quant>m2\s+visible)$/iu.exec(text);
  if (
    disposalBuildingMarketMixMatch?.groups?.core &&
    disposalBuildingMarketMixMatch?.groups?.quant
  ) {
    return {
      source: text,
      base_name: disposalBuildingMarketMixMatch.groups.core.trim(),
      treatment: disposalBuildingMarketMixMatch.groups.quant.trim(),
      clean_existing_treatment: true,
    };
  }
  const naturalGasConsumerMatch =
    /^(?<core>natural\s+gas),\s*(?<route>(?:high|low)\s+pressure,\s*at\s+consumer)$/iu.exec(text);
  if (naturalGasConsumerMatch?.groups?.core && naturalGasConsumerMatch?.groups?.route) {
    return {
      source: text,
      base_name: naturalGasConsumerMatch.groups.core.trim(),
      treatment: naturalGasConsumerMatch.groups.route.trim(),
    };
  }
  const fuelServiceStationMatch =
    /^(?<core>methane|ethanol|petrol),\s*(?<route>.+\bat\s+service\s+station)$/iu.exec(text);
  if (fuelServiceStationMatch?.groups?.core && fuelServiceStationMatch?.groups?.route) {
    return {
      source: text,
      base_name: fuelServiceStationMatch.groups.core.trim(),
      treatment: fuelServiceStationMatch.groups.route.trim(),
    };
  }
  const heatInCombustionUnitMatch =
    /^(?<core>heat),\s*(?<route>.+?,\s*in\s+.+\b(?:furnace|boiler|stove).*)$/iu.exec(text);
  if (heatInCombustionUnitMatch?.groups?.core && heatInCombustionUnitMatch?.groups?.route) {
    return {
      source: text,
      base_name: heatInCombustionUnitMatch.groups.core.trim(),
      treatment: heatInCombustionUnitMatch.groups.route.trim(),
    };
  }
  // Water-balance accounting flows ("Tap water, water balance, at user",
  // "Water, deionised, water balance"): the methodology citation that originally
  // trailed "water balance" (e.g. "according to MoeK 2013") is already removed by
  // stripSourceLocatorSuffix, leaving "<product>, water balance[, at <availability>]".
  // Keep the product as the base, "water balance" as the treatment qualifier, and any
  // availability phrase as the mix so neither the base nor the treatment retains a
  // source locator or an unsplit availability segment.
  const waterBalanceMatch =
    /^(?<core>.+?),\s*water\s+balance(?:,\s*(?<mix>(?:at|to)\s+(?:user|plant|grid|consumer|regional storage|sawmill|warehouse|market|power plant|feed mill)))?$/iu.exec(
      text,
    );
  if (waterBalanceMatch?.groups?.core) {
    return {
      source: text,
      base_name: cleanNamePlanPart(waterBalanceMatch.groups.core),
      treatment: "water balance",
      mix_location: waterBalanceMatch.groups.mix
        ? cleanNamePlanPart(waterBalanceMatch.groups.mix)
        : "production mix",
    };
  }
  const trackBedMatch = /^(?<core>track\s+bed)$/iu.exec(text);
  if (trackBedMatch?.groups?.core) {
    return {
      source: text,
      base_name: "Track bed",
      treatment: "rail infrastructure",
    };
  }
  const disposalOfObjectMatch = /^disposal\s+of\s+(?<object>.+)$/iu.exec(text);
  if (disposalOfObjectMatch?.groups?.object) {
    return {
      source: text,
      base_name: disposalOfObjectMatch.groups.object.trim(),
      treatment: "disposal",
    };
  }
  const toSortingMatch = /^(?<core>.+?)\s+(?<route>to\s+(?:.+\s+)?sorting)$/iu.exec(text);
  if (toSortingMatch?.groups?.core && toSortingMatch?.groups?.route) {
    return {
      source: text,
      base_name: toSortingMatch.groups.core.trim(),
      treatment: toSortingMatch.groups.route.trim(),
    };
  }
  const toTreatmentMatch = /^(?<core>.+?)\s+(?<route>to\s+.+?\s+treatment)$/iu.exec(text);
  if (toTreatmentMatch?.groups?.core && toTreatmentMatch?.groups?.route) {
    return {
      source: text,
      base_name: toTreatmentMatch.groups.core.trim(),
      treatment: toTreatmentMatch.groups.route.trim(),
    };
  }
  const recyclingMaterialMatch = /^recycling\s+(?<core>.+)$/iu.exec(text);
  if (recyclingMaterialMatch?.groups?.core) {
    return {
      source: text,
      base_name: recyclingMaterialMatch.groups.core.trim(),
      treatment: "recycling",
    };
  }
  const liquefiedProductionShipMatch =
    /^(?<core>.+?\bliquefied),?\s+(?<route>production\s+[^,{}]+),\s*(?<mix>at freight ship)(?:\s*\{[A-Za-z]{2,3}\})?$/iu.exec(
      text,
    );
  if (
    liquefiedProductionShipMatch?.groups?.core &&
    liquefiedProductionShipMatch?.groups?.route &&
    liquefiedProductionShipMatch?.groups?.mix
  ) {
    return {
      source: text,
      base_name: liquefiedProductionShipMatch.groups.core.trim(),
      treatment: liquefiedProductionShipMatch.groups.route.trim(),
      mix_location: liquefiedProductionShipMatch.groups.mix.trim(),
    };
  }
  const disposalBuildingWasteMatch =
    /^(?<core>disposal,\s*.+?)\s+(?<route>as building waste(?:,\s*to .+)?)$/iu.exec(text);
  if (disposalBuildingWasteMatch?.groups?.core && disposalBuildingWasteMatch?.groups?.route) {
    return {
      source: text,
      base_name: disposalBuildingWasteMatch.groups.core.trim(),
      treatment: disposalBuildingWasteMatch.groups.route.trim(),
    };
  }
  const disposalToMatch = /^(?<core>disposal,\s*.+?),\s*(?<route>to .+)$/iu.exec(text);
  if (disposalToMatch?.groups?.core && disposalToMatch?.groups?.route) {
    const marketMixSplit = splitCommaDelimitedMarketMixPart(disposalToMatch.groups.core);
    return {
      source: text,
      base_name: marketMixSplit?.base_name ?? disposalToMatch.groups.core.trim(),
      treatment: disposalToMatch.groups.route.trim(),
      ...(marketMixSplit
        ? {
            mix_location: marketMixSplit.mix_location,
            clean_existing_treatment: true,
          }
        : {}),
    };
  }
  // Trailing location segments must leave the baseName before the catch-all
  // keeps the full disposal name with a placeholder route.
  const disposalAtLocationMatch = /^(?<core>disposal,\s*.+?),\s*(?<route>at\s+.+)$/iu.exec(text);
  if (disposalAtLocationMatch?.groups?.core && disposalAtLocationMatch?.groups?.route) {
    return {
      source: text,
      base_name: disposalAtLocationMatch.groups.core.trim(),
      treatment: disposalAtLocationMatch.groups.route.trim(),
    };
  }
  const disposalObjectMatch = /^(?<core>disposal,\s*.+)$/iu.exec(text);
  if (disposalObjectMatch?.groups?.core) {
    return {
      source: text,
      base_name: disposalObjectMatch.groups.core.trim(),
      treatment: "disposal route",
    };
  }
  const shreddingMatch = /^shredding,\s*(?<object>.+)$/iu.exec(text);
  if (shreddingMatch?.groups?.object) {
    return {
      source: text,
      base_name: shreddingMatch.groups.object.trim(),
      treatment: "shredding",
    };
  }
  const wreckingMatch = /^wrecking,\s*(?<object>.+)$/iu.exec(text);
  if (wreckingMatch?.groups?.object) {
    return {
      source: text,
      base_name: wreckingMatch.groups.object.trim(),
      treatment: "wrecking",
    };
  }
  const processBurdensMatch = /^(?<core>process-specific\s+burdens),\s*(?<route>.+)$/iu.exec(text);
  if (processBurdensMatch?.groups?.core && processBurdensMatch?.groups?.route) {
    return {
      source: text,
      base_name: processBurdensMatch.groups.core.trim(),
      treatment: processBurdensMatch.groups.route.trim(),
    };
  }
  const mountingMatch = /^mounting,\s*(?<route>.+)$/iu.exec(text);
  if (mountingMatch?.groups?.route) {
    return {
      source: text,
      base_name: "Mounting",
      treatment: mountingMatch.groups.route.trim(),
    };
  }
  const weldingMatch = /^welding,\s*(?<route>.+)$/iu.exec(text);
  if (weldingMatch?.groups?.route) {
    return {
      source: text,
      base_name: "Welding",
      treatment: weldingMatch.groups.route.trim(),
    };
  }
  const sheetRollingMatch = /^sheet\s+rolling,\s*(?<route>.+)$/iu.exec(text);
  if (sheetRollingMatch?.groups?.route) {
    return {
      source: text,
      base_name: "Sheet rolling",
      treatment: sheetRollingMatch.groups.route.trim(),
    };
  }
  const materialProcessingMatch =
    /^(?<core>powder\s+coating|anodi[sz]ing|wire\s+drawing|hot\s+rolling|section\s+bar\s+rolling|section\s+bar\s+extrusion|zinc\s+coating|tin\s+plating|coating|tempering|casting|sputtering|thermoforming|manufacturing|foaming|excavation|we+ving|production\s+efforts),\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (materialProcessingMatch?.groups?.core && materialProcessingMatch?.groups?.route) {
    return {
      source: text,
      base_name: materialProcessingMatch.groups.core.trim(),
      treatment: materialProcessingMatch.groups.route.trim(),
    };
  }
  const constructionRouteMatch =
    /^(?<core>pushed\s+pile|sheet\s+pile\s+wall|displacement\s+pile|bored\s+concrete\s+pile|stone\s+columns),\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (constructionRouteMatch?.groups?.core && constructionRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: constructionRouteMatch.groups.core.trim(),
      treatment: constructionRouteMatch.groups.route.trim(),
    };
  }
  const ekgBuildingRouteMatch = /^(?<core>EKG\s+[IVX]+),\s*(?<route>.+)$/u.exec(text);
  if (ekgBuildingRouteMatch?.groups?.core && ekgBuildingRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: ekgBuildingRouteMatch.groups.core.trim(),
      treatment: ekgBuildingRouteMatch.groups.route.trim(),
    };
  }
  const injectionMouldingMatch = /^(?<core>injection\s+mou?lding)(?:,\s*(?<route>.+))?$/iu.exec(
    text,
  );
  if (injectionMouldingMatch?.groups?.core) {
    return {
      source: text,
      base_name: injectionMouldingMatch.groups.core.trim(),
      treatment: injectionMouldingMatch.groups.route?.trim() || "manufacturing service",
    };
  }
  const extrusionMatch = /^(?<core>extrusion),\s*(?<route>.+)$/iu.exec(text);
  if (extrusionMatch?.groups?.core && extrusionMatch?.groups?.route) {
    return {
      source: text,
      base_name: extrusionMatch.groups.core.trim(),
      treatment: extrusionMatch.groups.route.trim(),
    };
  }
  const currentCollectorVariantMatch =
    /^(?<core>.+?\bcurrent\s+collector),\s*(?<route>[A-Z][A-Za-z0-9-]+)$/u.exec(text);
  if (currentCollectorVariantMatch?.groups?.core && currentCollectorVariantMatch?.groups?.route) {
    return {
      source: text,
      base_name: currentCollectorVariantMatch.groups.core.trim(),
      treatment: currentCollectorVariantMatch.groups.route.trim(),
    };
  }
  const batteryMaterialVariantMatch =
    /^(?<core>.+?\b(?:paste|material|electrode|battery|cell)|cathode|anode|electrolyte|separator),\s*(?<route>[A-Z][A-Za-z0-9-]+)$/iu.exec(
      text,
    );
  if (batteryMaterialVariantMatch?.groups?.core && batteryMaterialVariantMatch?.groups?.route) {
    return {
      source: text,
      base_name: batteryMaterialVariantMatch.groups.core.trim(),
      treatment: batteryMaterialVariantMatch.groups.route.trim(),
    };
  }
  const transportModeOnlyMatch =
    /^(?<core>transport,\s*freight),\s*(?<route>lorry|truck|rail|train|ship|barge|aircraft)$/iu.exec(
      text,
    );
  if (transportModeOnlyMatch?.groups?.core && transportModeOnlyMatch?.groups?.route) {
    return {
      source: text,
      base_name: transportModeOnlyMatch.groups.core.trim(),
      treatment: transportModeOnlyMatch.groups.route.trim(),
    };
  }
  const transportServiceModeMatch =
    /^(?<core>transport),\s*(?<route>barge\s+tanker|barge|tanker|ship)$/iu.exec(text);
  if (transportServiceModeMatch?.groups?.core && transportServiceModeMatch?.groups?.route) {
    return {
      source: text,
      base_name: transportServiceModeMatch.groups.core.trim(),
      treatment: transportServiceModeMatch.groups.route.trim(),
    };
  }
  const transportRouteMatch =
    /^(?<core>transport,\s*freight,\s*(?:lorry|truck|rail|train|ship|barge|aircraft))\s*,\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (transportRouteMatch?.groups?.core && transportRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: transportRouteMatch.groups.core.trim(),
      treatment: transportRouteMatch.groups.route.trim(),
    };
  }
  const transportGeneralRouteMatch = /^(?<core>transport),\s*(?<route>.+)$/iu.exec(text);
  if (transportGeneralRouteMatch?.groups?.core && transportGeneralRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: transportGeneralRouteMatch.groups.core.trim(),
      treatment: transportGeneralRouteMatch.groups.route.trim(),
    };
  }
  const electricityVoltageRouteMatch =
    /^(?<core>electricity,\s*(?:low|medium|high)\s+voltage)\s*,\s*(?<route>.+)$/iu.exec(text);
  if (electricityVoltageRouteMatch?.groups?.core && electricityVoltageRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: electricityVoltageRouteMatch.groups.core.trim(),
      treatment: electricityVoltageRouteMatch.groups.route.trim(),
    };
  }
  const electricityPhotovoltaicInstallationMatch =
    /^(?<core>electricity),\s*(?<technology>photovoltaic),\s*(?<mix>at\s+[^,]+)\s*,\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (
    electricityPhotovoltaicInstallationMatch?.groups?.core &&
    electricityPhotovoltaicInstallationMatch?.groups?.technology &&
    electricityPhotovoltaicInstallationMatch?.groups?.mix &&
    electricityPhotovoltaicInstallationMatch?.groups?.route
  ) {
    return {
      source: text,
      base_name: electricityPhotovoltaicInstallationMatch.groups.core.trim(),
      treatment: cleanNamePlanPart(
        `${electricityPhotovoltaicInstallationMatch.groups.technology}, ${electricityPhotovoltaicInstallationMatch.groups.route}`,
      ),
      mix_location: cleanNamePlanPart(electricityPhotovoltaicInstallationMatch.groups.mix),
    };
  }
  const electricityProductionMixTechnologyMatch =
    /^(?<core>electricity),\s*production\s+mix\s+(?<technology>.+?),\s*(?<route>at .+)$/iu.exec(
      text,
    );
  if (
    electricityProductionMixTechnologyMatch?.groups?.core &&
    electricityProductionMixTechnologyMatch?.groups?.technology &&
    electricityProductionMixTechnologyMatch?.groups?.route
  ) {
    return {
      source: text,
      base_name: electricityProductionMixTechnologyMatch.groups.core.trim(),
      treatment: `${electricityProductionMixTechnologyMatch.groups.technology.trim()}, ${electricityProductionMixTechnologyMatch.groups.route.trim()}`,
    };
  }
  const recoveredRouteMatch = /^(?<core>.+?),\s*(?<route>recovered\s+from\s+.+)$/iu.exec(text);
  if (recoveredRouteMatch?.groups?.core && recoveredRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: recoveredRouteMatch.groups.core.trim(),
      treatment: recoveredRouteMatch.groups.route.trim(),
    };
  }
  const windowFrameMarketMixMatch =
    /^(?<core>window\s+frame),\s*(?<route>.+?),\s*(?<mix>market\s+mix),\s*(?<quant>m2\s+visible|wall\s+opening)(?:,\s*(?<terminal>at\s+plant))?$/iu.exec(
      text,
    );
  if (
    windowFrameMarketMixMatch?.groups?.core &&
    windowFrameMarketMixMatch?.groups?.route &&
    windowFrameMarketMixMatch?.groups?.mix &&
    windowFrameMarketMixMatch?.groups?.quant
  ) {
    return {
      source: text,
      base_name: windowFrameMarketMixMatch.groups.core.trim(),
      treatment: [
        windowFrameMarketMixMatch.groups.route.trim(),
        windowFrameMarketMixMatch.groups.quant.trim(),
        windowFrameMarketMixMatch.groups.terminal?.trim(),
      ]
        .filter(Boolean)
        .join(", "),
      mix_location: windowFrameMarketMixMatch.groups.mix.trim(),
    };
  }
  const measuredAsPropertyRouteMatch =
    /^(?<core>.+?),\s*(?<property>measured\s+as\s+[^,{}]+),\s*(?<route>at\s+[^,{}]+)$/iu.exec(text);
  if (
    measuredAsPropertyRouteMatch?.groups?.core &&
    measuredAsPropertyRouteMatch?.groups?.property &&
    measuredAsPropertyRouteMatch?.groups?.route
  ) {
    return {
      source: text,
      base_name: cleanNamePlanPart(measuredAsPropertyRouteMatch.groups.core),
      treatment: measuredAsPropertyRouteMatch.groups.route.trim(),
      flow_property: measuredAsPropertyRouteMatch.groups.property.trim(),
    };
  }
  const fusedAtPlantQualifierMatch =
    /^(?<core>titanium\s+dioxide)\s+at\s+plant,\s*(?<route>(?:sulphate|chloride)\s+process(?:,\s*at\s+plant)?)$/iu.exec(
      text,
    );
  if (fusedAtPlantQualifierMatch?.groups?.core && fusedAtPlantQualifierMatch?.groups?.route) {
    const route = fusedAtPlantQualifierMatch.groups.route.trim();
    return {
      source: text,
      base_name: cleanNamePlanPart(fusedAtPlantQualifierMatch.groups.core),
      treatment: /at\s+plant$/iu.test(route) ? route : `${route}, at plant`,
      clean_existing_treatment: true,
    };
  }
  const vendorYearLocatorMatch =
    /^(?<core>cellulose\s+fibres)\s*\((?<treat>injected|blown[- ]?in)\)\s*\([a-z][a-z .&-]*(?:19|20)\d{2}\)(?<rest>(?:,\s*[^,]+)*)$/iu.exec(
      text,
    );
  if (vendorYearLocatorMatch?.groups?.core && vendorYearLocatorMatch?.groups?.treat) {
    const rest = cleanNamePlanPart(
      (vendorYearLocatorMatch.groups.rest ?? "").replace(/^\s*,\s*/u, ""),
    );
    return {
      source: text,
      base_name: cleanNamePlanPart(vendorYearLocatorMatch.groups.core),
      treatment: rest
        ? `${vendorYearLocatorMatch.groups.treat.trim()}, ${rest}`
        : vendorYearLocatorMatch.groups.treat.trim(),
      clean_existing_treatment: true,
    };
  }
  const terminalAtPlantMatch = /^(?<core>.+?),\s*(?<route>at plant)$/iu.exec(text);
  if (terminalAtPlantMatch?.groups?.core && terminalAtPlantMatch?.groups?.route) {
    return {
      source: text,
      base_name: terminalAtPlantMatch.groups.core.trim(),
      treatment: terminalAtPlantMatch.groups.route.trim(),
    };
  }
  const terminalAtStorageMatch = /^(?<core>.+?),\s*(?<route>at\s+(?:regional\s+)?storage)$/iu.exec(
    text,
  );
  if (terminalAtStorageMatch?.groups?.core && terminalAtStorageMatch?.groups?.route) {
    return {
      source: text,
      base_name: terminalAtStorageMatch.groups.core.trim(),
      treatment: terminalAtStorageMatch.groups.route.trim(),
    };
  }
  const fuelCellAssemblySpecificationMatch =
    /^(?<core>fuel\s+cell\s+.+?\bassembly),\s*(?<route>.+)$/iu.exec(text);
  if (
    fuelCellAssemblySpecificationMatch?.groups?.core &&
    fuelCellAssemblySpecificationMatch?.groups?.route
  ) {
    return {
      source: text,
      base_name: cleanNamePlanPart(fuelCellAssemblySpecificationMatch.groups.core),
      treatment: cleanNamePlanPart(fuelCellAssemblySpecificationMatch.groups.route),
    };
  }
  const sawnTimberRouteMatch =
    /^(?<core>sawn\s+timber),\s*(?<route>.+\b(?:pine|SFM|u=\d+%|kiln\s+dried|sawmill|maritime\s+harbour)\b.*)$/iu.exec(
      text,
    );
  if (sawnTimberRouteMatch?.groups?.core && sawnTimberRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: sawnTimberRouteMatch.groups.core.trim(),
      treatment: sawnTimberRouteMatch.groups.route.trim(),
    };
  }
  const woodChipsRouteMatch =
    /^(?<core>wood\s+chips),\s*(?<route>.+\b(?:softwood|hardwood|mixed|u=\d+%|forest)\b.*)$/iu.exec(
      text,
    );
  if (woodChipsRouteMatch?.groups?.core && woodChipsRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: woodChipsRouteMatch.groups.core.trim(),
      treatment: woodChipsRouteMatch.groups.route.trim(),
    };
  }
  const woodResourceRouteMatch =
    /^(?<core>round\s*wood|roundwood|logs|residual\s+wood|bark\s+chips|slab\s+and\s+siding),\s*(?<route>.+\b(?:forest\s+road|at\s+forest|sawmill|under\s+bark|u=\d+%).*)$/iu.exec(
      text,
    );
  if (woodResourceRouteMatch?.groups?.core && woodResourceRouteMatch?.groups?.route) {
    return {
      source: text,
      base_name: woodResourceRouteMatch.groups.core.trim(),
      treatment: woodResourceRouteMatch.groups.route.trim(),
    };
  }
  const barkAfterDebarkingMatch =
    /^(?<core>bark,\s*(?:softwood|hardwood)),\s*(?<route>after\s+debarking,\s*at\s+sawmill)$/iu.exec(
      text,
    );
  if (barkAfterDebarkingMatch?.groups?.core && barkAfterDebarkingMatch?.groups?.route) {
    return {
      source: text,
      base_name: barkAfterDebarkingMatch.groups.core.trim(),
      treatment: barkAfterDebarkingMatch.groups.route.trim(),
    };
  }
  const sawnwoodProductionMixRouteMatch =
    /^(?<core>sawnwood),\s*production\s+mix,\s*(?:(?<species>softwood|hardwood),\s*)?(?<route>(?:raw|air\s+dried|kiln\s+dried|dried|planed)\b.*\bat\s+(?:sawmill|saw|regional\s+storage)(?:,\s*with\s+resource\s+correction)?)$/iu.exec(
      text,
    );
  if (
    sawnwoodProductionMixRouteMatch?.groups?.core &&
    sawnwoodProductionMixRouteMatch?.groups?.route
  ) {
    const species = sawnwoodProductionMixRouteMatch.groups.species?.trim();
    return {
      source: text,
      base_name: species
        ? `${sawnwoodProductionMixRouteMatch.groups.core.trim()}, ${species}`
        : sawnwoodProductionMixRouteMatch.groups.core.trim(),
      treatment: sawnwoodProductionMixRouteMatch.groups.route.trim(),
      mix_location: "production mix",
    };
  }
  const sawnwoodShapeSpeciesRouteMatch =
    /^(?<core>sawnwood(?:,\s*(?:beam|board|lath))?(?:,\s*(?:softwood|hardwood))?),\s*(?<route>(?:raw|air\s+dried|kiln\s+dried|dried|planed|Swiss\s+wood)\b.*\bat\s+(?:sawmill|saw|regional\s+storage)(?:,\s*with\s+resource\s+correction)?)$/iu.exec(
      text,
    );
  if (
    sawnwoodShapeSpeciesRouteMatch?.groups?.core &&
    sawnwoodShapeSpeciesRouteMatch?.groups?.route
  ) {
    return {
      source: text,
      base_name: sawnwoodShapeSpeciesRouteMatch.groups.core.trim(),
      treatment: sawnwoodShapeSpeciesRouteMatch.groups.route.trim(),
    };
  }
  const productionOfSystemMatch =
    /^(?<core>production\s+of\s+(?:.+?\bsystem|borehole\s+heat\s+exchanger)),\s*(?<route>(?:apartment|office)\s+building.*)$/iu.exec(
      text,
    );
  if (productionOfSystemMatch?.groups?.core && productionOfSystemMatch?.groups?.route) {
    return {
      source: text,
      base_name: productionOfSystemMatch.groups.core.trim(),
      treatment: productionOfSystemMatch.groups.route.trim(),
    };
  }
  const heatTreatmentExtrusionMatch =
    /^(?<core>heat\s+treatment),\s*(?<route>(?:cold|hot)\s+impact\s+extrusion.*)$/iu.exec(text);
  if (heatTreatmentExtrusionMatch?.groups?.core && heatTreatmentExtrusionMatch?.groups?.route) {
    return {
      source: text,
      base_name: heatTreatmentExtrusionMatch.groups.core.trim(),
      treatment: heatTreatmentExtrusionMatch.groups.route.trim(),
    };
  }
  const forElectricVehicleMatch =
    /^(?<core>.+?),\s*(?<route>for\s+(?:electric|hybrid)\s+.+)$/iu.exec(text);
  if (forElectricVehicleMatch?.groups?.core && forElectricVehicleMatch?.groups?.route) {
    return {
      source: text,
      base_name: forElectricVehicleMatch.groups.core.trim(),
      treatment: forElectricVehicleMatch.groups.route.trim(),
    };
  }
  const mountingConstructionMatch =
    /^(?<core>(?:slanted-roof|flat\s+roof|facade)\s+construction),\s*(?<route>(?:integrated|mounted|on\s+roof).*)$/iu.exec(
      text,
    );
  if (mountingConstructionMatch?.groups?.core && mountingConstructionMatch?.groups?.route) {
    return {
      source: text,
      base_name: mountingConstructionMatch.groups.core.trim(),
      treatment: mountingConstructionMatch.groups.route.trim(),
    };
  }
  const insulationSpecificationMatch =
    /^(?<core>.+?\binsulation(?:\s+with\s+.+?)?),\s*(?<route>insulation\s+thickness\s+\d+(?:\.\d+)?\s*mm)$/iu.exec(
      text,
    );
  if (insulationSpecificationMatch?.groups?.core && insulationSpecificationMatch?.groups?.route) {
    return {
      source: text,
      base_name: insulationSpecificationMatch.groups.core.trim(),
      treatment: insulationSpecificationMatch.groups.route.trim(),
    };
  }
  const constructionProductQualifierMatch =
    /^(?<core>pipe|steel\s+pipe|heat\s+pump|branch\s+connections\s+and\s+fittings|mineral\s+wool\s+insulation|borehole\s+heat\s+exchanger|prefabricated\s+driven\s+pile|concrete\s+pile|heating-cooling\s+ceiling)(?:\s+(?<dimension>\d+(?:\.\d+)?\s*mm))?,\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (
    constructionProductQualifierMatch?.groups?.core &&
    constructionProductQualifierMatch?.groups?.route
  ) {
    const dimension = constructionProductQualifierMatch.groups.dimension?.trim();
    const route = constructionProductQualifierMatch.groups.route.trim();
    return {
      source: text,
      base_name: constructionProductQualifierMatch.groups.core.trim(),
      treatment: dimension ? `${dimension}, ${route}` : route,
    };
  }
  const materialAtSourceMatch =
    /^(?<core>.+?,\s*(?:round)),\s*(?<route>at\s+(?:mine|quarry|pit|plant))$/iu.exec(text);
  if (materialAtSourceMatch?.groups?.core && materialAtSourceMatch?.groups?.route) {
    return {
      source: text,
      base_name: materialAtSourceMatch.groups.core.trim(),
      treatment: materialAtSourceMatch.groups.route.trim(),
    };
  }
  const productQualifierMatch =
    /^(?<core>paper|door|cement\s+floor\s+screed|anhydrite\s+floor\s+screed|building|photovoltaic\s+panel|render\s+carrier\s+board|petrol|steel\s+sheet|transmission\s+network|water\s+supply\s+network|glass\s+fibre-reinforced\s+polymer\s+panel|flooring|sulphite\s+pulp|ferrochromium|industrial\s+wood|plastic\s+tunnel|ventilation\s+of\s+dwellings|energy\s+reduction|SMR\s+NG|fuel\s+in\s+building\s+machine|particle\s+board|fibre\s+board|chipper),\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (productQualifierMatch?.groups?.core && productQualifierMatch?.groups?.route) {
    return {
      source: text,
      base_name: productQualifierMatch.groups.core.trim(),
      treatment: productQualifierMatch.groups.route.trim(),
    };
  }
  const crushedAtSourceMatch =
    /^(?<core>.+?,\s*(?:crushed|washed|sorted|screened|broken|milled|ground|dried|liquid|liquefied|gaseous|weaved|woven|ginned|unspecified)),\s*(?<route>at\s+(?:mine|quarry|pit|plant|factory|farm|mill|regional\s+storehouse|regional\s+storage|storehouse))$/iu.exec(
      text,
    );
  if (crushedAtSourceMatch?.groups?.core && crushedAtSourceMatch?.groups?.route) {
    return {
      source: text,
      base_name: crushedAtSourceMatch.groups.core.trim(),
      treatment: crushedAtSourceMatch.groups.route.trim(),
    };
  }
  const heatDistributionMatch =
    /^(?<core>heat\s+distribution(?:\s+system)?),\s*(?<route>(?:hydronic|radiant|underfloor|radiator|air\s+heating)\b.*)$/iu.exec(
      text,
    );
  if (heatDistributionMatch?.groups?.core && heatDistributionMatch?.groups?.route) {
    return {
      source: text,
      base_name: cleanNamePlanPart(heatDistributionMatch.groups.core),
      treatment: cleanNamePlanPart(heatDistributionMatch.groups.route),
    };
  }
  const kwpInstallationMatch =
    /^(?<core>\d+(?:\.\d+)?\s*[kM]Wp\s+(?:flat[\s-]roof|slanted[\s-]roof|facade|open\s+ground)\s+installation),\s*(?<route>(?:single-Si|multi-Si|mc-Si|sc-Si|a-Si|ribbon-Si|micro-Si|CIS|CdTe)\b.*)$/iu.exec(
      text,
    );
  if (kwpInstallationMatch?.groups?.core && kwpInstallationMatch?.groups?.route) {
    return {
      source: text,
      base_name: cleanNamePlanPart(kwpInstallationMatch.groups.core),
      treatment: cleanNamePlanPart(kwpInstallationMatch.groups.route),
    };
  }
  const windPlantPartsMatch =
    /^(?<core>wind\s+power\s+plant(?:\s+\d+\s*[kM]?W)?),\s*(?<route>(?:moving|fixed)\s+parts)$/iu.exec(
      text,
    );
  if (windPlantPartsMatch?.groups?.core && windPlantPartsMatch?.groups?.route) {
    return {
      source: text,
      base_name: cleanNamePlanPart(windPlantPartsMatch.groups.core),
      treatment: cleanNamePlanPart(windPlantPartsMatch.groups.route),
    };
  }
  const serviceProcessObjectMatch =
    /^(?<core>calendering|crushing|packing|drawing\s+of\s+pipes|fleece\s+production|yarn\s+production|spruce\s+wood),\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (serviceProcessObjectMatch?.groups?.core && serviceProcessObjectMatch?.groups?.route) {
    return {
      source: text,
      base_name: cleanNamePlanPart(serviceProcessObjectMatch.groups.core),
      treatment: cleanNamePlanPart(serviceProcessObjectMatch.groups.route),
    };
  }
  const useOfServiceMatch = /^(?<core>use\s+of\s+[^,]+),\s*(?<route>.+)$/iu.exec(text);
  if (useOfServiceMatch?.groups?.core && useOfServiceMatch?.groups?.route) {
    return {
      source: text,
      base_name: cleanNamePlanPart(useOfServiceMatch.groups.core),
      treatment: cleanNamePlanPart(useOfServiceMatch.groups.route),
    };
  }
  const useOfDeviceMatch =
    /^(?<core>use),\s*(?<obj>laptop|smartphone|printer|computer(?:\s*,\s*(?:desktop|laptop))?|tablet)\s*,\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (useOfDeviceMatch?.groups?.obj && useOfDeviceMatch?.groups?.route) {
    return {
      source: text,
      base_name: cleanNamePlanPart(useOfDeviceMatch.groups.obj),
      treatment: cleanNamePlanPart(`use, ${useOfDeviceMatch.groups.route}`),
    };
  }
  const resourceCorrectionSignMatch =
    /^(?<core>resource\s+correction,\s*[A-Za-z]+,\s*[a-z]+),\s*(?<route>negative|positive)$/iu.exec(
      text,
    );
  if (resourceCorrectionSignMatch?.groups?.core && resourceCorrectionSignMatch?.groups?.route) {
    return {
      source: text,
      base_name: cleanNamePlanPart(resourceCorrectionSignMatch.groups.core),
      treatment: cleanNamePlanPart(resourceCorrectionSignMatch.groups.route),
    };
  }
  const maintenanceOfObjectMatch = /^(?<core>maintenance),\s*(?<obj>.+)$/iu.exec(text);
  if (maintenanceOfObjectMatch?.groups?.obj) {
    return {
      source: text,
      base_name: cleanNamePlanPart(maintenanceOfObjectMatch.groups.obj),
      treatment: "maintenance",
    };
  }
  const namedFacilityMatch =
    /^(?<core>ventilation\s+system|storage\s+building|manual\s+treatment\s+plant|open\s+cast\s+mine|mine|pem\s+electrolyzer|irrigation),\s*(?<route>.+)$/iu.exec(
      text,
    );
  if (namedFacilityMatch?.groups?.core && namedFacilityMatch?.groups?.route) {
    return {
      source: text,
      base_name: cleanNamePlanPart(namedFacilityMatch.groups.core),
      treatment: cleanNamePlanPart(namedFacilityMatch.groups.route),
    };
  }
  const operationOfVehicleMatch =
    /^(?<core>operation),\s*(?<obj>electric\s+(?:bicycle|scooter|moped))(?:,\s*(?<extra>.+))?$/iu.exec(
      text,
    );
  if (operationOfVehicleMatch?.groups?.obj) {
    const extra = operationOfVehicleMatch.groups.extra?.trim();
    return {
      source: text,
      base_name: cleanNamePlanPart(operationOfVehicleMatch.groups.obj),
      treatment: extra ? `operation, ${extra}` : "operation",
    };
  }
  const residualSingleSplitMatch =
    /^(?<core>(?:aluminium|steel|copper)\s+(?:profile|sheet)|(?:bearing|covering)\s+layer|brass|fuel\s+cell\s+(?:stack|balance\s+of\s+plant)\s+production|ground\s+heat\s+exchanger\s+for\s+\w+\s+buildings|insulated\s+gate\s+bipolar\s+transistor|jute\s+fibres|limestone,\s*crushed|methane|molybdenum\s+concentrate|office,\s*(?:complex|simple)\s+sanitary\s+installation|solid\s+wood,\s*spruce\s*[\/,]\s*fir\s*[\/,]\s*larch(?:\s+switzerland)?|steam\s+brake|uranium|ventilated\s+ceiling\s+system|well\s+for\s+exploration\s+and\s+production),\s*(?<route>uncoated|tin-coated|bituminised|bituminized|architectural\s+bronze\s+sheet(?:,\s*with\s+resource\s+correction)?|1\s*kWe.*|PE\s+ducts|long:.*|short:.*|electric\s+vehicle\s+application|(?:irrigated|rainfed)\s+system,\s*at\s+farm|for\s+mill|washed|96\s*vol-%.*|couple\s+production\s+\w+|main\s+product|incl\..*|(?:air|kiln)-dried.*|polyethylen.*|enriched\s+[\d.]+%\s+for\s+\w+|commercial\s+kitchen|onshore|offshore)$/iu.exec(
      text,
    );
  if (residualSingleSplitMatch?.groups?.core && residualSingleSplitMatch?.groups?.route) {
    return {
      source: text,
      base_name: cleanNamePlanPart(residualSingleSplitMatch.groups.core),
      treatment: cleanNamePlanPart(residualSingleSplitMatch.groups.route),
    };
  }
  const bareProductMatch =
    /^(?<core>(?:[a-z][a-z0-9+-]*\s+)*(?:component|components|radiator|tube|tubes|panel|panels|profile|profiles|module|modules|machine|machines|equipment|system|systems))$/iu.exec(
      text,
    );
  if (bareProductMatch?.groups?.core) {
    return {
      source: text,
      base_name: bareProductMatch.groups.core.trim(),
      treatment: "production",
    };
  }
  const bareBatteryComponentMatch =
    /^(?<core>(?:positive\s+|negative\s+)?(?:cathode|anode|current\s+collector)(?:\s+[A-Za-z0-9+-]+)?)$/iu.exec(
      text,
    );
  if (bareBatteryComponentMatch?.groups?.core) {
    return {
      source: text,
      base_name: bareBatteryComponentMatch.groups.core.trim(),
      treatment: "production",
    };
  }
  const electrodeMaterialMatch = /^(?<core>.+?\belectrode\s+material(?:\s*\(.+\))?)$/iu.exec(text);
  if (electrodeMaterialMatch?.groups?.core) {
    return {
      source: text,
      base_name: electrodeMaterialMatch.groups.core.trim(),
      treatment: "production",
    };
  }
  // Waste-facility names whose first comma sits inside an enumeration
  // ("Final repository for nuclear waste SF, HLW, and ILW") — keep the
  // enumeration whole in the route, mirroring "Interim storage, for nuclear waste".
  const wasteFacilityMatch =
    /^(?<core>final\s+repository|interim\s+storage)\s*,?\s+(?<route>for\s+nuclear\s+waste\b.*)$/iu.exec(
      text,
    );
  if (wasteFacilityMatch?.groups?.core && wasteFacilityMatch?.groups?.route) {
    return {
      source: text,
      base_name: wasteFacilityMatch.groups.core.trim(),
      treatment: wasteFacilityMatch.groups.route.trim(),
    };
  }
  // Resource-correction storage split (runs after every specific matcher): BAFU
  // construction-material flows carry a base + intrinsic use/type qualifier, then a
  // formal availability phrase, then the "with resource correction" treatment, e.g.
  // "Plywood, indoor use, at regional storage, with resource correction" or
  // "Fibreboard, hard, at regional storage, with resource correction". The generic
  // "<base>, <route>" fallback below leaves the availability phrase inside the base name,
  // so the semantic_name_base_contains_unsplit_segments gate keeps re-firing and the
  // curation gate stays needs_foundry_ai_authoring. We require the distinctive
  // "with resource correction" tail so this never touches names whose pre-availability
  // segment is a real route qualifier (e.g. "Copper, primary, at refinery"). The
  // availability vocabulary mirrors the gate's basePatterns list; mix moves to
  // mix_location and the base keeps its intrinsic comma-joined qualifier.
  const resourceCorrectionStorageMatch =
    /^(?<core>.+?),\s*(?<mix>(?:at|to)\s+(?:regional storage|plant|user|grid|market|sawmill|refinery|warehouse|consumer|power plant|feed mill)),\s*(?<treatment>with resource correction)$/iu.exec(
      text,
    );
  if (resourceCorrectionStorageMatch?.groups?.core && resourceCorrectionStorageMatch?.groups?.mix) {
    return {
      source: text,
      base_name: cleanNamePlanPart(resourceCorrectionStorageMatch.groups.core),
      treatment: cleanNamePlanPart(resourceCorrectionStorageMatch.groups.treatment),
      mix_location: cleanNamePlanPart(resourceCorrectionStorageMatch.groups.mix),
    };
  }
  const match = /^(?<core>[^,]+),\s*(?<treatment>.+)$/u.exec(text);
  if (!match?.groups?.core || !match?.groups?.treatment) return null;
  const core = match.groups.core.trim();
  const treatment = match.groups.treatment.trim();
  if (!core || !treatment) return null;

  const treatmentText = normalizeIdentityText(treatment);
  const routeLike =
    /^(?:as|at|by|from|in|for|on|to|per|with|without|production|consumption|market|supply)\b/u.test(
      treatmentText,
    ) ||
    /\b(?:allocation|average|cogen|cogeneration|diesel|fleet|freight|gas|grid|gross|hydropower|incineration|industrial|lorry|module|municipal|mix|nuclear|oil|plant|power|pv|reactor|recovered|river|ship|treatment|transport|voltage|waste|wind|wood)\b/u.test(
      treatmentText,
    ) ||
    /\b(?:primary|refinery|packaging)\b/u.test(treatmentText) ||
    /\b(?:assembly|electronic|fluorescent|lamp|lamps|metal|mounting|shredding|solder|surface|technology|through|welding|working|hole)\b/u.test(
      treatmentText,
    ) ||
    /\b(?:fossil|biogenic|land use change)\b/u.test(treatmentText) ||
    // v51-population qualifier vocabulary (product/route adjectives and nouns)
    /\b(?:electric|conventional|steel|aluminium|copper|brass|zinc|components?|parts|concrete|collector|future|tower|matured|heat|pit|class|overlapped|pressure|agricultur(?:e|al)|organics?|borehole|infrastructure|system|sewage|rechargeable|prismatic|manufacturing|equipment|circuit|operation|maintenance|stack|unspecified|process|based|type|ion|battery|panels?|mounted|integrated|laminated|installation|roof|ground|facade|station|covered|sludge|electrolysis|graphite|render|machinery|charging|lignite|peat|cast|hydronic|anchored|drilled|vibrated|strutted|capture|sorbent|adsorbent|digested|silage|sprinkler|scrap|converter|chemicals|solid|cargo|urban|production|network|server|standard|printing|storehouse|distillation|molasses|polymerisation|polymerization|cattle|pig|pigs|poultry|sow|sows|livestock|onshore|offshore|plastic|wooden|mine|bauxite|limestone|recultivation|silo|temperature|drying|grain|polyvinylchlorid|polyvinylchloride|bonded|boards?|emulsion|suspension|bulk|vented|venting|flared|fugitive|company|internal|external|private|public|municipal)\b/u.test(
      treatmentText,
    ) ||
    // power ratings (3kW, 1MWe, 570 kWp, 100W), physical measurements, EURO classes
    /\b\d+(?:\.\d+)?\s*(?:[km]?w[ep]?|kva|mm|cm|m[23]?|kg|t|litres?|liters?|bar|%)\b/u.test(
      treatmentText,
    ) ||
    /\b\d+(?:\.\d+)?\s*%|u=\d+%/u.test(treatment) ||
    /\beuro\s*\d/u.test(treatmentText) ||
    /\b(?:raw|uncoated|coated|ore|concentrate|beneficiation|ventilated|mineral|gaseous|internet|foil|stone|crushed|devices|dried|solar)\b/u.test(
      treatmentText,
    );
  if (!routeLike) {
    // The tail after the first comma is not a recognised route, but it may still end
    // in a formal availability/location phrase ("Tap water, desalinated sea water, at
    // user") that the semantic_name_base_contains_unsplit_segments gate flags. Move
    // that phrase into mix_location and keep the rest (a genuine compound product name)
    // as the base. Route-like tails were already returned above, so this never steals a
    // real route qualifier (e.g. "Copper, primary, at refinery" keeps base "Copper").
    // The availability vocabulary mirrors the gate's basePatterns list.
    const availabilitySplit =
      /^(?<core>.+),\s*(?<mix>(?:at|to)\s+(?:freight ship|ship|plant|user|grid|market|sawmill|refinery|warehouse|consumer|regional storage|power plant|feed mill))$/iu.exec(
        text,
      );
    if (availabilitySplit?.groups?.core && availabilitySplit?.groups?.mix) {
      return {
        source: text,
        base_name: cleanNamePlanPart(availabilitySplit.groups.core),
        treatment: "production",
        mix_location: cleanNamePlanPart(availabilitySplit.groups.mix),
      };
    }
    return null;
  }

  return {
    source: text,
    base_name: core,
    treatment,
  };
}

function flowReferencePropertyActionValue(actionItem) {
  const suggested = actionItem?.evidence?.suggested_value;
  if (suggested && typeof suggested === "object" && !Array.isArray(suggested)) {
    const text = textFromMultilang(suggested).trim();
    if (text) return englishText(text);
  }
  const reference = actionItem?.evidence?.reference_flow_properties?.find?.((item) =>
    String(item ?? "").trim(),
  );
  return reference ? englishText(String(reference).trim()) : null;
}

function normalizeIdentityText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\\+/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const identityStopWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "source",
  "the",
  "to",
  "with",
]);

function identityTokens(value) {
  const tokens = normalizeIdentityText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !identityStopWords.has(token));
  return new Set(tokens);
}

function identityTextFromParts(parts) {
  return (parts ?? [])
    .map((part) => String(part ?? ""))
    .filter(Boolean)
    .join(" ");
}

function tokenOverlapRatio(left, right) {
  const leftTokens = identityTokens(left);
  const rightTokens = identityTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function categoriesOverlap(left, right) {
  const leftTokens = identityTokens(identityTextFromParts(left));
  const rightTokens = identityTokens(identityTextFromParts(right));
  for (const token of leftTokens) {
    if (rightTokens.has(token)) return true;
  }
  return false;
}

function namesAreExactIdentityMatch(targetNames, candidateNames) {
  const target = normalizeIdentityText(identityTextFromParts(targetNames));
  const candidate = normalizeIdentityText(identityTextFromParts(candidateNames));
  return target && target === candidate;
}

const NAME_MEANING_STOP_TOKENS = new Set([
  "at",
  "plant",
  "production",
  "mix",
  "market",
  "supply",
  "grid",
  "regional",
  "storage",
  "storehouse",
  "works",
  "rer",
  "glo",
  "row",
  "ucte",
  "entso",
]);

function substanceMeaningText(names) {
  return normalizeIdentityText(identityTextFromParts(names))
    .split(/\s+/u)
    .filter((token) => token.length >= 2 && !NAME_MEANING_STOP_TOKENS.has(token))
    .filter((token) => !/^[a-z]{2}$/u.test(token))
    .join(" ");
}

function strongNameMeaningDiffers(targetNames, candidateNames) {
  const targetText = identityTextFromParts(targetNames);
  const candidateText = identityTextFromParts(candidateNames);
  const target = normalizeIdentityText(targetText);
  const candidate = normalizeIdentityText(candidateText);
  if (!target || !candidate || target === candidate) return false;
  // Route/mix/geography words ("at plant", "RER") are not substance identity; comparing
  // them inflates overlap and lets a different polymer pass as possibly equivalent.
  const targetSubstance = substanceMeaningText(targetNames);
  const candidateSubstance = substanceMeaningText(candidateNames);
  if (targetSubstance && candidateSubstance) {
    return tokenOverlapRatio(targetSubstance, candidateSubstance) < 0.45;
  }
  return tokenOverlapRatio(targetText, candidateText) < 0.45;
}

function routeOrTechnologyDiffers(targetNames, candidateNames) {
  const target = normalizeIdentityText(identityTextFromParts(targetNames));
  const candidate = normalizeIdentityText(identityTextFromParts(candidateNames));
  const routeTokens = [
    "allocation",
    "cogen",
    "cogeneration",
    "consumption",
    "disposal",
    "exergy",
    "grid",
    "low",
    "market",
    "medium",
    "mix",
    "plant",
    "production",
    "route",
    "ship",
    "supply",
    "voltage",
    "waste",
  ];
  const targetRoutes = routeTokens.filter((token) => target.includes(token));
  const candidateRoutes = routeTokens.filter((token) => candidate.includes(token));
  if (targetRoutes.length === 0 && candidateRoutes.length === 0) return false;
  return !sameList(targetRoutes, candidateRoutes);
}

function candidateHasClearNonEquivalence(reviewedCandidate) {
  return (reviewedCandidate?.non_equivalence_reasons ?? []).length > 0;
}

function reusableEquivalentCandidate(target, reviewedCandidates) {
  const targetNames = target?.names ?? [];
  const targetGeography = lowerText(target?.fields?.geography);
  return (reviewedCandidates ?? []).find((candidate) => {
    if (!candidate?.id || !candidate?.version) return false;
    if (candidateHasClearNonEquivalence(candidate)) return false;
    if (
      tokenOverlapRatio(
        identityTextFromParts(targetNames),
        identityTextFromParts(candidate.names),
      ) < 0.8
    ) {
      return false;
    }
    const candidateGeography = lowerText(candidate?.fields?.geography);
    if (targetGeography && candidateGeography && targetGeography !== candidateGeography)
      return false;
    return true;
  });
}

function normalizedCategoryText(fields) {
  return normalizeIdentityText(arrayValues(fields?.categories).join(" "));
}

function reusableBafuElementaryFlowCandidate(target, candidates) {
  const targetType = lowerText(target?.fields?.type_of_dataset);
  if (targetType !== "elementary flow") return null;
  const targetNamesText = normalizeIdentityText(identityTextFromParts(target?.names ?? []));
  const targetProperty = normalizeIdentityText(target?.fields?.flow_property);
  const targetCategories = normalizedCategoryText(target?.fields ?? {});
  const isIndustrialOccupation =
    targetProperty === "area time" &&
    targetNamesText.includes("occupation industrial area") &&
    targetCategories.includes("land");
  const isIndustrialTransformationTo =
    targetProperty === "area" &&
    targetNamesText.includes("transformation to industrial area") &&
    targetCategories.includes("land");
  if (!isIndustrialOccupation && !isIndustrialTransformationTo) return null;

  for (const candidate of candidates ?? []) {
    const fields = candidate?.fields ?? {};
    if (lowerText(fields.type_of_dataset) !== "elementary flow") continue;
    const candidateProperty = normalizeIdentityText(fields.flow_property);
    const candidateNamesText = normalizeIdentityText(identityTextFromParts(candidate?.names ?? []));
    const candidateCategories = normalizedCategoryText(fields);
    if (isIndustrialOccupation) {
      if (candidateProperty !== "area time") continue;
      if (!candidateNamesText.includes("industrial area")) continue;
      if (!candidateCategories.includes("land occupation")) continue;
      return {
        ...candidate,
        equivalence_basis:
          "BAFU land occupation flow uses the industrial-area land-use meaning with Area*time; the canonical candidate is the matching public TianGong land occupation elementary flow.",
      };
    }
    if (isIndustrialTransformationTo) {
      if (candidateProperty !== "area") continue;
      if (!candidateNamesText.includes("to industrial area")) continue;
      if (candidateNamesText.includes("from industrial area")) continue;
      if (!candidateCategories.includes("land transformation")) continue;
      return {
        ...candidate,
        equivalence_basis:
          "BAFU land transformation flow is a transformation to industrial area with Area; the canonical candidate is the matching public TianGong land transformation elementary flow.",
      };
    }
  }
  return null;
}

function nonEquivalentFlowCandidateReasons(target, candidates) {
  const targetNames = target?.names ?? [];
  const targetFields = target?.fields ?? {};
  const targetProperty = lowerText(targetFields.flow_property);
  const targetUnit = lowerText(targetFields.reference_unit);
  const targetGeography = lowerText(targetFields.geography);
  const targetCategories = targetFields.categories ?? [];
  const reviewed = [];
  let exactEquivalentCandidate = null;

  for (const candidate of candidates ?? []) {
    const candidateNames = candidate?.names ?? [];
    const candidateFields = candidate?.fields ?? {};
    const candidateProperty = lowerText(candidateFields.flow_property);
    const candidateUnit = lowerText(candidateFields.reference_unit);
    const candidateGeography = lowerText(candidateFields.geography);
    const candidateCategories = candidateFields.categories ?? [];
    const reasons = [];
    if (targetProperty && candidateProperty && targetProperty !== candidateProperty) {
      reasons.push("flow property differs");
    }
    if (targetUnit && candidateUnit && targetUnit !== candidateUnit) {
      reasons.push("reference unit differs");
    }
    if (targetGeography && candidateGeography && targetGeography !== candidateGeography) {
      reasons.push("geography/market context differs");
    }
    if (
      targetCategories.length > 0 &&
      candidateCategories.length > 0 &&
      !categoriesOverlap(targetCategories, candidateCategories)
    ) {
      reasons.push("source category/route differs");
    }
    if (strongNameMeaningDiffers(targetNames, candidateNames)) {
      reasons.push("flow name/physical service meaning differs");
    }
    if (routeOrTechnologyDiffers(targetNames, candidateNames)) {
      reasons.push("technology/route qualifier differs");
    }
    if (namesAreExactIdentityMatch(targetNames, candidateNames)) {
      exactEquivalentCandidate = candidate;
    }
    reviewed.push({
      id: candidate?.id ?? null,
      version: candidate?.version ?? null,
      names: candidate?.names ?? [],
      fields: candidateFields,
      non_equivalence_reasons: reasons,
    });
  }

  return { exactEquivalentCandidate, reviewed };
}

function sameList(left, right) {
  const leftSet = new Set((left ?? []).map(lowerText).filter(Boolean));
  const rightSet = new Set((right ?? []).map(lowerText).filter(Boolean));
  if (leftSet.size !== rightSet.size) return false;
  for (const item of leftSet) {
    if (!rightSet.has(item)) return false;
  }
  return leftSet.size > 0;
}

function nonEquivalentProcessCandidateReasons(target, candidates) {
  const targetNames = target?.names ?? [];
  const targetFields = target?.fields ?? {};
  const targetGeography = lowerText(targetFields.geography);
  const targetReferenceFlowIds = targetFields.reference_flow_ids ?? [];
  const targetReferenceFlowNames = targetFields.reference_flow_names ?? [];
  const targetCategories = targetFields.categories ?? [];
  const targetExchangeSignature = target?.exchange_signature ?? [];
  const reviewed = [];
  let exactEquivalentCandidate = null;

  for (const candidate of candidates ?? []) {
    const candidateNames = candidate?.names ?? [];
    const candidateFields = candidate?.fields ?? {};
    const candidateGeography = lowerText(candidateFields.geography);
    const candidateReferenceFlowIds = candidateFields.reference_flow_ids ?? [];
    const candidateReferenceFlowNames = candidateFields.reference_flow_names ?? [];
    const candidateCategories = candidateFields.categories ?? [];
    const candidateExchangeSignature = candidate?.exchange_signature ?? [];
    const reasons = [];
    if (targetGeography && candidateGeography && targetGeography !== candidateGeography) {
      reasons.push("geography differs");
    }
    if (
      targetReferenceFlowIds.length > 0 &&
      candidateReferenceFlowIds.length > 0 &&
      !sameList(targetReferenceFlowIds, candidateReferenceFlowIds)
    ) {
      reasons.push("reference flow differs");
    }
    if (
      targetReferenceFlowNames.length > 0 &&
      candidateReferenceFlowNames.length > 0 &&
      !sameList(targetReferenceFlowNames, candidateReferenceFlowNames)
    ) {
      reasons.push("reference flow meaning differs");
    }
    if (
      targetExchangeSignature.length > 0 &&
      candidateExchangeSignature.length > 0 &&
      !sameList(targetExchangeSignature, candidateExchangeSignature)
    ) {
      reasons.push("exchange signature differs");
    }
    if (
      targetCategories.length > 0 &&
      candidateCategories.length > 0 &&
      !categoriesOverlap(targetCategories, candidateCategories)
    ) {
      reasons.push("process classification/route differs");
    }
    if (strongNameMeaningDiffers(targetNames, candidateNames)) {
      reasons.push("process name/technology meaning differs");
    }
    if (routeOrTechnologyDiffers(targetNames, candidateNames)) {
      reasons.push("process technology/route qualifier differs");
    }
    if (namesAreExactIdentityMatch(targetNames, candidateNames)) {
      exactEquivalentCandidate = candidate;
    }
    reviewed.push({
      id: candidate?.id ?? null,
      version: candidate?.version ?? null,
      names: candidate?.names ?? [],
      fields: candidateFields,
      exchange_signature: candidateExchangeSignature,
      non_equivalence_reasons: reasons,
    });
  }

  return { exactEquivalentCandidate, reviewed };
}

function canCreateBafuProductFlow(actionItem) {
  const evidence = actionItem?.evidence ?? {};
  const target = evidence.target ?? {};
  const targetType = lowerText(target?.fields?.type_of_dataset);
  const elementaryReuse = reusableBafuElementaryFlowCandidate(
    target,
    evidence.top_candidates ?? [],
  );
  if (elementaryReuse) {
    return {
      ok: false,
      reuse: elementaryReuse,
      reason:
        "A public TianGong elementary land-use flow candidate is physically identity-equivalent and should be reused.",
      reviewed: [
        {
          id: elementaryReuse.id ?? null,
          version: elementaryReuse.version ?? null,
          names: elementaryReuse.names ?? [],
          fields: elementaryReuse.fields ?? {},
          non_equivalence_reasons: [],
          equivalence_basis: elementaryReuse.equivalence_basis ?? null,
        },
      ],
    };
  }
  if (!["product flow", "waste flow"].includes(targetType)) {
    return {
      ok: false,
      reason: "Only product/waste flow identity decisions may be autofilled as create_new.",
    };
  }
  const targetNames = target.names ?? [];
  if (!normalizeIdentityText(identityTextFromParts(targetNames))) {
    return {
      ok: false,
      reason: "Target flow lacks enough name evidence for an automatic identity decision.",
    };
  }
  const { exactEquivalentCandidate, reviewed } = nonEquivalentFlowCandidateReasons(
    target,
    evidence.top_candidates ?? [],
  );
  const reuseCandidate = exactEquivalentCandidate ?? reusableEquivalentCandidate(target, reviewed);
  if (reuseCandidate) {
    return {
      ok: false,
      reuse: reuseCandidate,
      reason: "A remote candidate is physically identity-equivalent and should be reused.",
      reviewed,
    };
  }
  const equivalentRisk = reviewed.some((candidate) => !candidateHasClearNonEquivalence(candidate));
  if (equivalentRisk) {
    return {
      ok: false,
      reason: "At least one candidate lacks clear non-equivalence reasons.",
      reviewed,
    };
  }
  return { ok: true, reviewed };
}

function canCreateBafuProcess(actionItem) {
  const evidence = actionItem?.evidence ?? {};
  const target = evidence.target ?? {};
  const targetNames = target.names ?? [];
  if (!normalizeIdentityText(identityTextFromParts(targetNames))) {
    return {
      ok: false,
      reason: "Target process lacks enough name evidence for an automatic identity decision.",
    };
  }
  const { exactEquivalentCandidate, reviewed } = nonEquivalentProcessCandidateReasons(
    target,
    evidence.top_candidates ?? [],
  );
  if (exactEquivalentCandidate) {
    return {
      ok: false,
      reason: "A process candidate has an exact name match and requires explicit reuse/new review.",
      reviewed,
    };
  }
  const equivalentRisk = reviewed.some((candidate) => !candidateHasClearNonEquivalence(candidate));
  if (equivalentRisk) {
    return {
      ok: false,
      reason: "At least one process candidate lacks clear non-equivalence reasons.",
      reviewed,
    };
  }
  return { ok: true, reviewed };
}

function identityDecisionRow(actionItem, task) {
  const evidence = actionItem?.evidence ?? {};
  const target = evidence.target ?? {};
  const datasetType = String(
    actionItem?.dataset_type ?? target.dataset_type ?? "flow",
  ).toLowerCase();
  const createNew =
    datasetType === "process"
      ? canCreateBafuProcess(actionItem)
      : canCreateBafuProductFlow(actionItem);
  const datasetId = String(actionItem?.dataset_id ?? target.id ?? "");
  const datasetVersion = String(actionItem?.dataset_version ?? target.version ?? "00.00.001");
  const base = {
    schema_version: 1,
    dataset_type: datasetType,
    dataset_id: datasetId,
    dataset_version: datasetVersion,
    decision_status: "completed",
    authoring_package: actionItem?.authoring_package ?? null,
    authoring_package_sha256: actionItem?.authoring_package_sha256 ?? null,
    used_context_kinds: fullContextKinds,
    closes_action_items: ["identity_preflight_manual_review"],
  };
  if (!createNew.ok && createNew.reuse) {
    return {
      ...base,
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: datasetType === "process" ? "processes" : "flows",
        ref_object_id: createNew.reuse.id,
        version: createNew.reuse.version,
        short_description: identityTextFromParts(createNew.reuse.names) || createNew.reuse.id,
      },
      basis:
        "A remote candidate was reviewed as physically identity-equivalent to the BAFU target by name, route, geography, flow property, and reference unit evidence, so the existing row is reused.",
      evidence: {
        source: "dataset-bafu-identity-decisions-autofill",
        policy: `reuse_existing_reference_when_${datasetType}_identity_equivalence_is_proven`,
        target,
        remote_search: evidence.remote_search ?? null,
        selected_candidate: createNew.reuse,
        reviewed_top_candidates: createNew.reviewed ?? [],
        physical_equivalence_decision: "identity_equivalent_to_existing_candidate",
      },
    };
  }
  if (!createNew.ok) {
    return {
      ...base,
      identity_decision: "block_unresolved",
      canonical: null,
      basis: createNew.reason,
      evidence: {
        source: "dataset-bafu-identity-decisions-autofill",
        policy: `blocked_when_${datasetType}_identity_equivalence_is_not_proven_safe`,
        target,
        reviewed_top_candidates: createNew.reviewed ?? [],
      },
    };
  }
  return {
    ...base,
    identity_decision: "create_new",
    canonical: null,
    basis:
      datasetType === "process"
        ? "BAFU source process was reviewed against the remote candidates; each candidate differs by reference flow, exchange signature, geography, classification/route, or process meaning, so no identity-equivalent process was found."
        : "BAFU source flow was reviewed against the remote candidates; each candidate differs by physical property, reference unit, geography/market, classification/route, technology, or flow meaning, so no identity-equivalent product/waste flow was found.",
    evidence: {
      source: "dataset-bafu-identity-decisions-autofill",
      policy:
        datasetType === "process"
          ? "create_new_allowed_for_process_when_candidates_are_not_identity_equivalent"
          : "create_new_allowed_for_non_elementary_product_flow_when_candidates_are_not_identity_equivalent",
      target,
      remote_search: evidence.remote_search ?? null,
      reviewed_top_candidates: createNew.reviewed,
      physical_equivalence_decision: "not_identity_equivalent_to_existing_candidates",
    },
  };
}

function removeTrailingLocationToken(value, expectedLocationCode = null) {
  const text = textFromMultilang(value).trim();
  const cleaned = stripTrailingLocationTokenText(text, expectedLocationCode);
  return cleaned && cleaned !== text ? englishText(cleaned) : null;
}

function cleanProcessFunctionalUnitText(value, expectedLocationCode = null) {
  const text = textFromMultilang(value).trim();
  const expected = normalizeLocationTokenCode(expectedLocationCode);
  let cleaned = stripTrailingLocationTokenText(text, expectedLocationCode);
  // SimaPro-style names also embed the location token inline
  // ("1.0 MJ Product {RER} | activity | Alloc Rec, U"); remove inline
  // occurrences only when they match the dataset geography field.
  if (expected) {
    cleaned = cleaned.split(`{${expected}}`).join(" ");
  }
  cleaned = cleaned
    .replace(/(^|\s)xx\s+/iu, "$1")
    .replace(/\s+/gu, " ")
    .replace(/\s+\|/gu, " |")
    .trim();
  return cleaned && cleaned !== text ? englishText(cleaned) : null;
}

let locationLabelCache = null;

function loadLocationLabels() {
  if (locationLabelCache) return locationLabelCache;
  const labels = new Map([
    ["CH", "Switzerland"],
    ["BR", "Brazil"],
    ["CN", "China"],
    ["CY", "Cyprus"],
    ["DE", "Germany"],
    ["EU", "Europe"],
    ["GLO", "global"],
    ["IN", "India"],
    ["JP", "Japan"],
    ["LU", "Luxembourg"],
    ["MX", "Mexico"],
    ["PE", "Peru"],
    ["RLA", "Latin America"],
    ["RER", "Europe"],
    ["UCTE", "UCTE"],
    ["US", "United States"],
    ["WEU", "Western Europe"],
  ]);
  const schemaPath = path.join(
    resolveInstalledTiangongLcaCliPackage().schemaDir,
    "tidas_locations_category.json",
  );
  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    for (const item of arrayValues(schema.oneOf)) {
      if (!item?.const || !item?.description) continue;
      labels.set(String(item.const).toUpperCase(), String(item.description));
    }
  } catch {
    // The stable fallback labels keep suggestions deterministic if an asset is malformed.
  }
  labels.set("GLO", "global");
  locationLabelCache = labels;
  return labels;
}

function locationNameLabel(locationCode) {
  const code = String(locationCode ?? "").toUpperCase();
  return loadLocationLabels().get(code) ?? code;
}

function inferMixLocationPhrase({ isProcess, name, locationCode }) {
  const locationLabel = locationNameLabel(locationCode);
  const nameText = normalizeIdentityText(
    [
      textFromMultilang(name?.baseName),
      textFromMultilang(name?.treatmentStandardsRoutes),
      textFromMultilang(name?.mixAndLocationTypes),
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

function inferBareProductNamePlan({ name, packagePayload }) {
  const locationCode = datasetLocationCode({ isProcess: false, packagePayload });
  const source = stripSourceLocatorSuffix(
    stripGeneratedPrefixText(
      stripTrailingLocationTokenText(textFromMultilang(name?.baseName).trim(), locationCode),
    ),
  );
  // Comma-containing names are accepted as a whole-name base name (see the matching
  // note in inferBareProcessNamePlan). This fallback runs only after every
  // splitBafuNamePlan matcher returned null, so it never overrides a recognised
  // base+treatment split; what remains are intrinsic compound product names
  // (e.g. "Fuel in transport, aircraft, passenger"). The product-flow type guard
  // below still restricts this to actual product flows.
  if (!source) return null;
  const flow =
    packagePayload?.source_row?.flowDataSet ?? packagePayload?.entity_payload?.flowDataSet ?? {};
  const typeOfDataSet = lowerText(flow?.modellingAndValidation?.LCIMethod?.typeOfDataSet);
  if (typeOfDataSet !== "product flow") return null;

  const normalized = normalizeIdentityText(source);
  if (!/[a-z0-9]/u.test(normalized)) return null;
  const treatment = /\b(?:consumption|consumer|market|supply|imports?|grid)\b/u.test(normalized)
    ? "supply"
    : "production";
  const locationLabel = locationCode ? locationNameLabel(locationCode) : null;
  const mixKind = treatment === "supply" ? "supply mix" : "production mix";
  return {
    source,
    base_name: source,
    treatment,
    mix_location: locationLabel ? `${mixKind}, ${locationLabel}` : mixKind,
  };
}

function inferBareProcessNamePlan({ name, packagePayload }) {
  const locationCode = datasetLocationCode({ isProcess: true, packagePayload });
  const source = stripSourceLocatorSuffix(
    stripGeneratedPrefixText(
      stripTrailingLocationTokenText(textFromMultilang(name?.baseName).trim(), locationCode),
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
  const process =
    packagePayload?.source_row?.processDataSet ??
    packagePayload?.entity_payload?.processDataSet ??
    null;
  if (!process) return null;

  const normalized = normalizeIdentityText(source);
  if (!/[a-z0-9]/u.test(normalized)) return null;

  const exchanges = arrayValues(process?.exchanges?.exchange);
  const outputNames = exchanges
    .filter((exchange) => lowerText(exchange?.exchangeDirection) === "output")
    .map((exchange) =>
      textFromMultilang(exchange?.referenceToFlowDataSet?.["common:shortDescription"]),
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
      process?.processInformation?.dataSetInformation?.classificationInformation ?? {},
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

  const locationLabel = locationCode ? locationNameLabel(locationCode) : null;
  return {
    source,
    base_name: source,
    treatment,
    mix_location: locationLabel ? `${mixKind}, ${locationLabel}` : mixKind,
  };
}

function mergeExistingTreatmentRoute(nameSplit, name) {
  if (!nameSplit) return null;
  const existing = textFromMultilang(name?.treatmentStandardsRoutes).trim();
  if (!existing || normalizeIdentityText(existing) === "source described route") return nameSplit;
  const currentTreatment = String(nameSplit.treatment ?? "").trim();
  if (nameSplit.clean_existing_treatment) {
    const parts = [...existing.split(","), ...currentTreatment.split(",")]
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => {
        const normalized = normalizeIdentityText(part);
        return (
          !["disposal route", "market"].includes(normalized) &&
          !sourceLocatorMarkerInText(part) &&
          !/\brecycling\s+share\b/iu.test(part) &&
          !/^(?:at|to)\s+(?:plant|user|grid|market|consumer|sawmill|warehouse|regional storage)$/iu.test(
            part,
          )
        );
      });
    const uniqueParts = [];
    const seen = new Set();
    for (const part of parts) {
      const key = normalizeIdentityText(part);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueParts.push(part);
    }
    return {
      ...nameSplit,
      treatment: uniqueParts.join(", "),
    };
  }
  if (!currentTreatment) return { ...nameSplit, treatment: existing };
  if (normalizeIdentityText(currentTreatment).includes(normalizeIdentityText(existing))) {
    return nameSplit;
  }
  return {
    ...nameSplit,
    treatment: `${currentTreatment}, ${existing}`,
  };
}

function datasetLocationCode({ isProcess, packagePayload }) {
  if (isProcess) {
    const process =
      packagePayload?.source_row?.processDataSet ??
      packagePayload?.entity_payload?.processDataSet ??
      {};
    const location = process?.processInformation?.geography?.locationOfOperationSupplyOrProduction;
    if (typeof location === "string") return location.toUpperCase();
    return String(location?.["@location"] ?? "").toUpperCase();
  }
  const flow =
    packagePayload?.source_row?.flowDataSet ?? packagePayload?.entity_payload?.flowDataSet ?? {};
  return String(flow?.flowInformation?.geography?.locationOfSupply ?? "").toUpperCase();
}

function completeNameSplitMixLocationPhrase(mixLocation, locationCode) {
  const phrase = String(mixLocation ?? "").trim();
  if (!phrase) return null;
  if (/^(?:market|production|supply)\s+mix$/iu.test(phrase) && locationCode) {
    return `${phrase}, ${locationNameLabel(locationCode)}`;
  }
  if (
    /^at\s+(?:plant|user|grid|consumer|market|sawmill|warehouse|regional storage)$/iu.test(
      phrase,
    ) &&
    locationCode
  ) {
    return `${phrase}, ${locationNameLabel(locationCode)}`;
  }
  return phrase;
}

function splitBafuNamePlanFromNameParts(name, expectedLocationCode = null) {
  // Strip a trailing source-locator citation from the base name up front: this function
  // appends treatment segments after the base name before delegating to
  // splitBafuNamePlan, which would leave the citation stranded mid-string (e.g.
  // "...water balance according to MoeK 2013, at plant") where the terminal-anchored
  // strip can no longer reach it.
  const baseName = stripSourceLocatorSuffix(textFromMultilang(name?.baseName).trim());
  const treatment = textFromMultilang(name?.treatmentStandardsRoutes).trim();
  if (!baseName || !treatment || normalizeIdentityText(treatment) === "source described route") {
    return null;
  }
  if (
    !sourceLocatorMarkerInText(baseName) &&
    !sourceLocatorMarkerInText(treatment) &&
    !/\brecycling\s+share\b/iu.test(treatment)
  ) {
    return null;
  }
  // Treatment segments already embedded in the baseName (e.g. base "..., at plant"
  // with treatment "at plant") must not be appended again — the duplicated tail
  // defeats the terminal-segment rules and the split degrades to a no-op.
  const baseSegmentKeys = new Set(
    baseName
      .split(",")
      .map((part) => normalizeIdentityText(part.trim()))
      .filter(Boolean),
  );
  const novelTreatmentParts = treatment
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !baseSegmentKeys.has(normalizeIdentityText(part)));
  const combinedName = novelTreatmentParts.length
    ? `${baseName}, ${novelTreatmentParts.join(", ")}`
    : baseName;
  return splitBafuNamePlan(combinedName, expectedLocationCode);
}

function buildNamePatchOperations(task) {
  const operations = [];
  const actionItems = task.action_items ?? [];
  const packagePayload = task.authoring_package_payload ?? {};
  const datasetType = String(task.entity?.dataset_type ?? "").toLowerCase();
  const isProcess = datasetType === "process";
  const namePathPrefix = isProcess
    ? "/processDataSet/processInformation/dataSetInformation/name"
    : "/flowDataSet/flowInformation/dataSetInformation/name";
  const formalLocationField = isProcess
    ? "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction"
    : "flowDataSet.flowInformation.geography.locationOfSupply";
  const name = isProcess
    ? (packagePayload.source_row?.processDataSet?.processInformation?.dataSetInformation?.name ??
      packagePayload.entity_payload?.processDataSet?.processInformation?.dataSetInformation?.name ??
      {})
    : (packagePayload.source_row?.flowDataSet?.flowInformation?.dataSetInformation?.name ??
      packagePayload.entity_payload?.flowDataSet?.flowInformation?.dataSetInformation?.name ??
      {});
  const functionalUnit = isProcess
    ? (packagePayload.source_row?.processDataSet?.processInformation?.quantitativeReference
        ?.functionalUnitOrOther ??
      packagePayload.entity_payload?.processDataSet?.processInformation?.quantitativeReference
        ?.functionalUnitOrOther)
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
        ? inferBareProcessNamePlan({ name, packagePayload })
        : inferBareProductNamePlan({ name, packagePayload })),
    name,
  );
  const nameSplitMixLocation = completeNameSplitMixLocationPhrase(
    nameSplit?.mix_location,
    locationCode,
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
    if (code === "semantic_content_saturation_flow_location_of_supply_missing" && !isProcess) {
      const mixText = normalizeLocationTokenCode(
        textFromMultilang(name?.mixAndLocationTypes).trim(),
      );
      const codeToken = /^[A-Z0-9][A-Z0-9+&-]{1,30}$/u.test(mixText) ? mixText : null;
      if (!codeToken) {
        operations.push({
          blocker: {
            code: "bafu_flow_location_of_supply_unresolvable",
            dataset_id: task.entity.entity_id,
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
      const original = String(item?.evidence?.text ?? "");
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
        textFromMultilang(name?.mixAndLocationTypes).trim(),
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
            dataset_id: task.entity.entity_id,
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
            dataset_id: task.entity.entity_id,
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
          textFromMultilang(name?.functionalUnitFlowProperties).trim(),
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
      const locationCode = String(item?.evidence?.location_code_candidate ?? "").toUpperCase();
      const locationPhrase =
        nameSplitMixLocation ?? inferMixLocationPhrase({ isProcess, name, locationCode });
      operations.push({
        op: "replace",
        path: `${namePathPrefix}/mixAndLocationTypes`,
        value: englishText(locationPhrase),
        basis:
          "The field contains only a bare location code; the completed location decision places the formal code in locationOfSupply, while the required name-plan field should carry a human-readable availability/location-type phrase.",
        evidence: evidenceObject("bare_location_name_part_replaced", task, item, {
          removed_value: item?.evidence?.text ?? null,
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
            dataset_id: task.entity.entity_id,
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
          reference_flow_properties: item?.evidence?.reference_flow_properties ?? [],
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

function processSourceTraceObject(task) {
  const info =
    task.authoring_package_payload?.source_row?.processDataSet?.processInformation
      ?.dataSetInformation ??
    task.authoring_package_payload?.entity_payload?.processDataSet?.processInformation
      ?.dataSetInformation ??
    {};
  return info?.["common:other"]?.["tidasimport:sourceTrace"]?.payload ?? null;
}

function processSourceExchangeCompletenessEvidence(task, actionItem) {
  const sourceTrace = processSourceTraceObject(task);
  const sourceObject = sourceTrace?.sourceObject ?? task.context?.source_rows_file ?? null;
  const exchangeCount = actionItem?.evidence?.exchange_count ?? null;
  const directions = actionItem?.evidence?.directions ?? [];
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

function buildSourceOnlyOutputExchangeTraceOperation(task, actionItem) {
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

export const bafuAutoAuthoringTestHooks = {
  splitBafuNamePlan,
  splitBafuNamePlanFromNameParts,
  cleanProcessFunctionalUnitText,
  nonEquivalentFlowCandidateReasons,
  strongNameMeaningDiffers,
  routeOrTechnologyDiffers,
};

export function createBafuAutoAuthoringCommands({
  ensureArray,
  fileExists,
  nowIso,
  readJson,
  readText,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
  writeJsonLines,
}) {
  function runDatasetBafuIdentityDecisionsAutofill(options = {}) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-bafu-identity-decisions-autofill",
        usage: [
          "node scripts/foundry.mjs dataset-bafu-identity-decisions-autofill --identity-decision-task <identity-decision-task.json>",
        ],
        purpose:
          "Write BAFU-specific identity-decisions.jsonl for safe, auditable product-flow create_new cases. This command never writes the remote database.",
      };
    }
    const taskPath = resolveRepoPath(options.identityDecisionTask ?? options.task ?? options.input);
    if (!taskPath || !fileExists(taskPath)) {
      throw new Error("--identity-decision-task is required.");
    }
    const task = readJson(taskPath);
    const outFile = resolveRepoPath(
      options.out ||
        options.decisions ||
        task.files?.expected_decisions ||
        path.join(path.dirname(taskPath), "identity-decisions.jsonl"),
    );
    const outDir = resolveRepoPath(options.outDir || path.dirname(outFile));
    const reportFile = path.join(outDir, "bafu-identity-decisions-autofill-report.json");
    const rows = ensureArray(task.identity_action_items).map((item) =>
      identityDecisionRow(item, task),
    );
    const blockedRows = rows.filter((row) => row.identity_decision === "block_unresolved");
    fs.mkdirSync(outDir, { recursive: true });
    writeJsonLines(outFile, rows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedRows.length > 0 ? "completed_with_manual_review" : "completed",
      command: "dataset-bafu-identity-decisions-autofill",
      identity_decision_task: repoRelativePath(taskPath),
      counts: {
        identity_action_items: ensureArray(task.identity_action_items).length,
        decisions: rows.length,
        create_new: rows.filter((row) => row.identity_decision === "create_new").length,
        blocked_unresolved: blockedRows.length,
      },
      blocked: blockedRows.map((row) => ({
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        reason: row.basis,
      })),
      files: {
        report: repoRelativePath(reportFile),
        decisions: repoRelativePath(outFile),
      },
    };
    writeJson(reportFile, report);
    return report;
  }

  function runDatasetBafuAuthoringPatchesAutofill(options = {}) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-bafu-authoring-patches-autofill",
        usage: [
          "node scripts/foundry.mjs dataset-bafu-authoring-patches-autofill --task-manifest <authoring-task-manifest.json>",
        ],
        purpose:
          "Write per-task BAFU AI patch artifacts for supported high-confidence name-plan and flow-property saturation action items. This command never writes the remote database.",
      };
    }
    const manifestPath = resolveRepoPath(options.taskManifest ?? options.manifest ?? options.input);
    if (!manifestPath || !fileExists(manifestPath)) {
      throw new Error("--task-manifest is required.");
    }
    const manifest = readJson(manifestPath);
    const outDir = resolveRepoPath(options.outDir || path.dirname(manifestPath));
    const reportFile = path.join(outDir, "bafu-authoring-patches-autofill-report.json");
    const blockers = [];
    const patchFiles = [];

    for (const task of ensureArray(manifest.tasks)) {
      if (task.status !== "ready_for_ai_authoring") continue;
      const packagePath = resolveRepoPath(task.files?.authoring_package);
      if (!packagePath || !fileExists(packagePath)) {
        blockers.push({
          code: "authoring_package_missing",
          dataset_id: task.entity?.entity_id ?? null,
          authoring_package: task.files?.authoring_package ?? null,
        });
        continue;
      }
      const enrichedTask = {
        ...task,
        authoring_package_payload: readJson(packagePath),
      };
      const operations = buildNamePatchOperations(enrichedTask);
      const operationBlockers = operations.filter((operation) => operation.blocker);
      if (operationBlockers.length > 0) {
        blockers.push(...operationBlockers.map((operation) => operation.blocker));
        continue;
      }
      const patchPath = resolveRepoPath(task.files?.output_patch_file);
      if (!patchPath) {
        blockers.push({
          code: "output_patch_file_missing",
          dataset_id: task.entity?.entity_id ?? null,
        });
        continue;
      }
      const payload = {
        schema_version: 1,
        kind: "tiangong_foundry_dataset_patch",
        patch_status: "completed",
        generated_at_utc: nowIso(),
        task_manifest: repoRelativePath(manifestPath),
        patch_sets: [
          {
            dataset_type: task.entity.dataset_type,
            dataset_id: task.entity.entity_id,
            version: task.entity.version,
            authoring_package: path.basename(packagePath),
            authoring_package_sha256: task.context?.authoring_package_sha256 ?? null,
            operations,
          },
        ],
      };
      ensureDirFor(patchPath);
      writeJson(patchPath, payload);
      patchFiles.push(repoRelativePath(patchPath));
    }

    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "completed_with_manual_review" : "completed",
      command: "dataset-bafu-authoring-patches-autofill",
      task_manifest: repoRelativePath(manifestPath),
      counts: {
        tasks: ensureArray(manifest.tasks).length,
        patch_files: patchFiles.length,
        blockers: blockers.length,
      },
      blockers,
      files: {
        report: repoRelativePath(reportFile),
        patch_files: patchFiles,
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportFile, report);
    return report;
  }

  return {
    runDatasetBafuAuthoringPatchesAutofill,
    runDatasetBafuIdentityDecisionsAutofill,
  };
}
