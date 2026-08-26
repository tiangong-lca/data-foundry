import type { BafuNamePlan } from "./name-plan-contract.ts";
import { splitBafuExactNameOverride, splitBafuWasteDisposalName } from "./name-plan-overrides.ts";
import {
  cleanNamePlanPart,
  normalizeIdentityText,
  recyclingShareDescriptor,
  splitCommaDelimitedMarketMixPart,
  stripGeneratedPrefixText,
  stripSourceLocatorSuffix,
  stripTrailingLocationTokenText,
  textFromMultilang,
} from "./name-plan-text.ts";

export function splitBafuNamePlan(
  baseName: unknown,
  expectedLocationCode: unknown = null,
): BafuNamePlan | null {
  const wasteSplit = splitBafuWasteDisposalName(baseName);
  if (wasteSplit) return wasteSplit;

  const text = stripSourceLocatorSuffix(
    stripGeneratedPrefixText(
      stripTrailingLocationTokenText(textFromMultilang(baseName).trim(), expectedLocationCode),
    ),
  );
  const exactOverride = splitBafuExactNameOverride(text);
  if (exactOverride) return exactOverride;
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
    const voltageGroup = electricityBfeConsumerMatch.groups?.voltage;
    const voltage = voltageGroup ? cleanNamePlanPart(voltageGroup.replace(/,\s*$/u, "")) : null;
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
