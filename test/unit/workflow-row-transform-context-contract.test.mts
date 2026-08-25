import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as transforms from "../../scripts/lib/import-curation/internal/workflow-row-transform-context.mjs";
import { sha256Json } from "../../scripts/lib/import-curation/internal/hash-utils.ts";

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

test("unresolved externalization context preserves aliases, trace order/counts, paths, payload hashes, and native errors", () => {
  withTempRoot("row-transform-unresolved", (root) => {
    assert.equal(transforms.readUnresolvedExchangeExternalizationContext(root, null), null);
    const inputPayload = { processDataSet: { marker: "input" } };
    const outputOld = { processDataSet: { marker: "old" } };
    const outputNew = { processDataSet: { marker: "new" } };
    writeJsonLines(path.join(root, "rows", "input.jsonl"), [
      { id: "process-id", version: "01.00.000", payload: inputPayload },
    ]);
    writeJsonLines(path.join(root, "rows", "output.jsonl"), [
      { id: "process-id", version: "01.00.000", payload: outputOld },
      { id: "process-id", version: "01.00.000", payload: outputNew },
    ]);
    const tracesPath = path.join(root, "traces", "unresolved.jsonl");
    writeJsonLines(tracesPath, [
      { dataset_id: "process-id", dataset_version: "01.00.000", marker: "first" },
      { entity_id: "process-id", version: "01.00.000", marker: "second" },
      { dataset_id: "other", marker: "other" },
      { marker: "missing-id" },
    ]);
    const reportPath = path.join(root, "reports", "externalization.json");
    const artifact = {
      path: reportPath,
      value: {
        status: " completed ",
        inputRowsFile: "rows/input.jsonl",
        files: {
          outputRows: "rows/output.jsonl",
          unresolved_exchanges: "traces/unresolved.jsonl",
        },
        counts: { externalized_exchanges: "3", affected_rows: 2 },
      },
    };
    const context = transforms.readUnresolvedExchangeExternalizationContext(root, artifact);
    assert.equal(context.status, "completed");
    assert.equal(context.inputRowsFile, path.join(root, "rows", "input.jsonl"));
    assert.equal(context.outputRowsFile, path.join(root, "rows", "output.jsonl"));
    assert.equal(context.tracesFile, tracesPath);
    assert.equal(context.reportPathRelative, "reports/externalization.json");
    assert.equal(context.externalizedExchanges, 3);
    assert.equal(context.affectedRows, 2);
    assert.deepEqual(
      [...context.affectedKeys],
      ["process:process-id@@01.00.000", "process:other@@00.00.001"],
    );
    assert.deepEqual(
      [...context.externalizedExchangeCountByIdentity],
      [
        ["process:process-id@@01.00.000", 2],
        ["process:other@@00.00.001", 1],
      ],
    );
    assert.deepEqual(
      [...context.inputPayloadSha256ByIdentity],
      [["process:process-id@@01.00.000", sha256Json(inputPayload)]],
    );
    assert.deepEqual(
      [...context.outputPayloadSha256ByIdentity],
      [["process:process-id@@01.00.000", sha256Json(outputNew)]],
    );
    assert.deepEqual(
      transforms
        .unresolvedExchangeExternalizationRowsForIdentity(context, {
          id: "process-id",
          version: "01.00.000",
        })
        .map((row: JsonRecord) => row.marker),
      ["first", "second"],
    );
    assert.deepEqual(
      transforms.unresolvedExchangeExternalizationRowsForIdentity(context, { id: "missing" }),
      [],
    );
    assert.equal(
      transforms.rowsFileChainsThroughUnresolvedExchangeExternalization({
        repoRoot: root,
        upstreamFile: "rows/input.jsonl",
        finalFile: "rows/output.jsonl",
        unresolvedExchangeExternalizationContext: context,
      }),
      true,
    );

    writeText(tracesPath, "{bad}\n");
    assert.throws(
      () => transforms.readUnresolvedExchangeExternalizationContext(root, artifact),
      (error: unknown) => error instanceof SyntaxError,
    );
    assert.throws(
      () =>
        transforms.readUnresolvedExchangeExternalizationContext(root, {
          path: null,
          value: {},
        }),
      (error: unknown) => error instanceof TypeError,
    );
  });
});

