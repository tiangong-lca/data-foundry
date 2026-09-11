import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public reference input refreshes expired identity before sealing and preserves no-replay readback", (t) =>
  verifyPublicIdentityWorkflow(t, publicIdentityCases[2], false, "normal", true, true));
