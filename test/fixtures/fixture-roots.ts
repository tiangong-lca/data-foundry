import { testTmpRoot } from "./foundry-core.mjs";

export const fixtureRoot: string = testTmpRoot("full-context-gate-test");
export const mutationFixtureRoot: string = testTmpRoot("mutation-manifest-trace-test");
export const referenceClosureFixtureRoot: string = testTmpRoot(
  "mutation-manifest-reference-closure-test",
);
export const supportManifestFixtureRoot: string = testTmpRoot(
  "mutation-manifest-support-scope-test",
);
export const classificationFixtureRoot: string = testTmpRoot("classification-queue-gate-test");
export const flowClassificationFixtureRoot: string = testTmpRoot("flow-classification-gate-test");
export const elementaryFlowManifestFixtureRoot: string = testTmpRoot(
  "elementary-flow-manifest-gate-test",
);
export const flowIdentityReferenceFixtureRoot: string = testTmpRoot(
  "flow-identity-reference-reuse-test",
);
export const locationFixtureRoot: string = testTmpRoot("location-queue-gate-test");
export const finalizeLocationFixtureRoot: string = testTmpRoot("finalize-location-audit-test");
export const finalizeCurationGateFixtureRoot: string = testTmpRoot("finalize-curation-gate-test");
export const finalizeIdentityPreflightFixtureRoot: string = testTmpRoot(
  "finalize-identity-preflight-test",
);
export const identityPreflightRunFixtureRoot: string = testTmpRoot("identity-preflight-run-test");
export const finalizeAutoQueueFixtureRoot: string = testTmpRoot("finalize-auto-queue-test");
export const packageContextFixtureRoot: string = testTmpRoot("authoring-package-context-test");
export const annualSupplyFixtureRoot: string = testTmpRoot("annual-supply-deferral-test");
export const sourceExchangeFixtureRoot: string = testTmpRoot("source-exchange-completeness-test");
export const qaPathFixtureRoot: string = testTmpRoot("qa-path-gate-test");