test("canonical and generic row-transform contexts preserve blocker modes, aliases, proofs, paths, and hashes", () => {
  withTempRoot("row-transform-reports", (root) => {
    const inputPayload = { flowDataSet: { marker: "input" } };
    const outputPayload = { flowDataSet: { marker: "output" } };
    writeJsonLines(path.join(root, "rows", "input.jsonl"), [
      { id: "flow-id", version: "01.00.000", payload: inputPayload },
    ]);
    writeJsonLines(path.join(root, "rows", "output.jsonl"), [
      { id: "flow-id", version: "01.00.000", payload: outputPayload },
    ]);
    writeJsonLines(path.join(root, "reports", "blockers.jsonl"), [
      { code: "first" },
      { code: "second" },
    ]);
    writeJsonLines(path.join(root, "reports", "rewrites.jsonl"), [{ marker: "rewrite" }]);
    const canonicalArtifact = {
      path: path.join(root, "reports", "canonical.json"),
      value: {
        status: "blocked",
        rowsFile: "rows/input.jsonl",
        outputRowsFile: "rows/output.jsonl",
        counts: { rewrites: 1 },
        files: {
          blockers: "reports/blockers.jsonl",
          canonical_support_rewrites: "reports/rewrites.jsonl",
          deferredRows: "rows/deferred.jsonl",
        },
      },
    };
    const canonical = transforms.readCanonicalSupportRewriteContext(root, canonicalArtifact);
    assert.equal(canonical.status, "blocked");
    assert.deepEqual(canonical.blockers, [{ code: "first" }, { code: "second" }]);
    assert.deepEqual(canonical.deferredBlockers, []);
    assert.deepEqual(canonical.rewrites, [{ marker: "rewrite" }]);
    assert.equal(canonical.blockersFileRelative, "reports/blockers.jsonl");
    assert.equal(canonical.deferredRowsFileRelative, "rows/deferred.jsonl");
    assert.deepEqual(
      [...canonical.inputPayloadSha256ByIdentity],
      [["flow:flow-id@@01.00.000", sha256Json(inputPayload)]],
    );
    assert.deepEqual(
      [...canonical.outputPayloadSha256ByIdentity],
      [["flow:flow-id@@01.00.000", sha256Json(outputPayload)]],
    );

    const explicitBlockers = [{ code: "explicit" }];
    const explicit = transforms.readCanonicalSupportRewriteContext(root, {
      ...canonicalArtifact,
      value: { ...canonicalArtifact.value, blockers: explicitBlockers },
    });
    assert.equal(explicit.blockers, explicitBlockers);
    const deferred = transforms.readCanonicalSupportRewriteContext(root, {
      ...canonicalArtifact,
      value: { ...canonicalArtifact.value, status: "completed_with_deferred_rows" },
    });
    assert.deepEqual(deferred.deferredBlockers, [{ code: "first" }, { code: "second" }]);

    const proof = { dataset_id: "flow-id", trace_hash: "trace" };
    const genericArtifact = {
      path: path.join(root, "reports", "cleanup.json"),
      value: {
        status: "ready_with_profile_waivers",
        inputPath: "rows/input.jsonl",
        files: { cleanedRows: "rows/output.jsonl" },
        proofs: { source_exchange_completeness: [proof] },
      },
    };
    const generic = transforms.readRowsFileTransformContext(root, genericArtifact, "custom");
    assert.equal(generic.kind, "custom");
    assert.deepEqual(generic.sourceExchangeCompletenessProofs, [proof]);
    assert.equal(
      transforms.readSourceContactRewriteContext(root, genericArtifact).kind,
      "source_contact_rewrite",
    );
    assert.equal(
      transforms.readCleanupTransformContext(root, genericArtifact).kind,
      "curation_cleanup",
    );
    assert.equal(transforms.readRowsFileTransformContext(root, null, "none"), null);
  });
});

