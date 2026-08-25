import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createImportLedgerUtils } from "../../scripts/lib/import-ledger.ts";
import type {
  BlockedScopeImportLedgerRow,
  JsonRecord,
  JsonValue,
  VerifiedImportLedgerRow,
} from "../../scripts/lib/import-ledger.ts";
import {
  readJsonLines,
  rel,
  repoRoot,
  testTmpRoot,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";

function asText(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function datasetIdentity(payload: JsonValue) {
  const typedPayload = payload as JsonRecord;
  const root = (typedPayload.processDataSet ?? {}) as JsonRecord;
  const processInformation = (root.processInformation ?? {}) as JsonRecord;
  const dataSetInformation = (processInformation.dataSetInformation ?? {}) as JsonRecord;
  const administrativeInformation = (root.administrativeInformation ?? {}) as JsonRecord;
  const publicationAndOwnership = (administrativeInformation.publicationAndOwnership ??
    {}) as JsonRecord;
  return {
    id: (dataSetInformation["common:UUID"] as string | undefined) ?? null,
    version: (publicationAndOwnership["common:dataSetVersion"] as string | undefined) ?? null,
  };
}

function ledgerUtils() {
  return createImportLedgerUtils({
    asText,
    datasetIdentity,
    fileExists: (filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
    nowIso: () => "2026-06-07T00:00:00.000Z",
    readJson: (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")),
    readJsonLines: (filePath: string) => readJsonLines(filePath) as unknown as JsonValue[],
    repoRelativePath: (filePath) => path.relative(repoRoot, filePath),
    resolveRepoPath: (filePath: unknown) =>
      filePath
        ? path.isAbsolute(filePath as string)
          ? (filePath as string)
          : path.join(repoRoot, filePath as string)
        : null,
    writeJson,
  });
}

function processPayload(id: string) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

test("closeout ledger writes verified rows and blocked rerun scopes", () => {
  const root = testTmpRoot("import-ledger-utils");
  fs.rmSync(root, { recursive: true, force: true });
  const rowsFile = path.join(root, "rows.jsonl");
  const ledgerDir = path.join(root, "ledger");
  writeJsonLines(rowsFile, [processPayload("verified-process")]);
  const utils = ledgerUtils();

  const okResult = utils.writeCloseoutImportLedger({
    ledgerDir,
    reportPath: path.join(root, "closeout-ok.json"),
    report: {
      status: "completed",
      dataset_type: "process",
      profile: "bafu",
      final_rows_file: rel(rowsFile),
      target_user_id: "target-user",
      expected_state_code: 0,
      counts: { root_payload_mismatches: 0 },
    },
  });
  assert.equal(okResult.status, "completed");
  const okRows = readJsonLines(
    path.join(ledgerDir, "ok.scopes.verified.jsonl"),
  ) as unknown as VerifiedImportLedgerRow[];
  assert.equal(okRows[0].dataset_id, "verified-process");
  assert.equal(okRows[0].status, "verified");

  const blockedResult = utils.writeCloseoutImportLedger({
    ledgerDir,
    reportPath: path.join(root, "closeout-blocked.json"),
    report: {
      status: "blocked",
      dataset_type: "process",
      profile: "bafu",
      final_rows_file: rel(rowsFile),
      blockers: [{ code: "commit_report_status_not_completed", message: "commit failed" }],
    },
  });
  assert.equal(blockedResult.status, "completed");
  const blockedRows = readJsonLines(
    path.join(ledgerDir, "blocked.scopes.human-review.jsonl"),
  ) as unknown as BlockedScopeImportLedgerRow[];
  assert.equal(blockedRows[0].scope_ids[0], "verified-process");
  assert.equal(blockedRows[0].status, "blocked_human_review");
  assert.ok(blockedRows[0].rerun_command?.includes("dataset-post-write-closeout"));
});
