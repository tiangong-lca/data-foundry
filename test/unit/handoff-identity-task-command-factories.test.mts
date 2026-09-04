import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCommitHandoffCommands } from "../../scripts/commands/commit-handoff.ts";
import { createIdentityDecisionTaskCommands } from "../../scripts/commands/identity-decision-task.ts";
import { profileFor } from "../../scripts/lib/import-curation/internal/profiles-config.ts";
import {
  authorizedProfileOptions,
  taskAuthorizationFixture,
} from "../fixtures/task-authorizations.ts";
import { validateTaskAuthorization } from "../../scripts/lib/task-authorization.ts";

type JsonObject = Record<string, unknown>;

interface HandoffReport extends JsonObject {
  status: string;
  final_rows_artifact: { path: string; bytes: number; sha256: string } | null;
  blockers: JsonObject[];
  commands: {
    commit: CommandSpec | null;
    post_write_verify: CommandSpec | null;
  };
  files: Record<string, unknown> & { report?: string };
}

interface CommandSpec extends JsonObject {
  schema: string;
  executable: string;
  argv: string[];
  display: string;
  sha256: string;
  binding: {
    artifacts: Array<{ role: string; path: string; bytes: number; sha256: string }>;
  };
}

interface IdentityTaskReport extends JsonObject {
  status: string;
  counts: Record<string, number>;
  identity_action_items: JsonObject[];
  context_bundle: JsonObject & { sha256: string };
  files: Record<string, string>;
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const fixedNow = "2026-08-25T11:00:00.000Z";

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

function withTempRoot(name: string, run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `foundry-${name}-`));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function resolveFrom(root: string, value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text);
}

