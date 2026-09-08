import { dotPathToJsonPointer } from "./import-curation/internal/workflow-semantic-actions.ts";
import { operationTargetsLocationCode } from "./import-curation/internal/workflow-patch-evidence.ts";

/** Select an existing domain owner; this never chooses a classification or location code. */
export function routeFoundryDecisionAction(
  action: Record<string, unknown>,
  type: string,
): Record<string, unknown> {
  if (action.ai_required === false || !["flow", "process"].includes(type)) return action;
  const pointer = dotPathToJsonPointer(action.path);
  if (action.action_kind === "identity_decision_authoring") return action;
  if (
    action.action_kind === "classification_decision_authoring" ||
    pointer.includes("/classificationInformation") ||
    pointer.includes("/elementaryFlowCategorization") ||
    String(action.code).includes("classification")
  )
    return {
      ...action,
      action_kind: "classification_decision_authoring",
      required_owner: "foundry_classification_decisions",
    };
  if (
    action.action_kind === "location_decision_authoring" ||
    operationTargetsLocationCode({ path: pointer })
  )
    return {
      ...action,
      action_kind: "location_decision_authoring",
      required_owner: "foundry_location_decisions",
    };
  return action;
}

export function decisionTargetPath(pointer: string): string {
  const segments = dotPathToJsonPointer(pointer)
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"));
  if (["json", "json_ordered", "jsonOrdered", "payload", "flow", "process"].includes(segments[0]))
    segments.shift();
  if (segments.at(-1) === "locationOfOperationSupplyOrProduction") segments.push("@location");
  return segments.join(".");
}
