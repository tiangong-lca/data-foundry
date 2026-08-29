import assert from "node:assert/strict";
import test from "node:test";

import {
  createProcessScopeResumeContract,
  latestProcessScopeFinalizeCheckpoint,
} from "../../scripts/lib/bafu-orchestration/process-scope-resume.ts";
import { scopeResumeMismatchReason } from "../../scripts/lib/batch-orchestration/scope-resume-contract.ts";

type JsonRecord = Record<string, unknown>;

const base = {
  commandName: "dataset-bafu-process-scope-e2e",
  processScope: { id: "process-a", version: "00.00.001" },
  inputHashes: {
    rows_file_sha256: "rows-sha",
    source_support_rows_file_sha256: "support-sha",
    source_rows_file_sha256: "source-sha",
  },
  options: { profile: "bafu", execute: true, commit: false, stateCode: 0 },
  finalizeCommand: ["node", "foundry.ts", "dataset-post-authoring-finalize", "--profile", "bafu"],
  cliPackage: "@tiangong-lca/cli@0.1.3",
  stagePolicy: "tiangong-foundry.bafu-process-scope-stage-policy.v1",
};

test("process checkpoint contract rejects every content policy and executable drift", () => {
  const contract = createProcessScopeResumeContract(base);
  const variants = [
    createProcessScopeResumeContract({
      ...base,
      inputHashes: { ...base.inputHashes, rows_file_sha256: "changed" },
    }),
    createProcessScopeResumeContract({ ...base, options: { ...base.options, stateCode: 1 } }),
    createProcessScopeResumeContract({
      ...base,
      finalizeCommand: [...base.finalizeCommand, "--changed-command-spec"],
    }),
    createProcessScopeResumeContract({ ...base, cliPackage: "@tiangong-lca/cli@0.1.4" }),
    createProcessScopeResumeContract({ ...base, stagePolicy: "changed-stage-policy" }),
  ];
  assert.deepEqual(
    variants.map((variant) => scopeResumeMismatchReason(contract, variant)),
    [
      "resume_content_drift",
      "resume_policy_drift",
      "resume_executable_drift",
      "resume_executable_drift",
      "resume_executable_drift",
    ],
  );
});

test("process checkpoint requires exact contract and exact finalize report bytes", () => {
  const contract = createProcessScopeResumeContract(base);
  const reportPath = "/repo/finalize.json";
  let reportSha = "report-sha";
  const rows: JsonRecord[] = [
    {
      stage: "post_authoring_finalize",
      resume_contract: contract,
      finalize_report_sha256: "report-sha",
      files: { finalize_report: "finalize.json" },
    },
  ];
  const adapter = {
    exists: (filePath: string | null) => filePath === "ledger" || filePath === reportPath,
    readJsonLines: () => [...rows],
    resolve: (value: unknown) => (value ? `/repo/${String(value)}` : null),
    fileSha256: () => reportSha,
  };
  assert.equal(
    latestProcessScopeFinalizeCheckpoint({ ledgerPath: "ledger", contract, adapter }),
    rows[0],
  );
  reportSha = "tampered";
  assert.equal(
    latestProcessScopeFinalizeCheckpoint({ ledgerPath: "ledger", contract, adapter }),
    null,
  );
  rows[0] = { ...rows[0], resume_contract: null };
  reportSha = "report-sha";
  assert.equal(
    latestProcessScopeFinalizeCheckpoint({ ledgerPath: "ledger", contract, adapter }),
    null,
  );
});
