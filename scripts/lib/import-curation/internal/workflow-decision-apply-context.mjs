import {
  decisionTaskProofsFromApplyReport,
  normalizeClassificationDecisionRows,
  payloadSha256ByIdentityForRows,
} from "./full-context-proof.ts";
import { asText, ensureArray, fileExists, readJsonOrJsonl, resolveRepoPath } from "./runtime-io.ts";

export function readClassificationDecisionApplyContext(
  repoRoot,
  classificationDecisionApplyArtifact,
  sourceLabel = "classification_decision_apply",
) {
  if (!classificationDecisionApplyArtifact) return null;
  const report = classificationDecisionApplyArtifact.value ?? {};
  const decisionsFile = resolveRepoPath(repoRoot, report.decisions_file || report.decisionsFile);
  let decisions = [];
  if (decisionsFile && fileExists(decisionsFile)) {
    decisions = normalizeClassificationDecisionRows(readJsonOrJsonl(decisionsFile));
  }
  const decisionTaskProofs = decisionTaskProofsFromApplyReport(repoRoot, report, sourceLabel);
  const inputRows = ensureArray(report.files?.input_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath))
    .filter(Boolean);
  const outputRows = ensureArray(report.files?.output_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath))
    .filter(Boolean);
  const fallbackDatasetType = decisions.some((decision) =>
    asText(decision?.category_type ?? decision?.categoryType).startsWith("flow"),
  )
    ? "flow"
    : decisions.some(
          (decision) => asText(decision?.category_type ?? decision?.categoryType) === "process",
        )
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
    applied: Number(report.counts?.applied ?? 0) || 0,
  };
}
