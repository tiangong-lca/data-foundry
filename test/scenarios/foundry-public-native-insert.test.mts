import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public native insert retains the selected contract snapshot through admission and no-replay recovery", (t) =>
  verifyPublicIdentityWorkflow(t, publicIdentityCases[0], true));
