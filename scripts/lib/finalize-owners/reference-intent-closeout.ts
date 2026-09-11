import path from "node:path";
import { parseFoundryCommandSpec, type FoundryArtifactFact } from "../foundry-command-spec.ts";
import { sha256Json } from "../identity-preflight-proof.ts";
import { readHandoffReferenceEvidence } from "./handoff-reference-intent.ts";

type RecordValue = Record<string, unknown>;
function requireEvidence(value: unknown): asserts value {
  if (!value)
    throw new Error("Reference intent readback evidence is missing, changed or inconsistent.");
}
function object(value: unknown): RecordValue {
  requireEvidence(value && typeof value === "object" && !Array.isArray(value));
  return value as RecordValue;
}
export function validateReferenceIntentReadback(input: {
  handoff: RecordValue;
  report: RecordValue;
  rowsFile: string;
  datasetType: string;
  targetUserId: string;
  resolveFile: (value: unknown) => string | null;
  relativePath: (file: string) => string;
}): FoundryArtifactFact[] {
  if (!Object.hasOwn(input.handoff, "reference_intent")) {
    requireEvidence(!Object.hasOwn(input.report, "reference_intent"));
    const commands = input.handoff.commands;
    if (commands && typeof commands === "object") {
      for (const raw of Object.values(commands)) {
        if (!raw || typeof raw !== "object") continue;
        const argv = (raw as RecordValue).argv;
        requireEvidence(
          !Array.isArray(argv) ||
            !argv.some(
              (arg) => typeof arg === "string" && arg.split("=")[0] === "--reference-intent-file",
            ),
        );
      }
    }
    return [];
  }
  const resolve = (value: unknown) => {
    const file = input.resolveFile(value);
    return file ? path.resolve(file) : null;
  };
  const metadata = object(input.handoff.reference_intent),
    intent = object(metadata.artifact),
    precommit = object(metadata.precommit_artifact);
  const fresh = readHandoffReferenceEvidence({
    finalize: {
      files: { remote_verify_report: precommit.path },
      reference_intent_file: intent.path,
    },
    options: { referenceIntentFile: intent.path },
    rowsFile: input.rowsFile,
    datasetType: input.datasetType,
    targetUserId: input.targetUserId,
    projectRef: String(input.handoff.verified_project_ref ?? ""),
    resolveFile: input.resolveFile,
    relativePath: input.relativePath,
  });
  requireEvidence(fresh && Array.isArray(metadata.review_artifacts));
  const expected = [intent, precommit, ...metadata.review_artifacts.map(object)];
  const sameFact = (a: RecordValue, b: { path: string; sha256: string; bytes: number }) =>
    resolve(a.path) === resolve(b.path) && a.sha256 === b.sha256 && a.bytes === b.bytes;
  requireEvidence(
    expected.length === fresh.artifacts.length &&
      expected.every(
        (fact, i) => fact.role === fresh.artifacts[i].role && sameFact(fact, fresh.artifacts[i]),
      ),
  );
  requireEvidence(
    metadata.actor_user_id === fresh.metadata.actor_user_id &&
      metadata.project_ref === fresh.metadata.project_ref &&
      metadata.consumers_sha256 === fresh.metadata.consumers_sha256,
  );
  const rows = object(input.handoff.final_rows_artifact);
  requireEvidence(rows.sha256 === fresh.rows_sha256);
  const commands = object(input.handoff.commands);
  for (const key of ["commit", "post_write_verify"]) {
    const command = parseFoundryCommandSpec(commands[key]);
    for (const fact of [rows, ...expected])
      requireEvidence(
        command.binding.artifacts.filter((bound) => sameFact(fact, bound)).length === 1,
      );
    const positions = command.argv.flatMap((arg, index) =>
      arg === "--reference-intent-file" ? [index] : [],
    );
    requireEvidence(!command.argv.some((arg) => arg.startsWith("--reference-intent-file=")));
    requireEvidence(
      key === "commit"
        ? positions.length === 0
        : positions.length === 1 && resolve(command.argv[positions[0] + 1]) === fresh.intentFile,
    );
  }
  const readback = object(input.report.reference_intent);
  requireEvidence(
    sameFact(object(readback.file), fresh.metadata.artifact) &&
      readback.actor_user_id === metadata.actor_user_id &&
      readback.project_ref === metadata.project_ref &&
      sha256Json(readback.consumers) === metadata.consumers_sha256,
  );
  requireEvidence(
    Array.isArray(readback.review_files) &&
      readback.review_files.length === fresh.metadata.review_artifacts.length,
  );
  for (const fact of fresh.metadata.review_artifacts)
    requireEvidence(
      readback.review_files.filter((raw) => sameFact(object(raw), fact)).length === 1,
    );
  return fresh.artifacts.map((fact) => ({ ...fact, path: resolve(fact.path)! }));
}
