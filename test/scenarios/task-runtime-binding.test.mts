import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { assertFoundryTaskInputLineage } from "../../scripts/lib/foundry-task-store.ts";

const moduleUrl = new URL("../../scripts/runtime-entry.ts", import.meta.url).href;
const hasCode = (code: string) => (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === code);

test("a persisted task cannot be reused by a different actor or input scope", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-task-binding-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.jsonl");
  fs.writeFileSync(source, '{"flowDataSet":{}}\n');
  const options = {
    moduleUrl,
    workspace: path.join(root, "project"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const first = createFoundryRuntime(
    createFoundryRuntimeContext({
      ...options,
      taskId: "same-task",
      actorId: "actor-one",
      inputs: [captureFoundryInput(source)],
    }),
  );

  function fixture(t: { after: (fn: () => void) => void }, prefix: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const input = path.join(root, "input.jsonl");
    fs.writeFileSync(input, '{"flowDataSet":{}}\n');
    const options = {
      moduleUrl,
      workspace: path.join(root, "project"),
      cacheBase: path.join(root, "cache"),
    };
    initializeFoundryWorkspace(createFoundryRuntimeContext(options));
    const context = createFoundryRuntimeContext({
      ...options,
      taskId: "task",
      actorId: "agent",
      inputs: [captureFoundryInput(input)],
    });
    return { root, input, options, context, runtime: createFoundryRuntime(context) };
  }

  test("same request is idempotent under concurrent calls and preserves all task bytes", async (t) => {
    const { input, context, runtime } = fixture(t, "foundry-task-idempotence-");
    const [one, two] = await Promise.all([
      runtime.cleanup({ input, type: "flow" }),
      runtime.cleanup({ input, type: "flow" }),
    ]);
    assert.deepEqual(one, two);
    const index = path.join(context.taskRoot!, "artifact-index.jsonl");
    const before = fs.readFileSync(index);
    const third = await runtime.cleanup({ input, type: "flow" });
    assert.deepEqual(third, one);
    assert.deepEqual(fs.readFileSync(index), before);
    assert.equal(before.toString().trim().split("\n").length, 2);
  });

  test("task account intent cannot change or be forgotten after local registration", async (t) => {
    const { input, options, context, runtime } = fixture(t, "foundry-task-account-");
    await runtime.cleanup({ input, type: "flow" });
    const intent = {
      projectRef: "aaaaaaaaaaaaaaaaaaaa",
      userId: "11111111-1111-4111-8111-111111111111",
    };
    const bound = createFoundryRuntime(
      createFoundryRuntimeContext({
        ...options,
        taskId: "task",
        actorId: "agent",
        inputs: [captureFoundryInput(input)],
        accountIntent: intent,
      }),
    );
    await bound.cleanup({ input, type: "flow" });
    const accountFile = path.join(context.taskRoot!, "account-intent.json");
    const original = fs.readFileSync(accountFile);
    const wrong = createFoundryRuntime(
      createFoundryRuntimeContext({
        ...options,
        taskId: "task",
        actorId: "agent",
        inputs: [captureFoundryInput(input)],
        accountIntent: { ...intent, userId: "22222222-2222-4222-8222-222222222222" },
      }),
    );
    await assert.rejects(
      () => wrong.cleanup({ input, type: "flow", outputDirectory: "outputs/wrong-account" }),
      hasCode("task_account_mismatch"),
    );
    fs.unlinkSync(accountFile);
    await runtime.cleanup({ input, type: "flow" });
    assert.deepEqual(fs.readFileSync(accountFile), original);
  });

  test("a published task cannot be recreated after its directory is lost", async (t) => {
    const { input, context, runtime } = fixture(t, "foundry-task-no-reset-");
    await runtime.cleanup({ input, type: "flow" });
    fs.rmSync(context.taskRoot!, { recursive: true });
    await assert.rejects(
      () => runtime.cleanup({ input, type: "flow" }),
      hasCode("task_state_missing"),
    );
    assert.equal(fs.existsSync(context.taskRoot!), false);
  });

  test("registration can finish interrupted initialization but cannot republish executed state", async (t) => {
    const { input, context, runtime } = fixture(t, "foundry-task-init-recovery-");
    await runtime.cleanup({ input, type: "flow" });
    const job = fs.readFileSync(path.join(context.taskRoot!, "foundry-job.json"));
    const publication = path.join(context.stateRoot, "task-publications/task.json");
    fs.rmSync(context.taskRoot!, { recursive: true });
    fs.unlinkSync(publication);
    await runtime.cleanup({ input, type: "flow" });
    assert.deepEqual(fs.readFileSync(path.join(context.taskRoot!, "foundry-job.json")), job);
    const consumed = path.join(context.taskRoot!, "attempts/consumed.json");
    fs.mkdirSync(path.dirname(consumed));
    fs.writeFileSync(consumed, '{"consumed":true}\n');
    fs.unlinkSync(publication);
    await assert.rejects(
      () => runtime.cleanup({ input, type: "flow" }),
      hasCode("task_initialization_ambiguous"),
    );
    assert.equal(fs.readFileSync(consumed, "utf8"), '{"consumed":true}\n');
  });

  test("mutated job metadata and an ancestor producer receipt invalidate continuation", async (t) => {
    const { input, options, context, runtime } = fixture(t, "foundry-task-tamper-");
    const first = await runtime.cleanup({ input, type: "flow" });
    const firstOutput = path.join(context.workspaceRoot, String(first.cleaned_rows_file));
    const derived = createFoundryRuntime(
      createFoundryRuntimeContext({
        ...options,
        taskId: "task",
        actorId: "agent",
        inputs: [captureFoundryInput(firstOutput)],
      }),
    );
    const second = await derived.cleanup({
      input: firstOutput,
      type: "flow",
      outputDirectory: "outputs/second",
    });
    const jobPath = path.join(context.taskRoot!, "foundry-job.json");
    const originalJob = fs.readFileSync(jobPath);
    const modified = JSON.parse(originalJob.toString());
    modified.created_at_utc = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(jobPath, JSON.stringify(modified));
    await assert.rejects(
      () => runtime.cleanup({ input, type: "flow" }),
      hasCode("task_snapshot_changed"),
    );
    fs.writeFileSync(jobPath, originalJob);
    const entries = fs
      .readFileSync(path.join(context.taskRoot!, "artifact-index.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const ancestorReceipt = path.join(context.taskRoot!, entries[0].receipt.path);
    fs.appendFileSync(ancestorReceipt, " ");
    const secondOutput = path.join(context.workspaceRoot, String(second.cleaned_rows_file));
    const third = createFoundryRuntime(
      createFoundryRuntimeContext({
        ...options,
        taskId: "task",
        actorId: "agent",
        inputs: [captureFoundryInput(secondOutput)],
      }),
    );
    await assert.rejects(
      () => third.cleanup({ input: secondOutput, type: "flow", outputDirectory: "outputs/third" }),
      hasCode("task_lineage_invalid"),
    );
  });
  await first.cleanup({ input: source, type: "flow" });
  const second = createFoundryRuntime(
    createFoundryRuntimeContext({
      ...options,
      taskId: "same-task",
      actorId: "actor-two",
      inputs: [captureFoundryInput(source)],
    }),
  );
  await assert.rejects(
    async () =>
      second.cleanup({ input: source, type: "flow", outputDirectory: "outputs/other-actor" }),
    hasCode("task_actor_mismatch"),
  );
  assert.equal(fs.existsSync(path.join(first.context.taskRoot!, "outputs/other-actor")), false);
  fs.writeFileSync(source, '{"flowDataSet":{"changed":true}}\n');
  const changed = createFoundryRuntime(
    createFoundryRuntimeContext({
      ...options,
      taskId: "same-task",
      actorId: "actor-one",
      inputs: [captureFoundryInput(source)],
    }),
  );
  await assert.rejects(
    async () =>
      changed.cleanup({ input: source, type: "flow", outputDirectory: "outputs/changed-input" }),
    hasCode("task_source_changed"),
  );
});

test("preparation persists source/profile facts and records output lineage", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-task-lineage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "input.jsonl");
  fs.writeFileSync(input, '{"flowDataSet":{}}\n');
  const options = {
    moduleUrl,
    workspace: path.join(root, "project"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const context = createFoundryRuntimeContext({
    ...options,
    taskId: "task",
    actorId: "agent",
    inputs: [captureFoundryInput(input)],
  });
  const result = await createFoundryRuntime(context).cleanup({ input, type: "flow" });
  for (const name of [
    "foundry-job.json",
    "source-manifest.json",
    "profile-lock.json",
    "artifact-index.jsonl",
  ])
    assert.ok(fs.existsSync(path.join(context.taskRoot!, name)), name);
  const marker = fs.readFileSync(path.join(context.taskRoot!, "foundry-job.json"));
  const output = path.join(context.workspaceRoot, String(result.cleaned_rows_file));
  const derived = createFoundryRuntime(
    createFoundryRuntimeContext({
      ...options,
      taskId: "task",
      actorId: "agent",
      inputs: [captureFoundryInput(output)],
    }),
  );
  const next = await derived.cleanup({
    input: output,
    type: "flow",
    outputDirectory: "outputs/second",
  });
  assert.equal(next.status, "completed");
  const secondOutput = path.join(context.workspaceRoot, String(next.cleaned_rows_file));
  const lineageContext = createFoundryRuntimeContext({
    ...options,
    taskId: "task",
    actorId: "agent",
    inputs: [
      captureFoundryInput(input),
      captureFoundryInput(output),
      captureFoundryInput(secondOutput),
    ],
  });
  const lineage = await assertFoundryTaskInputLineage(lineageContext, input, secondOutput);
  assert.equal(lineage.ancestor.path, fs.realpathSync(input));
  assert.equal(lineage.derived.path, secondOutput);
  const siblingResult = await createFoundryRuntime(lineageContext).cleanup({
    input,
    type: "flow",
    outputDirectory: "outputs/sibling",
  });
  const sibling = path.join(context.workspaceRoot, String(siblingResult.cleaned_rows_file));
  const unrelatedContext = createFoundryRuntimeContext({
    ...options,
    taskId: "task",
    actorId: "agent",
    inputs: [captureFoundryInput(sibling), captureFoundryInput(secondOutput)],
  });
  await assert.rejects(
    () => assertFoundryTaskInputLineage(unrelatedContext, sibling, secondOutput),
    hasCode("task_lineage_scope_mismatch"),
  );
  assert.deepEqual(fs.readFileSync(path.join(context.taskRoot!, "foundry-job.json")), marker);
  const unindexed = path.join(context.taskRoot!, "outputs/unindexed.jsonl");
  fs.writeFileSync(unindexed, '{"flowDataSet":{}}\n');
  const forged = createFoundryRuntime(
    createFoundryRuntimeContext({
      ...options,
      taskId: "task",
      actorId: "agent",
      inputs: [captureFoundryInput(unindexed)],
    }),
  );
  await assert.rejects(
    async () =>
      forged.cleanup({ input: unindexed, type: "flow", outputDirectory: "outputs/forged" }),
    hasCode("task_input_unrecognized"),
  );
});
