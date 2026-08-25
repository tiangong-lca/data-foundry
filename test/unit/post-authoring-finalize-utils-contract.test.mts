import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPostAuthoringFinalizeUtils } from "../../scripts/lib/post-authoring-finalize-utils.mjs";

type JsonObject = Record<string, unknown>;

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function readJsonLines(filePath: string): JsonObject[] {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as JsonObject) : [];
}

function withTempRoot(name: string, run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `foundry-${name}-`));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createHarness(root: string) {
  const queueCalls: JsonObject[] = [];
  const resolveRepoPath = (value: unknown) => {
    const text = asText(value);
    if (!text) return null;
    return path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text);
  };
  const utils = createPostAuthoringFinalizeUtils({
    asText,
    booleanOption(value: unknown) {
      return value === true || value === "true" || value === "1";
    },
    cliWrapperCommands: {
      runDatasetCurationQueueBuild(options: JsonObject) {
        queueCalls.push(options);
        return {
          status: "ready",
          files: {
            manifest: path.join(String(options.outDir), "outputs/curation-queue-manifest.json"),
          },
        };
      },
    },
    countRowsFile(filePath: string) {
      return readJsonLines(filePath).length;
    },
    datasetIdentity(row: JsonObject, type: string) {
      const rootKey = `${type}DataSet`;
      const root = (row[rootKey] ?? row) as JsonObject;
      return {
        id: asText(root.id ?? row.id),
        version: asText(root.version ?? row.version) || "00.00.001",
      };
    },
    ensureArray,
    fileExists(filePath: string | null) {
      return Boolean(filePath && fs.existsSync(filePath));
    },
    identityPreflightCommands: {
      identityPreflightRunIndexPath() {
        return null;
      },
      runDatasetIdentityPreflightRequestsBuild() {
        throw new Error("unexpected request build");
      },
      runDatasetIdentityPreflightIndexMerge() {
        throw new Error("unexpected index merge");
      },
      runDatasetIdentityPreflightRun() {
        throw new Error("unexpected preflight run");
      },
    },
    identityReferenceRewriteIndexPath() {
      return null;
    },
    normalizedList(value: unknown) {
      return ensureArray(value).flatMap((entry) =>
        typeof entry === "string"
          ? entry
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean)
          : [],
      );
    },
    readRowsFile: readJsonLines,
    referenceShortDescription(reference: JsonObject) {
      return asText(reference["common:shortDescription"]);
    },
    repoRelativeMaybe(filePath: string | null) {
      return filePath ? path.relative(root, filePath).split(path.sep).join("/") : null;
    },
    resolveRepoPath,
    unique<T>(values: T[]) {
      return [...new Set(values)];
    },
    writeJsonLines,
  });
  return { queueCalls, resolveRepoPath, utils };
}

test("finalize rewrite discovery preserves configured and nearest-sibling priority", () => {
  withTempRoot("finalize-rewrite-discovery", (root) => {
    const rowsFile = path.join(root, "scope/rows/processes.jsonl");
    const nearestSource = path.join(root, "scope/rows/source-reference-rewrites.jsonl");
    const parentSource = path.join(root, "scope/source-reference-rewrites.jsonl");
    const nearestIdentity = path.join(root, "scope/rows/identity-flow-reference-rewrites.jsonl");
    const configured = path.join(root, "configured.jsonl");
    for (const file of [rowsFile, nearestSource, parentSource, nearestIdentity, configured]) {
      writeJsonLines(file, [{ file }]);
    }
    const { utils } = createHarness(root);
    assert.equal(utils.sourceReferenceRewritesFileForRowsFile(rowsFile), nearestSource);
    assert.equal(
      utils.sourceReferenceRewritesFileForRowsFile(rowsFile, {
        sourceReferenceRewrites: configured,
      }),
      configured,
    );
    assert.equal(utils.identityReferenceRewritesFileForRowsFile(rowsFile), nearestIdentity);
    fs.rmSync(nearestSource);
    assert.equal(utils.sourceReferenceRewritesFileForRowsFile(rowsFile), parentSource);
    assert.equal(utils.sourceReferenceRewritesFileForRowsFile(null), null);
  });
});

