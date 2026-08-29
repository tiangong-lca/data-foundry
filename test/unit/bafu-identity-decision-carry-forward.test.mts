import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBafuIdentityDecisionCarryForwardService } from "../../scripts/lib/bafu-orchestration/identity-decision-carry-forward.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonLines(filePath: string): unknown[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "",
  );
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function datasetIdentity(
  rowValue: unknown,
  datasetType: string,
): {
  id?: string | null;
  version?: string | null;
} {
  const row = record(rowValue);
  const root = record(row[`${datasetType}DataSet`] ?? row);
  const informationRoot = record(
    root[`${datasetType}Information`] ??
      (datasetType === "flowproperty" ? root.flowPropertiesInformation : undefined),
  );
  const information = record(
    informationRoot.dataSetInformation ?? informationRoot["common:dataSetInformation"],
  );
  const administrative = record(root.administrativeInformation);
  const publication = record(
    administrative.publicationAndOwnership ?? administrative["common:publicationAndOwnership"],
  );
  return {
    id: text(information["common:UUID"] ?? information.UUID ?? row.dataset_id ?? row.id),
    version:
      text(
        publication["common:dataSetVersion"] ??
          publication.dataSetVersion ??
          row.dataset_version ??
          row.version,
      ) || "00.00.001",
  };
}

