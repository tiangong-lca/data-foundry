import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test, { type TestContext } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  createFoundryRuntimeContext,
  captureFoundryInput,
  writeFoundryArtifact,
  type FoundryRuntimeContext,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { planFoundryWorkspaceMigration } from "../../scripts/lib/foundry-migration-plan.ts";
import { stageFoundryMigration } from "../../scripts/lib/foundry-migration-transfer.ts";
import {
  materializeMigrationTaskSpec,
  migrationTaskTemplate,
  planFoundryMigrationAdoption,
} from "../../scripts/lib/foundry-migration-adoption-plan.ts";
import { applyFoundryMigrationAdoption } from "../../scripts/lib/foundry-migration-adoption.ts";
import {
  createFoundryFacade,
  runFoundryPublicCommand,
  type FoundryOperationResult,
} from "../../scripts/public-api.ts";
import { workspaceManifestFixture } from "../helpers/foundry-runtime-manifest.mts";
import { assertFoundryMigrationNoReplay } from "../../scripts/lib/foundry-migration-replay.ts";
import { runFoundryTaskOperation } from "../../scripts/lib/foundry-task-store.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import {
  parseFoundryTaskStartSpec,
  taskStartSpecFingerprint,
} from "../../scripts/lib/foundry-task-start-spec.ts";

const moduleUrl = new URL("../../scripts/public-api.ts", import.meta.url).href;
function adoptionHost(options: Parameters<typeof createFoundryFacade>[0]) {
  return { createTaskFacade: () => createFoundryFacade(options) };
}
const json = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value) + "\n");
};
async function fixture(
  t: TestContext,
  laterHistory = false,
  nativeId?: string,
  withAccount = false,
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-adoption-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"),
    destination = path.join(root, "destination"),
    input = path.join(root, "flow.json");
  json(input, {
    flowDataSet: nativeId
      ? {
          flowInformation: { dataSetInformation: { "common:UUID": nativeId } },
          administrativeInformation: {
            publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
          },
        }
      : {},
  });
  const file = captureFoundryInput(input);
  const task = path.join(source, ".foundry/workspaces/local");
  json(path.join(task, "foundry-job.json"), {
    schema_version: 1,
    task_id: "local",
    workspace_dir: ".foundry/workspaces/local",
    lane: "external-dataset-curated-import",
    target_profile: "generic",
    target_entities: ["flow"],
    write_policy: { mode: "dry-run" },
  });
  json(path.join(task, "source-manifest.json"), {
    schema_version: 1,
    source_kind: "selected-local-files",
    source_paths: [{ path: file.path, sha256: file.sha256, access: "local-private" }],
  });
  json(path.join(task, "profile-lock.json"), {
    schema_version: 1,
    profile_id: "generic",
    old_policy: "retained-only",
  });
  if (laterHistory)
    json(path.join(task, "attempts/later.json"), { state: "UNKNOWN_DO_NOT_REPLAY" });
  const spec = path.join(root, "task.json");
  const accountIntent = withAccount
    ? { projectRef: "a".repeat(20), userId: "00000000-0000-4000-8000-000000000001" }
    : undefined;
  json(spec, {
    schema: "tiangong-foundry.task-start.v1",
    request_id: "adopt-local",
    actor_id: "actor",
    lane: "external-dataset-curated-import",
    profile_id: "generic",
    target_entities: ["flow"],
    sources: [{ path: file.path }],
    seed: null,
    account_intent: accountIntent
      ? {
          project_ref: accountIntent.projectRef,
          user_id: accountIntent.userId,
          session_reference: null,
        }
      : null,
    preparation: {
      operation: "dataset-curation-cleanup",
      type: "flow",
      input: file.path,
      source_input: null,
      output_directory: "outputs/cleanup",
    },
  });
  const manifest = workspaceManifestFixture({
    schemas: ["tiangong-foundry.workspace.v1", "tiangong-foundry.workspace.v2"],
    write: ["migration-adoption-v1", "registered-tasks-v2"],
  });
  const options = {
    moduleUrl,
    workspace: destination,
    cacheBase: path.join(root, "cache"),
    workspaceAccess: { manifest, access: "write" as const },
    accountIntent,
  };
  const context = createFoundryRuntimeContext(options),
    planning = {
      sourceWorkspace: source,
      actorId: "actor",
      requestId: "migration",
      externalInputs: [file.path],
    };
  const plan = planFoundryWorkspaceMigration(context, planning);
  await stageFoundryMigration(context, planning, plan);
  return {
    root,
    source,
    destination,
    input,
    task,
    spec,
    manifest,
    options,
    host: adoptionHost(options),
    context: createFoundryRuntimeContext(options),
    planning,
    plan,
    selections: [{ sourceTask: "workspaces/local", specFile: spec }],
  };
}

