import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { workflowFixture, digestFile } from "../fixtures/foundry-public-workflow.ts";
import { processRowWithInvalidLocation, flowRow } from "../fixtures/row-builders.ts";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import {
  createFoundryRuntimeContext,
  captureFoundryInput,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { qualifyFoundryRuntime } from "../../scripts/lib/foundry-runtime-qualification.ts";
import { finalizeFoundryWorkflow } from "../../scripts/lib/foundry-workflow-finalize.ts";

test("public Process QA selection snapshots repeated inputs and the finalizer transports them to the installed owner", async (t) => {
  const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
  const seed = path.join(root, "seed.json"),
    specFile = path.join(root, "request.json");
  fs.writeFileSync(
    seed,
    JSON.stringify({
      rows: [processRowWithInvalidLocation("66666666-6666-4666-8666-666666666666")],
    }),
  );
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "process-reference-qa",
      actor_id: "qa-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId: "qa-actor" };
  await facade.resume(invocation);
  await facade.resume(invocation);
  const assessed = await facade.resume(invocation);
  const manifest = assessed.artifacts.findLast((item) => item.role === "foundry-rows.json");
  assert.ok(manifest?.kind === "file", JSON.stringify(assessed.blockers));
  const references = [path.join(root, "flows.jsonl"), path.join(root, "support.json")];
  fs.writeFileSync(
    references[0],
    JSON.stringify(flowRow("77777777-7777-4777-8777-777777777777")) + "\n",
  );
  fs.writeFileSync(references[1], "[]");
  const descriptorFile = path.join(root, "references.json");
  const descriptor = {
    schema: "tiangong-foundry.reference-input.v1",
    task_id: invocation.taskId,
    actor_id: invocation.actorId,
    rows_manifest_sha256: manifest.sha256,
    dataset_type: "process",
    qa_reference_rows: references.map((file) => ({ file, sha256: digestFile(file) })),
    intent: null,
    review_files: [],
  };
  fs.writeFileSync(
    descriptorFile,
    JSON.stringify({ ...descriptor, rows_manifest_sha256: "0".repeat(64) }),
  );
  const stale = await facade.resume({ ...invocation, referenceInputFile: descriptorFile });
  assert.equal(stale.blockers[0]?.code, "reference_input_invalid");
  assert.ok(!stale.artifacts.some((item) => item.role === "foundry-reference-input.json"));
  fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
  const selected = await facade.resume({ ...invocation, referenceInputFile: descriptorFile });
  const artifact = selected.artifacts.findLast(
    (item) => item.role === "foundry-reference-input.json",
  );
  assert.ok(artifact?.kind === "file", JSON.stringify(selected.blockers));
  const selection = JSON.parse(fs.readFileSync(artifact.path, "utf8")) as {
    qa_files: Array<{ path: string; sha256: string }>;
    grants_permission: boolean;
  };
  assert.equal(selection.grants_permission, false);
  assert.deepEqual(
    selection.qa_files.map((item) => item.sha256),
    descriptor.qa_reference_rows.map((item) => item.sha256),
  );
  references.forEach((file) => fs.unlinkSync(file));

  // Invoke the existing finalization owner on the same registered public task.
  // No account is selected: this exercises real offline QA transport, not remote identity or a write.
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace,
    cacheBase: path.join(root, "cache"),
    ...invocation,
  };
  const context = createFoundryRuntimeContext(options);
  const runtime = createFoundryRuntime(context, qualifyFoundryRuntime(context, runtimeSelection));
  const inspected = await runtime.inspectTask();
  const selectedContext = createFoundryRuntimeContext({
    ...options,
    inputs: inspected.artifacts.map((entry) =>
      captureFoundryInput(path.resolve(context.taskRoot!, entry.path)),
    ),
  });
  const original = childProcess.spawnSync;
  const qaCalls: string[][] = [];
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const argv = args[1];
    if (Array.isArray(argv) && argv[1] === "qa" && argv[2] === "process") qaCalls.push([...argv]);
    return Reflect.apply(original, childProcess, args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await finalizeFoundryWorkflow(
    selectedContext,
    qualifyFoundryRuntime(selectedContext, runtimeSelection),
    inspected.artifacts,
  );
  assert.equal(qaCalls.length, 1);
  assert.deepEqual(
    qaCalls[0].flatMap((arg, index, argv) =>
      arg === "--reference-rows-file" ? [argv[index + 1]] : [],
    ),
    selection.qa_files.map((item) => item.path),
  );
  const after = await runtime.inspectTask();
  assert.ok(after.artifacts.some((entry) => entry.path.endsWith("foundry-finalize.json")));
  assert.ok(
    !after.artifacts.some((entry) => entry.command === "dataset-workflow-execution-prepare"),
  );
});
