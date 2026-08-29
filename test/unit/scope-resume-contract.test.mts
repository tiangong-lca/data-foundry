import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createBafuScopeResumeContract,
  scopeResumeMismatchReason,
} from "../../scripts/lib/batch-orchestration/scope-resume-contract.ts";
import { loadMatchingVerifiedScopes } from "../../scripts/lib/batch-orchestration/scope-resume-ledger.ts";
import { createBafuScopeSourceContent } from "../../scripts/lib/batch-orchestration/scope-source-content.ts";

const scope = {
  schema_version: 1,
  process_id: "process-a",
  process_version: "00.00.001",
  closure_status: "ready",
  source_bundle_sha256: "a".repeat(64),
  commit_command: { sha256: "b".repeat(64) },
  verify_command: { sha256: "c".repeat(64) },
};

const context = {
  command: "dataset-bafu-batch-import-run",
  profile: "bafu",
  targetUserId: "account-a",
  stateCode: 0,
  commit: true,
  parallel: 5,
  requireLeafClassification: true,
  selectionOrder: "input",
  applyResolutionRewrites: false,
  familySignatures: true,
  mintUnmatchedFpUgSupport: false,
  cliPackage: "@tiangong-lca/cli@0.1.3",
};

test("scope resume contract isolates content policy executable and aggregate drift", () => {
  const contract = createBafuScopeResumeContract(scope, context);
  assert.deepEqual(contract, {
    schema: "tiangong-foundry.scope-resume-contract.v1",
    identity_key: "process-a@00.00.001",
    content_sha256: "edc2d0c062dacc82f9f0bc108cb6d2c870ec66360f607f238dae173ad15837c4",
    policy_sha256: "7d6f71a0a9b3b33bfbe2bf6dbf08ba7d18363af019a868a3a269965a28d5686c",
    executable_sha256: "e81f161ca404e7ca1433469d4112957cc59cbd62cb870da785189ed8e5d0676c",
    sha256: "efcec9ffff1bf99e2c86085ba99c140c81aa06b100f00101d3688881991e85e4",
  });
  assert.equal(scopeResumeMismatchReason(contract, contract), null);

  const variants = [
    [
      createBafuScopeResumeContract({ ...scope, source_bundle_sha256: "d".repeat(64) }, context),
      "resume_content_drift",
    ],
    [createBafuScopeResumeContract(scope, { ...context, parallel: 2 }), "resume_policy_drift"],
    [
      createBafuScopeResumeContract(scope, {
        ...context,
        cliPackage: "@tiangong-lca/cli@0.1.4",
      }),
      "resume_executable_drift",
    ],
    [
      createBafuScopeResumeContract(scope, { ...context, stagePolicy: "bafu-stage-policy.v2" }),
      "resume_executable_drift",
    ],
    [
      createBafuScopeResumeContract(
        { ...scope, commit_command: { sha256: "b".repeat(64), argv: ["changed"] } },
        context,
      ),
      "resume_executable_drift",
    ],
  ] as const;
  for (const [variant, reason] of variants) {
    assert.equal(scopeResumeMismatchReason(contract, variant), reason);
  }
  assert.equal(scopeResumeMismatchReason({}, contract), "legacy_resume_contract_missing");
  assert.equal(
    scopeResumeMismatchReason({ ...contract, sha256: "0".repeat(64) }, contract),
    "resume_contract_drift",
  );
});

test("scope source content hashes real bundle and shared-file bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-scope-content-"));
  const bundles = path.join(root, "bundles");
  const bundleFile = path.join(bundles, "process-a", "tidas", "processes", "process-a.json");
  const sharedFile = path.join(root, "policy.json");
  fs.mkdirSync(path.dirname(bundleFile), { recursive: true });
  fs.writeFileSync(bundleFile, '{"value":"before"}\n');
  fs.writeFileSync(sharedFile, '{"policy":1}\n');
  const content = () =>
    createBafuScopeSourceContent({
      scope,
      processBundlesDir: bundles,
      sharedFiles: [sharedFile],
      resolutionRewriteRows: [],
      repoRelative: (filePath) => path.relative(root, filePath),
    });
  try {
    const initial = createBafuScopeResumeContract(scope, { ...context, sourceContent: content() });
    fs.writeFileSync(bundleFile, '{"value":"after"}\n');
    const changed = createBafuScopeResumeContract(scope, { ...context, sourceContent: content() });
    assert.equal(scopeResumeMismatchReason(initial, changed), "resume_content_drift");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("matching verified scopes distrust legacy rows and keep latest exact contracts", () => {
  const contract = createBafuScopeResumeContract(scope, context);
  const rowsByFile = new Map<string, unknown[]>([
    [
      "source.jsonl",
      [
        {
          process_id: "process-a",
          process_version: "00.00.001",
          status: "verified",
          resume_contract: contract,
        },
      ],
    ],
    [
      "local.jsonl",
      [
        {
          process_id: "process-a",
          process_version: "00.00.001",
          status: "verified",
        },
      ],
    ],
  ]);
  const adapter = {
    nowIso: () => "2026-08-29T00:00:00.000Z",
    readJsonLines: (filePath: string) => rowsByFile.get(filePath) ?? [],
    repoRelative: (filePath: string) => `ledger/${filePath}`,
  };

  const invalidated = loadMatchingVerifiedScopes(
    ["source.jsonl", "local.jsonl"],
    new Map([[contract.identity_key, contract]]),
    adapter,
  );
  assert.deepEqual([...invalidated.verifiedScopes], []);
  assert.equal(invalidated.invalidatedRows[0].reason, "legacy_resume_contract_missing");
  assert.equal(invalidated.invalidatedRows[0].source_ledger_file, "ledger/local.jsonl");

  rowsByFile.set("local.jsonl", [
    {
      process_id: "process-a",
      process_version: "00.00.001",
      status: "verified",
      resume_contract: contract,
    },
  ]);
  const matched = loadMatchingVerifiedScopes(
    ["source.jsonl", "local.jsonl"],
    new Map([[contract.identity_key, contract]]),
    adapter,
  );
  assert.deepEqual([...matched.verifiedScopes], ["process-a@00.00.001"]);
  assert.deepEqual(matched.invalidatedRows, []);
});