test("adoption binds a current local preparation spec to archived inputs and a new task identity", async (t) => {
  const f = await fixture(t);
  const before = fs.readFileSync(path.join(f.task, "foundry-job.json"));
  const plan = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  const row = plan.tasks[0];
  assert.equal(row.authority.disposition, "local-unattempted", JSON.stringify(row.reasons));
  assert.match(String(row.authority.task_id), /^task-[0-9a-f]{64}-r0001$/u);
  assert.notEqual(row.authority.task_id, "local");
  assert.ok(row.target_spec!.sources[0].path.startsWith(f.context.workspaceRoot + path.sep));
  assert.equal(row.inputs[0].sha256, captureFoundryInput(f.input).sha256);
  assert.deepEqual(
    await planFoundryMigrationAdoption(f.context, f.planning, f.plan, f.selections, f.manifest),
    plan,
  );
  assert.deepEqual(fs.readFileSync(path.join(f.task, "foundry-job.json")), before);
  assert.equal(fs.existsSync(path.join(f.destination, ".foundry/workspaces")), false);
});

test("adoption compares account identity independently of the optional session reference", async (t) => {
  const f = await fixture(t, false, undefined, true);
  const adoption = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  assert.equal(
    adoption.tasks[0].authority.disposition,
    "local-unattempted",
    JSON.stringify(adoption.tasks[0].reasons),
  );
  const preview = await createFoundryFacade({
    ...f.options,
    workspace: f.source,
  }).migrationAdoption({
    destination: f.destination,
    actorId: "actor",
    requestId: "migration",
    externalInputs: [f.input],
    plan: f.plan,
    tasks: f.selections,
  });
  assert.equal(preview.status, "ready", JSON.stringify(preview.blockers));
  assert.equal(JSON.stringify(preview).includes('"session_reference"'), false);
  await applyFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    adoption,
    f.manifest,
    f.host,
  );
  const source = JSON.parse(fs.readFileSync(f.spec, "utf8"));
  source.account_intent.user_id = "00000000-0000-4000-8000-000000000002";
  json(f.spec, source);
  const g = await fixture(t, false, undefined, true);
  const other = JSON.parse(fs.readFileSync(g.spec, "utf8"));
  other.account_intent.user_id = source.account_intent.user_id;
  json(g.spec, other);
  const rejected = await planFoundryMigrationAdoption(
    g.context,
    g.planning,
    g.plan,
    g.selections,
    g.manifest,
  );
  assert.equal(rejected.tasks[0].authority.disposition, "blocked-evidence");
  assert.deepEqual(rejected.tasks[0].reasons, ["migration_account_mismatch"]);
});

test("later attempt evidence prevents local adoption regardless of a fresh request", async (t) => {
  const f = await fixture(t, true);
  const plan = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  assert.equal(plan.tasks[0].authority.disposition, "owner-readback-only");
  assert.equal(plan.tasks[0].authority.task_id, null);
  assert.equal(plan.tasks[0].target_spec, null);
});

test("a selected current spec cannot change the retained source scope or actor", async (t) => {
  const f = await fixture(t);
  const value = JSON.parse(fs.readFileSync(f.spec, "utf8"));
  value.actor_id = "other";
  json(f.spec, value);
  const plan = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  assert.equal(plan.tasks[0].authority.disposition, "blocked-evidence");
  assert.equal(plan.tasks[0].authority.task_id, null);
});

