import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withBatchRunLock } from "@tiangong-lca/cli/batch";
import {
  captureFoundryInput,
  resolveFoundryInputPath,
  resolveFoundryOutput,
  writeFoundryArtifact,
  type FoundryRuntimeContext,
  type FoundryInputFact,
} from "./foundry-runtime-context.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import {
  fail,
  object,
  exact,
  timestamp,
  bytes,
  digest,
  taskPath,
  relative,
  readTaskBytes,
  readTaskJson,
  reference,
  facts,
  sameFact,
  shaPattern,
  maxIndexBytes,
} from "./foundry-task-io.ts";
import {
  requiredTask,
  createTask,
  loadTask,
  bindAccountIntent,
} from "./foundry-task-registration.ts";
import type {
  JsonRecord,
  FileReference,
  ArtifactFact,
  ArtifactEntry,
  LoadedTask,
  FoundryTaskOptions,
  FoundryTaskOperation,
  OperationPlan,
  OperationReceipt,
} from "./foundry-task-types.ts";
export type {
  FoundryTaskOptions,
  FoundryTaskOperation,
  FoundryTaskJob,
} from "./foundry-task-types.ts";

export async function withFoundryTaskMetadata<T>(
  context: FoundryRuntimeContext,
  inspect: (task: LoadedTask, index: readonly ArtifactEntry[]) => T,
): Promise<T> {
  requiredTask(context);
  const runPath = resolveFoundryOutput(context, `task-locks/${context.taskId}.json`, "state");
  return withBatchRunLock(
    {
      runPath,
      identity: {
        schema: "foundry-task-store-lock.v1",
        workspace_id: context.workspaceId,
        task_id: context.taskId,
      },
      reason: "Foundry task metadata verification",
    },
    () => {
      const task = loadTask(context, {});
      bindAccountIntent(context);
      const index = readIndex(context);
      verifyInputs(context, task, index);
      return inspect(task, index);
    },
  );
}

function selectedInput(context: FoundryRuntimeContext, file: string): FoundryInputFact {
  const resolved = resolveFoundryInputPath(context, file);
  return context.inputs.find((fact) => fact.path === resolved)!;
}

