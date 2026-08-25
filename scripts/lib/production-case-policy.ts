export type FoundryAccountMode = "ordinary" | "production-test";

const PRODUCTION_TEST_IDENTITIES = new Set([
  "qgzvkongdjqiiamzbbts:c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
]);

export function accountModeForVerifiedIdentity(input: {
  projectRef: string;
  userId: string;
}): FoundryAccountMode {
  return PRODUCTION_TEST_IDENTITIES.has(`${input.projectRef}:${input.userId}`)
    ? "production-test"
    : "ordinary";
}

export function traceHashNormalizationAllowed(handoffPlan: Record<string, unknown>): boolean {
  return String(handoffPlan.account_mode ?? "ordinary") !== "production-test";
}

export function assertReceiptBoundHandoffAccount(
  handoffPlan: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): void {
  const verifiedProjectRef = String(env.FOUNDRY_VERIFIED_PROJECT_REF ?? "").trim();
  const verifiedUserId = String(env.FOUNDRY_VERIFIED_USER_ID ?? "").trim();
  const environmentMode = String(env.FOUNDRY_ACCOUNT_MODE ?? "").trim();
  const planProjectRef = String(handoffPlan.verified_project_ref ?? "").trim();
  const planUserId = String(handoffPlan.verified_user_id ?? "").trim();
  const targetUserId = String(handoffPlan.target_user_id ?? "").trim();
  const planMode = String(handoffPlan.account_mode ?? "ordinary").trim();
  const planBound = Boolean(planProjectRef || planUserId || planMode === "production-test");
  const environmentBound = Boolean(verifiedProjectRef || verifiedUserId || environmentMode);
  if (!planBound && !environmentBound) return;
  if (
    !verifiedProjectRef ||
    !verifiedUserId ||
    !environmentMode ||
    planProjectRef !== verifiedProjectRef ||
    planUserId !== verifiedUserId ||
    targetUserId !== verifiedUserId ||
    planMode !== environmentMode
  ) {
    throw new Error("Handoff account evidence does not match the receipt-bound session.");
  }
}