test("application rebuilds through current task owners before activating an audited workspace", async (t) => {
  const f = await fixture(t);
  const original = fs.readFileSync(path.join(f.task, "foundry-job.json"));
  const adoption = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  const applied = await applyFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    adoption,
    f.manifest,
    f.host,
  );
  const current = createFoundryRuntimeContext(f.options);
  assert.equal(current.workspaceId, adoption.workspace_id);
  assert.equal(current.workspaceSchema, "tiangong-foundry.workspace.v2");
  assert.equal(current.pendingMigration, null);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const [name, value] of [
    ["foundry-migration-adoption-plan", adoption],
    ["foundry-migration-activation", applied.activation],
    [
      "foundry-workspace-v2",
      JSON.parse(fs.readFileSync(path.join(current.controlRoot, "workspace.json"), "utf8")),
    ],
  ] as const) {
    const validate = ajv.compile(
      JSON.parse(
        fs.readFileSync(
          new URL(`../../specs/schemas/${name}.schema.json`, import.meta.url),
          "utf8",
        ),
      ),
    );
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...value, unexpected: true }), false);
  }
  const taskId = String(applied.activation.tasks[0].task_id);
  const facade = createFoundryFacade(f.options);
  const status = await facade.status({ taskId, actorId: "actor" });
  assert.equal(status.status, "ready", JSON.stringify(status.blockers));
  const outputs = fs.readdirSync(
    path.join(current.controlRoot, "workspaces", taskId, "outputs/cleanup"),
  );
  assert.ok(outputs.some((name) => name.endsWith(".cleaned.jsonl")));
  assert.deepEqual(fs.readFileSync(path.join(f.task, "foundry-job.json")), original);
  assert.deepEqual(
    await applyFoundryMigrationAdoption(
      current,
      f.planning,
      f.plan,
      f.selections,
      adoption,
      f.manifest,
      f.host,
    ),
    applied,
  );
  assert.throws(
    () => createFoundryRuntimeContext({ ...f.options, workspaceAccess: undefined }),
    /trusted read\/write/u,
  );
});

test("interruption leaves the marker pending and resumes the same mapped preparation", async (t) => {
  for (const phase of ["mapped", "prepared", "audited"] as const) {
    const f = await fixture(t);
    const adoption = await planFoundryMigrationAdoption(
      f.context,
      f.planning,
      f.plan,
      f.selections,
      f.manifest,
    );
    await assert.rejects(
      applyFoundryMigrationAdoption(
        f.context,
        f.planning,
        f.plan,
        f.selections,
        adoption,
        f.manifest,
        f.host,
        {
          checkpoint: (current) => {
            if (current === phase) throw new Error("injected interruption");
          },
        },
      ),
      /injected interruption/u,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(f.destination, ".foundry/workspace.json"), "utf8"))
        .schema,
      "tiangong-foundry.workspace-migration-pending.v1",
    );
    const applied = await applyFoundryMigrationAdoption(
      createFoundryRuntimeContext(f.options),
      f.planning,
      f.plan,
      f.selections,
      adoption,
      f.manifest,
      f.host,
    );
    assert.equal(applied.activation.tasks[0].task_id, adoption.tasks[0].authority.task_id);
    assert.equal(fs.readdirSync(path.join(f.destination, ".foundry/workspaces")).length, 1);
  }
});

test("public CLI previews, applies and audits adoption only through a trusted host", async (t) => {
  const f = await fixture(t);
  const transferFile = path.join(f.root, "transfer.json"),
    adoptionFile = path.join(f.root, "adoption.json");
  json(transferFile, f.plan);
  const prefix = [
    process.execPath,
    "tiangong-foundry",
    "workspace",
    "migrate",
    "--workspace",
    f.source,
    "--to",
    f.destination,
    "--actor",
    "actor",
    "--request",
    "migration",
    "--input",
    f.input,
    "--plan",
    transferFile,
  ];
  const run = async (args: string[], trusted = true) => {
    let output = "",
      exit: number | undefined;
    await runFoundryPublicCommand([...prefix, ...args, "--json"], {
      cacheBase: f.options.cacheBase,
      ...(trusted ? { workspaceAccess: f.options.workspaceAccess } : {}),
      writeStdout: (value) => {
        output += value;
      },
      setExitCode: (value) => {
        exit = value;
      },
    });
    return { result: JSON.parse(output) as FoundryOperationResult, exit };
  };
  const selection = ["--task-spec", `workspaces/local=${f.spec}`];
  const rejected = await run(["--adoption-dry-run", ...selection], false);
  assert.equal(rejected.result.status, "blocked");
  const preview = await run(["--adoption-dry-run", ...selection]);
  assert.equal(preview.exit, 0, JSON.stringify(preview.result.blockers));
  const artifact = preview.result.artifacts[0];
  assert.equal(artifact.kind, "inline");
  json(adoptionFile, artifact.kind === "inline" ? artifact.value : null);
  const applied = await run(["--apply", "--adoption-plan", adoptionFile, ...selection]);
  assert.equal(applied.exit, 0, JSON.stringify(applied.result.blockers));
  assert.equal(applied.result.artifacts[0].role, "migration_activation_receipt");
  const audited = await run(["--audit"]);
  assert.equal(audited.exit, 0, JSON.stringify(audited.result.blockers));
  assert.deepEqual(audited.result.artifacts, applied.result.artifacts);
});

