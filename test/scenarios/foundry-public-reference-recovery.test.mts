import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public reference input preserves unknown-commit readback and never replays the write", (t) =>
  verifyPublicIdentityWorkflow(t, publicIdentityCases[2], false, "normal", true));
