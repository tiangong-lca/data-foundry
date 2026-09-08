import test from "node:test";
import { verifyDependentScopes } from "../fixtures/foundry-public-workflow.ts";

test("public dependent flowproperty scope continues after unitgroup write and readback", (t) =>
  verifyDependentScopes(t, true));