test("finalize auto queue preserves identity dedupe, process reference order, and exact owner inputs", () => {
  withTempRoot("finalize-auto-queue", (root) => {
    const rowsFile = path.join(root, "scope/processes.jsonl");
    const cleanedRowsFile = path.join(root, "scope/processes.cleaned.jsonl");
    const flowsFile = path.join(root, "scope/flows.jsonl");
    const supportFile = path.join(root, "scope/support.jsonl");
    writeJsonLines(rowsFile, [{ processDataSet: { id: "process-1", version: "01.00.000" } }]);
    writeJsonLines(flowsFile, [{ flowDataSet: { id: "flow-local", version: "01.00.000" } }]);
    writeJsonLines(supportFile, [{ sourceDataSet: { id: "source-1" } }]);
    writeJsonLines(cleanedRowsFile, [
      {
        processDataSet: {
          id: "process-1",
          version: "01.00.000",
          exchanges: {
            exchange: [
              {
                referenceToFlowDataSet: {
                  "@refObjectId": "flow-local",
                  "@version": "01.00.000",
                },
              },
              {
                referenceToFlowDataSet: {
                  "@refObjectId": "flow-remote-b",
                  "@version": "02.00.000",
                  "common:shortDescription": "Remote B",
                },
              },
              {
                referenceToFlowDataSet: {
                  "@refObjectId": "flow-remote-a",
                  "@version": "03.00.000",
                  "common:shortDescription": "Remote A",
                },
              },
            ],
          },
        },
      },
    ]);
    const outDir = path.join(root, "finalize");
    const { queueCalls, utils } = createHarness(root);
    const stage = utils.runFinalizeAutoCurationQueue({
      datasetType: "process",
      rowsFile,
      cleanedRowsFile,
      outDir,
      options: { flows: flowsFile },
      fullContextRequirement: true,
      identityReferenceRewriteStage: {
        rewrite_rows: [
          { canonical: { ref_object_id: "flow-reuse", version: "04.00.000" } },
          { canonical: { refObjectId: "flow-reuse", version: "04.00.000" } },
          { canonical: { id: "flow-reuse-2" } },
        ],
      },
    });
    assert.equal(stage.status, "ready");
    assert.equal(queueCalls.length, 1);
    const call = queueCalls[0];
    assert.equal(call.processes, cleanedRowsFile);
    assert.equal(call.flows, flowsFile);
    assert.deepEqual(call.support, [supportFile]);
    const externalFiles = call.externalFlowRef as string[];
    assert.equal(externalFiles.length, 2);
    assert.deepEqual(
      readJsonLines(externalFiles[0]).map((row) => [row.id, row.version]),
      [
        ["flow-reuse", "04.00.000"],
        ["flow-reuse-2", "00.00.001"],
      ],
    );
    const processRefs = readJsonLines(externalFiles[1]);
    assert.deepEqual(
      processRefs.map((row) => [row.id, row.version]),
      [
        ["flow-remote-b", "02.00.000"],
        ["flow-remote-a", "03.00.000"],
      ],
    );
    assert.deepEqual((processRefs[0].references as JsonObject[])[0], {
      process_id: "process-1",
      process_version: "01.00.000",
      row_index: 0,
      path: "processDataSet.exchanges.exchange.1.referenceToFlowDataSet",
    });
  });
});

test("finalize identity preflight stays no-op unless requested and fails closed without an index", () => {
  withTempRoot("finalize-preflight", (root) => {
    const rowsFile = path.join(root, "rows.jsonl");
    writeJsonLines(rowsFile, [{ flowDataSet: { id: "flow-1" } }]);
    const { utils } = createHarness(root);
    assert.deepEqual(
      utils.runFinalizeIdentityPreflightStage({ rowsFile, outDir: root, options: {} }),
      {
        stage: "identity_preflight_run",
        status: "not_requested",
        report: null,
        report_file: null,
      },
    );
    assert.throws(
      () =>
        utils.runFinalizeIdentityPreflightStage({
          rowsFile,
          outDir: root,
          options: { runIdentityPreflight: true, type: "flow" },
        }),
      /requires --identity-preflight-index/u,
    );
  });
});

test("post-authoring finalize utils exist only as zero-escape native TypeScript", () => {
  const typedPath = path.join(repoRoot, "scripts/lib/post-authoring-finalize-utils.ts");
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
});

test("post-authoring finalize utils consumers target the typed owner", () => {
  for (const consumer of [
    "scripts/foundry.mjs",
    "test/unit/finalize-resolution-reuse-seed.test.mjs",
    "test/unit/post-authoring-finalize-utils-contract.test.mts",
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, consumer), "utf8");
    assert.match(source, /(?:lib\/|scripts\/lib\/)post-authoring-finalize-utils\.ts/u);
    assert.doesNotMatch(source, /(?:lib\/|scripts\/lib\/)post-authoring-finalize-utils\.mjs/u);
  }
});
