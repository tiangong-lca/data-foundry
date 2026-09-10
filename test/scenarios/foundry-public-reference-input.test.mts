import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public reference input survives source removal and binds native execution/readback", (t) =>
  verifyPublicIdentityWorkflow(t, publicIdentityCases[0], true, "normal", true));
