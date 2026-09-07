import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { CLI_RUNTIME_EXPECTATION_SCHEMA, describeCliRuntime } from "@tiangong-lca/cli/runtime";
import { createFoundryFacade } from "../../scripts/public-api.ts";
import { FOUNDRY_TIDAS_EXPECTATION_SCHEMA } from "../../scripts/lib/foundry-runtime-qualification.ts";
import { flowRow, processRowWithInvalidLocation } from "../fixtures/row-builders.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";

const digestFile = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function workflowFixture(
  t: TestContext,
  importFails = false,
  validationFails: boolean | "missing-name" | "decisions" = false,
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-public-workflow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "项目 workspace");
  const binary = path.join(root, "native owner fixture.ts");
  fs.copyFileSync(path.resolve(import.meta.dirname, "../fixtures/fake-tidas.ts"), binary);
  if (!importFails) {
    const before = fs.readFileSync(binary, "utf8");
    const marker = 'fs.writeFileSync(path.join(output, "issues.jsonl"), "");';
    assert.ok(before.includes(marker));
    fs.writeFileSync(
      binary,
      before
        .replace(
          marker,
          `${marker}
    const primary = path.join(output, "tidas", "processes", "sample.json");
    fs.writeFileSync(primary, JSON.stringify({ processDataSet: { processInformation: { dataSetInformation: { "common:UUID": "33333333-3333-4333-8333-333333333333" } } } }));
    const bundled = path.join(output, "process-bundles", "sample", "tidas", "processes");
    fs.mkdirSync(bundled, { recursive: true });
    fs.copyFileSync(primary, path.join(bundled, "sample.json"));
    `,
        )
        .replace("object_counts: { processes: 0 }", "object_counts: { processes: 1 }"),
    );
  }
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
  if (validationFails) {
    const before = fs.readFileSync(binary, "utf8");
    assert.ok(before.includes('process.env.FAKE_TIDAS_INVALID === "1"'));
    fs.writeFileSync(
      binary,
      before
        .replace(
          'process.env.FAKE_TIDAS_INVALID === "1"',
          validationFails === "missing-name"
            ? '!JSON.parse(fs.readFileSync(path.join(args[1], manifest[0].relative_path), "utf8")).flowDataSet?.flowInformation?.dataSetInformation?.name'
            : validationFails === "decisions"
              ? "false"
              : "true",
        )
        .replace('process.env.FAKE_TIDAS_BATCH_DATA_ISSUES === "1"', "true"),
    );
  }
  if (validationFails === "decisions") {
    const before = fs.readFileSync(binary, "utf8");
    const marker = "    const final = {";
    assert.ok(before.includes(marker));
    fs.writeFileSync(
      binary,
      before.replace(
        marker,
        `
    const payload = JSON.parse(fs.readFileSync(path.join(args[1], manifest[0].relative_path), "utf8"));
    const info = payload.processDataSet.processInformation;
    const failures = [
      [info.dataSetInformation.classificationInformation["common:classification"]["common:class"][0]["@classId"] === "INVALID",
        "/processDataSet/processInformation/dataSetInformation/classificationInformation"],
      [info.geography.locationOfOperationSupplyOrProduction["@location"] === "Invalid region",
        "/processDataSet/processInformation/geography/locationOfOperationSupplyOrProduction/@location"],
    ];
    for (const [invalid, location] of failures) {
      if (!invalid) continue;
      events.push({ type: "issue", schema_version: "tidas.validation-issue-event.v1",
        protocol: "document-validation-batch.v1", profile: "tidas-document-conformance.v1",
        document_key: manifest[0].document_key, document_ordinal: 0, issue_ordinal: events.length,
        identity: manifest[0].identity, issue: { issue_code: "fixture_invalid", severity: "error",
          category: manifest[0].category, file_path: manifest[0].relative_path, location,
          message: "Controlled invalid code", context: {} },
      });
    }
${marker}`,
      ),
    );
  }
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
  const materialized = await facade.resume({ taskId: started.task_id, actorId: "workflow-actor" });
  const processRows = materialized.artifacts.find(
    (artifact) => artifact.kind === "file" && path.basename(artifact.path) === "process.rows.json",
  );
  assert.ok(processRows?.kind === "file");
  assert.equal(
    JSON.parse(fs.readFileSync(processRows.path, "utf8")).length,
    1,
    "bundle snapshots must not duplicate the primary converted dataset",
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

test("public semantic submission rejects stale evidence and re-assesses only successfully applied rows", async (t) => {
  const { root, facade } = workflowFixture(t, false, "missing-name");
  const id = "44444444-4444-4444-8444-444444444444";
  const good = flowRow(id);
  const bad = {
    ...good,
    flowDataSet: {
      ...good.flowDataSet,
      flowInformation: { dataSetInformation: { "common:UUID": id } },
    },
  };
  const seed = path.join(root, "seed.json");
  fs.writeFileSync(seed, JSON.stringify({ rows: [{ id, version: "00.00.001", flow: bad }] }));
  const specFile = path.join(root, "request.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "semantic-cycle",
      actor_id: "semantic-actor",
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
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId: "semantic-actor" };
  await facade.resume(invocation);
  await facade.resume(invocation);
  const assessed = await facade.resume(invocation);
  assert.equal(assessed.status, "needs_input");
  const assessmentFile = assessed.artifacts.find(
    (artifact) => artifact.kind === "file" && artifact.role === "foundry-assessment.json",
  );
  assert.ok(assessmentFile?.kind === "file");
  const assessment = JSON.parse(fs.readFileSync(assessmentFile.path, "utf8")) as {
    owner_base: string;
    sets: Array<{ rows: string; authoring_manifest: string }>;
  };
  const manifest = JSON.parse(fs.readFileSync(assessment.sets[0].authoring_manifest, "utf8")) as {
    tasks: Array<{
      entity: { entity_id: string; version: string };
      files: { task_json: string; authoring_package: string };
      action_items: Array<{ code: string; path: string | null }>;
    }>;
  };
  const task = manifest.tasks[0];
  const taskFile = path.resolve(assessment.owner_base, task.files.task_json);
  const patchFile = path.join(root, "patch.json"),
    submissionFile = path.join(root, "submission.json");
  const operation = {
    op: "add",
    path: "/json/flowDataSet/flowInformation/dataSetInformation/name",
    value: good.flowDataSet.flowInformation.dataSetInformation.name,
    basis: "Controlled fixture restores the selected source name.",
    evidence: {
      source: seed,
      field_path: "/flowDataSet/flowInformation/dataSetInformation/name",
      quote_or_trace: "Natural gas",
    },
    resolution: {
      mode: "evidence_backed_completion",
      used_context_kinds: [
        "schema",
        "methodology_yaml",
        "ruleset",
        "classification_schema",
        "location_schema",
      ],
    },
    closes_action_items: task.action_items.map((item) => ({ code: item.code, path: item.path })),
  };
  const patch = {
    schema_version: 1,
    patch_status: "completed",
    patch_sets: [
      {
        dataset_id: task.entity.entity_id,
        version: task.entity.version,
        authoring_package: path.basename(task.files.authoring_package),
        operations: [operation],
      },
    ],
  };
  const writeSubmission = (actor = invocation.actorId) => {
    fs.writeFileSync(
      submissionFile,
      JSON.stringify({
        schema: "tiangong-foundry.semantic-input.v1",
        task_id: invocation.taskId,
        actor_id: actor,
        assessment_sha256: assessmentFile.sha256,
        submissions: [
          {
            kind: "patch",
            authoring_task_sha256: digestFile(taskFile),
            file: patchFile,
            sha256: digestFile(patchFile),
          },
        ],
      }),
    );
  };
  fs.writeFileSync(patchFile, JSON.stringify(patch));
  writeSubmission("wrong-actor");
  const wrong = await facade.resume({ ...invocation, semanticInputFile: submissionFile });
  assert.equal(wrong.status, "blocked");
  assert.equal(wrong.blockers[0]?.code, "semantic_input_scope_mismatch");
  const invalid = structuredClone(patch);
  invalid.patch_sets[0].operations[0].evidence.quote_or_trace = "";
  invalid.patch_sets[0].operations[0].evidence.field_path = "";
  fs.writeFileSync(patchFile, JSON.stringify(invalid));
  writeSubmission();
  const refused = await facade.resume({ ...invocation, semanticInputFile: submissionFile });
  assert.equal(refused.status, "needs_input");
  assert.equal(refused.blockers[0]?.code, "semantic_input_rejected");
  const oldRows = fs.readFileSync(assessment.sets[0].rows);
  fs.writeFileSync(patchFile, JSON.stringify(patch));
  writeSubmission();
  const alternatePatch = structuredClone(patch);
  alternatePatch.patch_sets[0].operations[0].basis =
    "Concurrent equivalent repair with a distinct submission.";
  const alternateFile = path.join(root, "alternate-patch.json"),
    alternateSubmission = path.join(root, "alternate-submission.json");
  fs.writeFileSync(alternateFile, JSON.stringify(alternatePatch));
  const alternateDescriptor = JSON.parse(fs.readFileSync(submissionFile, "utf8")) as {
    submissions: Array<{ file: string; sha256: string }>;
  };
  alternateDescriptor.submissions[0].file = alternateFile;
  alternateDescriptor.submissions[0].sha256 = digestFile(alternateFile);
  fs.writeFileSync(alternateSubmission, JSON.stringify(alternateDescriptor));
  const raced = await Promise.all([
    facade.resume({ ...invocation, semanticInputFile: submissionFile }),
    facade.resume({ ...invocation, semanticInputFile: alternateSubmission }),
  ]);
  assert.equal(
    raced.filter((result) => result.status === "ready").length,
    1,
    JSON.stringify(raced),
  );
  assert.equal(raced.filter((result) => result.status === "blocked").length, 1);
  const winner = raced.findIndex((result) => result.status === "ready");
  const acceptedSubmission = winner === 0 ? submissionFile : alternateSubmission;
  const applied = raced[winner];
  assert.equal(applied.status, "ready", JSON.stringify(applied));
  assert.deepEqual(fs.readFileSync(assessment.sets[0].rows), oldRows, "old rows stay immutable");
  const rowManifest = applied.artifacts.findLast(
    (artifact) => artifact.kind === "file" && artifact.role === "foundry-rows.json",
  );
  assert.ok(rowManifest?.kind === "file");
  const rows = JSON.parse(fs.readFileSync(rowManifest.path, "utf8")) as {
    sets: Array<{ file: string }>;
  };
  assert.notEqual(rows.sets[0].file, assessment.sets[0].rows);
  const repaired = JSON.parse(fs.readFileSync(rows.sets[0].file, "utf8").trim()) as {
    json: typeof good;
  };
  assert.deepEqual(
    repaired.json.flowDataSet.flowInformation.dataSetInformation.name,
    operation.value,
  );
  const duplicate = await facade.resume({ ...invocation, semanticInputFile: acceptedSubmission });
  assert.deepEqual(
    duplicate.artifacts,
    applied.artifacts,
    "an accepted submission cannot apply twice",
  );
  const reviewed = await facade.resume(invocation);
  assert.equal(reviewed.status, "ready", JSON.stringify(reviewed));
  assert.notEqual(reviewed.status, "completed");
  const latest = reviewed.artifacts.findLast(
    (artifact) => artifact.kind === "file" && artifact.role === "foundry-assessment.json",
  );
  assert.ok(latest?.kind === "file");
  assert.notEqual(latest.sha256, assessmentFile.sha256);
  patch.patch_sets[0].operations[0].basis =
    "A different submission must not use the old assessment.";
  fs.writeFileSync(patchFile, JSON.stringify(patch));
  writeSubmission();
  const stale = await facade.resume({ ...invocation, semanticInputFile: submissionFile });
  assert.equal(stale.status, "blocked");
  assert.equal(stale.blockers[0]?.code, "semantic_assessment_mismatch");
});

test("public decisions bind their owner and context, preserve rows on refusal, and reassess between owners", async (t) => {
  const { root, facade } = workflowFixture(t, false, "decisions");
  const id = "66666666-6666-4666-8666-666666666666";
  const row = processRowWithInvalidLocation(id);
  row.processDataSet.processInformation.dataSetInformation.classificationInformation[
    "common:classification"
  ]["common:class"][0]["@classId"] = "INVALID";
  const seed = path.join(root, "seed.json"),
    specFile = path.join(root, "request.json");
  fs.writeFileSync(seed, JSON.stringify({ rows: [{ id, version: "00.00.001", json: row }] }));
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "decision-cycle",
      actor_id: "decision-actor",
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
  const invocation = { taskId: started.task_id, actorId: "decision-actor" };
  await facade.resume(invocation);
  await facade.resume(invocation);
  let result = await facade.resume(invocation);
  const classes = JSON.parse(
    fs.readFileSync(
      path.join(resolveInstalledTiangongLcaCliPackage().schemaDir, "tidas_processes_category.json"),
      "utf8",
    ),
  ) as { oneOf: Array<{ properties?: { "@classId"?: { const?: string } } }> };
  const code = classes.oneOf
    .map((value) => value.properties?.["@classId"]?.const)
    .filter((value): value is string => typeof value === "string" && value.startsWith("351"))
    .sort((left, right) => right.length - left.length)[0];
  assert.ok(code, "the classification comes from the installed owner's schema");
  for (const kind of ["classification", "location"] as const) {
    const artifact = result.artifacts.findLast((value) => value.role === "foundry-assessment.json");
    assert.ok(artifact?.kind === "file");
    const assessment = JSON.parse(fs.readFileSync(artifact.path, "utf8")) as {
      owner_base: string;
      sets: Array<{
        rows: string;
        decisions: Array<{ kind: string; task: string; status: string }>;
      }>;
    };
    const set = assessment.sets[0],
      work = set.decisions.find((value) => value.kind === kind);
    assert.ok(work);
    assert.equal(work.status, `ready_for_ai_${kind}_decisions`);
    const task = JSON.parse(fs.readFileSync(work.task, "utf8")) as {
      commands: { apply_decisions: null };
      files: { template: string };
    };
    assert.equal(task.commands.apply_decisions, null);
    const decisions = fs
      .readFileSync(path.resolve(assessment.owner_base, task.files.template), "utf8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            code: string;
            basis: string;
            used_context_kinds: string[];
            evidence: Record<string, unknown>;
            authoring_context: { context_bundle_sha256: string };
          },
      );
    for (const value of decisions) {
      value.code = kind === "classification" ? code : "CH";
      value.basis = "Controlled fixture with an explicitly selected schema-valid code.";
      value.used_context_kinds = [
        "schema",
        "methodology_yaml",
        "ruleset",
        "classification_schema",
        "location_schema",
      ];
      value.evidence = {
        ...value.evidence,
        source: seed,
        quote_or_trace: "Controlled schema fixture.",
      };
    }
    const file = path.join(root, `${kind}.jsonl`),
      descriptor = path.join(root, `${kind}-submission.json`);
    const part = () => ({
      kind: String(kind),
      authoring_task_sha256: digestFile(work.task),
      file,
      sha256: digestFile(file),
    });
    const write = (values = decisions, parts?: ReturnType<typeof part>[]) => {
      fs.writeFileSync(file, values.map((value) => JSON.stringify(value)).join("\n") + "\n");
      fs.writeFileSync(
        descriptor,
        JSON.stringify({
          schema: "tiangong-foundry.semantic-input.v1",
          task_id: invocation.taskId,
          actor_id: invocation.actorId,
          assessment_sha256: artifact.sha256,
          submissions: parts ?? [part()],
        }),
      );
    };
    const original = fs.readFileSync(set.rows);
    const originalManifest = result.artifacts.findLast(
      (value) => value.role === "foundry-rows.json",
    );
    write();
    write(decisions, [
      { ...part(), kind: kind === "classification" ? "location" : "classification" },
    ]);
    const wrongOwner = await facade.resume({ ...invocation, semanticInputFile: descriptor });
    assert.equal(wrongOwner.status, "blocked");
    assert.equal(wrongOwner.blockers[0]?.code, "semantic_work_mismatch");
    if (kind === "classification") {
      const location = set.decisions.find((value) => value.kind === "location");
      assert.ok(location);
      write(decisions, [
        part(),
        { ...part(), kind: "location", authoring_task_sha256: digestFile(location.task) },
      ]);
      const mixed = await facade.resume({ ...invocation, semanticInputFile: descriptor });
      assert.equal(mixed.status, "needs_input");
      assert.equal(mixed.blockers[0]?.code, "task_semantic_owner_conflict");
    }
    const invalid = structuredClone(decisions);
    invalid[0].authoring_context.context_bundle_sha256 = "0".repeat(64);
    write(invalid);
    const refused = await facade.resume({ ...invocation, semanticInputFile: descriptor });
    assert.equal(refused.status, "needs_input", JSON.stringify(refused));
    assert.equal(refused.blockers[0]?.code, "semantic_input_rejected");
    const afterRefusal = await facade.status(invocation);
    assert.deepEqual(
      afterRefusal.artifacts.findLast((value) => value.role === "foundry-rows.json"),
      originalManifest,
    );
    assert.deepEqual(fs.readFileSync(set.rows), original);
    write();
    const applied = await facade.resume({ ...invocation, semanticInputFile: descriptor });
    assert.equal(applied.status, "ready", JSON.stringify(applied));
    const duplicate = await facade.resume({ ...invocation, semanticInputFile: descriptor });
    assert.deepEqual(duplicate.artifacts, applied.artifacts);
    assert.deepEqual(fs.readFileSync(set.rows), original);
    result = await facade.resume(invocation);
    const latest = result.artifacts.findLast((value) => value.role === "foundry-assessment.json");
    assert.ok(latest?.kind === "file");
    const reviewed = JSON.parse(fs.readFileSync(latest.path, "utf8")) as typeof assessment;
    assert.ok(!reviewed.sets[0].decisions.some((value) => value.kind === kind));
    decisions[0].basis = "A distinct late submission against the original assessment.";
    write();
    const stale = await facade.resume({ ...invocation, semanticInputFile: descriptor });
    assert.equal(stale.status, "blocked");
    assert.equal(stale.blockers[0]?.code, "semantic_assessment_mismatch");
  }
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
  const { root, facade } = workflowFixture(t, false, true);
  const seed = path.join(root, "selected-seed.json");
  const sourceRow = {
    id: "22222222-2222-4222-8222-222222222222",
    version: "00.00.001",
    flow: flowRow("22222222-2222-4222-8222-222222222222"),
  };
  fs.writeFileSync(seed, JSON.stringify({ rows: [sourceRow] }));
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
  const normalized = await facade.resume({ taskId: started.task_id, actorId: "source-actor" });
  const rowFile = normalized.artifacts.find(
    (artifact) => artifact.kind === "file" && path.basename(artifact.path) === "flow.rows.json",
  );
  assert.ok(rowFile?.kind === "file", "the next stage must materialize the selected rows");
  assert.deepEqual(JSON.parse(fs.readFileSync(rowFile.path, "utf8")), [
    { id: sourceRow.id, version: sourceRow.version, json: sourceRow.flow },
  ]);
  const assessed = await facade.resume({ taskId: started.task_id, actorId: "source-actor" });
  assert.ok(
    assessed.artifacts.some(
      (artifact) =>
        artifact.kind === "file" && path.basename(artifact.path) === "validation-report.json",
    ),
    JSON.stringify(assessed),
  );
  const manifest = assessed.artifacts.find(
    (artifact) =>
      artifact.kind === "file" && path.basename(artifact.path) === "authoring-task-manifest.json",
  );
  assert.ok(manifest?.kind === "file", "assessment must publish concrete owner authoring work");
  const work = JSON.parse(fs.readFileSync(manifest.path, "utf8")) as {
    commands: { apply_all_patches: string | null };
    tasks: Array<{ commands: { apply_patch: string | null; validate_after_apply: string | null } }>;
  };
  assert.equal(work.commands.apply_all_patches, null);
  for (const task of work.tasks) {
    assert.equal(task.commands.apply_patch, null);
    assert.equal(task.commands.validate_after_apply, null);
  }
  assert.equal(assessed.status, "needs_input");
  assert.ok(
    assessed.next_actions.some(
      (action) => action.kind === "human" && action.code === "review_semantic_work",
    ),
  );
  const repeated = await facade.resume({ taskId: started.task_id, actorId: "source-actor" });
  assert.deepEqual(
    repeated.artifacts,
    assessed.artifacts,
    "pending semantic work must not rerun local owners",
  );
  fs.appendFileSync(rowFile.path, "\n");
  const changed = await facade.resume({ taskId: started.task_id, actorId: "source-actor" });
  assert.equal(changed.status, "blocked");
  assert.equal(changed.blockers[0]?.code, "workflow_assessment_changed");
});