function relativeTo(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function withoutAccountEnvironment<T>(run: () => T): T {
  const keys = [
    "FOUNDRY_TARGET_USER_ID",
    "FOUNDRY_VERIFIED_PROJECT_REF",
    "FOUNDRY_VERIFIED_USER_ID",
    "FOUNDRY_ACCOUNT_MODE",
  ] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    return run();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function handoffHarness(root: string) {
  const traceCoverageCalls: unknown[] = [];
  const resolveRepoPath = (value: unknown) => resolveFrom(root, value);
  const commands = createCommitHandoffCommands({
    appendOption(args: string[], name: string, value: unknown) {
      const text = asText(value);
      if (text) args.push(name, text);
    },
    asText,
    countJsonLinesFile(filePath: string) {
      const text = fs.readFileSync(filePath, "utf8").trim();
      return text ? text.split(/\r?\n/u).length : 0;
    },
    fileExists(filePath: string | null) {
      return Boolean(filePath && fs.existsSync(filePath));
    },
    fullContextProofCheck() {
      return { required: true, blockers: [] };
    },
    nowIso: () => fixedNow,
    profileFor,
    readJsonArtifactOption(value: unknown) {
      const artifactPath = resolveRepoPath(value);
      if (!artifactPath || !fs.existsSync(artifactPath)) return null;
      return { path: artifactPath, value: JSON.parse(fs.readFileSync(artifactPath, "utf8")) };
    },
    repoRelativePath(filePath: string) {
      return relativeTo(root, filePath);
    },
    repoRoot: root,
    resolveRepoPath,
    resolveTiangongLcaCliCommand() {
      return { command: process.execPath, args: ["/installed/tiangong-lca.js"] };
    },
    resolveTiangongLcaCliBin() {
      return "/unused/tiangong-lca";
    },
    shellQuote(value: unknown) {
      return JSON.stringify(String(value));
    },
    validateTraceQueueCoverageForRows(input: unknown) {
      traceCoverageCalls.push(input);
    },
    writeJson,
  });
  return { commands, traceCoverageCalls };
}

function writeHandoffFixture(root: string): { finalize: string; rows: string; rowsText: string } {
  const rows = path.join(root, "scope/final-rows.jsonl");
  const rowsText = `${JSON.stringify({ processDataSet: { id: "process-1" } })}\n`;
  writeText(rows, rowsText);
  writeJson(path.join(root, "scope/mutation.json"), {
    status: "ready_for_remote_write",
    profile: "generic",
    target_user_id: "owner-1",
    counts: {
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
    files: {},
  });
  const finalize = path.join(root, "scope/finalize.json");
  writeJson(finalize, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "generic",
    target_user_id: "owner-1",
    counts: { location_audit_blockers: 0, write_candidates: 1 },
    files: {
      final_rows: relativeTo(root, rows),
      mutation_manifest: "scope/mutation.json",
    },
  });
  return { finalize: relativeTo(root, finalize), rows, rowsText };
}

test("mixed support handoff rechecks exact task actions against actual final rows", () => {
  withTempRoot("handoff-task-authorization", (root) =>
    withoutAccountEnvironment(() => {
      const fixture = writeHandoffFixture(root);
      writeJson(path.join(root, "specs/import-profiles.json"), {
        profiles: { generic: { id: "generic" } },
      });
      const owner = "11111111-1111-4111-8111-111111111111";
      const fp = {
        flowPropertyDataSet: {
          flowPropertiesInformation: { dataSetInformation: { "common:UUID": "fp" } },
        },
      };
      const ug = {
        unitGroupDataSet: { unitGroupInformation: { dataSetInformation: { "common:UUID": "ug" } } },
      };
      writeText(fixture.rows, `${JSON.stringify(fp)}\n`);
      const { commands } = handoffHarness(root);
      const options = {
        finalizeReport: fixture.finalize,
        type: "support",
        targetUserId: owner,
        outDir: "handoff",
      };
      const denied = commands.runDatasetCommitHandoffPlan(options) as HandoffReport;
      assert.equal(denied.status, "blocked");
      assert.equal(denied.commands.commit, null);
      assert.deepEqual(
        denied.blockers
          .filter((row) => row.code === "task_authorization_action_required")
          .map((row) => row.action),
        ["flowproperty_write", "canonical_support_local_mint"],
      );
      const fpGrant = authorizedProfileOptions(
        root,
        "generic",
        ["flowproperty_write", "canonical_support_local_mint"],
        sha256(fs.readFileSync(fixture.rows, "utf8")),
      );
      const fpReady = commands.runDatasetCommitHandoffPlan({
        ...options,
        ...fpGrant,
      }) as HandoffReport;
      assert.equal(fpReady.status, "ready_for_explicit_commit");
      assert.ok(fpReady.commands.commit?.argv.includes("--allow-account-local-support"));
      writeText(fixture.rows, `${JSON.stringify(fp)}\n${JSON.stringify(ug)}\n`);
      const widened = commands.runDatasetCommitHandoffPlan({
        ...options,
        ...fpGrant,
      }) as HandoffReport;
      assert.equal(widened.status, "blocked");
      assert.ok(widened.blockers.some((row) => row.action === "unitgroup_write"));
      assert.ok(widened.blockers.some((row) => row.code === "task_authorization_input_mismatch"));
      const mixedGrant = authorizedProfileOptions(
        root,
        "generic",
        ["flowproperty_write", "unitgroup_write", "canonical_support_local_mint"],
        sha256(fs.readFileSync(fixture.rows, "utf8")),
      );
      assert.equal(
        (commands.runDatasetCommitHandoffPlan({ ...options, ...mixedGrant }) as HandoffReport)
          .status,
        "ready_for_explicit_commit",
      );
      const wrongOwner = commands.runDatasetCommitHandoffPlan({
        ...options,
        ...mixedGrant,
        targetUserId: "different-owner",
      }) as HandoffReport;
      assert.equal(wrongOwner.commands.commit, null);
      assert.ok(
        wrongOwner.blockers.some((row) => row.code === "task_authorization_account_mismatch"),
      );
    }),
  );
});

test("old non-generic ready reports require current rule evidence before handoff", () => {
  withTempRoot("handoff-legacy-rules", (root) =>
    withoutAccountEnvironment(() => {
      const fixture = writeHandoffFixture(root);
      writeJson(path.join(root, "specs/import-profiles.json"), {
        profiles: { bafu: { id: "bafu" } },
      });
      const finalizePath = path.join(root, fixture.finalize);
      const finalize = JSON.parse(fs.readFileSync(finalizePath, "utf8"));
      writeJson(finalizePath, { ...finalize, profile: "bafu" });
      const mutationPath = path.join(root, "scope/mutation.json");
      const mutation = JSON.parse(fs.readFileSync(mutationPath, "utf8"));
      writeJson(mutationPath, { ...mutation, profile: "bafu" });
      const options = { finalizeReport: fixture.finalize, outDir: "handoff" };
      const { commands } = handoffHarness(root);
      const legacy = commands.runDatasetCommitHandoffPlan(options) as HandoffReport;
      assert.equal(legacy.commands.commit, null);
      assert.ok(legacy.blockers.some((row) => row.code === "task_profile_rules_evidence_required"));
      writeJson(mutationPath, {
        ...mutation,
        profile: "bafu",
        profile_rules_sha256: profileFor(root, "bafu").rulesSha256,
      });
      assert.equal(
        (commands.runDatasetCommitHandoffPlan(options) as HandoffReport).status,
        "ready_for_explicit_commit",
      );
      writeJson(finalizePath, { ...finalize, profile: "generic" });
      writeJson(mutationPath, { ...mutation, profile: "bafu" });
      const mixedProfile = commands.runDatasetCommitHandoffPlan(options) as HandoffReport;
      assert.equal(mixedProfile.commands.commit, null);
      assert.ok(mixedProfile.blockers.some((row) => row.code === "task_profile_mismatch"));
    }),
  );
});

test("retained QA exceptions require a live task grant at the final handoff", () => {
  withTempRoot("handoff-qa-approval", (root) =>
    withoutAccountEnvironment(() => {
      const fixture = writeHandoffFixture(root);
      const rules = { id: "generic" };
      writeJson(path.join(root, "specs/import-profiles.json"), { profiles: { generic: rules } });
      const mutationPath = path.join(root, "scope/mutation.json");
      const mutation = JSON.parse(fs.readFileSync(mutationPath, "utf8"));
      writeJson(mutationPath, {
        ...mutation,
        required_qa_waiver_codes: ["process_material_balance_deviation"],
      });
      const grant = taskAuthorizationFixture("generic", rules);
      grant.binding.input_scope_sha256 = sha256(fs.readFileSync(fixture.rows, "utf8"));
      grant.authorization.binding = { ...grant.binding };
      grant.authorization.allowed_actions = [];
      grant.authorization.evidence.push({
        id: "source-model",
        kind: "source-model",
        reference: "fixture/source-model.json",
        sha256: "b".repeat(64),
      });
      grant.authorization.qa_waivers = [
        {
          dataset_type: "process",
          code: "process_material_balance_deviation",
          evidence_ids: ["source-model"],
        },
      ];
      const result = validateTaskAuthorization(grant.authorization, grant.binding);
      assert.equal(result.status, "authorized");
      const options = {
        finalizeReport: fixture.finalize,
        outDir: "handoff",
        targetUserId: grant.binding.user_id,
        taskAuthorizationBinding: grant.binding,
      };
      const { commands } = handoffHarness(root);
      const absent = commands.runDatasetCommitHandoffPlan(options) as HandoffReport;
      assert.equal(absent.commands.commit, null);
      assert.ok(
        absent.blockers.some((row) => row.code === "task_authorization_qa_waiver_required"),
      );
      assert.equal(
        (
          commands.runDatasetCommitHandoffPlan({
            ...options,
            taskAuthorization: result.authorization,
          }) as HandoffReport
        ).status,
        "ready_for_explicit_commit",
      );
      const serialized = commands.runDatasetCommitHandoffPlan({
        ...options,
        taskAuthorization: JSON.parse(JSON.stringify(result.authorization)),
      }) as HandoffReport;
      assert.equal(serialized.commands.commit, null);
      assert.ok(
        serialized.blockers.some((row) => row.code === "task_authorization_qa_waiver_required"),
      );
    }),
  );
});

test("commit handoff binds exact final-row bytes, argv order, hashes, and report bytes", () => {
  withTempRoot("handoff-ready", (root) => {
    const fixture = writeHandoffFixture(root);
    const { commands, traceCoverageCalls } = handoffHarness(root);
    const report = withoutAccountEnvironment(
      () =>
        commands.runDatasetCommitHandoffPlan({
          finalizeReport: fixture.finalize,
          outDir: "handoff",
          targetUserId: "owner-1",
          accountMode: "ordinary",
        }) as HandoffReport,
    );

    assert.equal(report.status, "ready_for_explicit_commit");
    assert.deepEqual(report.final_rows_artifact, {
      path: "scope/final-rows.jsonl",
      bytes: Buffer.byteLength(fixture.rowsText),
      sha256: sha256(fixture.rowsText),
    });
    const commit = report.commands.commit;
    const verify = report.commands.post_write_verify;
    assert.ok(commit);
    assert.ok(verify);
    assert.equal(commit.schema, "tiangong-foundry.command-spec.v1");
    assert.equal(commit.executable, process.execPath);
    assert.deepEqual(commit.argv, [
      "/installed/tiangong-lca.js",
      "process",
      "save-draft",
      "--input",
      fixture.rows,
      "--out-dir",
      path.join(root, "handoff/commit/process-save-draft"),
      "--commit",
      "--json",
      "--target-user-id",
      "owner-1",
    ]);
    assert.deepEqual(commit.binding.artifacts, verify.binding.artifacts);
    assert.deepEqual(commit.binding.artifacts, [
      {
        role: "final_rows",
        path: "scope/final-rows.jsonl",
        bytes: Buffer.byteLength(fixture.rowsText),
        sha256: sha256(fixture.rowsText),
      },
    ]);
    assert.match(commit.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(commit.display.includes("--target-user-id"), true);
    assert.deepEqual(verify.argv.slice(-4), ["--target-user-id", "owner-1", "--state-code", "0"]);
    assert.equal(traceCoverageCalls.length, 1);

    const written = structuredClone(report);
    delete written.files.report;
    assert.equal(
      fs.readFileSync(path.join(root, "handoff/dataset-commit-handoff-plan.json"), "utf8"),
      `${JSON.stringify(written, null, 2)}\n`,
    );
  });
});

test("commit handoff stays fail-closed and preserves native malformed-report errors", () => {
  withTempRoot("handoff-blocked", (root) => {
    const fixture = writeHandoffFixture(root);
    const mutationPath = path.join(root, "scope/mutation.json");
    fs.rmSync(mutationPath);
    const finalizePath = path.join(root, fixture.finalize);
    const finalize = JSON.parse(fs.readFileSync(finalizePath, "utf8")) as JsonObject;
    delete finalize.target_user_id;
    writeJson(finalizePath, finalize);
    const { commands } = handoffHarness(root);
    const blocked = withoutAccountEnvironment(
      () =>
        commands.runDatasetCommitHandoffPlan({
          finalizeReport: fixture.finalize,
          outDir: "blocked",
          accountMode: "ordinary",
        }) as HandoffReport,
    );
    assert.equal(blocked.status, "blocked");
    assert.deepEqual(
      blocked.blockers.map((entry) => entry.code),
      ["mutation_manifest_required", "target_user_id_required"],
    );
    assert.equal(blocked.commands.commit, null);
    assert.equal(blocked.commands.post_write_verify, null);

    writeText(path.join(root, "malformed.json"), "{ malformed\n");
    assert.throws(
      () =>
        withoutAccountEnvironment(() =>
          commands.runDatasetCommitHandoffPlan({ finalizeReport: "malformed.json" }),
        ),
      SyntaxError,
    );
  });
});

function identityTaskHarness(root: string) {
  const resolveRepoPath = (value: unknown) => resolveFrom(root, value);
  const summary = (value: unknown) => {
    const file = value as JsonObject;
    return { kind: asText(file.kind), text: asText(file.text) };
  };
  const commands = createIdentityDecisionTaskCommands({
    asText,
    datasetRowsFileStem(datasetType: string) {
      return datasetType === "process" ? "processes" : "flows";
    },
    decisionAuthoringContext(bundle: JsonObject) {
      return { context_bundle_sha256: bundle.sha256 };
    },
    decisionTaskBuildStatus(input: {
      queueRows: unknown[];
      blockers: unknown[];
      readyStatus: string;
      emptyStatus: string;
    }) {
      if (input.blockers.length) return "blocked_missing_full_context";
      return input.queueRows.length ? input.readyStatus : input.emptyStatus;
    },
    decisionTaskContextFileSummary: summary,
    dedupeDecisionTaskContextFiles(files) {
      const byKey = new Map<string, (typeof files)[number]>();
      for (const file of files) byKey.set(JSON.stringify(summary(file)), file);
      return [...byKey.values()];
    },
    ensureArray,
    fileExists(filePath: string | null) {
      return Boolean(filePath && fs.existsSync(filePath));
    },
    hasQueueSelectionOptions() {
      return false;
    },
    normalizedList(value: unknown) {
      return ensureArray(value).map(asText).filter(Boolean);
    },
    nowIso: () => fixedNow,
    readJson(filePath: string) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    },
    readText(filePath: string) {
      return fs.readFileSync(filePath, "utf8");
    },
    repoRelativePath(filePath: string) {
      return relativeTo(root, filePath);
    },
    repoRoot: root,
    resolveRepoPath,
    selectDecisionTaskQueueRows(rows) {
      return {
        selected: rows.map((row, index) => ({ row, index })),
        selection: { source_queue_rows: rows.length, selected_queue_rows: rows.length },
      };
    },
    sha256Text: sha256,
    shellQuote(value: unknown) {
      return JSON.stringify(String(value));
    },
    unique<T>(values: T[]) {
      return [...new Set(values)];
    },
    writeDecisionTaskSharedContextBundle(input: {
      outDir: string;
      taskKind: string;
      files: unknown[];
      references: unknown[];
    }) {
      const bundlePath = path.join(input.outDir, "shared-context-bundle.json");
      const payload = {
        task_kind: input.taskKind,
        files: input.files,
        references: input.references,
      };
      const text = `${JSON.stringify(payload, null, 2)}\n`;
      writeText(bundlePath, text);
      return { path: relativeTo(root, bundlePath), sha256: sha256(text) };
    },
    writeJson,
    writeJsonLines,
  });
  return { commands };
}

function writeIdentityTaskFixture(root: string): {
  gatePath: string;
  packagePath: string;
  packageText: string;
} {
  const packagePath = path.join(root, "packages/flow.authoring-package.json");
  const packagePayload = {
    dataset_type: "process",
    entity_id: "process-owner",
    version: "01.00.000",
    full_context_ai_completion: {
      required_context_kinds: ["schema", "methodology_yaml", "ruleset"],
    },
    contract_context_files: [
      { kind: "schema", text: "schema text" },
      { kind: "methodology_yaml", text: "method text" },
      { kind: "ruleset", text: "rules text" },
    ],
    missing_context_files: [],
    action_items: [
      {
        code: "identity_preflight_manual_review",
        dependency_type: "flow",
        dependency_id: "flow-target",
        dependency_version: "01.02.003",
        relation: "exchange",
        evidence: { target: "candidate-a" },
      },
      {
        code: "elementary_flow_identity_manual_review",
        dependency_type: "flow",
        dependency_id: "flow-target",
        dependency_version: "01.02.003",
        relation: "exchange",
        evidence: { target: "candidate-b", top_candidates: ["canonical-b"] },
      },
    ],
  };
  const packageText = `${JSON.stringify(packagePayload, null, 2)}\n`;
  writeText(packagePath, packageText);
  const gatePath = path.join(root, "gate.json");
  writeJson(gatePath, {
    entities: [
      {
        authoring_package: relativeTo(root, packagePath),
        authoring_package_sha256: sha256(packageText),
      },
    ],
  });
  return { gatePath: relativeTo(root, gatePath), packagePath, packageText };
}

test("identity task preserves package SHA snapshots, action order, dedupe, and exact artifacts", () => {
  withTempRoot("identity-task", (root) => {
    const fixture = writeIdentityTaskFixture(root);
    const { commands } = identityTaskHarness(root);
    const task = commands.runDatasetIdentityDecisionTaskBuild({
      curationGateReport: fixture.gatePath,
      outDir: "identity-task",
      rowsFile: "rows/flows.jsonl",
    }) as IdentityTaskReport;

    assert.equal(task.status, "ready_for_ai_identity_decisions");
    assert.deepEqual(
      {
        identity_action_items: task.counts.identity_action_items,
        unique_identity_targets: task.counts.unique_identity_targets,
        selected_identity_action_items: task.counts.selected_identity_action_items,
        selected_unique_identity_targets: task.counts.selected_unique_identity_targets,
        deduplicated_identity_action_items: task.counts.deduplicated_identity_action_items,
        template_decisions: task.counts.template_decisions,
        blockers: task.counts.blockers,
      },
      {
        identity_action_items: 2,
        unique_identity_targets: 1,
        selected_identity_action_items: 2,
        selected_unique_identity_targets: 1,
        deduplicated_identity_action_items: 1,
        template_decisions: 1,
        blockers: 0,
      },
    );
    const item = task.identity_action_items[0];
    assert.deepEqual(item.action_item_codes, [
      "identity_preflight_manual_review",
      "elementary_flow_identity_manual_review",
    ]);
    assert.equal(item.action_item_code, "elementary_flow_identity_manual_review");
    assert.equal(item.source_action_item_count, 2);

    const snapshotName = `flow.authoring-package.${sha256(fixture.packageText)}.snapshot.json`;
    const snapshotPath = path.join(root, "identity-task/authoring-package-snapshots", snapshotName);
    assert.equal(fs.readFileSync(snapshotPath, "utf8"), fixture.packageText);
    const templateText = fs.readFileSync(
      path.join(root, "identity-task/identity-decisions.template.jsonl"),
      "utf8",
    );
    const templateRows = templateText
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.equal(templateRows.length, 1);
    assert.equal(
      templateRows[0].identity_decision,
      "__AI_SELECT_REUSE_EXISTING_REFERENCE_OR_BLOCK_UNRESOLVED__",
    );
    assert.deepEqual(templateRows[0].closes_action_items, [
      "identity_preflight_manual_review",
      "elementary_flow_identity_manual_review",
    ]);
    assert.equal(templateRows[0].authoring_package, relativeTo(root, snapshotPath));
    assert.equal(templateRows[0].authoring_package_sha256, sha256(fixture.packageText));
    assert.equal(
      templateRows[0].authoring_context.context_bundle_sha256,
      task.context_bundle.sha256,
    );
    assert.equal(
      fs.readFileSync(path.join(root, "identity-task/identity-decision-task.json"), "utf8"),
      `${JSON.stringify(task, null, 2)}\n`,
    );
    assert.equal(
      fs.readFileSync(path.join(root, "identity-task/identity-decision-task-report.json"), "utf8"),
      `${JSON.stringify(task, null, 2)}\n`,
    );
  });
});

test("identity task blocks malformed packages and preserves native malformed-gate errors", () => {
  withTempRoot("identity-task-errors", (root) => {
    writeText(path.join(root, "package.json"), "{ malformed\n");
    writeJson(path.join(root, "gate.json"), {
      entities: [{ authoring_package: "package.json" }],
    });
    const { commands } = identityTaskHarness(root);
    const blocked = commands.runDatasetIdentityDecisionTaskBuild({
      curationGateReport: "gate.json",
      outDir: "blocked",
    }) as IdentityTaskReport;
    assert.equal(blocked.status, "blocked_missing_full_context");
    assert.deepEqual(
      (blocked.blockers as JsonObject[]).map((entry) => entry.code),
      ["identity_decision_authoring_package_invalid"],
    );
    assert.equal(blocked.counts.template_decisions, 0);

    writeText(path.join(root, "malformed-gate.json"), "{ malformed\n");
    assert.throws(
      () =>
        commands.runDatasetIdentityDecisionTaskBuild({
          curationGateReport: "malformed-gate.json",
          outDir: "native-error",
        }),
      SyntaxError,
    );
  });
});

test("handoff and identity task factories exist only as zero-escape native TypeScript", () => {
  for (const moduleName of ["commit-handoff", "identity-decision-task"]) {
    const typedPath = path.join(repoRoot, `scripts/commands/${moduleName}.ts`);
    assert.equal(fs.existsSync(typedPath), true);
    assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
    const source = fs.readFileSync(typedPath, "utf8");
    assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
    assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
  }
});

test("handoff and identity task consumers target the typed command factories", () => {
  for (const moduleName of ["commit-handoff", "identity-decision-task"]) {
    for (const consumer of [
      "scripts/foundry.ts",
      "scripts/lib/foundry-command-metadata.ts",
      "test/unit/handoff-identity-task-command-factories.test.mts",
    ]) {
      const source = fs.readFileSync(path.join(repoRoot, consumer), "utf8");
      assert.match(source, new RegExp(`(?:commands/|scripts/commands/)${moduleName}\\.ts`, "u"));
      assert.doesNotMatch(
        source,
        new RegExp(`(?:commands/|scripts/commands/)${moduleName}\\.mjs`, "u"),
      );
    }
  }
});