/** Prove a selected derived input descends from a selected approved input in the same verified index. */
export async function assertFoundryTaskInputLineage(
  context: FoundryRuntimeContext,
  ancestorFile: string,
  derivedFile: string,
): Promise<Readonly<{ ancestor: FoundryInputFact; derived: FoundryInputFact }>> {
  const ancestor = selectedInput(context, ancestorFile);
  const derived = selectedInput(context, derivedFile);
  if (sameFact(ancestor, derived))
    fail("task_lineage_not_derived", "A derived authorization requires a distinct indexed output.");
  return withFoundryTaskMetadata(context, (task, index) => {
    const findProducers = (fact: FoundryInputFact, before = Number.POSITIVE_INFINITY) =>
      index.filter(
        (entry) =>
          entry.sequence < before &&
          taskPath(context, entry.path) === fact.path &&
          entry.sha256 === fact.sha256 &&
          entry.bytes === fact.bytes,
      );
    const first = findProducers(derived);
    if (!first.length) fail("task_lineage_invalid", "Derived input has no indexed producer.");
    const pending = [...first];
    const visited = new Set<string>();
    while (pending.length) {
      const entry = pending.pop()!;
      if (visited.has(entry.record_sha256)) continue;
      visited.add(entry.record_sha256);
      const receiptBytes = readTaskBytes(context, entry.receipt.path);
      if (digest(receiptBytes) !== entry.receipt.sha256)
        fail("task_lineage_invalid", "Derived input producer receipt changed.");
      const receipt = object(JSON.parse(receiptBytes.toString("utf8")));
      exact(receipt, ["schema", "mode", "status", "plan", "job_sha256", "outputs", "result"]);
      const outputs = facts(receipt.outputs);
      if (
        receipt.schema !== "tiangong-foundry.operation-receipt.v1" ||
        receipt.mode !== "deterministic-local" ||
        receipt.status !== "completed" ||
        receipt.job_sha256 !== task.jobSha256 ||
        !outputs.some(
          (output) =>
            output.path === entry.path &&
            output.bytes === entry.bytes &&
            output.sha256 === entry.sha256,
        )
      )
        fail("task_lineage_invalid", "Derived input has no valid same-task producer receipt.");
      const planRef = reference(receipt.plan);
      const planBytes = readTaskBytes(context, planRef.path);
      if (digest(planBytes) !== planRef.sha256)
        fail("task_lineage_invalid", "Derived input producer plan changed.");
      const plan = object(JSON.parse(planBytes.toString("utf8")));
      exact(plan, [
        "schema",
        "operation_id",
        "job_sha256",
        "command",
        "options_sha256",
        "input_scope_sha256",
        "inputs",
        "created_at_utc",
      ]);
      const parents = facts(plan.inputs);
      const computedOperation = sha256Json({
        job: task.jobSha256,
        command: plan.command,
        input_scope: sha256Json(parents),
        options: plan.options_sha256,
      });
      if (
        plan.schema !== "tiangong-foundry.operation-plan.v1" ||
        plan.operation_id !== entry.operation_id ||
        computedOperation !== entry.operation_id ||
        plan.job_sha256 !== task.jobSha256 ||
        plan.command !== entry.command ||
        plan.input_scope_sha256 !== entry.input_scope_sha256 ||
        sha256Json(parents) !== entry.input_scope_sha256 ||
        !timestamp(plan.created_at_utc)
      )
        fail("task_lineage_invalid", "Derived input producer binding changed.");
      for (const parent of parents) {
        if (sameFact(parent, ancestor)) return Object.freeze({ ancestor, derived });
        pending.push(...findProducers(parent, entry.sequence));
      }
    }
    return fail(
      "task_lineage_scope_mismatch",
      "Derived input is valid task output but does not descend from the approved input scope.",
    );
  });
}

function readIndex(context: FoundryRuntimeContext): ArtifactEntry[] {
  const content = readTaskBytes(context, "artifact-index.jsonl", maxIndexBytes).toString("utf8");
  if (content && !content.endsWith("\n"))
    fail(
      "task_index_incomplete",
      "Artifact index is truncated; do not infer missing entries as permission.",
    );
  let previous: string | null = null;
  return content
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      let entry: JsonRecord;
      try {
        entry = object(JSON.parse(line));
      } catch {
        fail("task_index_invalid", "Artifact index contains incomplete JSON.");
      }
      exact(entry, [
        "schema",
        "sequence",
        "previous_sha256",
        "operation_id",
        "command",
        "input_scope_sha256",
        "receipt",
        "path",
        "bytes",
        "sha256",
        "record_sha256",
      ]);
      const { record_sha256: recorded, ...unsigned } = entry;
      if (
        entry.schema !== "tiangong-foundry.artifact-index.v2" ||
        entry.sequence !== index + 1 ||
        entry.previous_sha256 !== previous ||
        recorded !== sha256Json(unsigned) ||
        typeof entry.operation_id !== "string" ||
        !shaPattern.test(entry.operation_id) ||
        typeof entry.command !== "string" ||
        typeof entry.input_scope_sha256 !== "string" ||
        !shaPattern.test(entry.input_scope_sha256)
      )
        fail("task_index_invalid", "Artifact index sequence or content binding changed.");
      const fact = facts([{ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 }])[0];
      if (
        path.isAbsolute(fact.path) ||
        fact.path.includes("\\") ||
        fact.path.split("/").some((part) => part === ".." || part === "." || !part)
      )
        fail("task_index_invalid", "Artifact index paths must be task-relative.");
      taskPath(context, fact.path);
      reference(entry.receipt);
      previous = recorded;
      return entry as unknown as ArtifactEntry;
    });
}

