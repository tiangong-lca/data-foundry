import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import * as decisionTask from "../../scripts/lib/decision-task-utils.ts";
import * as fullContext from "../../scripts/lib/full-context-proof.ts";
import * as preflightArtifacts from "../../scripts/lib/identity-preflight-artifacts.ts";
import * as identityRewrite from "../../scripts/lib/identity-reference-rewrite-utils.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("four evidence leaves preserve their factory export surfaces", () => {
  assert.deepEqual(Object.keys(decisionTask), ["createDecisionTaskUtils"]);
  assert.deepEqual(Object.keys(identityRewrite), ["createIdentityReferenceRewriteUtils"]);
  assert.deepEqual(Object.keys(fullContext), ["createFullContextProofUtils"]);
  assert.deepEqual(Object.keys(preflightArtifacts), ["createIdentityPreflightArtifactUtils"]);
});

test("four evidence leaves are native TypeScript with updated Foundry consumers", () => {
  for (const stem of [
    "decision-task-utils",
    "identity-reference-rewrite-utils",
    "full-context-proof",
    "identity-preflight-artifacts",
  ]) {
    const typedPath = path.join(repoRoot, `scripts/lib/${stem}.ts`);
    assert.equal(fs.existsSync(typedPath), true, `${stem}.ts must exist`);
    assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  }
  const foundrySource = fs.readFileSync(path.join(repoRoot, "scripts/foundry.ts"), "utf8");
  for (const specifier of [
    "./lib/decision-task-utils.ts",
    "./lib/identity-reference-rewrite-utils.ts",
    "./lib/full-context-proof.ts",
    "./lib/identity-preflight-artifacts.ts",
  ]) {
    assert.match(
      foundrySource,
      new RegExp(`from ["']${specifier.replaceAll(".", "\\.")}["']`, "u"),
    );
  }
});