test("transform entry factories preserve cross-product and fixed aggregation order with status gates", () => {
  const hashes = new Map([["key", "hash"]]);
  const decision = {
    status: "completed",
    inputRows: ["input-a", "input-b"],
    outputRows: ["output-a", "output-b"],
    inputPayloadSha256ByIdentity: hashes,
    outputPayloadSha256ByIdentity: hashes,
  };
  assert.deepEqual(transforms.rowsFileTransformEntriesFromDecisionApply(decision, "decision"), [
    {
      kind: "decision",
      inputRowsFile: "input-a",
      outputRowsFile: "output-a",
      inputPayloadSha256ByIdentity: hashes,
      outputPayloadSha256ByIdentity: hashes,
    },
    {
      kind: "decision",
      inputRowsFile: "input-a",
      outputRowsFile: "output-b",
      inputPayloadSha256ByIdentity: hashes,
      outputPayloadSha256ByIdentity: hashes,
    },
    {
      kind: "decision",
      inputRowsFile: "input-b",
      outputRowsFile: "output-a",
      inputPayloadSha256ByIdentity: hashes,
      outputPayloadSha256ByIdentity: hashes,
    },
    {
      kind: "decision",
      inputRowsFile: "input-b",
      outputRowsFile: "output-b",
      inputPayloadSha256ByIdentity: hashes,
      outputPayloadSha256ByIdentity: hashes,
    },
  ]);
  assert.deepEqual(
    transforms.rowsFileTransformEntriesFromDecisionApply({ ...decision, status: "blocked" }, "x"),
    [],
  );
  const patch = {
    inputRowsFile: "patch-in",
    outputRows: ["patch-a", "patch-b"],
    inputPayloadSha256ByIdentity: hashes,
    outputPayloadSha256ByIdentity: hashes,
  };
  assert.deepEqual(
    transforms
      .rowsFileTransformEntriesFromPatchApply(patch)
      .map((entry: JsonRecord) => entry.outputRowsFile),
    ["patch-a", "patch-b"],
  );
  const identityRewrite = {
    inputRowsFile: "identity-in",
    outputRowsFile: "identity-out",
    inputPayloadSha256ByIdentity: hashes,
    outputPayloadSha256ByIdentity: hashes,
  };
  assert.equal(
    transforms.rowsFileTransformEntryFromIdentityReferenceRewrite(identityRewrite)[0].kind,
    "identity_reference_rewrite",
  );
  const unresolved = {
    status: "completed",
    inputRowsFile: "unresolved-in",
    outputRowsFile: "unresolved-out",
    inputPayloadSha256ByIdentity: hashes,
    outputPayloadSha256ByIdentity: hashes,
  };
  assert.equal(
    transforms.rowsFileTransformEntryFromUnresolvedExchangeExternalization(unresolved)[0].kind,
    "unresolved_exchange_externalization",
  );
  assert.deepEqual(
    transforms.rowsFileTransformEntryFromUnresolvedExchangeExternalization({
      ...unresolved,
      status: "blocked",
    }),
    [],
  );
  const canonical = {
    status: "blocked",
    inputRowsFile: "canonical-in",
    outputRowsFile: "canonical-out",
    inputPayloadSha256ByIdentity: hashes,
    outputPayloadSha256ByIdentity: hashes,
  };
  assert.equal(
    transforms.rowsFileTransformEntryFromCanonicalSupportRewrite(canonical)[0].kind,
    "canonical_support_rewrite",
  );
  assert.deepEqual(
    transforms.rowsFileTransformEntryFromCanonicalSupportRewrite({
      ...canonical,
      status: "invalid",
    }),
    [],
  );
  const generic = {
    kind: "stored-kind",
    status: "ready",
    inputRowsFile: "generic-in",
    outputRowsFile: "generic-out",
    inputPayloadSha256ByIdentity: hashes,
    outputPayloadSha256ByIdentity: hashes,
  };
  assert.equal(
    transforms.rowsFileTransformEntryFromRowsFileContext(generic, "")[0].kind,
    "stored-kind",
  );
  assert.deepEqual(
    transforms.rowsFileTransformEntryFromRowsFileContext({ ...generic, status: "blocked" }, "x"),
    [],
  );

  const all = transforms.deterministicRowsFileTransformEntries({
    patchApplyContext: patch,
    classificationDecisionApplyContext: {
      ...decision,
      inputRows: ["class-in"],
      outputRows: ["class-out"],
    },
    locationDecisionApplyContext: {
      ...decision,
      inputRows: ["location-in"],
      outputRows: ["location-out"],
    },
    identityDecisionApplyContext: {
      ...decision,
      inputRows: ["decision-in"],
      outputRows: ["decision-out"],
    },
    identityReferenceRewriteContext: identityRewrite,
    unresolvedExchangeExternalizationContext: unresolved,
    sourceContactRewriteContext: {
      ...generic,
      inputRowsFile: "source-in",
      outputRowsFile: "source-out",
    },
    canonicalSupportRewriteContext: canonical,
    cleanupContext: { ...generic, inputRowsFile: "cleanup-in", outputRowsFile: "cleanup-out" },
  });
  assert.deepEqual(
    all.map((entry: JsonRecord) => entry.kind),
    [
      "patch_apply",
      "patch_apply",
      "classification_decision_apply",
      "location_decision_apply",
      "identity_decision_apply",
      "identity_reference_rewrite",
      "unresolved_exchange_externalization",
      "source_contact_rewrite",
      "canonical_support_rewrite",
      "curation_cleanup",
    ],
  );
});