test("retained attempts block matching datasets across a new request and changed path without blocking independent data", async (t) => {
  const f = await fixture(t, true, "11111111-1111-4111-8111-111111111111");
  const adoption = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  assert.equal(adoption.tasks[0].authority.scope_complete, true);
  await applyFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    adoption,
    f.manifest,
    f.host,
  );
  const moved = path.join(f.root, "moved.json");
  fs.writeFileSync(moved, fs.readFileSync(f.input, "utf8") + "\n");
  const makeTask = async (file: string, request: string) => {
    const value = JSON.parse(fs.readFileSync(f.spec, "utf8"));
    value.request_id = request;
    value.sources = [{ path: file }];
    value.preparation = null;
    const specFile = path.join(f.root, `${request}.json`);
    json(specFile, value);
    const started = await createFoundryFacade(f.options).start({ specFile });
    assert.equal(started.status, "ready", JSON.stringify(started.blockers));
    return createFoundryRuntimeContext({
      ...f.options,
      taskId: String(started.task_id),
      actorId: "actor",
      inputs: [captureFoundryInput(file)],
    });
  };
  const replay = await makeTask(moved, "different-request");
  assert.throws(
    () => assertFoundryMigrationNoReplay(replay, moved),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "migration_replay_forbidden",
  );
  const independent = path.join(f.root, "independent.json");
  const value = JSON.parse(fs.readFileSync(f.input, "utf8"));
  value.flowDataSet.flowInformation.dataSetInformation["common:UUID"] =
    "22222222-2222-4222-8222-222222222222";
  json(independent, value);
  const fresh = await makeTask(independent, "independent-request");
  assert.doesNotThrow(() => assertFoundryMigrationNoReplay(fresh, independent));
});

test("a pending context cannot escape its adoption callback or regain write authority after activation", async (t) => {
  const f = await fixture(t);
  const adoption = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  let escaped: FoundryRuntimeContext | undefined;
  await applyFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    adoption,
    f.manifest,
    f.host,
    {
      checkpoint: (phase) => {
        if (phase === "prepared")
          escaped = createFoundryRuntimeContext({
            ...f.options,
            taskId: adoption.tasks[0].authority.task_id!,
            actorId: "actor",
            inputs: adoption.tasks[0].inputs,
          });
      },
    },
  );
  assert.ok(escaped);
  const retained = escaped;
  assert.throws(
    () => writeFoundryArtifact(retained, "outputs/escaped.json", "{}"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "migration_session_closed",
  );
  assert.equal(fs.existsSync(path.join(escaped.taskRoot!, "outputs/escaped.json")), false);
});

test("read-compatible selection preserves future marker data and an unqualified writer cannot downgrade it", async (t) => {
  const f = await fixture(t);
  const adoption = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  await applyFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    adoption,
    f.manifest,
    f.host,
  );
  const markerFile = path.join(f.destination, ".foundry/workspace.json");
  const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
  marker.required_features.push("future-state-v1");
  marker.extensions = { future: { retained: [1, 2, 3] } };
  json(markerFile, marker);
  const before = fs.readFileSync(markerFile);
  const manifest = workspaceManifestFixture({
    schema: "tiangong-foundry.workspace.v2",
    version: "0.0.9",
    read: marker.required_features,
  });
  const reader = createFoundryFacade({
    ...f.options,
    workspaceAccess: { manifest, access: "read" },
  });
  assert.equal(reader.doctor().status, "ready");
  assert.equal(reader.initialize().status, "blocked");
  const writer = createFoundryFacade({
    ...f.options,
    workspaceAccess: {
      manifest: workspaceManifestFixture({
        schema: "tiangong-foundry.workspace.v2",
        read: marker.required_features,
        write: marker.required_features,
      }),
      access: "write",
    },
  });
  assert.equal(writer.initialize().blockers[0]?.code, "workspace_feature_unsupported");
  assert.deepEqual(fs.readFileSync(markerFile), before);
});

