import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public native insert retains the selected contract snapshot through admission and no-replay recovery", (t) =>
  verifyPublicIdentityWorkflow(t, publicIdentityCases[0], true));

test("public native insert keeps canonical reuse outside the write contract", (t) =>
  verifyPublicIdentityWorkflow(t, publicIdentityCases[4], true));

for (const response of ["lost", "missing", "unknown"] as const)
  test(`public native insert response ${response} requires its own execution receipt without replay`, (t) =>
    verifyPublicIdentityWorkflow(t, publicIdentityCases[0], true, response));
