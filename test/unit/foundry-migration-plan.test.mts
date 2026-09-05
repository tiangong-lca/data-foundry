import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import {
  createFoundryRuntimeContext,
  FoundryContextError,
} from "../../scripts/lib/foundry-runtime-context.ts";
import {
  planFoundryWorkspaceMigration,
  revalidateFoundryMigrationPlan,
} from "../../scripts/lib/foundry-migration-plan.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { modelExecutionAttemptDisposition } from "../../scripts/lib/foundry-execution-attempt.ts";
import { modelExecutionAttemptDisposition as originalOwner } from "../../scripts/commands/execution-capsule.ts";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-plan-unit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  fs.mkdirSync(path.join(source, ".foundry", "stages"), { recursive: true });
  const options = {
    sourceWorkspace: source,
    actorId: "actor/one",
    requestId: "migration-one",
    stageManifests: ["stages/one.json"],
  };
  const contextOptions = {
    moduleUrl: pathToFileURL(path.resolve(import.meta.dirname, "../../scripts/public-api.ts")).href,
    workspace: path.join(root, "destination"),
    cacheBase: path.join(root, "cache"),
  };
  const manifest = {
    schema_version: "foundry-execution-capsule-stage.v1",
    stage_id: "stage-one",
    producer_id: "producer-one",
    revision: 1,
    scope_binding_sha256: "a".repeat(64),
    attempt_state: {
      status: "UNATTEMPTED",
      attempt_count: 0,
      primary_attempt_count: 0,
      dispatch_state: "NOT_DISPATCHED",
      mutation_state: "NONE",
      readback_state: "NOT_STARTED",
    },
  };
  const file = path.join(source, ".foundry", "stages", "one.json");
  const write = () => fs.writeFileSync(file, JSON.stringify(manifest));
  write();
  return {
    root,
    source,
    file,
    manifest,
    write,
    options,
    contextOptions,
    context: createFoundryRuntimeContext(contextOptions),
  };
}

function code(expected: string) {
  return (error: unknown) => error instanceof FoundryContextError && error.code === expected;
}

test("migration preserves the owning attempt classifier and never infers write authority", (t) => {
  assert.equal(modelExecutionAttemptDisposition, originalOwner);
  const f = fixture(t);
  const cases = [
    ["NOT_DISPATCHED", "NOT_STARTED", 0, "UNATTEMPTED", "rebuild-local-preparation"],
    ["DISPATCH_CONFIRMED", "EXACT_DESIRED", 1, "SUCCEEDED_EXACT_READBACK", "retain-terminal"],
    [
      "DISPATCH_UNKNOWN",
      "EXACT_DESIRED",
      1,
      "SUCCEEDED_RECOVERED_EXACT_READBACK",
      "retain-terminal",
    ],
    ["DISPATCH_UNKNOWN", "MISSING", 1, "UNKNOWN_DO_NOT_REPLAY", "owner-readback-only"],
    ["NOT_DISPATCHED", "NOT_STARTED", 1, "UNKNOWN_DO_NOT_REPLAY", "owner-readback-only"],
    ["DISPATCH_CONFIRMED", "EXACT_DESIRED", 0, "UNKNOWN_DO_NOT_REPLAY", "owner-readback-only"],
    ["UNRECOGNIZED", "EXACT_DESIRED", 1, "UNKNOWN_DO_NOT_REPLAY", "owner-readback-only"],
  ] as const;
  for (const [dispatch, readback, attempts, disposition, action] of cases) {
    Object.assign(f.manifest.attempt_state, {
      dispatch_state: dispatch,
      readback_state: readback,
      attempt_count: attempts,
      primary_attempt_count: attempts,
      status: attempts ? "ATTEMPTED" : "UNATTEMPTED",
    });
    f.write();
    const plan = planFoundryWorkspaceMigration(f.context, f.options);
    assert.equal(plan.stages[0].disposition, disposition);
    assert.equal(plan.stages[0].migration_action, action);
    assert.equal(plan.stages[0].grants_write_authority, false);
    assert.equal(plan.remote_write_allowed, false);
    assert.equal(fs.existsSync(f.context.workspaceRoot), false);
  }
});

