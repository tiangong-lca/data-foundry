import {
  type DecisionTaskProof,
  decisionTaskProofsFromApplyReport,
  normalizeClassificationDecisionRows,
  payloadSha256ByIdentityForRows,
} from "./full-context-proof.ts";
import { asText, ensureArray, fileExists, readJsonOrJsonl, resolveRepoPath } from "./runtime-io.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface DecisionRow extends JsonRecord {
  category_type?: unknown;
  categoryType?: unknown;
}

interface ApplyReportFiles extends JsonRecord {
  input_rows?: unknown;
  output_rows?: unknown;
}

interface ApplyReportCounts extends JsonRecord {
  applied?: unknown;
}

interface ClassificationDecisionApplyReport extends JsonRecord {
  status?: unknown;
  decisions_file?: unknown;
  decisionsFile?: unknown;
  files?: unknown;
  counts?: unknown;
}

interface ClassificationDecisionApplyArtifact {
  path?: unknown;
  value?: unknown;
}

export interface ClassificationDecisionApplyContext {
  status: string;
  reportPath: unknown;
  decisionsFile: string | null;
  decisions: unknown[];
  decisionTaskProof: DecisionTaskProof | null;
  decisionTaskProofs: DecisionTaskProof[];
  inputRows: string[];
  outputRows: string[];
  inputPayloadSha256ByIdentity: Map<string, string>;
  outputPayloadSha256ByIdentity: Map<string, string>;
  applied: number;
}

export function readClassificationDecisionApplyContext(
  repoRoot: string,
  classificationDecisionApplyArtifact: ClassificationDecisionApplyArtifact | null | undefined,
  sourceLabel: string = "classification_decision_apply",
): ClassificationDecisionApplyContext | null {
  if (!classificationDecisionApplyArtifact) return null;
  const report = (classificationDecisionApplyArtifact.value ??
    {}) as ClassificationDecisionApplyReport;
  const decisionsFile = resolveRepoPath(
    repoRoot,
    (report.decisions_file || report.decisionsFile) as string | null | undefined,
  );
  let decisions: unknown[] = [];
  if (decisionsFile && fileExists(decisionsFile)) {
    decisions = normalizeClassificationDecisionRows(readJsonOrJsonl(decisionsFile));
  }
  const decisionTaskProofs = decisionTaskProofsFromApplyReport(repoRoot, report, sourceLabel);
  const files = report.files as ApplyReportFiles | null | undefined;
  const counts = report.counts as ApplyReportCounts | null | undefined;
  const inputRows = ensureArray(files?.input_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath as string | null | undefined))
    .filter(Boolean) as string[];
  const outputRows = ensureArray(files?.output_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath as string | null | undefined))
    .filter(Boolean) as string[];
  const fallbackDatasetType = decisions.some((decision) => {
    const row = decision as DecisionRow | null | undefined;
    return asText(row?.category_type ?? row?.categoryType).startsWith("flow");
  })
    ? "flow"
    : decisions.some((decision) => {
          const row = decision as DecisionRow | null | undefined;
          return asText(row?.category_type ?? row?.categoryType) === "process";
        })
      ? "process"
      : null;
  return {
    status: asText(report.status),
    reportPath: classificationDecisionApplyArtifact.path,
    decisionsFile,
    decisions,
    decisionTaskProof: decisionTaskProofs.length === 1 ? decisionTaskProofs[0] : null,
    decisionTaskProofs,
    inputRows,
    outputRows,
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      inputRows,
      fallbackDatasetType,
    ),
    outputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      outputRows,
      fallbackDatasetType,
    ),
    applied: Number(counts?.applied ?? 0) || 0,
  };
}
