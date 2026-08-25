import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDecisionTaskUtils } from "../../scripts/lib/decision-task-utils.ts";
import { createFullContextProofUtils } from "../../scripts/lib/full-context-proof.ts";
import { createIdentityPreflightArtifactUtils } from "../../scripts/lib/identity-preflight-artifacts.ts";
import { createIdentityReferenceRewriteUtils } from "../../scripts/lib/identity-reference-rewrite-utils.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const zeroAnyPaths = [
  "scripts/lib/decision-task-utils.ts",
  "scripts/lib/identity-preflight-artifacts.ts",
  "test/unit/evidence-decision-leaves.test.mts",
] as const;

test("evidence-decision family contains no explicit any or TypeScript suppression", () => {
  const oxlint = path.join(repoRoot, "node_modules", "oxlint", "bin", "oxlint");
  const result = spawnSync(
    process.execPath,
    [oxlint, "--format", "stylish", "-D", "typescript/no-explicit-any", ...zeroAnyPaths],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const relativePath of zeroAnyPaths) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u, relativePath);
  }
});

function withFixture<T>(callback: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-evidence-leaves-"));
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function asText(value: any): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function normalizedList(value: any): string[] {
  return ensureArray(value)
    .flatMap((entry) => String(entry ?? "").split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sha256Text(value: any): string {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

function writeJson(filePath: string, value: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonLines(filePath: string): any[] {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text
    ? text
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

function decisionUtils(root: string) {
  const resolve = (value: any) =>
    value
      ? path.isAbsolute(String(value))
        ? String(value)
        : path.join(root, String(value))
      : null;
  return createDecisionTaskUtils({
    asText,
    cloneJson: <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
    ensureArray,
    fileExists: (filePath: string) => Boolean(filePath && fs.existsSync(filePath)),
    integerOption: (value: any, fallback: any) => {
      const number = Number(value);
      return Number.isInteger(number) ? number : fallback;
    },
    normalizedList,
    nowIso: () => "2026-08-25T00:00:00.000Z",
    positiveIntegerOption: (value: any, fallback: any) => {
      const number = Number(value);
      return Number.isInteger(number) && number > 0 ? number : fallback;
    },
    readJson: (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8")),
    readJsonLines,
    readText: (filePath: string) => fs.readFileSync(filePath, "utf8"),
    repoRelativePath: (filePath: string) =>
      path.relative(root, filePath).split(path.sep).join(path.posix.sep),
    resolveRepoPath: resolve,
    sameResolvedPath: (left: string, right: string) =>
      Boolean(left && right && path.resolve(left) === path.resolve(right)),
    sha256Text,
    unique: <T,>(values: T[]) => [...new Set(values)],
    writeJson,
  });
}

test("decision-task helpers preserve selection, path, dedupe, and stable queue hash contracts", () => {
  withFixture((root) => {
    const utils = decisionUtils(root);
    const rows = [
      {
        dataset_id: "a",
        dataset_type: "flow",
        source_file: "root/process-bundles/bundle-a/flows.jsonl",
        classification_workflow: {
          schema_type: "flow-product",
          row_type: "flow",
          commands: { input_rows: "in-a.jsonl", output_rows: "volatile-a.jsonl" },
        },
      },
      {
        dataset_id: "b",
        dataset_type: "flow",
        source_file: "root/process-bundles/bundle-b/flows.jsonl",
        classification_workflow: {
          schema_type: "flow-product",
          commands: { input_rows: "in-b.jsonl", output_rows: "volatile-b.jsonl" },
        },
      },
    ];
    assert.equal(utils.classificationQueueSchemaType(rows[0]), "flow-product");
    assert.equal(utils.classificationQueueRowType(rows[0]), "flow");
    assert.equal(utils.classificationQueueInputRows(rows[0]), "in-a.jsonl");
    assert.equal(utils.classificationQueueOutputRows(rows[0]), "volatile-a.jsonl");
    assert.equal(utils.queueRowBundleId(rows[0]), "bundle-a");
    const selected = utils.selectDecisionTaskQueueRows(
      rows,
      { datasetType: "flow", bundleId: "bundle-b", offset: 0, limit: 1 },
      utils.classificationQueueSchemaType,
    );
    assert.deepEqual(selected.selection.source_queue_row_indices, [1]);
    assert.equal(selected.selected[0].row.dataset_id, "b");
    assert.equal(utils.safeFileToken(" bad / label ", "fallback"), "bad-label");
    assert.equal(
      utils.decisionTaskChunkLabel({ chunkLabel: " Batch A " }, selected.selection, "fallback"),
      "Batch-A",
    );

    const stable = utils.stableDecisionTaskQueueRows(rows);
    assert.equal(stable[0].classification_workflow.commands.output_rows, undefined);
    assert.equal(rows[0].classification_workflow.commands.output_rows, "volatile-a.jsonl");
    assert.equal(utils.decisionTaskQueueSha256(rows), sha256Text(JSON.stringify(stable)));

    const contextFiles = [
      { kind: "schema", path: "schema.json", text: "{}" },
      { kind: "schema", path: "schema.json", text: "{}" },
      { kind: "ruleset", path: "rules.json", text: '{"ok":true}' },
    ];
    const deduped = utils.dedupeDecisionTaskContextFiles(contextFiles);
    assert.equal(deduped.length, 2);
    assert.equal(deduped[0].sha256, sha256Text("{}"));
    const bundle = utils.writeDecisionTaskSharedContextBundle({
      outDir: root,
      taskKind: "classification",
      files: contextFiles,
    });
    assert.equal(bundle.counts.files, 2);
    assert.equal(bundle.cache.enabled, false);
    assert.equal(fs.existsSync(path.join(root, bundle.path)), true);
  });
});

function rewriteUtils(root: string): any {
  const resolve = (value: any) =>
    value
      ? path.isAbsolute(String(value))
        ? String(value)
        : path.join(root, String(value))
      : null;
  return createIdentityReferenceRewriteUtils({
    asText,
    cloneJson: <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
    countRowsFile: (filePath: string) => readJsonLines(filePath).length,
    datasetIdentity: (row: any, type: string) => {
      const rootPayload = type === "flow" ? row?.flowDataSet : row?.processDataSet;
      const info =
        rootPayload?.flowInformation?.dataSetInformation ??
        rootPayload?.processInformation?.dataSetInformation ??
        {};
      return {
        id: asText(info["common:UUID"]),
        version:
          asText(
            rootPayload?.administrativeInformation?.publicationAndOwnership?.[
              "common:dataSetVersion"
            ],
          ) || "00.00.001",
      };
    },
    datasetRowsFileStem: (type: string) => `${type}s`,
    ensureArray,
    fileExists: (filePath: string) => Boolean(filePath && fs.existsSync(filePath)),
    foundryTraceNamespace: "https://example.test/foundry",
    identityPreflightCommands: {
      identityPreflightRunReportFile: (row: any) => resolve(row.report_file),
    },
    languageForText: () => "en",
    multiLang: (text: any, language = "en") => ({ "@xml:lang": language, "#text": text }),
    normalizedList,
    nowIso: () => "2026-08-25T00:00:00.000Z",
    pathExpression: (parts: any[]) => parts.join("."),
    preferredSourceLanguageText: (values: any) => asText(ensureArray(values)[0]),
    readJson: (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8")),
    readJsonLines,
    readRowsFile: readJsonLines,
    repoRelativeMaybe: (filePath: any) =>
      filePath ? path.relative(root, filePath).split(path.sep).join(path.posix.sep) : null,
    repoRelativePath: (filePath: string) =>
      path.relative(root, filePath).split(path.sep).join(path.posix.sep),
    resolveRepoPath: resolve,
    supportText: asText,
    unique: <T,>(values: T[]) => [...new Set(values)],
    writeJson,
    writeJsonLines: (filePath: string, rows: any[]) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
      );
    },
  });
}

test("identity rewrite is fail-closed without evidence and emits exact reference-reuse rows", () => {
  withFixture((root) => {
    const rowsFile = path.join(root, "flows.jsonl");
    const flow = {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:UUID": "source-flow",
            name: { baseName: { "#text": "Source flow" } },
          },
        },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "01.00.000" },
        },
      },
    };
    fs.writeFileSync(rowsFile, `${JSON.stringify(flow)}\n`);
    const utils = rewriteUtils(root);
    const missing = utils.applyIdentityReferenceRewrites({
      datasetType: "flow",
      rowsFile,
      outDir: path.join(root, "missing-out"),
    });
    assert.equal(missing.status, "blocked");
    assert.deepEqual(
      missing.blockers.map((blocker: any) => blocker.code),
      ["identity_preflight_index_required"],
    );
    const allowed = utils.applyIdentityReferenceRewrites({
      datasetType: "flow",
      rowsFile,
      outDir: path.join(root, "allowed-out"),
      allowMissingIndex: true,
    });
    assert.equal(allowed.status, "completed_no_index");

    const rewrites = path.join(root, "rewrites.jsonl");
    fs.writeFileSync(
      rewrites,
      `${JSON.stringify({
        relation: "identity_decision",
        original: { ref_object_id: "source-flow", version: "01.00.000" },
        canonical: {
          table: "flows",
          ref_object_id: "canonical-flow",
          version: "02.00.000",
          short_description: "Canonical flow",
        },
      })}\n`,
    );
    const report = utils.applyIdentityReferenceRewrites({
      datasetType: "flow",
      rowsFile,
      outDir: path.join(root, "rewrite-out"),
      options: { identityReferenceRewrites: rewrites },
    });
    assert.equal(report.status, "completed");
    assert.equal(report.counts.input_rows, 1);
    assert.equal(report.counts.output_rows, 0);
    assert.equal(report.counts.reference_rows, 1);
    assert.equal(report.counts.flow_reference_rewrites, 1);
    assert.equal(report.rewrite_rows[0].canonical.ref_object_id, "canonical-flow");
    assert.deepEqual(readJsonLines(path.join(root, report.reference_rows_file)), [flow]);
    assert.equal(utils.referenceShortDescription(" text "), "");
    assert.equal(utils.referenceShortDescription({ shortDescription: " text " }), "text");
    assert.equal(
      utils.referenceShortDescription({ "common:shortDescription": { "#text": " x " } }),
      "x",
    );
  });
});

function fullContextUtils(root: string): any {
  return createFullContextProofUtils({
    asText,
    classificationDecisionUsedContextKinds: (row: any) => normalizedList(row.used_context_kinds),
    decisionCompletionStatus: (row: any) => asText(row.decision_status ?? row.status),
    decisionContextBundleSha256: (row: any) => asText(row.context_bundle_sha256),
    ensureArray,
    fileExists: (filePath: string) => Boolean(filePath && fs.existsSync(filePath)),
    listImportProfiles: () => ({
      default_profile: "generic",
      profiles: {
        generic: { id: "generic", full_context_ai_completion: { required: false } },
        strict: {
          id: "strict",
          full_context_ai_completion: {
            required: true,
            dataset_types: ["flow"],
            required_context_kinds: ["schema", "ruleset"],
            required_context_file_patterns: ["schema.json", "rules.json"],
          },
        },
      },
    }),
    normalizedList,
    readJson: (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8")),
    readJsonArtifactOption: () => null,
    readJsonLines,
    readText: (filePath: string) => fs.readFileSync(filePath, "utf8"),
    repoRelativePath: (filePath: string) =>
      path.relative(root, filePath).split(path.sep).join(path.posix.sep),
    resolveRepoPath: (value: any) =>
      value
        ? path.isAbsolute(String(value))
          ? String(value)
          : path.join(root, String(value))
        : null,
    repoRoot: root,
    sha256Text,
    unique: <T,>(values: T[]) => [...new Set(values)],
  });
}

test("full-context proof remains profile-aware and fail-closed for missing mutation evidence", () => {
  withFixture((root) => {
    const utils = fullContextUtils(root);
    assert.equal(utils.profileFullContextRequirement("generic", "flow"), null);
    assert.equal(utils.profileFullContextRequirement("strict", "process"), null);
    assert.deepEqual(utils.profileFullContextRequirement("strict", "flow"), {
      profile_id: "strict",
      dataset_type: "flow",
      required_context_kinds: ["schema", "ruleset"],
      required_context_file_patterns: ["schema.json", "rules.json"],
    });
    assert.deepEqual(utils.fullContextProofCheck({ profileId: "generic", datasetType: "flow" }), {
      required: false,
      blockers: [],
    });
    const missing = utils.fullContextProofCheck({
      profileId: "strict",
      datasetType: "flow",
      closeoutCounts: {},
      mutationArtifact: null,
      codePrefix: "verify",
    });
    assert.equal(missing.required, true);
    assert.deepEqual(
      missing.blockers.map((blocker: any) => blocker.code),
      [
        "verify_full_context_scope_missing",
        "verify_full_context_semantic_evidence_missing",
        "verify_full_context_mutation_manifest_missing",
      ],
    );
    assert.deepEqual(
      utils
        .completionFullContextBlockers({
          task: { meta: { profile: "strict", dataset_type: "flow" } },
          completionReport: { closeouts: [], counts: {} },
        })
        .map((blocker: any) => blocker.code),
      ["completion_full_context_closeout_missing"],
    );
  });
});

function preflightUtils(root: string): any {
  const resolve = (value: any) =>
    value
      ? path.isAbsolute(String(value))
        ? String(value)
        : path.join(root, String(value))
      : null;
  return createIdentityPreflightArtifactUtils({
    asText,
    bundleClassificationPath: () => "Products > Test",
    cleanEcoSpoldNameText: (value: any) => asText(value),
    collectSourceTracePayloads: (value: any) => ensureArray(value),
    datasetIdentity: (payload: any, type: string) => {
      const info =
        type === "flow"
          ? payload?.flowDataSet?.flowInformation?.dataSetInformation
          : payload?.processDataSet?.processInformation?.dataSetInformation;
      return { id: asText(info?.["common:UUID"]), version: "01.00.000" };
    },
    ensureArray,
    fileExists: (filePath: string) => Boolean(filePath && fs.existsSync(filePath)),
    flowNameParts: (payload: any) =>
      payload?.flowDataSet?.flowInformation?.dataSetInformation?.name ?? {},
    flowTypeOfDataSet: () => "Product flow",
    isConvertedDefaultClassification: () => false,
    jsonSha256: (value: any) => sha256Text(JSON.stringify(value)),
    normalizedList,
    processAuthoringContextFromTrace: () => ({}),
    processSourceClassificationSummary: () => ({}),
    readJson: (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8")),
    readJsonLines,
    repoRelativeMaybe: (filePath: any) =>
      filePath ? path.relative(root, filePath).split(path.sep).join(path.posix.sep) : null,
    repoRelativePath: (filePath: string) =>
      path.relative(root, filePath).split(path.sep).join(path.posix.sep),
    resolveRepoPath: resolve,
    safeFileToken: (value: any, fallback: string) =>
      asText(value).replace(/[^A-Za-z0-9_.-]+/gu, "-") || fallback,
    sha256Text,
    shellQuote: (value: any) => JSON.stringify(String(value)),
    sourceTraceLocationCode: () => "",
    textValue: asText,
    writeJson,
    writeJsonLines: (filePath: string, rows: any[]) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
      );
    },
  });
}

test("preflight artifacts bind exact request bytes, CommandSpec facts, and attached queue rows", () => {
  withFixture((root) => {
    const utils = preflightUtils(root);
    const payload = {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:UUID": "flow-id",
            name: { baseName: { "#text": "Test flow" } },
          },
        },
      },
    };
    const artifacts = utils.buildIdentityPreflightArtifacts({
      rowsByType: {
        flow: new Map([["flow-id", payload]]),
        process: new Map(),
      },
      sourceByType: { flow: new Map(), process: new Map() },
      outDir: root,
      cliBin: [process.execPath, "cli-entry.js"],
    });
    assert.equal(artifacts.rows.length, 1);
    const row = artifacts.rows[0];
    assert.equal(row.dataset_type, "flow");
    assert.equal(row.dataset_id, "flow-id");
    assert.equal(row.command_spec.schema, "tiangong-foundry.command-spec.v1");
    assert.equal(row.command_spec.executable, process.execPath);
    assert.deepEqual(row.command_spec.argv.slice(0, 3), [
      "cli-entry.js",
      "flow",
      "identity-preflight",
    ]);
    assert.equal(row.command_spec.binding.artifacts.length, 1);
    const fact = row.command_spec.binding.artifacts[0];
    const requestPath = path.join(root, row.request_file);
    const requestText = fs.readFileSync(requestPath, "utf8");
    assert.equal(fact.path, row.request_file);
    assert.equal(fact.bytes, Buffer.byteLength(requestText));
    assert.equal(fact.sha256, sha256Text(requestText));
    assert.equal(row.request_bytes_sha256, sha256Text(requestText));
    assert.equal(row.target_sha256, sha256Text(JSON.stringify(payload)));
    assert.ok(row.remote_search.query);
    assert.equal(row.remote_search.edge_request.endpoint, "flow_hybrid_search");

    const queue: any[] = [
      { dataset_type: "flow", dataset_id: "flow-id", dataset_version: "01.00.000" },
    ];
    utils.attachIdentityPreflightRows(queue, artifacts);
    assert.equal(queue[0].identity_preflight_request_file, row.request_file);
    assert.equal(queue[0].identity_preflight_command, row.command);
    assert.deepEqual(queue[0].remote_search, row.remote_search);
    assert.equal(utils.isLikelyLocationCodeText("CH-ZH"), true);
    assert.equal(utils.isLikelyLocationCodeText("Switzerland"), false);
  });
});

