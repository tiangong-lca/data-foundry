import test from "node:test";
import {
  publicIdentityCases,
  publicIdentityTitle,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

const scenario = publicIdentityCases[7];
test(publicIdentityTitle(scenario), (t) => verifyPublicIdentityWorkflow(t, scenario));
