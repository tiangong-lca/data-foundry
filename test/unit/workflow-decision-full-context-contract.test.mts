import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as fullDecision from "../../scripts/lib/import-curation/internal/workflow-decision-full-context.mjs";

type JsonRecord = Record<string, unknown>;

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function withTempRoot(name: string, body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("decision rows relevance and coverage preserve path-first, target aliases, payload keys, and empty fallbacks", () => {
  withTempRoot("decision-full-relevance", (root) => {
    const rowsFile = path.join(root, "rows.jsonl");
    writeJsonLines(rowsFile, [
      { id: "flow-id", version: "01.00.000", payload: { flowDataSet: { marker: "row" } } },
    ]);
    const unrelated = {
      decisions: [{ dataset_type: "process", dataset_id: "process-id" }],
      inputRows: [],
      outputRows: [],
      inputPayloadSha256ByIdentity: new Map(),
      outputPayloadSha256ByIdentity: new Map(),
    };
    assert.equal(
      fullDecision.decisionApplyContextRelevantToExpectedRowsFile({
        repoRoot: root,
        context: unrelated,
        expectedRowsFile: rowsFile,
      }),
      false,
    );
    assert.equal(
      fullDecision.decisionApplyContextCoversExpectedRowsIdentity({
        repoRoot: root,
        context: unrelated,
        expectedRowsFile: rowsFile,
      }),
      false,
    );
    const related = {
      ...unrelated,
      decisions: [{ category_type: "flow-product", id: "flow-id", version: "01.00.000" }],
    };
    assert.equal(
      fullDecision.decisionApplyContextRelevantToExpectedRowsFile({
        repoRoot: root,
        context: related,
        expectedRowsFile: rowsFile,
      }),
      true,
    );
    assert.equal(
      fullDecision.decisionApplyContextCoversExpectedRowsIdentity({
        repoRoot: root,
        context: related,
        expectedRowsFile: rowsFile,
      }),
      true,
    );
    assert.equal(
      fullDecision.decisionApplyContextRelevantToExpectedRowsFile({
        repoRoot: root,
        context: null,
        expectedRowsFile: rowsFile,
      }),
      true,
    );
    assert.equal(
      fullDecision.decisionApplyContextCoversExpectedRowsIdentity({
        repoRoot: root,
        context: null,
        expectedRowsFile: rowsFile,
      }),
      false,
    );
    assert.equal(
      fullDecision.decisionApplyContextRelevantToRowsFile({
        repoRoot: root,
        rowsFile,
        cleanupArtifact: null,
        context: { ...unrelated, outputRows: [rowsFile] },
      }),
      true,
    );
  });
});

test("patch, identity, and unresolved chain predicates preserve exact topology", () => {
  const root = "/repo";
  const decision = { outputRows: ["base"] };
  const patch = { inputRowsFile: "base", outputRows: ["patched"] };
  const identity = { inputRowsFile: "patched", outputRowsFile: "identity" };
  const unresolved = { status: "completed", inputRowsFile: "identity", outputRowsFile: "final" };
  assert.equal(
    fullDecision.decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization(
      root,
      { outputRows: ["identity"] },
      unresolved,
      "final",
    ),
    true,
  );
  assert.equal(
    fullDecision.decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization(
      root,
      decision,
      { ...patch, outputRows: ["identity"] },
      unresolved,
      "final",
    ),
    true,
  );
  assert.equal(
    fullDecision.decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization(
      root,
      decision,
      patch,
      identity,
      unresolved,
      "final",
    ),
    true,
  );
  assert.equal(
    fullDecision.decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization(
      root,
      decision,
      patch,
      { ...identity, outputRowsFile: "wrong" },
      unresolved,
      "final",
    ),
    false,
  );
});

test("identity rewrite proof preserves report-file priority, scoped-row chaining, aliases, and false boundaries", () => {
  const root = "/repo";
  const context = {
    identityReferenceRewritesFiles: ["rewrites/first.jsonl", "rewrites/shared.jsonl"],
    identityReferenceRewritesFile: "rewrites/shared.jsonl",
  };
  assert.equal(
    fullDecision.identityDecisionApplyProvesReferenceRewrite(root, context, {
      sourceFile: "/repo/rewrites/shared.jsonl",
      scopedRows: [{}],
    }),
    true,
  );
  assert.equal(
    fullDecision.identityDecisionApplyProvesReferenceRewrite(root, context, {
      sourceFile: "/repo/rewrites/other.jsonl",
      scopedRows: [{ rewriteSource: { file: "rewrites/first.jsonl" } }],
    }),
    true,
  );
  assert.equal(
    fullDecision.identityDecisionApplyProvesReferenceRewrite(root, context, {
      sourceFile: "/repo/rewrites/shared.jsonl",
      scopedRows: [],
    }),
    false,
  );
  assert.equal(fullDecision.identityDecisionApplyProvesReferenceRewrite(root, {}, null), false);
});

test("classification decision aliases, proof-list fallback, and context hash uniqueness preserve order", () => {
  const decision = {
    used_context_kinds: "schema,methodology_yaml",
    usedContextKinds: "ignored",
    resolution: { usedContextKinds: ["ruleset", "schema"] },
    evidence: { used_context_kinds: "location_schema" },
    authoringContext: { contextBundleSha256: "bundle-sha" },
    decisionStatus: " completed ",
  };
  assert.deepEqual(fullDecision.classificationDecisionContextKinds(decision), [
    "schema",
    "methodology_yaml",
    "ruleset",
    "schema",
    "location_schema",
  ]);
  assert.equal(fullDecision.classificationDecisionContextBundleSha256(decision), "bundle-sha");
  assert.equal(fullDecision.classificationDecisionCompletionStatus(decision), "completed");
  const first = { context_bundle_sha256: "first" };
  const second = { context_bundle_sha256: "second" };
  assert.deepEqual(
    fullDecision.decisionTaskProofListFromContext({
      decisionTaskProofs: [first, null, second],
      decisionTaskProof: { context_bundle_sha256: "ignored" },
    }),
    [first, second],
  );
  assert.deepEqual(fullDecision.decisionTaskProofListFromContext({ decisionTaskProof: first }), [
    first,
  ]);
  assert.deepEqual(
    fullDecision.decisionTaskContextBundleHashesFromContext({
      decisionTaskProofs: [first, first, second, { context_bundle_sha256: "" }],
    }),
    ["first", "second"],
  );
});

test("classification, location, and identity builders preserve absent-artifact no-op and fail-closed blocker prefixes", () => {
  withTempRoot("decision-full-blockers", (root) => {
    const rowsFile = path.join(root, "rows.jsonl");
    writeJsonLines(rowsFile, [
      { id: "flow-id", version: "01.00.000", payload: { flowDataSet: { marker: "row" } } },
    ]);
    const requirement = { requiredContextKinds: ["schema"], requiredContextFilePatterns: [] };
    const common = {
      repoRoot: root,
      rowsFile,
      cleanupArtifact: null,
      requirement,
    };
    assert.deepEqual(
      fullDecision.buildClassificationDecisionFullContextBlockers({
        ...common,
        classificationDecisionApplyArtifact: null,
      }),
      [],
    );
    assert.deepEqual(
      fullDecision.buildLocationDecisionFullContextBlockers({
        ...common,
        locationDecisionApplyArtifact: null,
      }),
      [],
    );
    assert.deepEqual(
      fullDecision.buildIdentityDecisionFullContextBlockers({
        ...common,
        identityDecisionApplyArtifact: null,
      }),
      [],
    );

    const artifact = { path: path.join(root, "report.json"), value: {} };
    const classification = fullDecision.buildClassificationDecisionFullContextBlockers({
      ...common,
      classificationDecisionApplyArtifact: artifact,
      classificationDecisionApplyContext: null,
    });
    assert.deepEqual(
      classification.slice(0, 3).map((blocker: JsonRecord) => blocker.code),
      [
        "full_context_ai_classification_apply_not_completed",
        "full_context_ai_classification_decision_task_required",
        "full_context_ai_classification_rows_mismatch",
      ],
    );
    assert.equal(
      classification.at(-1)?.code,
      "full_context_ai_classification_decision_evidence_required",
    );

    const location = fullDecision.buildLocationDecisionFullContextBlockers({
      ...common,
      locationDecisionApplyArtifact: artifact,
      locationDecisionApplyContext: null,
    });
    assert.deepEqual(
      location.slice(0, 3).map((blocker: JsonRecord) => blocker.code),
      [
        "full_context_ai_location_apply_not_completed",
        "full_context_ai_location_decision_task_required",
        "full_context_ai_location_rows_mismatch",
      ],
    );

    const identity = fullDecision.buildIdentityDecisionFullContextBlockers({
      ...common,
      identityDecisionApplyArtifact: artifact,
      identityDecisionApplyContext: null,
    });
    assert.deepEqual(
      identity.map((blocker: JsonRecord) => blocker.code),
      [
        "full_context_ai_identity_apply_not_completed",
        "full_context_ai_identity_rows_mismatch",
        "full_context_ai_identity_decision_evidence_required",
      ],
    );
  });
});

test("location apply reader preserves source label and native report aliases", () => {
  const context = fullDecision.readLocationDecisionApplyContext("/repo", {
    path: "/repo/report.json",
    value: { status: " completed ", decisions: [] },
  });
  assert.ok(context);
  assert.equal(context.status, "completed");
  assert.deepEqual(context.decisionTaskProofs, []);
});

test("decision full-context retains its exact export surface", () => {
  assert.deepEqual(Object.keys(fullDecision).sort(), [
    "buildClassificationDecisionFullContextBlockers",
    "buildIdentityDecisionFullContextBlockers",
    "buildLocationDecisionFullContextBlockers",
    "classificationDecisionCompletionStatus",
    "classificationDecisionContextBundleSha256",
    "classificationDecisionContextKinds",
    "decisionApplyContextCoversExpectedRowsIdentity",
    "decisionApplyContextRelevantToExpectedRowsFile",
    "decisionApplyContextRelevantToRowsFile",
    "decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization",
    "decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization",
    "decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization",
    "decisionTaskContextBundleHashesFromContext",
    "decisionTaskProofListFromContext",
    "identityDecisionApplyProvesReferenceRewrite",
    "readLocationDecisionApplyContext",
  ]);
});
