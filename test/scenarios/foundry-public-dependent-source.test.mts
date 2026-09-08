import test from "node:test";
import { verifyDependentScopes } from "../fixtures/foundry-public-workflow.ts";

test("public dependent source scope continues after contact write and readback", (t) =>
  verifyDependentScopes(t, false));
