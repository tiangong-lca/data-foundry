import type { BafuNamePlan } from "./name-plan-contract.ts";
import { splitBafuNamePlan } from "./name-plan-rules.ts";
import {
  jsonRecord,
  normalizeIdentityText,
  sourceLocatorMarkerInText,
  stripSourceLocatorSuffix,
  textFromMultilang,
} from "./name-plan-text.ts";

export function splitBafuNamePlanFromNameParts(
  name: unknown,
  expectedLocationCode: unknown = null,
): BafuNamePlan | null {
  const nameRecord = jsonRecord(name);
  const baseName = stripSourceLocatorSuffix(textFromMultilang(nameRecord.baseName).trim());
  const treatment = textFromMultilang(nameRecord.treatmentStandardsRoutes).trim();
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
