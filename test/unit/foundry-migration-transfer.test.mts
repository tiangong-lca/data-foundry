import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import {
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
  FoundryContextError,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { planFoundryWorkspaceMigration } from "../../scripts/lib/foundry-migration-plan.ts";
import {
  stageFoundryMigration,
  auditFoundryMigration,
} from "../../scripts/lib/foundry-migration-transfer.ts";

function setup(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-unit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"),
    dest = path.join(root, "destination");
  fs.mkdirSync(path.join(source, ".foundry/workspaces/one/attempts"), { recursive: true });
  fs.mkdirSync(path.join(source, "tasks/done"), { recursive: true });
  const attempt = path.join(source, ".foundry/workspaces/one/attempts/state.json"),
    queue = path.join(source, "tasks/done/one.md"),
    input = path.join(root, "data.json");
  fs.writeFileSync(attempt, '{"state":"UNKNOWN_DO_NOT_REPLAY"}\n');
  fs.writeFileSync(queue, "# Completed historical task\n");
  fs.writeFileSync(input, '{"flowDataSet":{}}\n');
  const ctxOptions = {
    moduleUrl: pathToFileURL(path.resolve(import.meta.dirname, "../../scripts/public-api.ts")).href,
    workspace: dest,
    cacheBase: path.join(root, "cache"),
  };
  const context = createFoundryRuntimeContext(ctxOptions),
    options = {
      sourceWorkspace: source,
      actorId: "actor-one",
      requestId: "transfer-one",
      externalInputs: [input],
    };
  return {
    root,
    source,
    dest,
    attempt,
    queue,
    input,
    ctxOptions,
    context,
    options,
    plan: planFoundryWorkspaceMigration(context, options),
  };
}
const code = (value: string) => (e: unknown) =>
  e instanceof FoundryContextError && e.code === value;

test("interrupted transfers retain a pending marker, preserve source and resume identical file copies", async (t) => {
  for (const stop of ["claimed", "copied", "audited"] as const) {
    const f = setup(t),
      original = fs.readFileSync(f.attempt);
    await assert.rejects(
      stageFoundryMigration(f.context, f.options, f.plan, {
        checkpoint: (phase, index) => {
          if (phase === stop && (phase !== "copied" || index === 1))
            throw new Error("injected_stop");
        },
      }),
      /injected_stop/u,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(f.dest, ".foundry/workspace.json"), "utf8")).schema,
      "tiangong-foundry.workspace-migration-pending.v1",
    );
    assert.throws(
      () => initializeFoundryWorkspace(createFoundryRuntimeContext(f.ctxOptions)),
      code("workspace_migration_pending"),
    );
    assert.deepEqual(fs.readFileSync(f.attempt), original);
    const resumed = await stageFoundryMigration(
      createFoundryRuntimeContext(f.ctxOptions),
      f.options,
      f.plan,
    );
    assert.equal(resumed.receipt.files.length, 3);
    assert.equal(resumed.receipt.activated, false);
    const again = await stageFoundryMigration(
      createFoundryRuntimeContext(f.ctxOptions),
      f.options,
      f.plan,
    );
    assert.deepEqual(again, resumed);
    assert.deepEqual(
      auditFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
      resumed,
    );
  }
});

test("source or destination drift during transfer prevents a successful receipt", async (t) => {
  const f = setup(t);
  await assert.rejects(
    stageFoundryMigration(f.context, f.options, f.plan, {
      checkpoint: (phase, index) => {
        if (phase === "copied" && index === 1) fs.appendFileSync(f.queue, "changed\n");
      },
    }),
  );
  assert.equal(
    fs.existsSync(path.join(f.dest, ".foundry/migrations", f.plan.plan_sha256, "receipt.json")),
    false,
  );
  await assert.rejects(
    stageFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
  );
  const g = setup(t);
  await assert.rejects(
    stageFoundryMigration(g.context, g.options, g.plan, {
      checkpoint: (phase) => {
        if (phase === "audited")
          fs.writeFileSync(
            path.join(
              g.dest,
              ".foundry/migrations",
              g.plan.plan_sha256,
              "original/tasks/done/one.md",
            ),
            "tampered",
          );
      },
    }),
    code("migration_audit_failed"),
  );
  assert.equal(
    fs.existsSync(path.join(g.dest, ".foundry/migrations", g.plan.plan_sha256, "receipt.json")),
    false,
  );
});