function verifyRecordedArtifact(context: FoundryRuntimeContext, fact: ArtifactFact): void {
  const actual = captureFoundryInput(taskPath(context, fact.path));
  if (actual.bytes !== fact.bytes || actual.sha256 !== fact.sha256)
    fail(
      "task_artifact_changed",
      "Recorded artifact bytes no longer match their producer evidence.",
    );
}

function verifyInputs(
  context: FoundryRuntimeContext,
  task: LoadedTask,
  index: ArtifactEntry[],
): void {
  for (const source of task.sources) {
    try {
      if (sameFact(captureFoundryInput(source.path), source)) continue;
    } catch {
      /* No unavailable source becomes fresh scope. */
    }
    fail(
      "task_source_changed",
      "Original source is missing or changed; restore its frozen snapshot or create an explicit revision.",
    );
  }
  const verified = new Set<string>();
  const findProducer = (fact: FoundryInputFact, before = Number.POSITIVE_INFINITY) =>
    index.find(
      (entry) =>
        entry.sequence < before &&
        taskPath(context, entry.path) === fact.path &&
        entry.sha256 === fact.sha256 &&
        entry.bytes === fact.bytes,
    );
  for (const fact of context.inputs) {
    if (!task.sources.some((source) => sameFact(source, fact))) {
      const first = findProducer(fact);
      if (!first)
        fail(
          "task_input_unrecognized",
          "Input is neither frozen source nor an indexed derived artifact; a new scope requires explicit revision.",
        );
      const pending = [first];
      while (pending.length) {
        const entry = pending.pop()!;
        if (verified.has(entry.record_sha256)) continue;
        const receiptBytes = readTaskBytes(context, entry.receipt.path);
        if (digest(receiptBytes) !== entry.receipt.sha256)
          fail("task_lineage_invalid", "Derived input producer receipt changed.");
        const receipt = object(JSON.parse(receiptBytes.toString("utf8")));
        exact(receipt, ["schema", "mode", "status", "plan", "job_sha256", "outputs", "result"]);
        if (
          receipt.schema !== "tiangong-foundry.operation-receipt.v1" ||
          receipt.mode !== "deterministic-local" ||
          receipt.status !== "completed" ||
          receipt.job_sha256 !== task.jobSha256
        )
          fail("task_lineage_invalid", "Derived input has no completed producer in the same task.");
        const outputs = facts(receipt.outputs);
        if (
          !outputs.some(
            (output) =>
              output.path === entry.path &&
              output.bytes === entry.bytes &&
              output.sha256 === entry.sha256,
          )
        )
          fail("task_lineage_invalid", "Derived input is outside its producer output scope.");
        const planRef = reference(receipt.plan);
        const planBytes = readTaskBytes(context, planRef.path);
        if (digest(planBytes) !== planRef.sha256)
          fail("task_lineage_invalid", "Producer input plan changed.");
        const plan = object(JSON.parse(planBytes.toString("utf8")));
        exact(plan, [
          "schema",
          "operation_id",
          "job_sha256",
          "command",
          "options_sha256",
          "input_scope_sha256",
          "inputs",
          "created_at_utc",
        ]);
        const parents = facts(plan.inputs);
        const computedOperation = sha256Json({
          job: task.jobSha256,
          command: plan.command,
          input_scope: sha256Json(parents),
          options: plan.options_sha256,
        });
        if (
          plan.schema !== "tiangong-foundry.operation-plan.v1" ||
          plan.operation_id !== entry.operation_id ||
          computedOperation !== entry.operation_id ||
          plan.job_sha256 !== task.jobSha256 ||
          plan.command !== entry.command ||
          plan.input_scope_sha256 !== entry.input_scope_sha256 ||
          sha256Json(parents) !== entry.input_scope_sha256 ||
          !timestamp(plan.created_at_utc)
        )
          fail("task_lineage_invalid", "Producer binding does not match the artifact index.");
        for (const parent of parents) {
          if (task.sources.some((source) => sameFact(source, parent))) continue;
          const earlier = findProducer(parent, entry.sequence);
          if (!earlier)
            fail("task_lineage_invalid", "Producer input has no earlier source-bound artifact.");
          pending.push(earlier);
        }
        verified.add(entry.record_sha256);
      }
    }
    if (!sameFact(captureFoundryInput(fact.path), fact))
      fail("input_changed", "Current operation input changed after selection.");
  }
}

