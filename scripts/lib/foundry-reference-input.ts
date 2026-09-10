import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  captureFoundryInput,
  readFoundryInput,
  FoundryContextError,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { assertNotFoundrySessionFile, migrationCredentialPath } from "./foundry-private-path.ts";
import { readSelectedSemanticBytes } from "./foundry-semantic-input.ts";
import {
  currentWorkflowState,
  readWorkflowArtifact,
  workflowObject,
} from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";

export const FOUNDRY_REFERENCE_INPUT_SCHEMA = "tiangong-foundry.reference-input.v1" as const;
type FileSelection = { file: string; sha256: string };
export interface FoundryReferenceInput {
  schema: typeof FOUNDRY_REFERENCE_INPUT_SCHEMA;
  task_id: string;
  actor_id: string;
  rows_manifest_sha256: string;
  dataset_type: string;
  qa_reference_rows: readonly FileSelection[];
  intent: FileSelection | null;
  review_files: readonly FileSelection[];
}
interface SelectedReferenceInput {
  spec: FoundryReferenceInput;
  descriptor: FoundryInputFact;
  qa: readonly FoundryInputFact[];
  intent: FoundryInputFact | null;
  reviews: readonly FoundryInputFact[];
}
const selections = new WeakSet<object>();
const sha = /^[a-f0-9]{64}$/u;
function invalid(message: string): never {
  throw new FoundryContextError("reference_input_invalid", message);
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    invalid("Reference input has missing or unsupported fields.");
}
function file(value: unknown): FileSelection {
  const selected = workflowObject(value);
  exact(selected, ["file", "sha256"]);
  if (
    typeof selected.file !== "string" ||
    !selected.file.trim() ||
    selected.file.length > 4096 ||
    /[\0\r\n]/u.test(selected.file) ||
    typeof selected.sha256 !== "string" ||
    !sha.test(selected.sha256)
  )
    invalid("Reference file selection is invalid.");
  return Object.freeze({ file: selected.file, sha256: selected.sha256 });
}
export function parseFoundryReferenceInput(value: unknown): FoundryReferenceInput {
  const data = workflowObject(value);
  exact(data, [
    "schema",
    "task_id",
    "actor_id",
    "rows_manifest_sha256",
    "dataset_type",
    "qa_reference_rows",
    "intent",
    "review_files",
  ]);
  if (
    data.schema !== FOUNDRY_REFERENCE_INPUT_SCHEMA ||
    typeof data.task_id !== "string" ||
    !/^task-[0-9a-f]{64}-r[0-9]{4}$/u.test(data.task_id) ||
    typeof data.actor_id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(data.actor_id) ||
    typeof data.rows_manifest_sha256 !== "string" ||
    !sha.test(data.rows_manifest_sha256) ||
    typeof data.dataset_type !== "string" ||
    ![
      "process",
      "flow",
      "source",
      "contact",
      "lifecyclemodel",
      "unitgroup",
      "flowproperty",
    ].includes(data.dataset_type) ||
    !Array.isArray(data.qa_reference_rows) ||
    !Array.isArray(data.review_files) ||
    data.qa_reference_rows.length > 128 ||
    data.review_files.length > 128
  )
    invalid("Reference input scope or file lists are invalid.");
  const qa = data.qa_reference_rows.map(file),
    reviews = data.review_files.map(file),
    intent = data.intent === null ? null : file(data.intent);
  if (
    (!qa.length && !intent) ||
    (qa.length && data.dataset_type !== "process") ||
    Boolean(intent) !== Boolean(reviews.length)
  )
    invalid("Select Process QA references and/or one intent with its explicit reviews.");
  return Object.freeze({
    schema: FOUNDRY_REFERENCE_INPUT_SCHEMA,
    task_id: data.task_id,
    actor_id: data.actor_id,
    rows_manifest_sha256: data.rows_manifest_sha256,
    dataset_type: data.dataset_type,
    qa_reference_rows: Object.freeze(qa),
    intent,
    review_files: Object.freeze(reviews),
  });
}
export function selectFoundryReferenceInput(
  context: FoundryRuntimeContext,
  descriptorFile: string,
): SelectedReferenceInput {
  let total = 0;
  const capture = (name: string) => {
    if (!name.trim() || name.length > 4096 || /[\0\r\n]/u.test(name))
      invalid("Reference input path is invalid.");
    const target = path.resolve(context.workspaceRoot, name);
    if (migrationCredentialPath(path.relative(context.workspaceRoot, target)))
      invalid("Credential paths cannot be reference inputs.");
    assertNotFoundrySessionFile(target, context.accountIntent?.sessionReference);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
      invalid("Reference inputs must be bounded regular files.");
    total += stat.size;
    if (total > 64 * 1024 * 1024) invalid("Reference input selection exceeds 64 MiB.");
    return Object.freeze(captureFoundryInput(target));
  };
  const descriptor = capture(descriptorFile);
  let spec: FoundryReferenceInput;
  try {
    spec = parseFoundryReferenceInput(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(readSelectedSemanticBytes(descriptor)),
      ),
    );
  } catch {
    invalid("Select a complete supported reference-input descriptor.");
  }
  if (spec.task_id !== context.taskId || spec.actor_id !== context.actorId)
    invalid("Reference selection belongs to another task or actor.");
  const selected = (entry: FileSelection) => {
    const fact = capture(entry.file);
    if (fact.sha256 !== entry.sha256)
      invalid("Reference input bytes differ from the selected digest.");
    return fact;
  };
  const result = Object.freeze({
    spec,
    descriptor,
    qa: Object.freeze(spec.qa_reference_rows.map(selected)),
    intent: spec.intent ? selected(spec.intent) : null,
    reviews: Object.freeze(spec.review_files.map(selected)),
  });
  if (
    new Set(result.qa.map((fact) => fact.path)).size !== result.qa.length ||
    new Set(result.reviews.map((fact) => fact.path)).size !== result.reviews.length
  )
    invalid("Select each reference file only once.");
  selections.add(result);
  return result;
}
function assertSelected(selected: SelectedReferenceInput) {
  if (!selections.has(selected)) invalid("Reference input must be selected by the current host.");
  for (const fact of [
    selected.descriptor,
    ...selected.qa,
    ...selected.reviews,
    ...(selected.intent ? [selected.intent] : []),
  ])
    readSelectedSemanticBytes(fact);
}
export async function recordFoundryReferenceInput(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  selected: SelectedReferenceInput,
) {
  assertSelected(selected);
  const state = currentWorkflowState(context, entries),
    rows = state.rows;
  if (!rows || rows.entry.sha256 !== selected.spec.rows_manifest_sha256)
    invalid("Reference input requires the current row manifest.");
  const set = rows.value.sets.find((item) => item.type === selected.spec.dataset_type);
  if (!set) invalid("Reference selection has no current dataset scope.");
  const assertUnprepared = (index: readonly ArtifactEntry[]) => {
    if (
      index.some(
        (entry) =>
          entry.command === "dataset-workflow-execution-prepare" &&
          path.basename(entry.path) === "owner-execution-request.json" &&
          workflowObject(readWorkflowArtifact(context, entry).value.policy).dataset_type ===
            selected.spec.dataset_type,
      )
    )
      invalid("A prepared or consumed owner scope cannot replace reference inputs.");
  };
  assertUnprepared(entries);
  const previous = state.referenceInputs.get(set.type)?.entry.sha256 ?? null;
  readFoundryInput(context, set.file);
  const input = captureFoundryInput(set.file);
  const existing = state.referenceInputs.get(set.type);
  if (existing?.value.source_sha256 === selected.descriptor.sha256) return existing.value;
  let intentValue: Record<string, unknown> | null = null;
  const reviewPointers: Array<{ value: Record<string, unknown>; source: FoundryInputFact }> = [];
  if (selected.intent) {
    try {
      intentValue = workflowObject(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            readSelectedSemanticBytes(selected.intent),
          ),
        ),
      );
      if (
        intentValue.schema_version !== "dataset-exact-reference-intent.v1" ||
        !Array.isArray(intentValue.references) ||
        !intentValue.references.length
      )
        invalid("Reference intent does not expose the supported explicit review locators.");
      for (const value of intentValue.references) {
        const review = workflowObject(workflowObject(value).review);
        if (typeof review.file !== "string") invalid("Reference review locator is missing.");
        const canonical = fs.realpathSync(
          path.resolve(path.dirname(selected.intent.path), review.file),
        );
        const fact = selected.reviews.find(
          (item) => item.path === canonical && item.sha256 === review.sha256,
        );
        if (!fact)
          invalid("Every intent review must match an independently selected file and digest.");
        reviewPointers.push({ value: review, source: fact });
      }
      if (new Set(reviewPointers.map((item) => item.source.path)).size !== selected.reviews.length)
        invalid("Reference selection contains unused review files.");
    } catch {
      invalid("Reference intent and independently selected reviews do not match.");
    }
  }
  const output = path.join(context.taskRoot!, "outputs", "reference-input", randomUUID());
  return runFoundryTaskOperation(
    context,
    {
      command: "dataset-workflow-reference-input",
      options: { descriptor: selected.descriptor, input, rows_manifest_sha256: rows.entry.sha256 },
      validateCurrent(index) {
        assertSelected(selected);
        assertUnprepared(index);
        if (
          (currentWorkflowState(context, index).referenceInputs.get(set.type)?.entry.sha256 ??
            null) !== previous
        )
          invalid("Reference selection changed concurrently.");
        if (currentWorkflowState(context, index).rows?.entry.sha256 !== rows.entry.sha256)
          invalid("Rows changed during reference selection.");
      },
    },
    (operation) => {
      const snapshot = (fact: FoundryInputFact, name: string) => {
        const target = path.join(output, name);
        operation.writeText(target, readSelectedSemanticBytes(fact));
        const captured = captureFoundryInput(target);
        if (captured.sha256 !== fact.sha256 || captured.bytes !== fact.bytes)
          invalid("Reference snapshot differs from selected bytes.");
        return captured;
      };
      const qa = selected.qa.map((fact, index) =>
        snapshot(
          fact,
          `qa-${index}${path.extname(fact.path).toLowerCase() === ".jsonl" ? ".jsonl" : ".json"}`,
        ),
      );
      const reviews = selected.reviews.map((fact, index) => snapshot(fact, `review-${index}.json`));
      let intent: FoundryInputFact | null = null;
      if (selected.intent && intentValue) {
        snapshot(selected.intent, "original-intent.json");
        for (const pointer of reviewPointers)
          pointer.value.file = reviews[selected.reviews.indexOf(pointer.source)].path;
        const target = path.join(output, "intent.json");
        operation.writeJson(target, intentValue);
        intent = captureFoundryInput(target);
      }
      snapshot(selected.descriptor, "descriptor.json");
      const result = {
        schema: "tiangong-foundry.reference-selection.v1",
        status: "selected",
        dataset_type: set.type,
        rows_manifest_sha256: rows.entry.sha256,
        source_sha256: selected.descriptor.sha256,
        input,
        qa_files: qa,
        intent,
        review_files: reviews,
        grants_permission: false,
      };
      operation.writeJson(path.join(output, "foundry-reference-input.json"), result);
      return result;
    },
  );
}
