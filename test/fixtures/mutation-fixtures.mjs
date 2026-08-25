import { mutationFixtureRoot } from "./fixture-roots.ts";
import {
  fs,
  fullContextKinds,
  fullContextPatterns,
  path,
  rel,
  repoRoot,
  sha256Text,
  writeJson,
  writeJsonLines,
  writeText,
} from "./foundry-core.ts";
import { contextFile } from "./full-context-fixtures.mjs";
import { processRowWithDeferredTrace } from "./row-builders.mjs";

export function createMutationManifestFixture() {
  fs.rmSync(mutationFixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(mutationFixtureRoot, { recursive: true });

  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const row = processRowWithDeferredTrace(processId);
  const patchOutputRows = path.join(mutationFixtureRoot, "patch-apply", "processes.patched.jsonl");
  const rowsFile = path.join(mutationFixtureRoot, "final", "processes.cleaned.jsonl");
  writeJsonLines(patchOutputRows, [row]);
  writeJsonLines(rowsFile, [row]);
  const sourceReferenceRewritesFile = path.join(
    mutationFixtureRoot,
    "source-reference-rewrites.jsonl",
  );
  writeJsonLines(sourceReferenceRewritesFile, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      source_file:
        "tmp/bafu/process-bundles/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/tidas/processes/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json",
      path: "processDataSet.administrativeInformation.dataEntryBy.common:referenceToDataSetFormat",
      relation: "dataset_format_source",
      original: {
        ref_object_id: "converted-format-source",
        version: "00.00.001",
        short_description: "ILCD format",
      },
      canonical: {
        ref_object_id: "a97a0155-0234-4b87-b4ce-a45da52f2a40",
        version: "03.00.003",
        short_description: "ILCD format",
      },
      reason:
        "Data set format uses the public canonical ILCD format source instead of a converted package-local support source.",
    },
    {
      dataset_type: "process",
      dataset_id: "not-this-process",
      dataset_version: "00.00.001",
      path: "processDataSet.administrativeInformation.dataEntryBy.common:referenceToDataSetFormat",
      relation: "dataset_format_source",
      original: { ref_object_id: "unrelated" },
      canonical: {
        ref_object_id: "a97a0155-0234-4b87-b4ce-a45da52f2a40",
      },
    },
  ]);

  const schemaReport = path.join(mutationFixtureRoot, "schema", "validation-report.json");
  writeJson(schemaReport, {
    generated_at_utc: "2026-06-02T00:00:00.000Z",
    input_path: rel(rowsFile),
    requested_type: "process",
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

  const qaReport = path.join(mutationFixtureRoot, "qa", "process-qa-report.json");
  writeJson(qaReport, {
    generated_at_utc: "2026-06-02T00:00:00.000Z",
    rows_file: rel(rowsFile),
    status: "completed",
    blockers: [],
    findings: [],
  });

  const progressJsonl = path.join(
    mutationFixtureRoot,
    "dry-run",
    "outputs",
    "save-draft-rpc",
    "progress.jsonl",
  );
  const failuresJsonl = path.join(
    mutationFixtureRoot,
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
    mutationFixtureRoot,
    "dry-run",
    "outputs",
    "save-draft-rpc",
    "summary.json",
  );
  writeJson(dryRunReport, {
    status: "completed",
    mode: "dry-run",
    commit: false,
    input_path: rel(rowsFile),
    files: {
      progress_jsonl: rel(progressJsonl),
      failures_jsonl: rel(failuresJsonl),
    },
  });

  const cleanupReport = path.join(
    mutationFixtureRoot,
    "cleanup",
    "dataset-curation-cleanup-report.json",
  );
  writeJson(cleanupReport, {
    schema_version: 2,
    status: "completed",
    dataset_type: "process",
    rows_file: rel(patchOutputRows),
    cleaned_rows_file: rel(rowsFile),
    files: {
      cleaned_rows: rel(rowsFile),
    },
  });

  const contractContextFiles = [
    contextFile("schema.json", '{"title":"process schema"}'),
    contextFile("methodology.yaml", "process:\n  required: true\n"),
    contextFile("runtime-ruleset.json", '{"rules":["source-language-only"]}'),
    ...fullContextPatterns
      .filter(
        (fileName) => fileName.startsWith("tidas_") && fileName !== "tidas_locations_category.json",
      )
      .map((fileName) => ({
        kind: "classification_schema",
        path: rel(path.join(mutationFixtureRoot, "context", fileName)),
        text: `{"oneOf":[{"const":"${fileName}","description":"Fixture ${fileName}"}]}`,
      })),
    {
      kind: "location_schema",
      path: rel(path.join(mutationFixtureRoot, "context", "tidas_locations_category.json")),
      text: '{"oneOf":[{"const":"CH","description":"Switzerland"}]}',
    },
  ];
  for (const file of contractContextFiles) {
    writeText(path.join(repoRoot, file.path), file.text);
  }
  const contractContextDetails = contractContextFiles.map((file) => ({
    kind: file.kind,
    path: file.path,
    sha256: sha256Text(file.text),
    bytes: Buffer.byteLength(file.text, "utf8"),
  }));

  const actionItem = {
    code: "source_system_boilerplate",
    path: "processDataSet.processInformation.dataSetInformation.generalComment",
    ai_required: true,
  };
  const authoringPackage = path.join(
    mutationFixtureRoot,
    "curation",
    "ai-authoring-packages",
    `process-${processId}.authoring-package.json`,
  );
  const authoringPackagePayload = {
    schema_version: 2,
    profile: "bafu",
    dataset_type: "process",
    entity_id: processId,
    version: "00.00.001",
    contract_context_files: contractContextFiles,
    full_context_ai_completion: {
      required: true,
      required_context_kinds: fullContextKinds,
      required_context_file_patterns: fullContextPatterns,
    },
    missing_context_files: [],
    action_items: [actionItem],
    source_row: row,
    entity_payload: row,
  };
  writeJson(authoringPackage, authoringPackagePayload);
  const authoringPackageSha256 = sha256Text(fs.readFileSync(authoringPackage, "utf8"));

  const curationGateReport = path.join(
    mutationFixtureRoot,
    "curation",
    "dataset-curation-gate-report.json",
  );
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "ready",
    profile: "bafu",
    dataset_type: "process",
    rows_file: rel(rowsFile),
    schema_report: rel(schemaReport),
    qa_report: rel(qaReport),
    context: {
      contract_context_files: contractContextFiles.map((file) => file.path),
      contract_context_file_details: contractContextDetails,
    },
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        version: "00.00.001",
        status: "ready",
        action_item_count: 0,
        authoring_package: rel(authoringPackage),
        authoring_package_sha256: authoringPackageSha256,
      },
    ],
  });

  const batchPatch = path.join(mutationFixtureRoot, "authoring-tasks", "ai-patches.batch.json");
  writeJson(batchPatch, {
    schema_version: 1,
    kind: "tiangong_foundry_dataset_patch_batch",
    patch_sets: [],
  });
  const taskManifest = path.join(
    mutationFixtureRoot,
    "authoring-tasks",
    "authoring-task-manifest.json",
  );
  writeJson(taskManifest, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "process",
          entity_id: processId,
          version: "00.00.001",
        },
        context: {
          authoring_package_sha256: authoringPackageSha256,
          full_context_ai_completion: { required: true },
        },
        action_item_count: 1,
        action_items: [actionItem],
        files: {
          authoring_package: rel(authoringPackage),
        },
      },
    ],
  });
  const patchCollectReport = path.join(
    mutationFixtureRoot,
    "authoring-tasks",
    "authoring-patch-collect-report.json",
  );
  writeJson(patchCollectReport, {
    schema_version: 1,
    status: "ready_for_patch_apply",
    task_manifest: rel(taskManifest),
    files: {
      batch_patch: rel(batchPatch),
    },
  });

  const patchEvidenceFile = path.join(
    mutationFixtureRoot,
    "patch-apply",
    "outputs",
    "patch-evidence.jsonl",
  );
  writeJsonLines(patchEvidenceFile, [
    {
      row_index: 0,
      dataset_id: processId,
      dataset_version: "00.00.001",
      op: "add",
      path: "/processDataSet/processInformation/dataSetInformation/common:other/tiangongfoundry:unresolvedTrace/0",
      basis:
        "The source row lacks a safe value for the optional descriptive field; the unresolved trace preserves the source context for later curation.",
      evidence: {
        source: "ai-authoring-package",
        quote_or_trace:
          "source_row.processDataSet.processInformation.dataSetInformation.generalComment absent",
      },
      resolution: {
        mode: "deferred_to_common_other",
        used_context_kinds: fullContextKinds,
      },
      authoring_package: path.basename(authoringPackage),
      authoring_package_sha256: authoringPackageSha256,
      closes_action_items: [actionItem],
    },
  ]);
  const patchApplyReport = path.join(
    mutationFixtureRoot,
    "patch-apply",
    "outputs",
    "dataset-patch-apply-report.json",
  );
  writeJson(patchApplyReport, {
    schema_version: 1,
    status: "completed",
    input_path: rel(path.join(mutationFixtureRoot, "rows", "processes.jsonl")),
    patch_path: rel(batchPatch),
    out_path: rel(patchOutputRows),
    evidence_count: 1,
    files: {
      patched_rows: rel(patchOutputRows),
      patch_evidence: rel(patchEvidenceFile),
      report: rel(patchApplyReport),
    },
  });

  return {
    rowsFile,
    schemaReport,
    qaReport,
    dryRunReport,
    cleanupReport,
    curationGateReport,
    patchCollectReport,
    patchApplyReport,
    sourceReferenceRewritesFile,
    contractContextFiles,
    processId,
  };
}
