import test from "node:test";
import {
  annualSupplyFixtureRoot,
  qaPathFixtureRoot,
  sourceExchangeFixtureRoot,
} from "../fixtures/fixture-roots.ts";
import {
  assert,
  blockerCodes,
  fs,
  fullContextKinds,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  targetUserId,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";
import { writeContextPackFiles } from "../fixtures/full-context-fixtures.mjs";
import { writeCompletedIdentityPreflightIndex } from "../fixtures/identity-fixtures.mjs";
import {
  processRowWithInvalidAnnualSupply,
  processRowWithInvalidLocation,
  processRowWithOnlyOutputExchange,
} from "../fixtures/row-builders.mjs";

test("curation gate maps process QA functional unit findings to concrete TIDAS paths", () => {
  fs.rmSync(qaPathFixtureRoot, { recursive: true, force: true });
  const processId = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
  const rowsFile = path.join(qaPathFixtureRoot, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithInvalidLocation(processId)]);
  const schemaReport = path.join(qaPathFixtureRoot, "schema", "validation-report.json");
  writeJson(schemaReport, {
    input_path: rel(rowsFile),
    status: "completed",
    rows: [
      {
        index: 0,
        id: processId,
        version: "00.00.001",
        type: "process",
        status: "valid",
        issues: [],
      },
    ],
  });
  const qaReport = path.join(qaPathFixtureRoot, "qa", "process-qa-report.json");
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "needs_review",
    blockers: [],
    findings: [
      {
        dataset_id: processId,
        dataset_version: "00.00.001",
        code: "process_missing_functional_unit",
        message:
          "Process quantitative reference functionalUnitOrOther is missing and should be curated by Foundry.",
      },
    ],
  });
  const context = writeContextPackFiles(qaPathFixtureRoot);

  try {
    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(qaPathFixtureRoot, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.counts.action_items, 1);

    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      gate.json.files.report,
      "--out-dir",
      rel(path.join(qaPathFixtureRoot, "authoring-tasks")),
    ]);
    assert.equal(task.code, 0);
    assert.equal(
      task.json.tasks[0].action_items[0].path,
      "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther",
    );
    assert.equal(
      task.json.tasks[0].action_items[0].json_pointer,
      "/processDataSet/processInformation/quantitativeReference/functionalUnitOrOther",
    );
    assert.notEqual(task.json.tasks[0].action_items[0].json_pointer, "/__AI_FILL_JSON_POINTER__");
    assert.deepEqual(task.json.tasks[0].action_items[0].allowed_resolution_modes, [
      "evidence_backed_completion",
    ]);

    const actionItem = task.json.tasks[0].action_items[0];
    const outputPatchFile = path.join(repoRoot, task.json.tasks[0].files.output_patch_file);
    const authoringPackageFile = path.join(repoRoot, task.json.tasks[0].files.authoring_package);
    writeJson(outputPatchFile, {
      schema_version: 1,
      kind: "tiangong_foundry_dataset_patch",
      patch_status: "completed",
      patch_sets: [
        {
          dataset_id: processId,
          version: "00.00.001",
          authoring_package: path.basename(authoringPackageFile),
          operations: [
            {
              op: "add",
              path: "/processDataSet/processInformation/dataSetInformation/common:other",
              value: {
                "tiangongfoundry:unresolvedTrace": [
                  {
                    status: "unresolved_deferred",
                    action_item_code: actionItem.code,
                    blocked_path: actionItem.path,
                    reason: "This test attempts to defer a required functional unit.",
                    evidence: {
                      source: "test",
                      quote_or_trace:
                        "functionalUnitOrOther is a formal business field and cannot be replaced by common:other trace.",
                    },
                    next_action:
                      "Provide an evidence-backed functionalUnitOrOther value instead of deferring it.",
                  },
                ],
              },
              basis: "Attempting to defer functionalUnitOrOther should be blocked.",
              evidence: {
                source: "test",
                quote_or_trace: "Functional unit is missing in the QA report.",
              },
              resolution: {
                mode: "deferred_to_common_other",
                used_context_kinds: fullContextKinds,
                summary: "This mode is intentionally invalid for functional unit.",
              },
              closes_action_items: [
                {
                  code: actionItem.code,
                  path: actionItem.path,
                },
              ],
            },
          ],
        },
      ],
    });
    const deferredFunctionalUnit = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(qaPathFixtureRoot, "authoring-patches-deferred-fu")),
    ]);
    assert.equal(deferredFunctionalUnit.code, 1);
    assert.equal(deferredFunctionalUnit.json.status, "blocked");
    assert.ok(
      blockerCodes(deferredFunctionalUnit.json).has(
        "patch_resolution_mode_not_allowed_for_action_item",
      ),
    );
  } finally {
    fs.rmSync(qaPathFixtureRoot, { recursive: true, force: true });
  }
});