test("BAFU carry-forward keeps duplicate-source precedence, exact package projection, rewrites, cache invalidation, and report bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-bafu-identity-carry-"));
  const runDir = path.join(root, "run");
  const firstDecisionDir = path.join(runDir, "decisions-00-library");
  const duplicateDecisionDir = path.join(runDir, "decisions-10-duplicate");
  const taskDir = path.join(root, "scope", "identity-task");
  const decisionsFile = path.join(taskDir, "identity-decisions.jsonl");
  const rowsFile = path.join(root, "scope", "flows.materialized.jsonl");
  const gateReportPath = path.join(root, "scope", "curation-gate-report.json");
  const gatePackagePath = path.join(root, "packages", "flow-b.authoring-package.json");
  const resolutionDir = path.join(root, "library-resolution");
  const resultCacheDir = path.join(root, "identity-result-cache");
  const flowA = "11111111-2222-4333-8444-555555555551";
  const flowB = "11111111-2222-4333-8444-555555555552";
  const flowC = "11111111-2222-4333-8444-555555555553";
  const canonicalA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
  const canonicalB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";

  const firstReusableA = {
    schema_version: 1,
    datasetType: "flow",
    datasetId: flowA,
    datasetVersion: "00.00.001",
    decisionStatus: "completed",
    decision: "reuse",
    selectedReference: {
      table: "flows",
      refObjectId: canonicalA,
      ref_version: "03.00.004",
      shortDescription: [
        { "@xml:lang": "en", "#text": "First canonical flow" },
        { "@xml:lang": "zh", "#text": "首个标准流" },
      ],
    },
    reason: "The lexically first decision source is authoritative for equal canonical reuse.",
    used_context_kinds: ["library_index", "identity_preflight"],
    closes_action_items: ["library_reuse"],
    evidence: { source: "decisions-00-library" },
  };
  const reusableB = {
    schema_version: 1,
    dataset_type: "flow",
    dataset_id: flowB,
    dataset_version: "00.00.001",
    decision_status: "completed",
    identity_decision: "reuse_existing_reference",
    canonical: {
      table: "flows",
      ref_object_id: canonicalB,
      version: "03.00.004",
      short_description: "library-only reusable flow",
    },
    basis: "Library resolution proves physical equivalence for a row without a scope task.",
    used_context_kinds: ["library_index", "scope_projection"],
    closes_action_items: ["elementary_flow_identity_manual_review"],
    evidence: { source: "library-resolution" },
  };
  const duplicateReusableA = {
    ...firstReusableA,
    reason: "A later equal-canonical duplicate must not replace the first source row.",
    evidence: { source: "decisions-10-duplicate" },
  };
  const incompleteC = {
    schema_version: 1,
    dataset_type: "flow",
    dataset_id: flowC,
    dataset_version: "00.00.001",
    decision_status: "needs_review",
    identity_decision: "reuse_existing_reference",
    canonical: {
      table: "flows",
      ref_object_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3",
      version: "03.00.004",
    },
    basis: "Incomplete decisions are never reusable.",
    evidence: { source: "manual-review" },
  };
  const unresolvedA = {
    schema_version: 1,
    source_dataset_id: flowA,
    source_dataset_version: "00.00.001",
    decision_status: "completed",
    identity_decision: "block_unresolved",
    canonical: null,
    basis: "The scope-specific search did not resolve this flow.",
    authoring_package: "scope/current-flow-a.authoring-package.json",
    authoring_package_sha256: "current-flow-a-sha",
    used_context_kinds: ["schema", "ruleset"],
    closes_action_items: ["scope_identity_review"],
    evidence: { source: "scope-autofill" },
  };
  const unresolvedC = {
    schema_version: 1,
    dataset_type: "flow",
    dataset_id: flowC,
    dataset_version: "00.00.001",
    decision_status: "completed",
    identity_decision: "block_unresolved",
    canonical: null,
    basis: "No completed reusable library decision exists.",
    used_context_kinds: ["schema"],
    closes_action_items: ["scope_identity_review"],
    evidence: { source: "scope-autofill" },
  };

  writeJsonLines(path.join(firstDecisionDir, "identity-decisions.jsonl"), [
    firstReusableA,
    reusableB,
    incompleteC,
  ]);
  writeJsonLines(path.join(duplicateDecisionDir, "identity-decisions.jsonl"), [duplicateReusableA]);
  writeJsonLines(decisionsFile, [unresolvedA, unresolvedC]);
  writeJsonLines(rowsFile, [
    {
      flowDataSet: {
        flowInformation: { dataSetInformation: { "common:UUID": flowA } },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    },
    {
      flowDataSet: {
        flowInformation: { dataSetInformation: { "common:UUID": flowB } },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    },
    {
      flowDataSet: {
        flowInformation: { dataSetInformation: { "common:UUID": flowB } },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    },
  ]);
  writeJson(gatePackagePath, {
    schema_version: 1,
    dataset_type: "flow",
    entity_id: flowB,
    contract_context_files: [
      { kind: "schema", text: "{}" },
      { kind: "methodology_yaml", text: "rules: []" },
      { kind: "ruleset", text: "{}" },
      { kind: "classification_schema", text: "{}" },
      { kind: "classification_schema", text: "duplicate kind" },
      { kind: "location_schema", text: "{}" },
      { kind: "empty_context", text: "" },
    ],
  });
  const gatePackageSha = sha256(fs.readFileSync(gatePackagePath));
  writeJson(gateReportPath, {
    schema_version: 1,
    flows: [
      {
        entity_id: flowB,
        authoring_package: "packages/flow-b.authoring-package.json",
        authoring_package_sha256: gatePackageSha,
      },
    ],
  });
  writeJsonLines(path.join(resolutionDir, "exchange-reference-rewrites.jsonl"), [
    { process_id: "process-b", exchange_index: 7, source_flow_id: flowB },
    { process_id: "process-a", exchange_index: 2, source_flow_id: flowA },
    { process_id: "process-b", exchange_index: 3, source_flow_id: flowA },
    { process_id: "", exchange_index: 99, source_flow_id: flowC },
  ]);

  const matchingCacheDir = path.join(resultCacheDir, "matching-entry");
  const otherCacheDir = path.join(resultCacheDir, "other-entry");
  const invalidCacheDir = path.join(resultCacheDir, "invalid-entry");
  writeJson(path.join(matchingCacheDir, "foundry-identity-preflight-execution.json"), {
    binding: { dataset: { type: "flow", id: flowA, version: "00.00.001" } },
  });
  writeJson(path.join(otherCacheDir, "foundry-identity-preflight-execution.json"), {
    binding: { dataset: { type: "flow", id: flowB, version: "00.00.001" } },
  });
  fs.mkdirSync(invalidCacheDir, { recursive: true });
  fs.writeFileSync(
    path.join(invalidCacheDir, "foundry-identity-preflight-execution.json"),
    "not-json\n",
  );

  const repoRelative = (filePath: string | null | undefined): string | null =>
    filePath ? path.relative(root, filePath).split(path.sep).join(path.posix.sep) : null;
  const service = createBafuIdentityDecisionCarryForwardService({
    nowIso: () => "2026-08-26T12:34:56.000Z",
    repoRelative,
    resolveRepoPath: (value: unknown) => {
      const valueText = text(value);
      return valueText
        ? path.isAbsolute(valueText)
          ? valueText
          : path.join(root, valueText)
        : null;
    },
    datasetIdentity,
    resultCacheDirectory: () => resultCacheDir,
    fs: {
      fileExists: (filePath: string | null | undefined) =>
        Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()),
      directoryExists: (filePath: string | null | undefined) =>
        Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()),
      readDirectory: (directory: string) =>
        fs.readdirSync(directory, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        })),
      readJson,
      readJsonLines,
      writeJson,
      writeJsonLines,
      ensureDirectory: (directory: string) => fs.mkdirSync(directory, { recursive: true }),
      copyFile: (source: string, destination: string) => fs.copyFileSync(source, destination),
      readText: (filePath: string) => fs.readFileSync(filePath, "utf8"),
      removeDirectory: (directory: string) =>
        fs.rmSync(directory, { recursive: true, force: true }),
    },
    path: {
      join: (...parts: string[]) => path.join(...parts),
      basename: (filePath: string) => path.basename(filePath),
      parse: (filePath: string) => path.parse(filePath),
    },
    hash: { sha256File: (filePath: string) => sha256(fs.readFileSync(filePath)) },
  });

  try {
    const result = service.mergeCompletedReusableIdentityDecisions({
      runDir,
      decisionsFile,
      outDir: taskDir,
      datasetType: "flow",
      rowsFile,
      curationGateReport: gateReportPath,
    });

    const snapshotPath = path.join(
      taskDir,
      "authoring-package-snapshots",
      `flow-b.authoring-package.${gatePackageSha}.snapshot.json`,
    );
    assert.equal(fs.readFileSync(snapshotPath, "utf8"), fs.readFileSync(gatePackagePath, "utf8"));
    assert.equal(sha256(fs.readFileSync(snapshotPath)), gatePackageSha);
    assert.equal(result.report.counts.replacements, 1);
    assert.equal(result.report.counts.additions, 1);
    assert.equal(result.report.counts.reusable_decisions, 2);
    assert.equal(result.report.counts.conflicts, 0);
    assert.equal(
      result.report.replacements[0].source_file,
      repoRelative(path.join(firstDecisionDir, "identity-decisions.jsonl")),
    );
    assert.equal(
      (readJsonLines(result.outputFile)[0] as JsonRecord).reason,
      firstReusableA.reason,
      "a later equal-canonical decision must not replace the lexically first source",
    );
    const canonicalDescription = [
      { "@xml:lang": "en", "#text": "First canonical flow" },
      { "@xml:lang": "zh", "#text": "首个标准流" },
    ];
    assert.deepEqual(
      record(record(readJsonLines(result.outputFile)[0]).selectedReference).shortDescription,
      canonicalDescription,
    );
    assert.deepEqual(
      record(record(result.report.replacements[0]).canonical).short_description,
      canonicalDescription,
    );

    const rewrites = service.loadResolutionRewritesByProcess("library-resolution");
    assert.deepEqual([...rewrites.keys()], ["process-b", "process-a"]);
    assert.deepEqual(
      rewrites.get("process-b")?.map((row) => row.exchange_index),
      [7, 3],
    );

    assert.equal(
      service.invalidateIdentityPreflightResultCacheEntry(`flow:${flowA}@00.00.001`),
      true,
    );
    assert.equal(fs.existsSync(matchingCacheDir), false);
    assert.equal(fs.existsSync(otherCacheDir), true);
    assert.equal(fs.existsSync(invalidCacheDir), true);

    const outputBytes = fs.readFileSync(result.outputFile, "utf8");
    const reportBytes = fs.readFileSync(result.reportPath, "utf8");
    assert.equal(
      sha256(outputBytes),
      "1a5fb2987c613de05c71c4acb05bb065d19ebe3872597b16e7dd68a5fdb030a1",
      "carry-forward JSONL byte contract",
    );
    assert.equal(
      sha256(reportBytes),
      "e3d9d99f38852b46832e1ad29ec6e2bdf3a6840bc03a57e8655442b4e690ae50",
      "carry-forward report byte contract",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