test("artifact equality and transform graph preserve exact/content identity, unordered passes, cycles, and failure envelopes", () => {
  withTempRoot("row-transform-graph", (root) => {
    const start = path.join(root, "start.jsonl");
    const copy = path.join(root, "copy.jsonl");
    const middle = path.join(root, "middle.jsonl");
    const final = path.join(root, "final.jsonl");
    writeText(start, '{"value":1}\n');
    writeText(copy, '{"value":1}\n');
    writeText(middle, '{"value":2}\n');
    writeText(final, '{"value":3}\n');
    assert.equal(transforms.sameRowsArtifact(root, "start.jsonl", "start.jsonl"), true);
    assert.equal(transforms.sameRowsArtifact(root, "start.jsonl", "copy.jsonl"), true);
    assert.equal(transforms.sameRowsArtifact(root, "start.jsonl", "middle.jsonl"), false);
    assert.equal(transforms.sameRowsArtifact(root, "missing-a", "missing-b"), false);
    assert.equal(
      transforms.rowsFileReachableThroughTransformChain({
        repoRoot: root,
        startFiles: ["start.jsonl", "copy.jsonl"],
        expectedRowsFile: "final.jsonl",
        transforms: [
          { inputRowsFile: "middle.jsonl", outputRowsFile: "final.jsonl" },
          { inputRowsFile: "copy.jsonl", outputRowsFile: "middle.jsonl" },
          { inputRowsFile: "final.jsonl", outputRowsFile: "middle.jsonl" },
        ],
      }),
      true,
    );
    assert.equal(
      transforms.rowsFileReachableThroughTransformChain({
        repoRoot: root,
        startFiles: ["start.jsonl"],
        expectedRowsFile: "unreachable.jsonl",
        transforms: [{ inputRowsFile: "start.jsonl", outputRowsFile: "middle.jsonl" }],
      }),
      false,
    );
    assert.equal(
      transforms.rowsFileReachableThroughTransformChain({
        repoRoot: root,
        startFiles: ["start.jsonl"],
        expectedRowsFile: null,
        transforms: [],
      }),
      false,
    );
  });
});

