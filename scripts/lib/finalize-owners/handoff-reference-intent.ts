import fs from "node:fs";
import path from "node:path";
import { createFileArtifactFact } from "../foundry-command-spec.ts";
import { sha256Json, sha256Text } from "../identity-preflight-proof.ts";
import { readRows } from "../import-curation/internal/runtime-io.ts";
import { datasetIdentity, detectDatasetType } from "../import-curation/internal/dataset-payload.ts";
import { bundleRowTypes, type BundleRowType } from "../bundle-row-types.ts";

type RecordValue = Record<string, unknown>;
type Fact = ReturnType<typeof createFileArtifactFact>;
function requireBinding(condition: unknown): asserts condition {
  if (!condition)
    throw new Error(
      "--reference-intent-file: current precommit, consumer, intent and review evidence must match.",
    );
}
function object(value: unknown): RecordValue {
  requireBinding(value && typeof value === "object" && !Array.isArray(value));
  return value as RecordValue;
}
export function assertReferenceIntentSelection(options: RecordValue): void {
  requireBinding(
    !Object.keys(options).some(
      (key) => key.startsWith("referenceIntent") && key !== "referenceIntentFile",
    ),
  );
  if (Object.hasOwn(options, "referenceIntentFile"))
    requireBinding(
      typeof options.referenceIntentFile === "string" && options.referenceIntentFile.trim(),
    );
}
export interface HandoffReferenceMetadata {
  artifact: Fact;
  precommit_artifact: Fact;
  review_artifacts: Fact[];
  actor_user_id: string;
  project_ref: string;
  consumers_sha256: string;
}
export function readHandoffReferenceEvidence(input: {
  finalize: RecordValue;
  options: RecordValue;
  rowsFile: string | null;
  datasetType: string;
  targetUserId: string;
  projectRef: string;
  resolveFile: (value: unknown) => string | null;
  relativePath: (file: string) => string;
}) {
  assertReferenceIntentSelection(input.options);
  const resolve = (value: unknown) => {
    const file = input.resolveFile(value);
    return file ? path.resolve(file) : null;
  };
  const files = input.finalize.files;
  const precommitFile =
    files && typeof files === "object"
      ? resolve((files as RecordValue).remote_verify_report)
      : null;
  if (!precommitFile) {
    requireBinding(
      !Object.hasOwn(input.options, "referenceIntentFile") &&
        !Object.hasOwn(input.finalize, "reference_intent_file"),
    );
    return null;
  }
  const precommit = object(JSON.parse(fs.readFileSync(precommitFile, "utf8")));
  if (!Object.hasOwn(precommit, "reference_intent")) {
    requireBinding(
      !Object.hasOwn(input.options, "referenceIntentFile") &&
        !Object.hasOwn(input.finalize, "reference_intent_file"),
    );
    return null;
  }
  const binding = object(precommit.reference_intent);
  requireBinding(
    input.rowsFile &&
      precommit.status === "passed_remote_verification" &&
      object(precommit.counts).blockers === 0 &&
      Array.isArray(precommit.blockers) &&
      precommit.blockers.length === 0 &&
      resolve(precommit.input_path) === resolve(input.rowsFile),
  );
  const capture = (raw: unknown, role: string): Fact => {
    const expected = object(raw),
      file = resolve(expected.path);
    requireBinding(file && fs.lstatSync(file).isFile());
    const fact = createFileArtifactFact({ role, path: input.relativePath(file), filePath: file });
    requireBinding(fact.sha256 === expected.sha256 && fact.bytes === expected.bytes);
    return fact;
  };
  const artifact = capture(binding.file, "reference_intent");
  if (Object.hasOwn(input.finalize, "reference_intent_file"))
    requireBinding(resolve(input.finalize.reference_intent_file) === resolve(artifact.path));
  if (Object.hasOwn(input.options, "referenceIntentFile"))
    requireBinding(resolve(input.options.referenceIntentFile) === resolve(artifact.path));
  requireBinding(
    binding.actor_user_id === input.targetUserId &&
      typeof binding.project_ref === "string" &&
      (!input.projectRef || binding.project_ref === input.projectRef),
  );
  const rowText = fs.readFileSync(input.rowsFile, "utf8"),
    rows = readRows(input.rowsFile, () => rowText);
  const consumers = rows.map((row, row_index) => {
    const type = detectDatasetType(row, input.datasetType) as BundleRowType;
    requireBinding(Object.hasOwn(bundleRowTypes, type));
    const identity = datasetIdentity(row, row_index, type);
    return {
      row_index,
      table: bundleRowTypes[type].plural,
      id: identity.id.toLowerCase(),
      version: identity.version,
      payload_sha256: sha256Json(identity.payload),
    };
  });
  requireBinding(
    rows.length > 0 &&
      object(precommit.counts).rows === rows.length &&
      sha256Json(binding.consumers) === sha256Json(consumers),
  );
  requireBinding(
    Array.isArray(binding.review_files) &&
      binding.review_files.length > 0 &&
      Array.isArray(binding.references) &&
      binding.references.length > 0,
  );
  const reviewArtifacts = binding.review_files.map((fact) => capture(fact, "reference_review"));
  requireBinding(
    new Set(reviewArtifacts.map((fact) => resolve(fact.path))).size === reviewArtifacts.length,
  );
  const usedReviews = new Set<string>();
  for (const raw of binding.references) {
    const review = object(object(raw).review),
      fact = object(review.file);
    const matching = reviewArtifacts.filter(
      (candidate) =>
        resolve(candidate.path) === resolve(fact.path) &&
        candidate.sha256 === fact.sha256 &&
        candidate.bytes === fact.bytes,
    );
    requireBinding(matching.length === 1);
    usedReviews.add(resolve(matching[0].path)!);
  }
  requireBinding(usedReviews.size === reviewArtifacts.length);
  const precommitArtifact = createFileArtifactFact({
    role: "reference_precommit",
    path: input.relativePath(precommitFile),
    filePath: precommitFile,
  });
  const metadata: HandoffReferenceMetadata = {
    artifact,
    precommit_artifact: precommitArtifact,
    review_artifacts: reviewArtifacts,
    actor_user_id: input.targetUserId,
    project_ref: binding.project_ref,
    consumers_sha256: sha256Json(consumers),
  };
  return {
    metadata,
    artifacts: [artifact, precommitArtifact, ...reviewArtifacts],
    intentFile: resolve(artifact.path)!,
    rows_sha256: sha256Text(rowText),
  };
}