test("annual supply schema issues route to deterministic missing-data sentinel cleanup", () => {
  fs.rmSync(annualSupplyFixtureRoot, { recursive: true, force: true });
  const processId = "eeeeeeee-ffff-4000-8111-222222222222";
  const rowsFile = path.join(annualSupplyFixtureRoot, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithInvalidAnnualSupply(processId)]);
  const schemaReport = path.join(annualSupplyFixtureRoot, "schema", "validation-report.json");
  const annualSupplyPath =
    "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume";
  const annualSupplyTextPath = `${annualSupplyPath}.#text`;
  writeJson(schemaReport, {
    input_path: rel(rowsFile),
    status: "invalid",
    rows: [
      {
        index: 0,
        id: processId,
        version: "00.00.001",
        type: "process",
        status: "invalid",
        issues: [
          {
            code: "invalid_format",
            path: annualSupplyTextPath,
            message:
              "annualSupplyOrProductionVolume.#text does not match the SDK numeric quantity pattern.",
          },
          {
            code: "annual_supply_or_production_volume_invalid",
            path: annualSupplyPath,
            message: "annualSupplyOrProductionVolume is not an annualized quantity.",
          },
        ],
      },
    ],
  });
  const qaReport = path.join(annualSupplyFixtureRoot, "qa", "process-qa-report.json");
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "completed",
    blockers: [],
    findings: [],
  });
  const context = writeContextPackFiles(annualSupplyFixtureRoot);

  try {
    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(annualSupplyFixtureRoot, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.status, "blocked_needs_foundry_deterministic_cleanup");
    assert.equal(gate.json.counts.action_items, 0);
    assert.equal(gate.json.counts.deterministic_cleanup_items, 3);
    assert.equal(gate.json.processes[0].status, "needs_foundry_deterministic_cleanup");
    const authoringPackage = readJson(
      path.join(repoRoot, gate.json.processes[0].authoring_package),
    );
    const annualCleanupItems = authoringPackage.deterministic_cleanup_items.filter(
      (item) => item.action_kind === "annual_supply_sentinel_completion",
    );
    assert.equal(annualCleanupItems.length, 2);
    assert.deepEqual(
      annualCleanupItems.map((item) => item.sentinel_value),
      ["9999 missing-data-sentinel/year", "9999 missing-data-sentinel/year"],
    );

    const cleanup = runFoundry([
      "dataset-curation-cleanup",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--out-dir",
      rel(path.join(annualSupplyFixtureRoot, "cleanup")),
    ]);
    assert.equal(cleanup.code, 0);
    assert.equal(cleanup.json.status, "completed");
    assert.equal(cleanup.json.counts.annual_supply_missing_data_sentinels, 1);
    const cleaned = readJsonLines(path.join(repoRoot, cleanup.json.files.cleaned_rows))[0];
    assert.deepEqual(
      cleaned.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness
        .annualSupplyOrProductionVolume,
      {
        "@xml:lang": "en",
        "#text": "9999 missing-data-sentinel/year",
      },
    );
    assert.equal(
      cleaned.processDataSet.processInformation.dataSetInformation["common:other"],
      undefined,
    );
  } finally {
    fs.rmSync(annualSupplyFixtureRoot, { recursive: true, force: true });
  }
});