test("a subsequent workspace migration retains origin identity and any later attempt", async (t) => {
  for (const attempted of [false, true]) {
    const f = await fixture(t, false, "11111111-1111-4111-8111-111111111111");
    const first = await planFoundryMigrationAdoption(
      f.context,
      f.planning,
      f.plan,
      f.selections,
      f.manifest,
    );
    await applyFoundryMigrationAdoption(
      f.context,
      f.planning,
      f.plan,
      f.selections,
      first,
      f.manifest,
      f.host,
    );
    const current = createFoundryRuntimeContext(f.options);
    const firstId = first.tasks[0].authority.task_id!;
    if (attempted)
      json(path.join(current.controlRoot, "workspaces", firstId, "attempts/later.json"), {
        state: "UNKNOWN_DO_NOT_REPLAY",
      });
    const nextSpec = path.join(f.root, "next-spec.json");
    json(nextSpec, {
      ...materializeMigrationTaskSpec(first.tasks[0].target_spec!),
      request_id: "next-migration",
    });
    const options = { ...f.options, workspace: path.join(f.root, "next-workspace") };
    const context = createFoundryRuntimeContext(options);
    const planning = {
      sourceWorkspace: current.workspaceRoot,
      actorId: "actor",
      requestId: "second-migration",
      externalInputs: [],
    };
    const transfer = planFoundryWorkspaceMigration(context, planning);
    assert.deepEqual(transfer.blockers, []);
    await stageFoundryMigration(context, planning, transfer);
    const selections = [{ sourceTask: `workspaces/${firstId}`, specFile: nextSpec }];
    const second = await planFoundryMigrationAdoption(
      createFoundryRuntimeContext(options),
      planning,
      transfer,
      selections,
      f.manifest,
    );
    const row = second.tasks.find(
      (item) => item.authority.origin_sha256 === first.tasks[0].authority.origin_sha256,
    )!;
    assert.ok(row);
    assert.equal(
      row.authority.disposition,
      attempted ? "owner-readback-only" : "local-unattempted",
      JSON.stringify(row.reasons),
    );
    await applyFoundryMigrationAdoption(
      createFoundryRuntimeContext(options),
      planning,
      transfer,
      selections,
      second,
      f.manifest,
      adoptionHost(options),
    );
    if (attempted) {
      const view = createFoundryRuntimeContext({
        ...options,
        inputs: [captureFoundryInput(f.input)],
      });
      assert.throws(
        () => assertFoundryMigrationNoReplay(view, f.input),
        (error: unknown) =>
          error instanceof Error && "code" in error && error.code === "migration_replay_forbidden",
      );
      assert.equal(row.authority.task_id, null);
    }
  }
});

test("indexed historical completion is retained without registering another executable task", async (t) => {
  const f = await fixture(t, false, "11111111-1111-4111-8111-111111111111");
  const first = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  await applyFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    first,
    f.manifest,
    f.host,
  );
  const id = first.tasks[0].authority.task_id!;
  const sourceContext = createFoundryRuntimeContext({
    ...f.options,
    taskId: id,
    actorId: "actor",
    inputs: first.tasks[0].inputs,
  });
  // Synthetic historical completion uses the real immutable local receipt/index format.
  await runFoundryTaskOperation(
    sourceContext,
    { command: "dataset-curation-cleanup", options: { synthetic_historical_completion: true } },
    (operation) => {
      const value = { status: "completed", task_id: id, blockers: [] };
      operation.writeJson(
        path.join(
          sourceContext.taskRoot!,
          "outputs/completion/dataset-import-completion-report.json",
        ),
        value,
      );
      return value;
    },
  );
  const options = { ...f.options, workspace: path.join(f.root, "terminal-workspace") };
  const nextSpec = path.join(f.root, "terminal-spec.json");
  json(nextSpec, {
    ...materializeMigrationTaskSpec(first.tasks[0].target_spec!),
    request_id: "terminal-reimport",
  });
  const context = createFoundryRuntimeContext(options),
    planning = {
      sourceWorkspace: sourceContext.workspaceRoot,
      actorId: "actor",
      requestId: "terminal-migration",
      externalInputs: [],
    };
  const transfer = planFoundryWorkspaceMigration(context, planning);
  await stageFoundryMigration(context, planning, transfer);
  const selections = [{ sourceTask: `workspaces/${id}`, specFile: nextSpec }];
  const adoption = await planFoundryMigrationAdoption(
    createFoundryRuntimeContext(options),
    planning,
    transfer,
    selections,
    f.manifest,
  );
  assert.equal(
    adoption.tasks[0].authority.disposition,
    "terminal-retained",
    JSON.stringify(adoption.tasks[0].reasons),
  );
  assert.equal(adoption.tasks[0].authority.task_id, null);
  await applyFoundryMigrationAdoption(
    createFoundryRuntimeContext(options),
    planning,
    transfer,
    selections,
    adoption,
    f.manifest,
    adoptionHost(options),
  );
  const current = createFoundryRuntimeContext({
    ...options,
    inputs: [captureFoundryInput(f.input)],
  });
  assert.equal(fs.existsSync(path.join(current.controlRoot, "workspaces")), false);
  assert.throws(
    () => assertFoundryMigrationNoReplay(current, f.input),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "migration_replay_forbidden",
  );
});

