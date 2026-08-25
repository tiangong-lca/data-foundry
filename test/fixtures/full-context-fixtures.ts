import { fixtureRoot, mutationFixtureRoot } from "./fixture-roots.ts";
import { canonicalPayloadSha256 } from "../../scripts/lib/post-write-root-proof.ts";
import {
  fs,
  fullContextKinds,
  path,
  rel,
  sha256Text,
  targetUserId,
  writeJson,
  writeJsonLines,
  writeText,
} from "./foundry-core.ts";

export interface ContractContextFile {
  kind: string;
  path: string;
  text: string;
}

export interface DecisionTaskFixtureOptions {
  root: string;
  kind: string;
  queueFile: string;
  contractContextFiles: ContractContextFile[];
  dirName?: string;
  status?: string;
  taskKind?: string;
}

export function createFixture() {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });

  const rows = ["p1", "p2"].map((id) => ({
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
  }));
  const rowsFile = path.join(fixtureRoot, "processes.jsonl");
  writeJsonLines(rowsFile, rows);
  const finalRowsArtifact = {
    path: rel(rowsFile),
    bytes: fs.readFileSync(rowsFile).byteLength,
    sha256: sha256Text(fs.readFileSync(rowsFile)),
  };

  const checksFile = path.join(fixtureRoot, "remote-verification.jsonl");
  writeText(
    checksFile,
    [0, 1]
      .map((rowIndex) =>
        JSON.stringify({
          role: "root",
          table: "processes",
          id: `p${rowIndex + 1}`,
          version: "00.00.001",
          path: `processes/${rowIndex}#readback`,
          status: "ok",
          local_payload_sha256: canonicalPayloadSha256(rows[rowIndex]),
          remote_payload_sha256: canonicalPayloadSha256(rows[rowIndex]),
          remote_user_id: targetUserId,
          remote_state_code: 0,
          row_index: rowIndex,
        }),
      )
      .join("\n") + "\n",
  );

  const commitReport = path.join(fixtureRoot, "commit-report.json");
  writeJson(commitReport, {
    status: "completed",
    mode: "commit",
    commit: true,
    input_path: rel(rowsFile),
    counts: {
      selected: 2,
      executed: 2,
      failed: 0,
    },
  });

  const verifyReport = path.join(fixtureRoot, "remote-verification-report.json");
  writeJson(verifyReport, {
    status: "passed_remote_verification",
    input_path: rel(rowsFile),
    blockers: [],
    counts: {
      blockers: 0,
      root_readback_checks: 2,
      root_payload_mismatches: 0,
    },
    files: {
      checks: rel(checksFile),
    },
  });

  const finalizeReport = path.join(fixtureRoot, "finalize-ready.json");
  writeJson(finalizeReport, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "bafu",
    files: {
      final_rows: rel(rowsFile),
    },
    counts: {
      blockers: 0,
    },
  });

  const mutationMissingProof = path.join(fixtureRoot, "mutation-missing-proof.json");
  writeJson(mutationMissingProof, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "bafu",
    rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    counts: {
      blockers: 0,
      write_candidates: 2,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
    },
    files: {
      unresolved_traces: null,
      source_exchange_completeness_traces: null,
    },
  });

  const patchCollectReport = path.join(fixtureRoot, "patch-collect-ready.json");
  const authoringPackage = path.join(fixtureRoot, "authoring-package.json");
  writeJson(authoringPackage, {
    schema_version: 2,
    profile: "bafu",
    dataset_type: "process",
    entity_id: "process-a",
    version: "00.00.001",
    contract_context_files: fullContextKinds.map((kind) => ({
      kind,
      path: `${kind}.fixture`,
      text: `${kind} context`,
    })),
    missing_context_files: [],
  });
  const authoringPackageSha256 = sha256Text(fs.readFileSync(authoringPackage, "utf8"));
  const taskManifest = path.join(fixtureRoot, "authoring-task-manifest.json");
  writeJson(taskManifest, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        files: {
          authoring_package: rel(authoringPackage),
        },
        context: {
          authoring_package_sha256: authoringPackageSha256,
        },
      },
    ],
  });
  writeJson(patchCollectReport, {
    status: "ready_for_patch_apply",
    task_manifest: rel(taskManifest),
  });
  const patchEvidenceFile = path.join(fixtureRoot, "patch-evidence.jsonl");
  writeJsonLines(patchEvidenceFile, [
    {
      dataset_id: "process-a",
      dataset_version: "00.00.001",
      authoring_package_sha256: authoringPackageSha256,
      closes_action_items: ["fixture-action"],
      resolution: {
        mode: "evidence_backed_completion",
        used_context_kinds: fullContextKinds,
      },
      evidence: {
        source: "fixture-authoring-package",
        quote_or_trace: "fixture trace",
      },
    },
  ]);
  const patchApplyReport = path.join(fixtureRoot, "patch-apply-completed.json");
  writeJson(patchApplyReport, {
    status: "completed",
    files: {
      patch_evidence: rel(patchEvidenceFile),
    },
  });

  const mutationWithProof = path.join(fixtureRoot, "mutation-with-proof.json");
  writeJson(mutationWithProof, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "bafu",
    rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    evidence: {
      full_context_ai_completion_required: true,
      full_context_ai_completion_proof:
        "schema/methodology_yaml/ruleset/classification_schema/location_schema authoring package plus AI patch evidence",
      patch_collect_report: rel(patchCollectReport),
      patch_collect_status: "ready_for_patch_apply",
      patch_apply_report: rel(patchApplyReport),
      patch_apply_status: "completed",
      patch_evidence_file: rel(patchEvidenceFile),
    },
    counts: {
      blockers: 0,
      write_candidates: 2,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      ai_patch_evidence_entries: 1,
    },
    files: {
      unresolved_traces: null,
      source_exchange_completeness_traces: null,
    },
  });

  const handoffMissingProof = path.join(fixtureRoot, "handoff-missing-proof.json");
  writeJson(handoffMissingProof, {
    status: "ready_for_explicit_commit",
    dataset_type: "process",
    profile: "bafu",
    finalize_report: rel(finalizeReport),
    mutation_manifest: rel(mutationMissingProof),
    final_rows_file: rel(rowsFile),
    final_rows_artifact: finalRowsArtifact,
    target_user_id: targetUserId,
    expected_state_code: "0",
    counts: {
      blockers: 0,
      write_candidates: 2,
    },
    files: {
      trace_queues: {
        unresolved_traces: null,
        source_exchange_completeness_traces: null,
      },
    },
  });

  const handoffWithProof = path.join(fixtureRoot, "handoff-with-proof.json");
  writeJson(handoffWithProof, {
    status: "ready_for_explicit_commit",
    dataset_type: "process",
    profile: "bafu",
    finalize_report: rel(finalizeReport),
    mutation_manifest: rel(mutationWithProof),
    final_rows_file: rel(rowsFile),
    final_rows_artifact: finalRowsArtifact,
    target_user_id: targetUserId,
    expected_state_code: "0",
    counts: {
      blockers: 0,
      write_candidates: 2,
    },
    files: {
      trace_queues: {
        unresolved_traces: null,
        source_exchange_completeness_traces: null,
      },
    },
  });

  const oldCloseoutMissingProof = path.join(fixtureRoot, "old-closeout-missing-proof.json");
  writeJson(oldCloseoutMissingProof, {
    status: "completed",
    dataset_type: "process",
    profile: "bafu",
    finalize_report: rel(finalizeReport),
    mutation_manifest: rel(mutationMissingProof),
    commit_report: rel(commitReport),
    post_write_verify_report: rel(verifyReport),
    final_rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    expected_state_code: 0,
    counts: {
      blockers: 0,
      root_readback_checks: 2,
      root_payload_mismatches: 0,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
    },
    files: {
      trace_queues: {
        unresolved_traces: null,
        source_exchange_completeness_traces: null,
      },
    },
  });

  return {
    rowsFile,
    finalizeReport,
    mutationWithProof,
    patchApplyReport,
    patchEvidenceFile,
    commitReport,
    verifyReport,
    handoffMissingProof,
    handoffWithProof,
    oldCloseoutMissingProof,
  };
}