function replaceIndex(
  context: FoundryRuntimeContext,
  entries: ArtifactEntry[],
  before: Buffer,
): void {
  const target = taskPath(context, "artifact-index.jsonl");
  const content = Buffer.from(
    entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""),
  );
  if (content.length > maxIndexBytes)
    fail("task_index_limit", "Artifact index exceeds the bounded metadata store.");
  const temp = taskPath(context, `.artifact-index-${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (!readTaskBytes(context, target, maxIndexBytes).equals(before))
      fail("task_index_conflict", "Artifact index changed outside the task lock.");
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

/** Short local preparation transaction. Remote mutation/batch execution must not use this replay path. */
export async function runFoundryTaskOperation(
  context: FoundryRuntimeContext,
  input: { command: "dataset-curation-cleanup"; options: JsonRecord; task?: FoundryTaskOptions },
  operation: (transaction: FoundryTaskOperation) => JsonRecord,
): Promise<JsonRecord> {
  requiredTask(context);
  const lockPath = resolveFoundryOutput(context, `task-locks/${context.taskId}.json`, "state");
  return withBatchRunLock(
    {
      runPath: lockPath,
      identity: {
        schema: "foundry-task-store-lock.v1",
        workspace_id: context.workspaceId,
        task_id: context.taskId,
      },
      reason: "Foundry local task preparation",
    },
    () => {
      requiredTask(context);
      const task = fs.existsSync(taskPath(context, "foundry-job.json"))
        ? loadTask(context, input.task ?? {})
        : createTask(context, input.task ?? {});
      bindAccountIntent(context);
      const indexBefore = readTaskBytes(context, "artifact-index.jsonl", maxIndexBytes);
      const index = readIndex(context);
      verifyInputs(context, task, index);
      const inputScopeSha256 = sha256Json(context.inputs);
      const optionsSha256 = sha256Json(input.options);
      const operationId = sha256Json({
        job: task.jobSha256,
        command: input.command,
        input_scope: inputScopeSha256,
        options: optionsSha256,
      });
      const planPath = `checkpoints/${operationId}.plan.json`;
      const receiptPath = `checkpoints/${operationId}.json`;
      let plan: OperationPlan;
      if (fs.existsSync(taskPath(context, planPath))) {
        const old = readTaskJson(context, planPath);
        exact(old, [
          "schema",
          "operation_id",
          "job_sha256",
          "command",
          "options_sha256",
          "input_scope_sha256",
          "inputs",
          "created_at_utc",
        ]);
        if (
          old.schema !== "tiangong-foundry.operation-plan.v1" ||
          old.operation_id !== operationId ||
          old.job_sha256 !== task.jobSha256 ||
          old.command !== input.command ||
          old.options_sha256 !== optionsSha256 ||
          old.input_scope_sha256 !== inputScopeSha256 ||
          sha256Json(old.inputs) !== inputScopeSha256 ||
          !timestamp(old.created_at_utc)
        )
          fail("task_operation_changed", "Existing operation plan does not match current inputs.");
        plan = old as unknown as OperationPlan;
      } else {
        plan = {
          schema: "tiangong-foundry.operation-plan.v1",
          operation_id: operationId,
          job_sha256: task.jobSha256,
          command: input.command,
          options_sha256: optionsSha256,
          input_scope_sha256: inputScopeSha256,
          inputs: context.inputs.map((fact) => ({ ...fact })),
          created_at_utc: new Date().toISOString(),
        };
        writeFoundryArtifact(context, planPath, bytes(plan));
      }
      const planRef = { path: planPath, sha256: digest(readTaskBytes(context, planPath)) };
      let receipt: OperationReceipt;
      let result: JsonRecord;
      if (fs.existsSync(taskPath(context, receiptPath))) {
        const old = readTaskJson(context, receiptPath);
        exact(old, ["schema", "mode", "status", "plan", "job_sha256", "outputs", "result"]);
        if (
          old.schema !== "tiangong-foundry.operation-receipt.v1" ||
          old.mode !== "deterministic-local" ||
          old.status !== "completed" ||
          old.job_sha256 !== task.jobSha256 ||
          sha256Json(old.plan) !== sha256Json(planRef)
        )
          fail("task_receipt_invalid", "Operation receipt does not match this local preparation.");
        const outputs = facts(old.outputs);
        for (const fact of outputs) verifyRecordedArtifact(context, fact);
        const resultRef = reference(old.result);
        const data = readTaskBytes(context, resultRef.path);
        if (
          digest(data) !== resultRef.sha256 ||
          !outputs.some((fact) => fact.path === resultRef.path && fact.sha256 === resultRef.sha256)
        )
          fail("task_receipt_invalid", "Cached result is not a current operation artifact.");
        result = object(JSON.parse(data.toString("utf8")));
        receipt = old as unknown as OperationReceipt;
      } else {
        const outputs = new Map<string, ArtifactFact>();
        const jsonObjects = new Map<string, FileReference>();
        let active = true;
        const write = (file: string, content: string | Buffer) => {
          if (!active)
            fail("task_operation_closed", "Operation writers cannot escape the task transaction.");
          loadTask(context, input.task ?? {});
          const relativePath = relative(context, file);
          if (!/^(?:outputs|evidence)\//u.test(relativePath))
            fail(
              "task_output_role_invalid",
              "Command output cannot overwrite task control records.",
            );
          writeFoundryArtifact(context, file, content);
          const fact = captureFoundryInput(taskPath(context, file));
          outputs.set(relativePath, { path: relativePath, bytes: fact.bytes, sha256: fact.sha256 });
        };
        try {
          result = operation({
            job: task.job,
            operationId,
            inputScopeSha256,
            nowIso: () => plan.created_at_utc,
            writeText(file, content) {
              write(
                file,
                typeof content === "string"
                  ? content
                  : Buffer.from(content.buffer, content.byteOffset, content.byteLength),
              );
            },
            writeJson(file, value) {
              const data = bytes(value);
              write(file, data);
              jsonObjects.set(digest(data), {
                path: relative(context, file),
                sha256: digest(data),
              });
            },
          });
          const resultRef = jsonObjects.get(digest(bytes(result)));
          if (!resultRef)
            fail(
              "task_result_not_recorded",
              "Local operation must write its exact returned report as an artifact.",
            );
          verifyInputs(context, task, index);
          receipt = {
            schema: "tiangong-foundry.operation-receipt.v1",
            mode: "deterministic-local",
            status: "completed",
            plan: planRef,
            job_sha256: task.jobSha256,
            outputs: [...outputs.values()],
            result: resultRef,
          };
          writeFoundryArtifact(context, receiptPath, bytes(receipt));
        } finally {
          active = false;
        }
      }
      const receiptRef = { path: receiptPath, sha256: digest(readTaskBytes(context, receiptPath)) };
      const next = [...index];
      for (const fact of receipt.outputs) {
        if (
          next.some(
            (entry) =>
              entry.operation_id === operationId &&
              entry.path === fact.path &&
              entry.sha256 === fact.sha256,
          )
        )
          continue;
        const entry = {
          schema: "tiangong-foundry.artifact-index.v2" as const,
          sequence: next.length + 1,
          previous_sha256: next.at(-1)?.record_sha256 ?? null,
          operation_id: operationId,
          command: input.command,
          input_scope_sha256: inputScopeSha256,
          receipt: receiptRef,
          ...fact,
        };
        next.push({ ...entry, record_sha256: sha256Json(entry) });
      }
      if (next.length !== index.length) replaceIndex(context, next, indexBefore);
      return result;
    },
  );
}