test("later local revisions preserve the anchored adoption and their attempts still block new requests", async (t) => {
  const f = await fixture(t, false, "11111111-1111-4111-8111-111111111111");
  const adoption = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  await applyFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    adoption,
    f.manifest,
    f.host,
  );
  const revised = {
    ...materializeMigrationTaskSpec(adoption.tasks[0].target_spec!),
    sources: [{ path: f.input }],
    preparation: null,
  };
  const file = path.join(f.root, "revision.json");
  json(file, revised);
  const facade = createFoundryFacade(f.options);
  const next = await facade.start({ specFile: file });
  assert.equal(next.status, "ready", JSON.stringify(next.blockers));
  assert.match(String(next.task_id), /-r0002$/u);
  const current = createFoundryRuntimeContext({
    ...f.options,
    inputs: [captureFoundryInput(f.input)],
  });
  assert.doesNotThrow(() => assertFoundryMigrationNoReplay(current, f.input));
  json(
    path.join(current.controlRoot, "workspaces", String(next.task_id), "attempts/unknown.json"),
    { state: "UNKNOWN_DO_NOT_REPLAY" },
  );
  assert.throws(
    () => assertFoundryMigrationNoReplay(current, f.input),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "migration_readback_required",
  );
  const audit = await createFoundryFacade({ ...f.options, workspace: f.source }).migrationTransfer({
    destination: f.destination,
    actorId: "actor",
    requestId: "migration",
    externalInputs: [f.input],
    plan: f.plan,
    audit: true,
  });
  assert.equal(audit.status, "ready", JSON.stringify(audit.blockers));
});

test("an explicit session reference cannot alias a workspace marker or activation document", async (t) => {
  const f = await fixture(t);
  const adoption = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  const applied = await applyFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    adoption,
    f.manifest,
    f.host,
  );
  for (const sessionReference of [
    path.join(f.destination, ".foundry/workspace.json"),
    applied.path,
  ]) {
    assert.throws(
      () =>
        createFoundryRuntimeContext({
          ...f.options,
          accountIntent: {
            projectRef: "a".repeat(20),
            userId: "00000000-0000-4000-8000-000000000001",
            sessionReference,
          },
        }),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "credential_input_forbidden",
    );
  }
});

