import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public native insert response unknown requires its own execution receipt without replay", (t) =>
  verifyPublicIdentityWorkflow(t, publicIdentityCases[0], true, "unknown"));
