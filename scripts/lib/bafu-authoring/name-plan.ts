import type { BafuNamePlan as BafuNamePlanContract } from "./name-plan-contract.ts";

export interface BafuNamePlan extends BafuNamePlanContract {}
export { splitBafuNamePlanFromNameParts } from "./name-plan-from-parts.ts";
export { splitBafuNamePlan } from "./name-plan-rules.ts";
export {
  cleanProcessFunctionalUnitText,
  englishText,
  mergeExistingTreatmentRoute,
  normalizeIdentityText,
  normalizeLocationTokenCode,
  removeTrailingLocationToken,
  stripGeneratedPrefixText,
  stripSourceLocatorSuffix,
  stripTrailingLocationTokenText,
  textFromMultilang,
} from "./name-plan-text.ts";