test("cleanup/decision path helpers and every direct chain combination preserve aliases and exact topology", () => {
  const root = "/repo";
  const cleanupArtifact = { value: { rowsFile: "cleanup-input" } };
  assert.equal(transforms.cleanupInputRowsFile(root, cleanupArtifact), "/repo/cleanup-input");
  assert.equal(
    transforms.decisionApplyExpectedRowsFile({
      repoRoot: root,
      rowsFile: "final",
      cleanupArtifact,
    }),
    "/repo/cleanup-input",
  );
  assert.equal(
    transforms.decisionApplyExpectedRowsFile({
      repoRoot: root,
      rowsFile: "final",
      cleanupArtifact: null,
    }),
    "final",
  );

  const classification = { status: "completed", inputRows: ["base"], outputRows: ["classified"] };
  const location = { status: "completed", inputRows: ["classified"], outputRows: ["located"] };
  const decision = { status: "completed", inputRows: ["base"], outputRows: ["located"] };
  const patch = { inputRowsFile: "located", outputRows: ["patched"] };
  const identity = { inputRowsFile: "patched", outputRowsFile: "identity" };
  const unresolved = {
    status: "completed",
    inputRowsFile: "identity",
    outputRowsFile: "externalized",
  };
  assert.equal(transforms.decisionApplyOutputRowsMatch(root, decision, "located"), true);
  assert.equal(transforms.decisionApplyInputRowsMatch(root, decision, "base"), true);
  assert.equal(
    transforms.decisionApplyOutputRowsChainThroughPatch(root, decision, patch, "patched"),
    true,
  );
  assert.equal(
    transforms.patchApplyOutputChainsThroughIdentityRewrite({
      repoRoot: root,
      patchOut: "patched",
      cleanupInput: "identity",
      identityReferenceRewriteContext: identity,
    }),
    true,
  );
  assert.equal(
    transforms.patchApplyOutputChainsThroughUnresolvedExchangeExternalization({
      repoRoot: root,
      patchOut: "identity",
      cleanupInput: "externalized",
      unresolvedExchangeExternalizationContext: unresolved,
    }),
    true,
  );
  assert.equal(
    transforms.patchApplyOutputChainsThroughIdentityRewriteAndUnresolvedExchangeExternalization({
      repoRoot: root,
      patchOut: "patched",
      cleanupInput: "externalized",
      identityReferenceRewriteContext: identity,
      unresolvedExchangeExternalizationContext: unresolved,
    }),
    true,
  );
  assert.equal(
    transforms.decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite(
      root,
      decision,
      patch,
      identity,
      "identity",
    ),
    true,
  );
  assert.equal(
    transforms.decisionApplyOutputRowsChainThroughIdentityRewrite(
      root,
      { ...decision, outputRows: ["patched"] },
      identity,
      "identity",
    ),
    true,
  );
  assert.equal(
    transforms.decisionApplyOutputRowsChainThroughIdentityRewriteAndUnresolvedExchangeExternalization(
      root,
      { ...decision, outputRows: ["patched"] },
      identity,
      unresolved,
      "externalized",
    ),
    true,
  );
  assert.equal(
    transforms.decisionApplyOutputRowsChainThroughClassification(
      root,
      { ...decision, outputRows: ["base"] },
      classification,
      "classified",
    ),
    true,
  );
  assert.equal(
    transforms.decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
      root,
      { ...decision, outputRows: ["base"] },
      { ...classification, outputRows: ["patched"] },
      identity,
      "identity",
    ),
    true,
  );
  assert.equal(
    transforms.decisionApplyOutputRowsChainThroughClassificationIdentityRewriteAndUnresolvedExchangeExternalization(
      root,
      { ...decision, outputRows: ["base"] },
      { ...classification, outputRows: ["patched"] },
      identity,
      unresolved,
      "externalized",
    ),
    true,
  );

  const reachable = transforms.decisionApplyOutputRowsReachableThroughDeterministicTransforms({
    repoRoot: root,
    context: { ...decision, outputRows: ["base"] },
    expectedRowsFile: "externalized",
    classificationDecisionApplyContext: classification,
    locationDecisionApplyContext: location,
    patchApplyContext: patch,
    identityReferenceRewriteContext: identity,
    unresolvedExchangeExternalizationContext: unresolved,
  });
  assert.equal(reachable, true);
  assert.equal(
    transforms.rowsFileChainsThroughUnresolvedExchangeExternalization({
      repoRoot: root,
      upstreamFile: "wrong",
      finalFile: "externalized",
      unresolvedExchangeExternalizationContext: unresolved,
    }),
    false,
  );
});

test("row transform context retains its exact export surface", () => {
  assert.deepEqual(Object.keys(transforms).sort(), [
    "cleanupInputRowsFile",
    "decisionApplyExpectedRowsFile",
    "decisionApplyInputRowsMatch",
    "decisionApplyOutputRowsChainThroughClassification",
    "decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite",
    "decisionApplyOutputRowsChainThroughClassificationIdentityRewriteAndUnresolvedExchangeExternalization",
    "decisionApplyOutputRowsChainThroughIdentityRewrite",
    "decisionApplyOutputRowsChainThroughIdentityRewriteAndUnresolvedExchangeExternalization",
    "decisionApplyOutputRowsChainThroughPatch",
    "decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite",
    "decisionApplyOutputRowsMatch",
    "decisionApplyOutputRowsReachableThroughDeterministicTransforms",
    "deterministicRowsFileTransformEntries",
    "patchApplyOutputChainsThroughIdentityRewrite",
    "patchApplyOutputChainsThroughIdentityRewriteAndUnresolvedExchangeExternalization",
    "patchApplyOutputChainsThroughUnresolvedExchangeExternalization",
    "readCanonicalSupportRewriteContext",
    "readCleanupTransformContext",
    "readRowsFileTransformContext",
    "readSourceContactRewriteContext",
    "readUnresolvedExchangeExternalizationContext",
    "rowsFileChainsThroughUnresolvedExchangeExternalization",
    "rowsFileReachableThroughTransformChain",
    "rowsFileTransformEntriesFromDecisionApply",
    "rowsFileTransformEntriesFromPatchApply",
    "rowsFileTransformEntryFromCanonicalSupportRewrite",
    "rowsFileTransformEntryFromIdentityReferenceRewrite",
    "rowsFileTransformEntryFromRowsFileContext",
    "rowsFileTransformEntryFromUnresolvedExchangeExternalization",
    "sameRowsArtifact",
    "unresolvedExchangeExternalizationRowsForIdentity",
  ]);
});