test("a schema-valid recomputed adoption cannot relabel an attempt as local preparation", async (t) => {
  const f = await fixture(t, true, "11111111-1111-4111-8111-111111111111");
  const adoption = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  const forged = structuredClone(adoption);
  const file = path.join(f.context.controlRoot, forged.tasks[0].scope_inputs[0]);
  const input = captureFoundryInput(file);
  const original = JSON.parse(fs.readFileSync(f.spec, "utf8"));
  const spec = parseFoundryTaskStartSpec({
    ...original,
    sources: [{ path: input.path }],
    preparation: { ...original.preparation, input: input.path },
  });
  const row = {
    ...forged.tasks[0],
    source_spec: captureFoundryInput(f.spec),
    target_spec: migrationTaskTemplate(spec),
    inputs: [input],
    reasons: ["current_owner_rebuild_required"],
    authority: {
      ...forged.tasks[0].authority,
      disposition: "local-unattempted" as const,
      request_id: spec.request_id,
      task_id: `task-${sha256Json({ workspace_id: forged.workspace_id, request_id: spec.request_id })}-r0001`,
      spec_fingerprint_sha256: taskStartSpecFingerprint(spec, [input]),
    },
  };
  const body = { ...forged, tasks: [row] };
  const { adoption_sha256: oldDigest, ...unsigned } = body;
  assert.ok(oldDigest);
  const changed = { ...unsigned, adoption_sha256: sha256Json(unsigned) };
  const validate = new Ajv2020({ strict: true }).compile(
    JSON.parse(
      fs.readFileSync(
        new URL("../../specs/schemas/foundry-migration-adoption-plan.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  assert.equal(validate(changed), true, JSON.stringify(validate.errors));
  await assert.rejects(
    applyFoundryMigrationAdoption(
      f.context,
      f.planning,
      f.plan,
      f.selections,
      changed,
      f.manifest,
      f.host,
    ),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "migration_adoption_changed",
  );
  assert.equal(fs.existsSync(path.join(f.context.controlRoot, "workspaces")), false);
  assert.equal(
    fs.existsSync(
      path.join(f.context.controlRoot, "migrations", f.plan.plan_sha256, "adoption.json"),
    ),
    false,
  );
});

test("a killed adoption process resumes its published local task without activating partial state", async (t) => {
  const f = await fixture(t);
  const adoption = await planFoundryMigrationAdoption(
    f.context,
    f.planning,
    f.plan,
    f.selections,
    f.manifest,
  );
  const configuration = path.join(f.root, "child-input.json"),
    ready = path.join(f.root, "prepared.flag"),
    script = path.join(f.root, "adopt-child.mjs");
  json(configuration, {
    workspace: f.options.workspace,
    cacheBase: f.options.cacheBase,
    planning: f.planning,
    transfer: f.plan,
    selections: f.selections,
    adoption,
    ready,
  });
  fs.writeFileSync(
    script,
    `import fs from 'node:fs';
import {createFoundryFacade} from ${JSON.stringify(moduleUrl)};
import {createFoundryRuntimeContext} from ${JSON.stringify(new URL("../../scripts/lib/foundry-runtime-context.ts", import.meta.url).href)};
import {applyFoundryMigrationAdoption} from ${JSON.stringify(new URL("../../scripts/lib/foundry-migration-adoption.ts", import.meta.url).href)};
import {workspaceManifestFixture} from ${JSON.stringify(new URL("../helpers/foundry-runtime-manifest.mts", import.meta.url).href)};
const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const manifest=workspaceManifestFixture({schemas:['tiangong-foundry.workspace.v1','tiangong-foundry.workspace.v2'],write:['migration-adoption-v1','registered-tasks-v2']});
const options={moduleUrl:${JSON.stringify(moduleUrl)},workspace:data.workspace,cacheBase:data.cacheBase,workspaceAccess:{manifest,access:'write'}};
await applyFoundryMigrationAdoption(createFoundryRuntimeContext(options),data.planning,data.transfer,data.selections,data.adoption,manifest,{createTaskFacade:()=>createFoundryFacade(options)},{checkpoint:phase=>{if(phase==='prepared'){fs.writeFileSync(data.ready,'ready',{flag:'wx'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20000);}}});
`,
    { flag: "wx" },
  );
  const child = spawn(process.execPath, [script, configuration], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  });
  const deadline = Date.now() + 15_000;
  while (
    !fs.existsSync(ready) &&
    Date.now() < deadline &&
    child.exitCode === null &&
    child.signalCode === null
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fs.existsSync(ready), true, stderr);
  child.kill("SIGKILL");
  await exited;
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.destination, ".foundry/workspace.json"), "utf8")).schema,
    "tiangong-foundry.workspace-migration-pending.v1",
  );
  const applied = await applyFoundryMigrationAdoption(
    createFoundryRuntimeContext(f.options),
    f.planning,
    f.plan,
    f.selections,
    adoption,
    f.manifest,
    f.host,
  );
  assert.equal(applied.activation.tasks[0].task_id, adoption.tasks[0].authority.task_id);
  assert.equal(fs.readdirSync(path.join(f.destination, ".foundry/workspaces")).length, 1);
});
