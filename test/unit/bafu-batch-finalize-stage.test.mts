import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createBatchFinalizeStageService,
  type BatchFinalizeArgsInput,
  type BatchFinalizeJsonRecord,
  type BatchFinalizeStageAdapter,
  type BatchFinalizeStageResult,
} from "../../scripts/lib/bafu-orchestration/batch-finalize-stage.ts";

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function stageResult(overrides: Partial<BatchFinalizeStageResult> = {}): BatchFinalizeStageResult {
  return {
    stage: "process.finalize",
    command: "/runtime/node scripts/foundry.ts dataset-post-authoring-finalize",
    exit_code: 0,
    signal: null,
    timed_out: false,
    timeout_ms: 900_000,
    started_at_utc: "2026-08-26T01:02:03.000Z",
    finished_at_utc: "2026-08-26T01:02:04.000Z",
    stdout_log: "logs/process.finalize.stdout.log",
    stderr_log: "logs/process.finalize.stderr.log",
    json: null,
    ...overrides,
  };
}

function makeAdapter({
  root,
  profile,
  libraryContact = {},
  mintUnmatchedFpUgSupport = false,
  runArgvStage = async () => stageResult(),
}: {
  root: string;
  profile: string;
  libraryContact?: BatchFinalizeJsonRecord;
  mintUnmatchedFpUgSupport?: boolean;
  runArgvStage?: BatchFinalizeStageAdapter["runArgvStage"];
}): BatchFinalizeStageAdapter {
  return {
    processExecPath: "/runtime/node",
    foundryEntryPath: path.join(root, "scripts", "foundry.ts"),
    activeProfile: () => profile,
    libraryContact: () => libraryContact,
    mintUnmatchedFpUgSupport: () => mintUnmatchedFpUgSupport,
    nowIso: () => "2026-08-26T01:02:05.000Z",
    normalizedList: (value) =>
      (Array.isArray(value) ? value : value == null || value === "" ? [] : [value])
        .flatMap((entry) => String(entry).split(","))
        .map((entry) => entry.trim())
        .filter(Boolean),
    repoRelative: (filePath) => path.relative(root, filePath).replaceAll("\\", "/"),
    resolveRepoPath: (value) => {
      if (typeof value !== "string" || value.length === 0) return null;
      return path.isAbsolute(value) ? value : path.join(root, value);
    },
    fileExists: (filePath) => Boolean(filePath && fs.existsSync(filePath)),
    readJson: (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")),
    runArgvStage,
  };
}

function finalizeInput(root: string): BatchFinalizeArgsInput {
  return {
    type: "process",
    rowsFile: path.join(root, "scopes", "p-001", "processes.jsonl"),
    outDir: path.join(root, "scopes", "p-001", "finalize"),
    ledgerDir: path.join(root, "import-ledger"),
    sourceSupportRowsFile: path.join(root, "scopes", "p-001", "support.jsonl"),
    sourceRowsFile: path.join(root, "scopes", "p-001", "source-processes.jsonl"),
    flowpropertyRowsFile: path.join(root, "scopes", "p-001", "flowproperties.jsonl"),
    unitgroupRowsFile: path.join(root, "scopes", "p-001", "unitgroups.jsonl"),
    identityPreflightIndex: path.join(root, "scopes", "p-001", "identity-index.jsonl"),
    context: {
      schemaFile: path.join(root, "context", "process", "outputs", "schema.json"),
      yamlFile: path.join(root, "context", "process", "outputs", "methodology.yaml"),
      rulesetFile: path.join(root, "context", "process", "outputs", "runtime-ruleset.json"),
    },
    classificationQueue: path.join(root, "scopes", "p-001", "classification-queue.jsonl"),
    locationQueue: path.join(root, "scopes", "p-001", "location-queue.jsonl"),
    classificationApplyReport: path.join(root, "scopes", "p-001", "classification-apply.json"),
    locationApplyReport: path.join(root, "scopes", "p-001", "location-apply.json"),
    identityApplyReports: [
      path.join(root, "scopes", "p-001", "flow-identity-apply.json"),
      path.join(root, "scopes", "p-001", "process-identity-apply.json"),
    ],
    patchCollectReport: path.join(root, "scopes", "p-001", "patch-collect.json"),
    patchApplyReport: path.join(root, "scopes", "p-001", "patch-apply.json"),
    targetUserId: "11111111-2222-4333-8444-555555555555",
    stateCode: 0,
  };
}

test("BAFU finalize planner preserves source rows, gate evidence, and exact argv order", () => {
  const root = path.resolve(path.sep, "repo");
  const service = createBatchFinalizeStageService(makeAdapter({ root, profile: "bafu" }));

  assert.deepEqual(service.buildFinalizeArgs(finalizeInput(root)), [
    "/runtime/node",
    path.join(root, "scripts", "foundry.ts"),
    "dataset-post-authoring-finalize",
    "--type",
    "process",
    "--profile",
    "bafu",
    "--rows-file",
    "scopes/p-001/processes.jsonl",
    "--out-dir",
    "scopes/p-001/finalize",
    "--ledger-dir",
    "import-ledger",
    "--source-support-rows-file",
    "scopes/p-001/support.jsonl",
    "--source-rows-file",
    "scopes/p-001/source-processes.jsonl",
    "--identity-preflight-index",
    "scopes/p-001/identity-index.jsonl",
    "--schema-file",
    "context/process/outputs/schema.json",
    "--yaml-file",
    "context/process/outputs/methodology.yaml",
    "--ruleset-file",
    "context/process/outputs/runtime-ruleset.json",
    "--classification-queue",
    "scopes/p-001/classification-queue.jsonl",
    "--location-queue",
    "scopes/p-001/location-queue.jsonl",
    "--classification-decision-apply-report",
    "scopes/p-001/classification-apply.json",
    "--location-decision-apply-report",
    "scopes/p-001/location-apply.json",
    "--identity-decision-apply-report",
    "scopes/p-001/flow-identity-apply.json",
    "--identity-decision-apply-report",
    "scopes/p-001/process-identity-apply.json",
    "--patch-collect-report",
    "scopes/p-001/patch-collect.json",
    "--patch-apply-report",
    "scopes/p-001/patch-apply.json",
    "--target-user-id",
    "11111111-2222-4333-8444-555555555555",
    "--state-code",
    "0",
    "--root-policy",
    "candidate",
    "--finalize-source-contact-support",
    "--verify-remote",
    "--run-identity-preflight",
    "--refresh-identity-preflight",
    "--require-patch-collect-report",
  ]);
});

test("USLCI finalize planner threads the complete frozen library contact after common flags", () => {
  const root = path.resolve(path.sep, "repo");
  const service = createBatchFinalizeStageService(
    makeAdapter({
      root,
      profile: "uslci",
      libraryContact: {
        libraryName: "U.S. Life Cycle Inventory Database",
        shortName: "USLCI",
        website: "https://www.lcacommons.gov/lca-collaboration/",
        email: "lca@nrel.gov",
        telephone: "+1-303-275-3000",
        contactAddress: "NREL, Golden, Colorado, USA",
        centralContactPoint: "National Renewable Energy Laboratory",
        description: "USLCI library contact",
        contactId: "22222222-3333-4444-8555-666666666666",
        contactVersion: "01.00.000",
      },
    }),
  );

  const args = service.buildFinalizeArgs(finalizeInput(root));
  assert.deepEqual(args.slice(-21), [
    "--library-name",
    "U.S. Life Cycle Inventory Database",
    "--library-short-name",
    "USLCI",
    "--library-website",
    "https://www.lcacommons.gov/lca-collaboration/",
    "--library-email",
    "lca@nrel.gov",
    "--library-telephone",
    "+1-303-275-3000",
    "--library-contact-address",
    "NREL, Golden, Colorado, USA",
    "--library-central-contact-point",
    "National Renewable Energy Laboratory",
    "--library-description",
    "USLCI library contact",
    "--library-contact-id",
    "22222222-3333-4444-8555-666666666666",
    "--library-contact-version",
    "01.00.000",
    "--require-patch-collect-report",
  ]);
  assert.equal(args.includes("--mint-unmatched-fp-ug-support"), false);
});

test("Worldsteel finalize planner appends account-local FP/UG support inputs after library contact", () => {
  const root = path.resolve(path.sep, "repo");
  const service = createBatchFinalizeStageService(
    makeAdapter({
      root,
      profile: "worldsteel",
      mintUnmatchedFpUgSupport: true,
      libraryContact: {
        libraryName: "World Steel Association",
        shortName: "worldsteel",
        website: "https://www.worldsteel.org",
        email: "steel@worldsteel.org",
      },
    }),
  );

  const args = service.buildFinalizeArgs(finalizeInput(root));
  assert.deepEqual(args.slice(-14), [
    "--library-name",
    "World Steel Association",
    "--library-short-name",
    "worldsteel",
    "--library-website",
    "https://www.worldsteel.org",
    "--library-email",
    "steel@worldsteel.org",
    "--mint-unmatched-fp-ug-support",
    "--support-flowproperty-rows-file",
    "scopes/p-001/flowproperties.jsonl",
    "--support-unitgroup-rows-file",
    "scopes/p-001/unitgroups.jsonl",
    "--require-patch-collect-report",
  ]);
});

test("finalize executor selects the expected report and preserves exact result/report bytes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-finalize-success-"));
  try {
    const reportPath = path.join(root, "finalize", "dataset-post-authoring-finalize-report.json");
    const report = {
      schema_version: 1,
      status: "ready_for_remote_write",
      counts: { blockers: 0, final_rows: 3 },
      files: { final_rows: "finalize/processes.final.jsonl" },
      blockers: [],
    };
    writeJson(reportPath, report);
    const captured: Array<{ stage: string; argv: string[]; logDir: string }> = [];
    const adapter = makeAdapter({
      root,
      profile: "bafu",
      runArgvStage: async (input) => {
        captured.push(input);
        return stageResult();
      },
    });
    const service = createBatchFinalizeStageService(adapter);
    const result = await service.runFinalizeStage({
      stage: "process.finalize",
      args: ["/runtime/node", "scripts/foundry.ts", "dataset-post-authoring-finalize"],
      reportPath,
      logDir: path.join(root, "logs"),
    });

    assert.deepEqual(captured, [
      {
        stage: "process.finalize",
        argv: ["/runtime/node", "scripts/foundry.ts", "dataset-post-authoring-finalize"],
        logDir: path.join(root, "logs"),
      },
    ]);
    assert.equal(result.finalize_report_missing, false);
    assert.equal(result.report, "finalize/dataset-post-authoring-finalize-report.json");
    assert.deepEqual(result.json, report);
    const resultBytes = JSON.stringify(result.json);
    assert.equal(
      resultBytes,
      '{"schema_version":1,"status":"ready_for_remote_write","counts":{"blockers":0,"final_rows":3},"files":{"final_rows":"finalize/processes.final.jsonl"},"blockers":[]}',
    );
    assert.equal(
      sha256Text(resultBytes),
      "a52d883941c83ebb8859cbf1845f04ba183018628ead005add21d5f91a8a601b",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("finalize executor synthesizes the exact missing-report timeout blocker without another stage", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-finalize-timeout-"));
  try {
    const service = createBatchFinalizeStageService(
      makeAdapter({
        root,
        profile: "worldsteel",
        runArgvStage: async () =>
          stageResult({
            stage: "flow.pre_finalize",
            command: "/runtime/node scripts/foundry.ts dataset-post-authoring-finalize --type flow",
            exit_code: 124,
            signal: "SIGTERM",
            timed_out: true,
            stdout_log: "logs/flow.pre_finalize.stdout.log",
            stderr_log: "logs/flow.pre_finalize.stderr.log",
            json: { status: "running", dataset_type: "flow" },
          }),
      }),
    );
    const reportPath = path.join(
      root,
      "flow-pre-finalize",
      "dataset-post-authoring-finalize-report.json",
    );
    const result = await service.runFinalizeStage({
      stage: "flow.pre_finalize",
      args: ["/runtime/node", "scripts/foundry.ts", "dataset-post-authoring-finalize"],
      reportPath,
      logDir: path.join(root, "logs"),
    });

    assert.equal(result.finalize_report_missing, true);
    assert.equal(result.report, "flow-pre-finalize/dataset-post-authoring-finalize-report.json");
    assert.deepEqual(result.json, {
      schema_version: 1,
      generated_at_utc: "2026-08-26T01:02:05.000Z",
      status: "failed_retryable",
      blockers: [
        {
          code: "finalize_stage_timeout",
          message: "flow.pre_finalize timed out before writing the expected finalize report.",
          stage: "flow.pre_finalize",
          expected_report: "flow-pre-finalize/dataset-post-authoring-finalize-report.json",
          exit_code: 124,
          timed_out: true,
          stdout_log: "logs/flow.pre_finalize.stdout.log",
          stderr_log: "logs/flow.pre_finalize.stderr.log",
          stdout_report_status: "running",
          stdout_report_dataset_type: "flow",
        },
      ],
      files: {
        expected_report: "flow-pre-finalize/dataset-post-authoring-finalize-report.json",
        stdout_log: "logs/flow.pre_finalize.stdout.log",
        stderr_log: "logs/flow.pre_finalize.stderr.log",
      },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("retry classifier follows nested identity/network evidence but keeps real curation work nonretryable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-finalize-retry-"));
  try {
    const nestedPath = path.join(root, "identity-preflight", "run-report.json");
    writeJson(nestedPath, {
      status: "failed",
      blockers: [
        {
          code: "identity_preflight_report_missing_or_non_json",
          message: "REMOTE_REQUEST_FAILED: getaddrinfo EAI_AGAIN api.tiangong.earth",
        },
      ],
    });
    const retryReportPath = path.join(root, "retry-finalize.json");
    writeJson(retryReportPath, {
      status: "blocked",
      blockers: [
        {
          code: "post_authoring_curation_gate_not_ready",
          status: "blocked_needs_foundry_deterministic_cleanup",
        },
      ],
      stages: [
        {
          stage: "identity_preflight_run",
          status: "failed",
          exit_code: 1,
          stderr: "",
          report_file: path.relative(root, nestedPath),
        },
        {
          stage: "post_authoring_curation_gate",
          status: "blocked_needs_foundry_deterministic_cleanup",
          exit_code: 1,
        },
      ],
    });
    const curationReportPath = path.join(root, "curation-finalize.json");
    writeJson(curationReportPath, {
      status: "blocked",
      blockers: [
        {
          code: "post_authoring_curation_gate_not_ready",
          status: "blocked_needs_foundry_ai_authoring",
        },
      ],
      stages: [
        { stage: "identity_preflight_run", status: "completed", exit_code: 0 },
        {
          stage: "post_authoring_curation_gate",
          status: "blocked_needs_foundry_ai_authoring",
          exit_code: 1,
        },
      ],
    });
    const service = createBatchFinalizeStageService(makeAdapter({ root, profile: "uslci" }));

    const retryable = service.retryableStageFailure({
      stage: "process.finalize",
      blocker: {
        code: "post_authoring_curation_gate_not_ready",
        message: "Post-authoring curation gate must be ready.",
      },
      report: path.relative(root, retryReportPath),
    });
    assert.deepEqual(retryable, {
      code: "identity_preflight_report_missing_or_non_json",
      message:
        "Stage failed for a retryable tool, network, or eventual-consistency reason; rerun the same scope instead of sending it to human review.",
    });

    assert.deepEqual(
      service.retryableStageFailure({
        stage: "classification.apply",
        report: null,
        blocker: {
          code: "classification_apply_stage_failed",
          message: "CLI classification apply failed for process.",
          stderr:
            "npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/@tiangong-lca%2fcli failed",
        },
      }),
      {
        code: "ENOTFOUND",
        message:
          "Stage failed for a retryable tool, network, or eventual-consistency reason; rerun the same scope instead of sending it to human review.",
      },
    );

    assert.equal(
      service.retryableStageFailure({
        stage: "process.finalize",
        blocker: {
          code: "post_authoring_curation_gate_not_ready",
          message: "Post-authoring curation gate must be ready.",
        },
        report: path.relative(root, curationReportPath),
      }),
      null,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
