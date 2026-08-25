import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as acceptedDiffModule from "../../scripts/lib/remote-verification-accepted-diff.mjs";

const { acceptTraceHashOnlyRemoteVerificationMismatch } = acceptedDiffModule;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function flowPayload(traceHash) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": "8be4cf81-079c-5a30-a353-fdc219cce43b",
          "common:other": {
            "tiangongfoundry:importTraceSummary": {
              "@status": "externalized_before_remote_write",
              traceHash,
              note: "Original import trace was captured in Foundry.",
            },
          },
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

test("accepts only importTraceSummary traceHash root payload mismatches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-accepted-diff-"));
  const inputPath = path.join(root, "flows.cleaned.jsonl");
  const verifyOut = path.join(root, "post-write-verify", "outputs");
  const reportPath = path.join(verifyOut, "remote-verification-report.json");
  const checksPath = path.join(verifyOut, "remote-verification.jsonl");
  const blockersPath = path.join(verifyOut, "blockers.jsonl");
  const local = flowPayload("local-hash");
  const remote = flowPayload("remote-hash");

  writeJsonLines(inputPath, [local]);
  writeJsonLines(checksPath, [
    {
      role: "root",
      table: "flows",
      id: "8be4cf81-079c-5a30-a353-fdc219cce43b",
      version: "00.00.001",
      row_index: 0,
      status: "payload_mismatch",
      path: "/flowDataSet#readback",
      local_payload_sha256: "local-original",
      remote_payload_sha256: "remote-original",
      remote_user_id: "user-1",
      remote_state_code: 0,
    },
  ]);
  writeJsonLines(blockersPath, [
    {
      code: "payload_mismatch",
      role: "root",
      table: "flows",
      id: "8be4cf81-079c-5a30-a353-fdc219cce43b",
      version: "00.00.001",
      row_index: 0,
      path: "/flowDataSet#readback",
    },
  ]);
  writeJson(reportPath, {
    status: "blocked_remote_verification",
    input_path: inputPath,
    counts: {
      rows: 1,
      checked: 1,
      blockers: 1,
      root_readback_checks: 1,
      root_payload_mismatches: 1,
      by_status: { ok: 0, payload_mismatch: 1 },
    },
    blockers: [
      {
        code: "payload_mismatch",
        role: "root",
        table: "flows",
        id: "8be4cf81-079c-5a30-a353-fdc219cce43b",
        version: "00.00.001",
        row_index: 0,
        path: "/flowDataSet#readback",
      },
    ],
    files: { report: reportPath, checks: checksPath, blockers: blockersPath },
  });

  const result = acceptTraceHashOnlyRemoteVerificationMismatch({
    verifyReportPath: reportPath,
    outDir: root,
    repoRoot: root,
    runCliGet: () => ({ ok: true, payload: remote, command: "fake flow get" }),
  });

  assert.equal(result.accepted, true);
  const acceptedReport = JSON.parse(fs.readFileSync(result.verifyReportPath, "utf8"));
  assert.equal(acceptedReport.status, "passed_remote_verification");
  assert.equal(acceptedReport.counts.root_payload_mismatches, 0);
  assert.equal(acceptedReport.blockers.length, 0);
  assert.equal(acceptedReport.foundry_accepted_remote_verification.accepted_differences.length, 1);
  const acceptedChecks = fs
    .readFileSync(acceptedReport.files.checks, "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.equal(acceptedChecks[0].status, "ok");
  assert.equal(acceptedChecks[0].local_payload_sha256, acceptedChecks[0].remote_payload_sha256);
  assert.equal(acceptedChecks[0].foundry_verification_mode, "accepted_normalized_payload");
});

test("rejects payload mismatches that still differ after traceHash normalization", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-accepted-diff-reject-"));
  const inputPath = path.join(root, "flows.cleaned.jsonl");
  const verifyOut = path.join(root, "post-write-verify", "outputs");
  const reportPath = path.join(verifyOut, "remote-verification-report.json");
  const checksPath = path.join(verifyOut, "remote-verification.jsonl");
  const blockersPath = path.join(verifyOut, "blockers.jsonl");
  const local = flowPayload("local-hash");
  const remote = flowPayload("remote-hash");
  remote.flowDataSet.flowInformation.dataSetInformation["common:UUID"] = "different";

  writeJsonLines(inputPath, [local]);
  writeJsonLines(checksPath, [
    {
      role: "root",
      table: "flows",
      id: "8be4cf81-079c-5a30-a353-fdc219cce43b",
      version: "00.00.001",
      row_index: 0,
      status: "payload_mismatch",
      path: "/flowDataSet#readback",
      local_payload_sha256: "local-original",
      remote_payload_sha256: "remote-original",
    },
  ]);
  writeJsonLines(blockersPath, []);
  writeJson(reportPath, {
    status: "blocked_remote_verification",
    input_path: inputPath,
    counts: {
      rows: 1,
      checked: 1,
      blockers: 1,
      root_readback_checks: 1,
      root_payload_mismatches: 1,
      by_status: { ok: 0, payload_mismatch: 1 },
    },
    blockers: [
      {
        code: "payload_mismatch",
        role: "root",
        table: "flows",
        id: "8be4cf81-079c-5a30-a353-fdc219cce43b",
        version: "00.00.001",
        row_index: 0,
        path: "/flowDataSet#readback",
      },
    ],
    files: { report: reportPath, checks: checksPath, blockers: blockersPath },
  });

  const result = acceptTraceHashOnlyRemoteVerificationMismatch({
    verifyReportPath: reportPath,
    outDir: root,
    repoRoot: root,
    runCliGet: () => ({ ok: true, payload: remote, command: "fake flow get" }),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "payloads_still_differ_after_trace_hash_normalization");
});

test("foreign or RLS-hidden state-0 missing_dataset cannot be accepted by any caller", () => {
  assert.equal(acceptedDiffModule.acceptTrustedExternalReferenceMissingDataset, undefined);

  const batchSource = fs.readFileSync(
    path.join(repoRoot, "scripts/commands/bafu-batch-import-run.mjs"),
    "utf8",
  );
  const worldsteelSource = fs.readFileSync(
    path.join(repoRoot, "scripts/commands/worldsteel-batch-import-run.mjs"),
    "utf8",
  );
  for (const source of [batchSource, worldsteelSource]) {
    assert.doesNotMatch(source, /acceptTrustedExternalReferenceMissingDataset/u);
    assert.doesNotMatch(source, /trustedExternalReferenceFlows/u);
    assert.doesNotMatch(source, /accepted_trusted_reference/u);
    assert.doesNotMatch(source, /3c4b0e5d-6500-4ada-9a2c-58e43ac96500/u);
  }
});
