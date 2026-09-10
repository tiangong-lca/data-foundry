import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public native insert keeps canonical reuse outside the write contract", (t) =>
  verifyPublicIdentityWorkflow(t, publicIdentityCases[4], true));