test("migration plan reconstruction rejects recomputed tampering, source drift and independent actor/account/runtime mismatch", (t) => {
  const f = fixture(t);
  const original = planFoundryWorkspaceMigration(f.context, f.options);
  assert.equal(Object.isFrozen(original.source_inventory.entries), true);
  assert.equal(Object.isFrozen(original.stages[0]), true);
  assert.deepEqual(
    revalidateFoundryMigrationPlan(f.context, f.options, JSON.parse(JSON.stringify(original))),
    original,
  );
  const payload = { ...original, actor_id: "forged-actor" };
  const { plan_sha256: _ignored, ...unsigned } = payload;
  payload.plan_sha256 = sha256Json(unsigned);
  assert.throws(
    () => revalidateFoundryMigrationPlan(f.context, f.options, payload),
    code("migration_plan_changed"),
  );
  assert.throws(
    () =>
      revalidateFoundryMigrationPlan(f.context, { ...f.options, actorId: "actor/two" }, original),
    code("migration_plan_changed"),
  );
  const account = createFoundryRuntimeContext({
    ...f.contextOptions,
    accountIntent: { projectRef: "a".repeat(20), userId: "00000000-0000-4000-8000-000000000001" },
  });
  assert.throws(
    () => revalidateFoundryMigrationPlan(account, f.options, original),
    code("migration_plan_changed"),
  );
  assert.throws(
    () =>
      revalidateFoundryMigrationPlan(f.context, f.options, {
        ...original,
        runtime: { ...original.runtime, entry_sha256: "0".repeat(64) },
      }),
    code("migration_plan_changed"),
  );
  f.manifest.revision = 2;
  f.write();
  assert.throws(
    () => revalidateFoundryMigrationPlan(f.context, f.options, original),
    code("migration_plan_changed"),
  );
});

test("migration requires disjoint roots and refuses existing destination state before planning", (t) => {
  const f = fixture(t);
  for (const destination of [f.source, path.join(f.source, "child"), f.root]) {
    const context = createFoundryRuntimeContext({
      ...f.contextOptions,
      workspace: destination,
      cacheBase: path.join(os.tmpdir(), "migration-external-cache"),
    });
    assert.throws(
      () => planFoundryWorkspaceMigration(context, f.options),
      code("migration_roots_overlap"),
    );
  }
  fs.mkdirSync(f.context.controlRoot, { recursive: true });
  fs.writeFileSync(path.join(f.context.controlRoot, "keep.txt"), "existing");
  assert.throws(
    () => planFoundryWorkspaceMigration(f.context, f.options),
    code("migration_destination_exists"),
  );
  assert.equal(fs.readFileSync(path.join(f.context.controlRoot, "keep.txt"), "utf8"), "existing");
});

test("migration stage selection rejects traversal, absolute paths, duplicates and private files", (t) => {
  const f = fixture(t);
  for (const selected of ["../escape.json", "stages/../one.json", "stages\\..\\one.json", f.file])
    assert.throws(
      () => planFoundryWorkspaceMigration(f.context, { ...f.options, stageManifests: [selected] }),
      code("migration_path_invalid"),
    );
  assert.throws(
    () =>
      planFoundryWorkspaceMigration(f.context, {
        ...f.options,
        stageManifests: [...f.options.stageManifests, ...f.options.stageManifests],
      }),
    code("migration_evidence_invalid"),
  );
  fs.writeFileSync(path.join(f.source, ".foundry", "session.json"), "private fixture");
  const plan = planFoundryWorkspaceMigration(f.context, f.options);
  assert.ok(plan.omitted_private_paths.includes("session.json"));
  assert.throws(
    () =>
      planFoundryWorkspaceMigration(f.context, { ...f.options, stageManifests: ["session.json"] }),
    code("migration_credential_forbidden"),
  );
  assert.equal(fs.existsSync(f.context.workspaceRoot), false);
});

test("migration stage selectors accept both separators and reject canonical duplicates", (t) => {
  const f = fixture(t);
  assert.deepEqual(
    planFoundryWorkspaceMigration(f.context, {
      ...f.options,
      stageManifests: ["stages\\one.json"],
    }),
    planFoundryWorkspaceMigration(f.context, f.options),
  );
  assert.throws(
    () =>
      planFoundryWorkspaceMigration(f.context, {
        ...f.options,
        stageManifests: ["stages/one.json", "stages\\one.json"],
      }),
    code("migration_evidence_invalid"),
  );
});