test("preflight source-index loading is first-binding and fail-closed for missing index/context", () => {
  withFixture((root) => {
    const utils = preflightUtils(root);
    const firstSource = path.join(root, "source-first.json");
    const secondSource = path.join(root, "source-second.json");
    writeJson(firstSource, { source: 1 });
    writeJson(secondSource, { source: 2 });
    const firstIndex = path.join(root, "first.jsonl");
    const secondIndex = path.join(root, "second.jsonl");
    fs.writeFileSync(
      firstIndex,
      `${JSON.stringify({
        dataset_type: "flow",
        dataset_id: "flow-id",
        dataset_version: "01.00.000",
        source_file: "source-first.json",
      })}\n`,
    );
    fs.writeFileSync(
      secondIndex,
      [
        {
          dataset_type: "flow",
          dataset_id: "flow-id",
          dataset_version: "01.00.000",
          source_file: "source-second.json",
        },
        {
          dataset_type: "process",
          dataset_id: "process-id",
          source_file: "missing-source.json",
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );
    assert.deepEqual(
      utils.identityPreflightSourceIndexPaths({ sourceIndexes: ["first.jsonl", "second.jsonl"] }),
      [firstIndex, secondIndex],
    );
    const loaded = utils.loadIdentityPreflightSourceFileMap([
      firstIndex,
      secondIndex,
      path.join(root, "missing-index.jsonl"),
    ]);
    assert.equal(loaded.rowCount, 3);
    assert.equal(loaded.sourceFilesByIdentity.get("flow:flow-id:01.00.000"), firstSource);
    assert.deepEqual(
      loaded.blockers.map((blocker: any) => blocker.code),
      ["identity_preflight_source_context_file_missing", "identity_preflight_source_index_missing"],
    );
  });
});
