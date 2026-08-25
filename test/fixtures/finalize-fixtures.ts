import { path, rel, targetUserId, writeJson } from "./foundry-core.ts";

export type ReadyFinalizeFixtureOptions = {
  root: string;
  datasetType: string;
  rowsFile: string;
  profile?: string;
  finalizeReportPath?: string | null;
};

export type ReadyFinalizeFixtureResult = {
  mutationReport: string;
  finalizeReport: string;
};

export function writeReadyFinalizeFixture({
  root,
  datasetType,
  rowsFile,
  profile = "generic",
  finalizeReportPath = null,
}: ReadyFinalizeFixtureOptions): ReadyFinalizeFixtureResult {
  const mutationReport = path.join(root, `${datasetType}-mutation-manifest.json`);
  writeJson(mutationReport, {
    status: "ready_for_remote_write",
    dataset_type: datasetType,
    profile,
    rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    counts: {
      blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
    files: {
      unresolved_traces: null,
      source_exchange_completeness_traces: null,
      source_reference_rewrites: null,
    },
  });
  const finalizeReport =
    finalizeReportPath ||
    path.join(root, `${datasetType}-dataset-post-authoring-finalize-report.json`);
  writeJson(finalizeReport, {
    status: "ready_for_remote_write",
    dataset_type: datasetType,
    profile,
    rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    files: {
      final_rows: rel(rowsFile),
      mutation_manifest: rel(mutationReport),
    },
    counts: {
      blockers: 0,
      location_audit_blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
  });
  return { mutationReport, finalizeReport };
}
