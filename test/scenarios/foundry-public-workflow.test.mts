import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { CLI_RUNTIME_EXPECTATION_SCHEMA, describeCliRuntime } from "@tiangong-lca/cli/runtime";
import { createFoundryFacade } from "../../scripts/public-api.ts";
import { FOUNDRY_TIDAS_EXPECTATION_SCHEMA } from "../../scripts/lib/foundry-runtime-qualification.ts";

function workflowFixture(t: TestContext, importFails = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-public-workflow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "项目 workspace");
  const binary = path.join(root, "native owner fixture.ts");
  fs.copyFileSync(path.resolve(import.meta.dirname, "../fixtures/fake-tidas.ts"), binary);
  if (importFails) {
    const before = fs.readFileSync(binary, "utf8");
    const declaration =
      "const requestedExit = process.env.FAKE_TIDAS_EXIT_CLASS as ExitClass | undefined;";
    assert.ok(before.includes(declaration));
    fs.writeFileSync(
      binary,
      before.replace(
        declaration,
        'const requestedExit: ExitClass = command === "import" ? "data-issues" : "success";',
      ),
    );
  }
  fs.chmodSync(binary, 0o755);
  const cli = describeCliRuntime();
  const facade = createFoundryFacade({
    workspace,
    cacheBase: path.join(root, "cache"),
    runtimeSelection: {
      cliExpectation: {
        schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
        package_version: cli.package.version,
        platform: cli.platform,
        content_sha256: cli.content_sha256,
        node_version: cli.node.version,
        node_sha256: cli.node.sha256,
      },
      tidasExecutable: binary,
      tidasExpectation: {
        schema: FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
        platform: cli.platform,
        binary_version: "0.2.7",
        executable: {
          bytes: fs.statSync(binary).size,
          sha256: createHash("sha256").update(fs.readFileSync(binary)).digest("hex"),
        },
        validation: {
          schema_version: "tidas.validation-describe.v1",
          asset_fingerprint: "1".repeat(64),
          protocols: ["document-validation-batch.v1"],
          event_schema_versions: [
            "tidas.validation-final-event.v1",
            "tidas.validation-issue-event.v1",
          ],
        },
      },
    },
  });
  assert.equal(facade.initialize().status, "ready");
  assert.equal(facade.doctor().status, "ready");
  return { root, workspace, facade };
}

test("qualified public import dispatches the native owner and retains indexed stage evidence", async (t) => {
  const { root, facade } = workflowFixture(t);
  const source = path.join(root, "selected-package.zip");
  // This regression isolates owner dispatch and evidence registration. The paired
  // real native case uses the valid four-document ILCD oracle, not this transport fixture.
  fs.writeFileSync(source, "selected native-owner input");
  const specFile = path.join(root, "request.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "native-owner-workflow",
      actor_id: "workflow-actor",
      lane: "external-dataset-curated-import",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [{ path: source }],
      seed: null,
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.equal(started.status, "ready");
  assert.ok(started.task_id);
  const resumed = await facade.resume({ taskId: started.task_id, actorId: "workflow-actor" });
  const imported = resumed.artifacts.find(
    (artifact) => artifact.kind === "file" && path.basename(artifact.path) === "import-report.json",
  );
  assert.ok(
    imported?.kind === "file",
    "public resume must expose the indexed native import report",
  );
  const report = JSON.parse(fs.readFileSync(imported.path, "utf8")) as Record<string, unknown>;
  assert.equal(report.schema_version, "tidas.import-execution-report.v1");
  assert.notEqual(resumed.status, "completed", "conversion alone cannot prove import completion");
  const context = await facade.resume({ taskId: started.task_id, actorId: "workflow-actor" });
  assert.ok(
    context.artifacts.some(
      (artifact) => artifact.kind === "file" && path.basename(artifact.path) === "schema.json",
    ),
    "the next resume must prepare real CLI-owned contract context",
  );
  const status = await facade.status({ taskId: started.task_id, actorId: "workflow-actor" });
  assert.ok(
    status.artifacts.some(
      (artifact) => artifact.kind === "file" && artifact.path === imported.path,
    ),
  );
  const before = fs.readFileSync(imported.path);
  const wrongActor = await facade.resume({ taskId: started.task_id, actorId: "another-actor" });
  assert.notEqual(wrongActor.status, "ready");
  assert.deepEqual(fs.readFileSync(imported.path), before);
  fs.appendFileSync(source, "changed");
  const changed = await facade.resume({ taskId: started.task_id, actorId: "workflow-actor" });
  assert.equal(changed.status, "blocked");
  assert.deepEqual(fs.readFileSync(imported.path), before);
});

test("a failed native conversion remains blocked without preparing later context", async (t) => {
  const { root, facade } = workflowFixture(t, true);
  const source = path.join(root, "unsupported-package.zip");
  fs.writeFileSync(source, "native data-issue input");
  const specFile = path.join(root, "blocked-request.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "blocked-conversion",
      actor_id: "actor",
      lane: "external-dataset-curated-import",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [{ path: source }],
      seed: null,
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const result = await facade.resume({ taskId: started.task_id, actorId: "actor" });
  assert.equal(result.status, "blocked");
  assert.equal(result.blockers[0]?.code, "native_import_blocked");
  assert.ok(result.artifacts.some((artifact) => artifact.role === "foundry-native-import.json"));
  const again = await facade.resume({ taskId: started.task_id, actorId: "actor" });
  assert.deepEqual(again, result);
  assert.ok(!again.artifacts.some((artifact) => artifact.role === "schema.json"));
});

test("source-evidence resume prepares an indexed SDK context before semantic work", async (t) => {
  const { root, facade } = workflowFixture(t);
  const seed = path.join(root, "selected-seed.json");
  fs.writeFileSync(seed, JSON.stringify({ rows: [{ flowDataSet: {} }] }));
  const specFile = path.join(root, "source-request.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "source-workflow",
      actor_id: "source-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.equal(started.status, "ready");
  assert.ok(started.task_id);
  const resumed = await facade.resume({ taskId: started.task_id, actorId: "source-actor" });
  const contract = resumed.artifacts.find(
    (artifact) =>
      artifact.kind === "file" && path.basename(artifact.path) === "contract-report.json",
  );
  assert.ok(contract?.kind === "file");
  const report = JSON.parse(fs.readFileSync(contract.path, "utf8")) as {
    status: string;
    type: string;
    files: Record<string, string | null>;
  };
  assert.equal(report.status, "completed");
  assert.equal(report.type, "flow");
  for (const key of ["schema", "methodology", "ruleset", "ai_context_json"]) {
    const file = report.files[key];
    assert.ok(file);
    assert.ok(
      resumed.artifacts.some((artifact) => artifact.kind === "file" && artifact.path === file),
      key,
    );
  }
  assert.notEqual(resumed.status, "completed");
});