test("an explicitly selected private session is excluded even under an opaque filename", (t) => {
  const f = fixture(t);
  const selected = path.join(f.source, ".foundry", "opaque.store");
  fs.writeFileSync(selected, "synthetic private storage");
  const context = createFoundryRuntimeContext({
    ...f.contextOptions,
    accountIntent: {
      projectRef: "a".repeat(20),
      userId: "00000000-0000-4000-8000-000000000001",
      sessionReference: selected,
    },
  });
  const plan = planFoundryWorkspaceMigration(context, f.options);
  assert.ok(plan.omitted_private_paths.includes("opaque.store"));
  assert.equal(
    plan.source_inventory.entries.find((item) => item.path === "opaque.store")?.sha256,
    null,
  );
  assert.deepEqual(plan.blockers, []);
});

test("migration inventory and explicit evidence reject symlinks and malformed stage JSON", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.file, "{");
  assert.throws(
    () => planFoundryWorkspaceMigration(f.context, f.options),
    code("migration_document_invalid"),
  );
  f.write();
  const target = path.join(f.root, "other");
  fs.mkdirSync(target);
  fs.symlinkSync(
    target,
    path.join(f.source, ".foundry", "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => planFoundryWorkspaceMigration(f.context, f.options),
    code("migration_symlink_unsupported"),
  );
});

test("serialized migration plans cannot invoke accessors or hide unknown non-JSON fields", (t) => {
  const f = fixture(t);
  const original = planFoundryWorkspaceMigration(f.context, f.options);
  const injected = { ...original };
  Object.defineProperty(injected, "actor_id", {
    enumerable: true,
    get: () => {
      throw new Error("accessor_executed");
    },
  });
  assert.throws(
    () => revalidateFoundryMigrationPlan(f.context, f.options, injected),
    code("migration_document_invalid"),
  );
  assert.throws(
    () => revalidateFoundryMigrationPlan(f.context, f.options, { ...original, hidden: undefined }),
    code("migration_document_invalid"),
  );
  assert.throws(
    () =>
      revalidateFoundryMigrationPlan(f.context, f.options, { ...original, toJSON: () => original }),
    code("migration_document_invalid"),
  );
  assert.throws(
    () => revalidateFoundryMigrationPlan({ ...f.context }, f.options, original),
    code("runtime_context_unverified"),
  );
});

test("migration revalidation observes runtime files again instead of trusting a stale context", (t) => {
  const f = fixture(t);
  const runtime = path.join(f.root, "runtime");
  fs.mkdirSync(path.join(runtime, "scripts"), { recursive: true });
  const entry = path.join(runtime, "scripts/foundry.ts");
  fs.writeFileSync(entry, "export const fixture = 1;\n");
  fs.writeFileSync(
    path.join(runtime, "package.json"),
    JSON.stringify({
      name: "@tiangong-lca/foundry",
      version: "0.1.0",
      foundryRuntime: {
        schema: "tiangong-foundry.runtime-layout.v1",
        asset_root: ".",
        source_entry: "scripts/foundry.ts",
        emitted_entry: "dist/scripts/foundry.js",
      },
    }),
  );
  const context = createFoundryRuntimeContext({
    ...f.contextOptions,
    moduleUrl: pathToFileURL(entry).href,
  });
  const plan = planFoundryWorkspaceMigration(context, f.options);
  fs.writeFileSync(entry, "export const fixture = 2;\n");
  assert.throws(
    () => revalidateFoundryMigrationPlan(context, f.options, plan),
    code("migration_runtime_changed"),
  );
  assert.equal(fs.existsSync(context.workspaceRoot), false);
});

test("unhashed large data and unsupported source markers remain explicit plan blockers", (t) => {
  const f = fixture(t);
  const huge = path.join(f.source, ".foundry", "large.bin");
  const fd = fs.openSync(huge, "wx");
  fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1);
  fs.closeSync(fd);
  fs.writeFileSync(
    path.join(f.source, ".foundry", "workspace.json"),
    JSON.stringify({ schema: "future-workspace.v99" }),
  );
  const plan = planFoundryWorkspaceMigration(f.context, f.options);
  assert.deepEqual(
    plan.blockers.map((row) => row.code),
    ["migration_unhashed_file", "migration_source_schema_unsupported"],
  );
  assert.equal(plan.source_inventory.entries.find((row) => row.path === "large.bin")?.sha256, null);
  assert.equal(fs.existsSync(f.context.workspaceRoot), false);
});