test("curation cleanup fills placeholder annual supply with searchable sentinel", () => {
  const root = path.join(repoRoot, "tmp", "annual-supply-deterministic-cleanup-test");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "eeeeeeee-ffff-4000-8111-222222222223";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithInvalidAnnualSupply(processId)]);

  try {
    const cleanup = runFoundry([
      "dataset-curation-cleanup",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--out-dir",
      rel(path.join(root, "cleanup")),
    ]);
    assert.equal(cleanup.code, 0);
    assert.equal(cleanup.json.status, "completed");
    assert.equal(cleanup.json.counts.annual_supply_missing_data_sentinels, 1);

    const cleaned = readJsonLines(path.join(repoRoot, cleanup.json.files.cleaned_rows))[0];
    assert.deepEqual(
      cleaned.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness
        .annualSupplyOrProductionVolume,
      {
        "@xml:lang": "en",
        "#text": "9999 missing-data-sentinel/year",
      },
    );
    assert.equal(
      cleaned.processDataSet.processInformation.dataSetInformation["common:other"],
      undefined,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("curation cleanup treats unavailable annual production volume as sentinel", () => {
  const root = path.join(repoRoot, "tmp", "annual-supply-unavailable-cleanup-test");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "eeeeeeee-ffff-4000-8111-222222222224";
  const row = processRowWithInvalidAnnualSupply(processId);
  row.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume =
    {
      "@xml:lang": "en",
      "#text": "0 m/year; source production volume unavailable",
    };
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [row]);

  try {
    const cleanup = runFoundry([
      "dataset-curation-cleanup",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--out-dir",
      rel(path.join(root, "cleanup")),
    ]);
    assert.equal(cleanup.code, 0);
    assert.equal(cleanup.json.status, "completed");
    assert.equal(cleanup.json.counts.annual_supply_missing_data_sentinels, 1);

    const cleaned = readJsonLines(path.join(repoRoot, cleanup.json.files.cleaned_rows))[0];
    assert.deepEqual(
      cleaned.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness
        .annualSupplyOrProductionVolume,
      {
        "@xml:lang": "en",
        "#text": "9999 missing-data-sentinel/year",
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("output-only process exchanges require source exchange completeness trace", () => {
  fs.rmSync(sourceExchangeFixtureRoot, { recursive: true, force: true });
  const processId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
  const rowsFile = path.join(sourceExchangeFixtureRoot, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithOnlyOutputExchange(processId)]);
  const schemaReport = path.join(sourceExchangeFixtureRoot, "schema", "validation-report.json");
  writeJson(schemaReport, {
    input_path: rel(rowsFile),
    status: "completed",
    rows: [
      {
        index: 0,
        id: processId,
        version: "00.00.001",
        type: "process",
        status: "valid",
        issues: [],
      },
    ],
  });
  const qaReport = path.join(sourceExchangeFixtureRoot, "qa", "process-qa-report.json");
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "completed",
    blockers: [],
    findings: [],
  });
  const context = writeContextPackFiles(sourceExchangeFixtureRoot);

  try {
    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.status, "blocked_needs_foundry_ai_authoring");
    assert.equal(gate.json.counts.action_items, 1);
    const blockedAuthoringPackage = readJson(
      path.join(repoRoot, gate.json.entities[0].authoring_package),
    );
    assert.equal(
      blockedAuthoringPackage.action_items[0].code,
      "semantic_process_only_output_exchange_requires_review",
    );

    const autoCleanup = runFoundry([
      "dataset-curation-cleanup",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--source-rows-file",
      rel(rowsFile),
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "cleanup-auto-proof")),
    ]);
    assert.equal(autoCleanup.code, 0);
    assert.equal(autoCleanup.json.status, "completed");
    assert.equal(autoCleanup.json.counts.source_exchange_completeness_proofs, 1);
    const autoCleanedRowsFile = path.join(repoRoot, autoCleanup.json.files.cleaned_rows);
    const autoCleanedRow = readJsonLines(autoCleanedRowsFile)[0];
    assert.equal(
      autoCleanedRow.processDataSet.processInformation.dataSetInformation["common:other"][
        "tiangongfoundry:sourceExchangeCompleteness"
      ][0].evidence.source,
      "foundry_deterministic_cleanup",
    );
    const autoSchemaReport = path.join(
      sourceExchangeFixtureRoot,
      "schema",
      "auto-cleaned-validation-report.json",
    );
    writeJson(autoSchemaReport, {
      input_path: rel(autoCleanedRowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: processId,
          version: "00.00.001",
          type: "process",
          status: "valid",
          issues: [],
        },
      ],
    });
    const autoQaReport = path.join(
      sourceExchangeFixtureRoot,
      "qa",
      "auto-cleaned-process-qa-report.json",
    );
    writeJson(autoQaReport, {
      rows_file: rel(autoCleanedRowsFile),
      status: "completed",
      blockers: [],
      findings: [],
    });
    const autoIdentityPreflightIndex = writeCompletedIdentityPreflightIndex(
      sourceExchangeFixtureRoot,
      [
        {
          datasetType: "process",
          id: processId,
          target: autoCleanedRow,
          name: "Heat production",
          query: "process name: Heat production\nexchange signature: Output heat 1",
        },
      ],
    );
    const autoGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(autoCleanedRowsFile),
      "--schema-report",
      rel(autoSchemaReport),
      "--qa-report",
      rel(autoQaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--identity-preflight-index",
      rel(autoIdentityPreflightIndex),
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "curation-gate-auto-proof")),
    ]);
    assert.equal(autoGate.code, 0);
    assert.equal(autoGate.json.status, "ready");
    assert.equal(autoGate.json.counts.action_items, 0);

    const autoProgressJsonl = path.join(
      sourceExchangeFixtureRoot,
      "dry-run-auto",
      "outputs",
      "save-draft-rpc",
      "progress.jsonl",
    );
    const autoFailuresJsonl = path.join(
      sourceExchangeFixtureRoot,
      "dry-run-auto",
      "outputs",
      "save-draft-rpc",
      "failures.jsonl",
    );
    writeJsonLines(autoProgressJsonl, [
      {
        id: processId,
        version: "00.00.001",
        status: "prepared",
        operation: "would_insert",
      },
    ]);
    writeJsonLines(autoFailuresJsonl, []);
    const autoDryRunReport = path.join(
      sourceExchangeFixtureRoot,
      "dry-run-auto",
      "outputs",
      "save-draft-rpc",
      "summary.json",
    );
    writeJson(autoDryRunReport, {
      status: "completed",
      mode: "dry-run",
      commit: false,
      input_path: rel(autoCleanedRowsFile),
      files: {
        progress_jsonl: rel(autoProgressJsonl),
        failures_jsonl: rel(autoFailuresJsonl),
      },
    });
    const autoManifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(autoCleanedRowsFile),
      "--schema-report",
      rel(autoSchemaReport),
      "--curation-gate-report",
      autoGate.json.files.report,
      "--cleanup-report",
      autoCleanup.json.files.report,
      "--dry-run-report",
      rel(autoDryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "mutation-manifest-auto-proof")),
    ]);
    assert.equal(autoManifest.code, 0, JSON.stringify(autoManifest.json, null, 2));
    assert.equal(autoManifest.json.status, "ready_for_remote_write");
    assert.equal(autoManifest.json.counts.source_exchange_completeness_entries, 1);

    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      gate.json.files.report,
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "authoring-tasks")),
    ]);
    assert.equal(task.code, 0);
    assert.deepEqual(task.json.tasks[0].action_items[0].allowed_resolution_modes, [
      "source_trace_verified",
      "exchange_set_repaired",
    ]);
    const actionItem = task.json.tasks[0].action_items[0];
    const outputPatchFile = path.join(repoRoot, task.json.tasks[0].files.output_patch_file);
    const authoringPackageFile = path.join(repoRoot, task.json.tasks[0].files.authoring_package);
    const closes = [{ code: actionItem.code, path: actionItem.path }];
    const sourceCompletenessTrace = {
      status: "source_only_output_exchange_verified",
      action_item_code: actionItem.code,
      source: "source_trace",
      summary: "The source exchange list contains a product output and no input exchanges.",
      evidence: {
        source: "authoring_package.source_row",
        quote_or_trace:
          "processDataSet.exchanges.exchange[0].exchangeDirection = Output; no Input exchanges in source row.",
      },
    };
    const patchPayload = (commonOtherValue) => ({
      schema_version: 1,
      kind: "tiangong_foundry_dataset_patch",
      patch_status: "completed",
      patch_sets: [
        {
          dataset_id: processId,
          version: "00.00.001",
          authoring_package: path.basename(authoringPackageFile),
          operations: [
            {
              op: "add",
              path: "/processDataSet/processInformation/dataSetInformation/common:other",
              value: commonOtherValue,
              basis:
                "The output-only exchange set is accepted only because the source row itself has only output exchanges.",
              evidence: {
                source: "authoring_package.source_row",
                quote_or_trace:
                  "The full authoring package source row lists only Output exchangeDirection values.",
              },
              resolution: {
                mode: "source_trace_verified",
                used_context_kinds: fullContextKinds,
                summary:
                  "Accept source-faithful output-only exchange set and preserve the verification trace.",
              },
              closes_action_items: closes,
            },
          ],
        },
      ],
    });

    writeJson(
      outputPatchFile,
      patchPayload({
        note: "Output-only exchanges were reviewed.",
      }),
    );
    const missingTraceCollect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "authoring-patches-missing-source-trace")),
    ]);
    assert.equal(missingTraceCollect.code, 1);
    assert.equal(missingTraceCollect.json.status, "blocked");
    assert.equal(
      blockerCodes(missingTraceCollect.json).has("patch_source_exchange_trace_missing"),
      true,
    );

    writeJson(
      outputPatchFile,
      patchPayload({
        "@xmlns:tiangongfoundry": "https://tiangong-lca.dev/foundry/import-curation/1",
        "tiangongfoundry:sourceExchangeCompleteness": [sourceCompletenessTrace],
      }),
    );
    const collect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "authoring-patches")),
    ]);
    assert.equal(collect.code, 0);
    assert.equal(collect.json.status, "ready_for_patch_apply");

    const patchedRowsFile = path.join(sourceExchangeFixtureRoot, "rows", "processes.patched.jsonl");
    const apply = runFoundry([
      "dataset-patch-apply",
      "--input",
      rel(rowsFile),
      "--patch",
      collect.json.files.batch_patch,
      "--out",
      rel(patchedRowsFile),
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "patch-apply")),
      "--authoring-package-dir",
      rel(path.dirname(authoringPackageFile)),
      "--require-authoring-package",
      "--require-action-item-closure",
    ]);
    assert.equal(apply.code, 0);
    assert.equal(apply.json.status, "completed");
    assert.equal(apply.json.evidence_count, 1);
    const patchedRow = readJsonLines(patchedRowsFile)[0];
    assert.equal(
      patchedRow.processDataSet.processInformation.dataSetInformation["common:other"][
        "tiangongfoundry:sourceExchangeCompleteness"
      ][0].status,
      "source_only_output_exchange_verified",
    );

    const cleanup = runFoundry([
      "dataset-curation-cleanup",
      "--type",
      "process",
      "--rows-file",
      rel(patchedRowsFile),
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "cleanup")),
    ]);
    assert.equal(cleanup.code, 0);
    assert.equal(cleanup.json.status, "completed");
    const cleanedRowsFile = path.join(repoRoot, cleanup.json.files.cleaned_rows);

    const cleanedSchemaReport = path.join(
      sourceExchangeFixtureRoot,
      "schema",
      "cleaned-validation-report.json",
    );
    writeJson(cleanedSchemaReport, {
      input_path: rel(cleanedRowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: processId,
          version: "00.00.001",
          type: "process",
          status: "valid",
          issues: [],
        },
      ],
    });
    const cleanedQaReport = path.join(
      sourceExchangeFixtureRoot,
      "qa",
      "cleaned-process-qa-report.json",
    );
    writeJson(cleanedQaReport, {
      rows_file: rel(cleanedRowsFile),
      status: "completed",
      blockers: [],
      findings: [],
    });
    const identityPreflightIndex = writeCompletedIdentityPreflightIndex(sourceExchangeFixtureRoot, [
      {
        datasetType: "process",
        id: processId,
        target: readJsonLines(cleanedRowsFile)[0],
        name: "Heat production",
        query: "process name: Heat production\nexchange signature: Output heat 1",
      },
    ]);
    const resolvedGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(cleanedRowsFile),
      "--schema-report",
      rel(cleanedSchemaReport),
      "--qa-report",
      rel(cleanedQaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "curation-gate-resolved")),
    ]);
    assert.equal(resolvedGate.code, 0);
    assert.equal(resolvedGate.json.status, "ready");
    assert.equal(resolvedGate.json.counts.action_items, 0);

    const progressJsonl = path.join(
      sourceExchangeFixtureRoot,
      "dry-run",
      "outputs",
      "save-draft-rpc",
      "progress.jsonl",
    );
    const failuresJsonl = path.join(
      sourceExchangeFixtureRoot,
      "dry-run",
      "outputs",
      "save-draft-rpc",
      "failures.jsonl",
    );
    writeJsonLines(progressJsonl, [
      {
        id: processId,
        version: "00.00.001",
        status: "prepared",
        operation: "would_insert",
      },
    ]);
    writeJsonLines(failuresJsonl, []);
    const dryRunReport = path.join(
      sourceExchangeFixtureRoot,
      "dry-run",
      "outputs",
      "save-draft-rpc",
      "summary.json",
    );
    writeJson(dryRunReport, {
      status: "completed",
      mode: "dry-run",
      commit: false,
      input_path: rel(cleanedRowsFile),
      files: {
        progress_jsonl: rel(progressJsonl),
        failures_jsonl: rel(failuresJsonl),
      },
    });

    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(cleanedRowsFile),
      "--schema-report",
      rel(cleanedSchemaReport),
      "--curation-gate-report",
      resolvedGate.json.files.report,
      "--cleanup-report",
      cleanup.json.files.report,
      "--dry-run-report",
      rel(dryRunReport),
      "--patch-collect-report",
      collect.json.files.report,
      "--require-patch-collect-report",
      "--patch-apply-report",
      apply.json.files.report,
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "mutation-manifest")),
    ]);
    assert.equal(manifest.code, 0);
    assert.equal(manifest.json.status, "ready_for_remote_write");
    assert.equal(manifest.json.counts.source_exchange_completeness_entries, 1);
    const traceRows = readJsonLines(
      path.join(repoRoot, manifest.json.files.source_exchange_completeness_traces),
    );
    assert.equal(traceRows.length, 1);
    assert.equal(traceRows[0].entity_id, processId);
    assert.equal(traceRows[0].trace_kind, "source_exchange_completeness");
    assert.equal(traceRows[0].status, "source_only_output_exchange_verified");
    assert.equal(
      traceRows[0].evidence.quote_or_trace,
      sourceCompletenessTrace.evidence.quote_or_trace,
    );
  } finally {
    fs.rmSync(sourceExchangeFixtureRoot, { recursive: true, force: true });
  }
});
