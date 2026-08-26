import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  createIdentityPatchStageService,
  type IdentityPatchCarryForwardResult,
  type IdentityPatchJsonRecord,
  type IdentityPatchStageAdapter,
  type IdentityPatchStageResult,
} from "../../scripts/lib/batch-orchestration/identity-patch-stage.ts";
import { repoRoot } from "../fixtures/foundry-core.ts";

const ownerRelativePath = "scripts/commands/bafu-batch-import-run.ts";
const stageRelativePath = "scripts/lib/batch-orchestration/identity-patch-stage.ts";
const baselineOwnerLines = 3148;

interface StageHarness {
  readonly adapter: IdentityPatchStageAdapter;
  readonly calls: Array<{
    stage: string;
    argv: string[];
    logDir: string;
    reportPath?: unknown;
  }>;
}

interface StageHarnessOptions {
  readonly root: string;
  readonly profile: "bafu" | "uslci" | "worldsteel";
  readonly autofill: boolean;
  readonly responses: Readonly<Record<string, IdentityPatchJsonRecord>>;
  readonly carryForward?: IdentityPatchCarryForwardResult;
  readonly filterStatus?: "ready_for_ai_authoring_batch" | "ready_no_action_items";
}

function record(value: unknown): IdentityPatchJsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as IdentityPatchJsonRecord)
    : {};
}

function recordArray(value: unknown): IdentityPatchJsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("; ");
  if (typeof value === "object") {
    const entry = record(value);
    return textValue(entry["#text"] ?? entry.value ?? entry.id);
  }
  return "";
}

function physicalLineCount(source: string): number {
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.length > 0 ? `${rows.map(JSON.stringify).join("\n")}\n` : "");
}

function appendOption(argv: string[], name: string, value: unknown): void {
  if (value == null || value === "") return;
  if (value === true) {
    argv.push(name);
    return;
  }
  argv.push(name, String(value));
}