test("receipt publication remnants recover before and after the immutable receipt appears", async (t) => {
  for (const published of [false, true]) {
    const f = setup(t);
    if (published) await stageFoundryMigration(f.context, f.options, f.plan);
    else
      await assert.rejects(
        stageFoundryMigration(f.context, f.options, f.plan, {
          checkpoint: (phase) => {
            if (phase === "audited") throw new Error("before_receipt");
          },
        }),
        /before_receipt/u,
      );
    const base = path.join(f.dest, ".foundry/migrations", f.plan.plan_sha256),
      temporary = path.join(base, "scratch/write-00000000-0000-4000-8000-000000000001.tmp");
    // These are the durable states left by termination during write or after link.
    if (published) fs.linkSync(path.join(base, "receipt.json"), temporary);
    else fs.writeFileSync(temporary, "partial receipt");
    const resumed = await stageFoundryMigration(
      createFoundryRuntimeContext(f.ctxOptions),
      f.options,
      f.plan,
    );
    assert.equal(fs.existsSync(temporary), false);
    assert.equal(resumed.receipt.activated, false);
    assert.equal(resumed.receipt.files.length, 3);
    assert.deepEqual(
      auditFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
      resumed,
    );
  }
});

test("completed transfer audit rejects corruption or deletion without restoring a fresh history", async (t) => {
  const f = setup(t),
    staged = await stageFoundryMigration(f.context, f.options, f.plan);
  const file = path.join(f.dest, ".foundry", staged.receipt.files[0].destination);
  fs.writeFileSync(file, "foreign bytes");
  assert.throws(
    () => auditFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
    code("migration_audit_failed"),
  );
  await assert.rejects(
    stageFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
    code("migration_audit_failed"),
  );
  assert.equal(fs.readFileSync(file, "utf8"), "foreign bytes");
  fs.unlinkSync(file);
  await assert.rejects(
    stageFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
  );
  assert.equal(fs.existsSync(file), false);
});

test("foreign destination state and forged transfer intent fail before publication", async (t) => {
  const f = setup(t);
  await assert.rejects(
    stageFoundryMigration(f.context, { ...f.options, actorId: "other" }, f.plan),
    code("migration_plan_changed"),
  );
  assert.equal(fs.existsSync(f.dest), false);
  fs.mkdirSync(path.join(f.dest, ".foundry"), { recursive: true });
  fs.writeFileSync(path.join(f.dest, ".foundry/keep"), "keep");
  await assert.rejects(
    stageFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
    code("migration_destination_exists"),
  );
  assert.equal(fs.readFileSync(path.join(f.dest, ".foundry/keep"), "utf8"), "keep");
});

test("concurrent staging shares the destination lock and produces one immutable receipt", async (t) => {
  const f = setup(t);
  const results = await Promise.all([
    stageFoundryMigration(f.context, f.options, f.plan),
    stageFoundryMigration(f.context, f.options, f.plan),
  ]);
  assert.deepEqual(results[0], results[1]);
});

test("cancellation and unowned scratch data preserve the source and keep the destination inactive", async (t) => {
  const f = setup(t),
    aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    stageFoundryMigration(f.context, f.options, f.plan, { signal: aborted.signal }),
    code("operation_interrupted"),
  );
  assert.equal(fs.existsSync(f.dest), false);
  const controller = new AbortController();
  await assert.rejects(
    stageFoundryMigration(f.context, f.options, f.plan, {
      signal: controller.signal,
      checkpoint: (phase) => {
        if (phase === "copied") controller.abort();
      },
    }),
    code("operation_interrupted"),
  );
  const scratch = path.join(f.dest, ".foundry/migrations", f.plan.plan_sha256, "scratch/keep.txt");
  fs.writeFileSync(scratch, "unowned");
  await assert.rejects(
    stageFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
    code("migration_destination_conflict"),
  );
  assert.equal(fs.readFileSync(scratch, "utf8"), "unowned");
});

test("private queue storage is omitted and external private inputs are rejected", async (t) => {
  const f = setup(t),
    privateFile = path.join(f.source, "tasks/opaque.store");
  fs.writeFileSync(privateFile, "synthetic private storage");
  const context = createFoundryRuntimeContext({
    ...f.ctxOptions,
    accountIntent: {
      projectRef: "a".repeat(20),
      userId: "00000000-0000-4000-8000-000000000001",
      sessionReference: privateFile,
    },
  });
  const plan = planFoundryWorkspaceMigration(context, f.options);
  assert.ok(plan.omitted_private_paths.includes("tasks/opaque.store"));
  assert.deepEqual(plan.blockers, []);
  const staged = await stageFoundryMigration(context, f.options, plan);
  assert.equal(staged.receipt.files.length, 3);
  assert.equal(
    staged.receipt.files.some((file) => file.source === fs.realpathSync(privateFile)),
    false,
  );
  assert.throws(() =>
    planFoundryWorkspaceMigration(context, { ...f.options, externalInputs: [privateFile] }),
  );
});