export function contextFile(pathName: string, text: string): ContractContextFile {
  return {
    kind:
      pathName === "schema.json"
        ? "schema"
        : pathName === "methodology.yaml"
          ? "methodology_yaml"
          : "ruleset",
    path: rel(path.join(mutationFixtureRoot, "context", pathName)),
    text,
  };
}

export function writeDecisionTaskFixture({
  root,
  kind,
  queueFile,
  contractContextFiles,
  dirName,
  status,
  taskKind,
}: DecisionTaskFixtureOptions) {
  const resolvedTaskKind =
    taskKind ??
    (kind === "location" ? "location_decision_authoring" : "classification_decision_authoring");
  const taskStatus =
    status ??
    (kind === "location"
      ? "ready_for_ai_location_decisions"
      : "ready_for_ai_classification_decisions");
  const taskDir = path.join(root, dirName ?? `${kind}-decision-task`);
  const taskFile = path.join(taskDir, `${kind}-decision-task.json`);
  const queueText = fs.existsSync(queueFile) ? fs.readFileSync(queueFile, "utf8") : "";
  const contractContextDetails = contractContextFiles.map((file) => ({
    kind: file.kind,
    path: file.path,
    sha256: sha256Text(file.text),
    bytes: Buffer.byteLength(file.text, "utf8"),
  }));
  const contextBundlePayload = {
    task_kind: resolvedTaskKind,
    task: rel(taskFile),
    queue: rel(queueFile),
    queue_sha256: sha256Text(queueText),
    queue_rows: queueText.trim() ? queueText.trim().split(/\r?\n/u).length : 0,
    contract_context_files: contractContextDetails,
    missing_context_files: [],
    provenance_context: {},
    attached_input_rows: [],
  };
  const contextBundle = {
    ...contextBundlePayload,
    sha256: sha256Text(JSON.stringify(contextBundlePayload)),
  };
  writeJson(taskFile, {
    schema_version: 1,
    status: taskStatus,
    task_kind: resolvedTaskKind,
    ...(kind === "location"
      ? { location_queue: rel(queueFile) }
      : { classification_queue: rel(queueFile) }),
    context_bundle: contextBundle,
    contract_context_files: contractContextFiles,
    missing_context_files: [],
  });
  return {
    taskFile,
    contextBundleSha256: contextBundle.sha256,
    taskSha256: sha256Text(fs.readFileSync(taskFile, "utf8")),
    authoringContext: {
      task: rel(taskFile),
      context_bundle_sha256: contextBundle.sha256,
      required_context_kinds: fullContextKinds,
      context_files: contractContextDetails.map((file) => ({
        kind: file.kind,
        path: file.path,
        sha256: file.sha256,
      })),
    },
  };
}

export function writeContextPackFiles(root: string) {
  const contextDir = path.join(root, "context");
  const schemaFile = path.join(contextDir, "schema.json");
  const yamlFile = path.join(contextDir, "methodology.yaml");
  const rulesetFile = path.join(contextDir, "runtime-ruleset.json");
  writeText(schemaFile, '{"title":"process schema"}\n');
  writeText(yamlFile, "process:\n  required_multilang_english: true\n");
  writeText(rulesetFile, '{"rules":["classification-decision"]}\n');
  return { schemaFile, yamlFile, rulesetFile };
}