function makeHarness({
  root,
  profile,
  autofill,
  responses,
  carryForward,
  filterStatus = "ready_for_ai_authoring_batch",
}: StageHarnessOptions): StageHarness {
  const calls: StageHarness["calls"] = [];
  const resolveRepoPath = (value: unknown): string | null => {
    const text = textValue(value);
    return text ? (path.isAbsolute(text) ? text : path.join(root, text)) : null;
  };
  const repoRelative = (filePath: string): string =>
    path.relative(root, filePath).replaceAll("\\", "/");
  const defaultCarryForward: IdentityPatchCarryForwardResult = {
    outputFile: path.join(root, "identity-task", "identity-decisions.merged.jsonl"),
    reportPath: path.join(root, "identity-task", "identity-decision-carry-forward-report.json"),
    report: {
      status: "completed",
      counts: { replacements: 0, additions: 0, conflicts: 0 },
    },
  };
  const adapter: IdentityPatchStageAdapter = {
    processExecPath: "/runtime/node",
    foundryEntryPath: path.join(root, "scripts", "foundry.ts"),
    activeProfile: () => profile,
    bafuAutofillEnabled: () => autofill,
    resolveRepoPath,
    repoRelative,
    fileExists: (filePath) => Boolean(filePath && fs.existsSync(filePath)),
    foundryCommand: (command, options = {}) => {
      const argv = ["/runtime/node", path.join(root, "scripts", "foundry.ts"), command];
      for (const [key, value] of Object.entries(options)) {
        const flag = `--${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
        if (Array.isArray(value)) {
          for (const item of value) appendOption(argv, flag, item);
        } else {
          appendOption(argv, flag, value);
        }
      }
      return argv;
    },
    runArgvStage: async (input): Promise<IdentityPatchStageResult> => {
      calls.push(input);
      return {
        stage: input.stage,
        command: input.argv.join(" "),
        exit_code: 0,
        json: responses[input.stage] ?? null,
      };
    },
    statusIs: (report, values) => values.includes(String(report?.status ?? "")),
    firstBlocker: (report, fallbackCode, fallbackMessage) =>
      recordArray(report?.blockers)[0] ?? { code: fallbackCode, message: fallbackMessage },
    reportFile: (stageJson, fallback) => {
      const value = record(stageJson?.files).report ?? stageJson?.report;
      return resolveRepoPath(value) ?? fallback;
    },
    mergeCompletedReusableIdentityDecisions: () => carryForward ?? defaultCarryForward,
    identityUnresolvedReferenceBlocker: ({ type, report }) => {
      const count = Number(record(report.counts).identity_unresolved_references ?? 0);
      return count > 0
        ? {
            code: `${type}_identity_unresolved_references`,
            message: `${type} identity decisions still leave ${count} unresolved reference row(s).`,
          }
        : null;
    },
    filterAuthoringTaskManifestToRows: ({ taskManifest }) => ({
      status: filterStatus,
      taskManifest,
    }),
    writeJsonLines,
  };
  return { adapter, calls };
}

function commonInput(root: string, stages: IdentityPatchJsonRecord[]) {
  return {
    type: "flow",
    inputRowsFile: path.join(root, "scope", "flows.materialized.jsonl"),
    preFinalizeReport: {
      files: { curation_gate_report: "scope/pre-finalize/curation-gate-report.json" },
    },
    scopeDir: path.join(root, "scope"),
    runDir: path.join(root, "run"),
    logDir: path.join(root, "scope", "logs"),
    stages,
  };
}

function createGateReport(root: string): void {
  const gateReport = path.join(root, "scope", "pre-finalize", "curation-gate-report.json");
  fs.mkdirSync(path.dirname(gateReport), { recursive: true });
  fs.writeFileSync(gateReport, "{}\n");
}

test("identity and patch recovery has one typed semantic owner and shrinks the command owner by 430 lines", async () => {
  const ownerPath = path.join(repoRoot, ownerRelativePath);
  const stagePath = path.join(repoRoot, stageRelativePath);
  assert.equal(fs.existsSync(stagePath), true, stageRelativePath);

  const ownerSource = fs.readFileSync(ownerPath, "utf8");
  const stageSource = fs.readFileSync(stagePath, "utf8");
  assert.match(ownerSource, /createIdentityPatchStageService/u);
  assert.doesNotMatch(ownerSource, /async function runIdentityAndPatch\s*\(/u);
  assert.ok(
    physicalLineCount(ownerSource) <= baselineOwnerLines - 430,
    `expected ${ownerRelativePath} to lose at least 430 lines`,
  );
  assert.ok(physicalLineCount(stageSource) <= 800, `${stageRelativePath} exceeds 800 lines`);
  assert.doesNotMatch(stageRelativePath, /(?:^|[-_/])part[-_]?\d+(?:\.|$)/u);
  assert.doesNotMatch(stageSource, /from\s+["']\.\.\/\.\.\/commands\//u);
  assert.doesNotMatch(stageSource, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b/u);
  assert.doesNotMatch(stageSource, /@ts-(?:no)?check|@ts-ignore|@ts-expect-error/u);

  const stageModule = (await import(pathToFileURL(stagePath).href)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(stageModule), ["createIdentityPatchStageService"]);
});

test("BAFU identity autofill preserves identity, authoring, collect, and patch-apply stage order", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-identity-patch-bafu-"));
  try {
    createGateReport(root);
    const identityRows = path.join(root, "scope", "flow-identity-apply", "flows.applied.jsonl");
    const patchedRows = path.join(root, "scope", "flow-authoring-tasks", "flows.patched.jsonl");
    const batchPatch = path.join(root, "scope", "flow-authoring-tasks", "ai-patches.batch.json");
    const { adapter, calls } = makeHarness({
      root,
      profile: "bafu",
      autofill: true,
      responses: {
        "flow.identity_task": { status: "ready_for_ai_identity_decisions" },
        "flow.identity_autofill": { status: "completed_with_manual_review" },
        "flow.identity_apply": { status: "completed", files: { output_rows: identityRows } },
        "flow.authoring_task": { status: "ready_for_ai_authoring_batch" },
        "flow.patch_autofill": { status: "completed" },
        "flow.patch_collect": {
          status: "ready_for_patch_apply",
          files: { batch_patch: batchPatch },
        },
        "flow.patch_apply": { status: "completed", files: { patched_rows: patchedRows } },
      },
      carryForward: {
        outputFile: path.join(root, "scope", "flow-identity-task", "identity-decisions.jsonl"),
        reportPath: path.join(
          root,
          "scope",
          "flow-identity-task",
          "identity-decision-carry-forward-report.json",
        ),
        report: {
          status: "completed",
          counts: { replacements: 1, additions: 2, conflicts: 0 },
        },
      },
    });
    const stages: IdentityPatchJsonRecord[] = [];
    const result = await createIdentityPatchStageService(adapter).runIdentityAndPatch(
      commonInput(root, stages),
    );

    assert.deepEqual(
      stages.map((stage) => stage.stage),
      [
        "flow.identity_task",
        "flow.identity_autofill",
        "flow.identity_decision_carry_forward",
        "flow.identity_apply",
        "flow.authoring_task",
        "flow.patch_autofill",
        "flow.patch_collect",
        "flow.patch_apply",
      ],
    );
    assert.deepEqual(
      calls.map((call) => call.stage),
      [
        "flow.identity_task",
        "flow.identity_autofill",
        "flow.identity_apply",
        "flow.authoring_task",
        "flow.patch_autofill",
        "flow.patch_collect",
        "flow.patch_apply",
      ],
    );
    assert.deepEqual(result, {
      status: "completed",
      rowsFile: patchedRows,
      identityApplyReport: path.join(
        root,
        "scope",
        "flow-identity-apply",
        "identity-decisions-apply-report.json",
      ),
      patchCollectReport: path.join(
        root,
        "scope",
        "flow-authoring-tasks",
        "authoring-patch-collect-report.json",
      ),
      patchApplyReport: path.join(
        root,
        "scope",
        "flow-authoring-tasks",
        "patch-apply",
        "outputs",
        "dataset-patch-apply-report.json",
      ),
    });
    const applyCall = calls.find((call) => call.stage === "flow.patch_apply");
    assert.deepEqual(applyCall?.argv, [
      "/runtime/node",
      path.join(root, "scripts", "foundry.ts"),
      "dataset-patch-apply",
      "--input",
      "scope/flow-identity-apply/flows.applied.jsonl",
      "--patch",
      "scope/flow-authoring-tasks/ai-patches.batch.json",
      "--out",
      "scope/flow-authoring-tasks/flows.patched.jsonl",
      "--out-dir",
      "scope/flow-authoring-tasks/patch-apply",
      "--authoring-package-dir",
      "scope/flow-authoring-tasks/authoring-package-snapshots",
      "--require-authoring-package",
      "--require-action-item-closure",
    ]);
    assert.equal(
      sha256Text(JSON.stringify({ result, stages: stages.map((stage) => stage.stage) })),
      "e7a46b73c721da5b711136101767387565535941066ea4b6b3f4e34bddcc7baa",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("USLCI deterministic resolution rewrites preserve decision order and fail closed before BAFU patching", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-identity-patch-uslci-"));
  try {
    createGateReport(root);
    const identityRows = path.join(root, "scope", "flow-identity-apply", "flows.applied.jsonl");
    const { adapter, calls } = makeHarness({
      root,
      profile: "uslci",
      autofill: false,
      responses: {
        "flow.identity_task": { status: "ready_for_ai_identity_decisions" },
        "flow.identity_apply": { status: "completed", files: { output_rows: identityRows } },
        "flow.authoring_task": { status: "ready_for_ai_authoring_batch" },
      },
    });
    const stages: IdentityPatchJsonRecord[] = [];
    const result = await createIdentityPatchStageService(adapter).runIdentityAndPatch({
      ...commonInput(root, stages),
      applyResolutionRewritesMode: true,
      resolutionRewriteRows: [
        {
          source_flow_id: "source-flow-a",
          source_flow_version: "01.00.000",
          canonical_flow_id: "canonical-flow-a",
          canonical_flow_version: "02.00.000",
          canonical_short_description: "Canonical electricity flow",
          process_id: "process-a",
          exchange_index: 4,
        },
        {
          source_flow_id: "source-flow-a",
          canonical_flow_id: "ignored-duplicate",
          process_id: "process-b",
          exchange_index: 9,
        },
        {
          source_flow_id: "source-flow-b",
          canonical_flow_id: "canonical-flow-b",
          process_id: "process-a",
          exchange_index: 7,
        },
      ],
    });

    assert.deepEqual(
      stages.map((stage) => stage.stage),
      [
        "flow.identity_task",
        "flow.identity_resolution_rewrites",
        "flow.identity_apply",
        "flow.authoring_task",
      ],
    );
    assert.deepEqual(
      calls.map((call) => call.stage),
      ["flow.identity_task", "flow.identity_apply", "flow.authoring_task"],
    );
    assert.deepEqual(result, {
      status: "blocked",
      blocker: {
        code: "flow_authoring_action_items_require_authoring",
        message:
          "flow scope has authoring action items but BAFU patch autofill is disabled for this profile; author the fields explicitly before commit.",
      },
      report: path.join(root, "scope", "flow-authoring-tasks", "authoring-task-manifest.json"),
    });
    assert.equal(
      calls.some((call) => call.stage.includes("patch")),
      false,
    );

    const decisionsPath = path.join(
      root,
      "scope",
      "flow-identity-task",
      "identity-decisions.resolution.jsonl",
    );
    const decisionBytes = fs.readFileSync(decisionsPath, "utf8");
    const decisionRows = decisionBytes
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(decisionRows.length, 2);
    assert.deepEqual(
      decisionRows.map((row) => [row.dataset_id, row.canonical.ref_object_id]),
      [
        ["source-flow-a", "canonical-flow-a"],
        ["source-flow-b", "canonical-flow-b"],
      ],
    );
    assert.equal(decisionRows[0].canonical.short_description, "Canonical electricity flow");
    assert.equal(decisionRows[0].evidence.exchange_index, 4);
    assert.equal(decisionRows[1].dataset_version, "00.00.001");
    assert.equal(
      sha256Text(decisionBytes),
      "26897979b455809f545d63fc819deaf47190d40ae67ef8b6f665af9d6f9e3836",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Worldsteel pre-authored reuse applies once and clean retained tasks skip BAFU patch authoring", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-identity-patch-worldsteel-"));
  try {
    createGateReport(root);
    const identityRows = path.join(root, "scope", "steel-identity-apply", "flows.applied.jsonl");
    const carryForward: IdentityPatchCarryForwardResult = {
      outputFile: path.join(root, "scope", "steel-identity-task", "identity-decisions.jsonl"),
      reportPath: path.join(root, "scope", "steel-identity-task", "carry-forward.json"),
      report: {
        status: "completed",
        counts: { replacements: 0, additions: 3, conflicts: 0 },
      },
    };
    const { adapter, calls } = makeHarness({
      root,
      profile: "worldsteel",
      autofill: false,
      carryForward,
      filterStatus: "ready_no_action_items",
      responses: {
        "steel.identity_task": { status: "ready_no_identity_actions" },
        "steel.identity_apply": { status: "completed", files: { output_rows: identityRows } },
        "steel.authoring_task": { status: "ready_for_ai_authoring_batch" },
      },
    });
    const stages: IdentityPatchJsonRecord[] = [];
    const result = await createIdentityPatchStageService(adapter).runIdentityAndPatch({
      ...commonInput(root, stages),
      label: "steel",
      stagePrefix: "steel",
    });

    assert.deepEqual(
      stages.map((stage) => stage.stage),
      [
        "steel.identity_task",
        "steel.identity_decision_carry_forward",
        "steel.identity_apply",
        "steel.authoring_task",
      ],
    );
    assert.deepEqual(
      calls.map((call) => call.stage),
      ["steel.identity_task", "steel.identity_apply", "steel.authoring_task"],
    );
    assert.deepEqual(result, {
      status: "completed",
      rowsFile: identityRows,
      identityApplyReport: path.join(
        root,
        "scope",
        "steel-identity-apply",
        "identity-decisions-apply-report.json",
      ),
      patchCollectReport: null,
      patchApplyReport: null,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing curation evidence and identity apply blockers stop without retries or later stages", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-identity-patch-blocked-"));
  try {
    const missingHarness = makeHarness({
      root,
      profile: "bafu",
      autofill: true,
      responses: {},
    });
    const missingStages: IdentityPatchJsonRecord[] = [];
    const missing = await createIdentityPatchStageService(
      missingHarness.adapter,
    ).runIdentityAndPatch(commonInput(root, missingStages));
    assert.deepEqual(missing, {
      status: "blocked",
      blocker: {
        code: "flow_curation_gate_report_missing",
        message: "flow curation gate report is required for identity and patch authoring.",
      },
    });
    assert.deepEqual(missingStages, []);
    assert.deepEqual(missingHarness.calls, []);

    createGateReport(root);
    const blockedHarness = makeHarness({
      root,
      profile: "bafu",
      autofill: true,
      responses: {
        "flow.identity_task": { status: "ready_for_ai_identity_decisions" },
        "flow.identity_autofill": { status: "completed" },
        "flow.identity_apply": {
          status: "blocked",
          blockers: [
            {
              code: "identity_preflight_report_missing_or_non_json",
              message: "REMOTE_REQUEST_FAILED: getaddrinfo EAI_AGAIN api.tiangong.earth",
            },
          ],
        },
      },
    });
    const blockedStages: IdentityPatchJsonRecord[] = [];
    const blocked = await createIdentityPatchStageService(
      blockedHarness.adapter,
    ).runIdentityAndPatch(commonInput(root, blockedStages));
    assert.deepEqual(blocked, {
      status: "blocked",
      blocker: {
        code: "identity_preflight_report_missing_or_non_json",
        message: "REMOTE_REQUEST_FAILED: getaddrinfo EAI_AGAIN api.tiangong.earth",
      },
      report: path.join(
        root,
        "scope",
        "flow-identity-apply",
        "identity-decisions-apply-report.json",
      ),
    });
    assert.deepEqual(
      blockedHarness.calls.map((call) => call.stage),
      ["flow.identity_task", "flow.identity_autofill", "flow.identity_apply"],
    );
    assert.equal(
      blockedHarness.calls.filter((call) => call.stage === "flow.identity_apply").length,
      1,
    );
    assert.equal(
      blockedHarness.calls.some((call) => /authoring|patch/u.test(call.stage)),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
