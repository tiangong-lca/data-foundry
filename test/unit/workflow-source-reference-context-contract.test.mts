import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as sourceModule from "../../scripts/lib/import-curation/internal/workflow-source-reference-context.mjs";
import { referenceKey } from "../../scripts/lib/import-curation/internal/workflow-reference-closure.ts";

type JsonRecord = Record<string, unknown>;

function writeJsonLines(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function rewriteRow({
  id,
  version,
  relation = "dataset_format_source",
  canonical,
}: {
  id: string;
  version?: string;
  relation?: string;
  canonical?: JsonRecord;
}): JsonRecord {
  return {
    dataset_type: "process",
    dataset_id: id,
    ...(version ? { dataset_version: version } : {}),
    relation,
    path: "/referenceToDataSource",
    canonical: canonical ?? {
      ref_object_id: "a97a0155-0234-4b87-b4ce-a45da52f2a40",
      version: "03.00.003",
    },
  };
}

test("source reference context preserves its complete export surface and public key order", () => {
  assert.deepEqual(Object.keys(sourceModule), [
    "publicCanonicalSourceReferenceKeys",
    "readSourceReferenceRewriteContext",
    "sourceContactSupportCanonicalUnitGroupProofKeys",
    "sourceContactSupportTrueSourceProofKeys",
    "sourceReferenceRewriteProofKeys",
  ]);
  assert.deepEqual(
    [...sourceModule.publicCanonicalSourceReferenceKeys],
    [
      referenceKey({
        table: "sources",
        id: "a97a0155-0234-4b87-b4ce-a45da52f2a40",
        version: "03.00.003",
      }),
      referenceKey({
        table: "sources",
        id: "d92a1a12-2545-49e2-a585-55c259997756",
        version: "20.20.002",
      }),
    ],
  );
});

test("configured and fallback rewrite files preserve source, scope, and identity order", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-source-reference-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rowsFile = path.join(root, "run", "rows", "processes.jsonl");
  writeJsonLines(rowsFile, []);
  const defaultFile = path.join(path.dirname(rowsFile), "source-reference-rewrites.jsonl");
  const defaultRows = [
    rewriteRow({ id: "process-a", version: "01.00.000" }),
    rewriteRow({ id: "process-b" }),
    rewriteRow({ id: "foreign-process", version: "00.00.001" }),
    rewriteRow({ id: "process-a", version: "01.00.000", relation: "compliance_system_source" }),
  ];
  writeJsonLines(defaultFile, defaultRows);
  const writeRows = new Map([
    ["process-a@@01.00.000", { identity: { id: "process-a" } }],
    ["process-b@@02.00.000", { identity: { id: "process-b" } }],
  ]);

  const fallback = sourceModule.readSourceReferenceRewriteContext({
    repoRoot: root,
    rowsFile,
    options: {},
    writeRows,
  });
  assert.equal(fallback.sourceFile, defaultFile);
  assert.equal(fallback.sourceRows.length, 4);
  assert.deepEqual(
    fallback.scopedRows.map((row) => [row.dataset_id, row.dataset_version, row.relation]),
    [
      ["process-a", "01.00.000", "dataset_format_source"],
      ["process-b", "00.00.001", "dataset_format_source"],
      ["process-a", "01.00.000", "compliance_system_source"],
    ],
  );
  assert.deepEqual(
    (fallback.byIdentity.get("process-a@@01.00.000") ?? []).map((row) => row.relation),
    ["dataset_format_source", "compliance_system_source"],
  );
  assert.deepEqual(
    (fallback.byIdentity.get("process-b@@00.00.001") ?? []).map((row) => row.dataset_id),
    ["process-b"],
  );

  const explicitFile = path.join(root, "explicit.jsonl");
  writeJsonLines(explicitFile, [rewriteRow({ id: "process-b", version: "02.00.000" })]);
  const explicit = sourceModule.readSourceReferenceRewriteContext({
    repoRoot: root,
    rowsFile,
    options: {
      sourceReferenceRewrites: "explicit.jsonl",
      sourceReferenceRewritesFile: "missing-should-not-win.jsonl",
    },
    writeRows,
  });
  assert.equal(explicit.sourceFile, explicitFile);
  assert.deepEqual(
    explicit.scopedRows.map((row) => row.dataset_version),
    ["02.00.000"],
  );
});

test("only public canonical source relations become proof keys while support proof order stays exact", () => {
  const publicA = {
    ref_object_id: "a97a0155-0234-4b87-b4ce-a45da52f2a40",
    version: "03.00.003",
  };
  const publicB = {
    ref_object_id: "d92a1a12-2545-49e2-a585-55c259997756",
    version: "20.20.002",
  };
  const proofKeys = sourceModule.sourceReferenceRewriteProofKeys({
    scopedRows: [
      rewriteRow({ id: "self", relation: "dataset_format_source", canonical: publicA }),
      rewriteRow({ id: "self", relation: "true_source", canonical: publicB }),
      rewriteRow({
        id: "foreign",
        relation: "dataset_format_source",
        canonical: { ref_object_id: "foreign-source", version: "00.00.001" },
      }),
      rewriteRow({ id: "self", relation: "compliance_system_source", canonical: publicB }),
    ],
  });
  assert.deepEqual(
    [...proofKeys],
    [
      referenceKey({ table: "sources", id: publicA.ref_object_id, version: publicA.version }),
      referenceKey({ table: "sources", id: publicB.ref_object_id, version: publicB.version }),
    ],
  );

  const trueSourceKeys = sourceModule.sourceContactSupportTrueSourceProofKeys({
    artifact: {
      value: {
        source_support: {
          referenced_true_source_keys: [
            { id: "source-one" },
            { id: "" },
            { id: "source-two", version: "02.00.000" },
          ],
        },
      },
    },
  });
  assert.deepEqual(
    [...trueSourceKeys],
    [
      referenceKey({ table: "sources", id: "source-one", version: "00.00.001" }),
      referenceKey({ table: "sources", id: "source-two", version: "02.00.000" }),
    ],
  );

  const unitGroupKeys = sourceModule.sourceContactSupportCanonicalUnitGroupProofKeys({
    artifact: {
      value: {
        canonical_support: {
          canonical_unit_group_reference_keys: [
            { id: "unit-one", version: "01.00.000" },
            { id: "unit-missing-version" },
            { id: "unit-two", version: "02.00.000" },
          ],
        },
      },
    },
  });
  assert.deepEqual(
    [...unitGroupKeys],
    [
      referenceKey({ table: "unitgroups", id: "unit-one", version: "01.00.000" }),
      referenceKey({ table: "unitgroups", id: "unit-two", version: "02.00.000" }),
    ],
  );
});

test("malformed readable fallback JSONL retains native SyntaxError", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-source-reference-error-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, []);
  fs.writeFileSync(path.join(path.dirname(rowsFile), "source-reference-rewrites.jsonl"), "{");
  assert.throws(
    () =>
      sourceModule.readSourceReferenceRewriteContext({
        repoRoot: root,
        rowsFile,
        options: {},
        writeRows: new Map(),
      }),
    SyntaxError,
  );
});
