import crypto from "node:crypto";
import test from "node:test";
import {
  assert,
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  spawnSync,
} from "../fixtures/foundry-core.ts";
import {
  createTopologyConvergenceFixture,
  fixtureSha,
  topologyIds,
} from "../fixtures/topology-convergence-fixtures.mjs";

function compose(fixture) {
  return runFoundry([
    "dataset-topology-convergence-compose",
    "--request",
    rel(fixture.requestPath),
    "--out-dir",
    rel(fixture.outDir),
  ]);
}

function composeRaw(fixture) {
  return spawnSync(
    process.execPath,
    [
      "scripts/foundry.mjs",
      "dataset-topology-convergence-compose",
      "--request",
      rel(fixture.requestPath),
      "--out-dir",
      rel(fixture.outDir),
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

function fileSha(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("topology composer emits exact F/P/D artifacts and preserves owner language by occurrence", () => {
  const fixture = createTopologyConvergenceFixture("complete");
  const result = compose(fixture);
  assert.equal(result.code, 0);
  assert.equal(result.json.status, "ready_for_admission");
  assert.equal(result.json.p0, 0);
  assert.equal(result.json.p1, 0);
  assert.equal(result.json.independent_audit, "PASS");
  assert.deepEqual(
    {
      flows: result.json.counts.candidate_flows,
      creates: result.json.counts.flow_create,
      ownerNoWrite: result.json.counts.flow_owner_no_write,
      publicReuse: result.json.counts.flow_public_reuse,
      deletes: result.json.counts.obsolete_flow_delete_candidates,
      processes: result.json.counts.processes,
      updates: result.json.counts.process_update,
      inserts: result.json.counts.process_insert,
      noWrite: result.json.counts.process_no_write,
      exchanges: result.json.counts.exchanges,
      refs: result.json.counts.flow_reference_changes,
      add: result.json.counts.exchange_add,
      remove: result.json.counts.exchange_delete,
      direction: result.json.counts.direction_changes,
      amount: result.json.counts.amount_changes,
      de: result.json.counts.german_synonyms,
      zh: result.json.counts.chinese_descriptions,
    },
    {
      flows: 4,
      creates: 2,
      ownerNoWrite: 1,
      publicReuse: 1,
      deletes: 5,
      processes: 3,
      updates: 1,
      inserts: 1,
      noWrite: 1,
      exchanges: 6,
      refs: 3,
      add: 1,
      remove: 1,
      direction: 1,
      amount: 1,
      de: 2,
      zh: 1,
    },
  );
  assert.deepEqual(result.json.dispatch_counts, { network: 0, database: 0, cli: 0, dml: 0 });

  const processRows = readJsonLines(path.join(fixture.outDir, "process-save-draft-input.jsonl"));
  const updated = processRows.find(
    (row) =>
      row.processDataSet.processInformation.dataSetInformation["common:UUID"] ===
      topologyIds.processes[0],
  );
  assert.equal(
    updated.processDataSet.processInformation.dataSetInformation.name.baseName["#text"],
    "Owner-authored name",
  );
  const exchanges = updated.processDataSet.exchanges.exchange;
  assert.deepEqual(
    exchanges.map((entry) => entry.referenceToFlowDataSet["@refObjectId"]),
    topologyIds.flows,
  );
  const descriptions = exchanges[1].referenceToFlowDataSet["common:shortDescription"];
  assert.equal(descriptions.find((entry) => entry["@xml:lang"] === "zh")["#text"], "中文流");

  const flowContract = readJson(path.join(fixture.outDir, "flow-create-execution-contract.json"));
  const processContract = readJson(path.join(fixture.outDir, "process-execution-contract.json"));
  assert.deepEqual(
    flowContract.actions.map((action) => action.expected_operation),
    ["insert", "insert"],
  );
  assert.deepEqual(processContract.actions.map((action) => action.expected_operation).sort(), [
    "insert",
    "save_draft",
  ]);
  assert.equal(readJsonLines(path.join(fixture.outDir, "flow-delete-candidates.jsonl")).length, 5);

  const events = readJsonLines(path.join(fixture.outDir, "topology-conversion-events.jsonl"));
  let previous = null;
  for (const event of events) {
    for (const field of [
      "action_id",
      "entity",
      "exchange_key",
      "mapping_kind",
      "reason",
      "before_sha",
      "desired_sha",
    ]) {
      assert.ok(Object.hasOwn(event, field), field);
    }
    assert.equal(event.previous_event_sha256, previous);
    const { event_sha256: recorded, ...body } = event;
    assert.equal(fixtureSha(body), recorded);
    previous = recorded;
  }
  const manifest = readJson(path.join(fixture.outDir, "topology-manifest.json"));
  for (const artifact of manifest.output_artifacts) {
    const artifactPath = path.join(fixture.outDir, artifact.path);
    assert.equal(fs.statSync(artifactPath).size, artifact.bytes, artifact.path);
    assert.equal(fileSha(artifactPath), artifact.sha256, artifact.path);
  }
});

test("foreign target is isolated and no executable contracts are emitted", () => {
  const fixture = createTopologyConvergenceFixture("foreign", (state) => {
    const id = topologyIds.flows[0];
    const payload = state.flowPayloads.get(id);
    state.foreignFlowRows.push({
      table: "flows",
      id,
      version: "00.00.001",
      user_id: "90000000-0000-4000-8000-000000000009",
      state_code: 0,
      json_ordered: payload,
      payload_sha256: fixtureSha(payload),
    });
  });
  const result = compose(fixture);
  assert.equal(result.code, 1);
  assert.equal(result.json.status, "rejected");
  assert.ok(result.json.p0 > 0);
  assert.equal(result.json.independent_audit, "FAIL");
  assert.equal(
    fs.existsSync(path.join(fixture.outDir, "flow-create-execution-contract.json")),
    false,
  );
  assert.equal(fs.existsSync(path.join(fixture.outDir, "process-execution-contract.json")), false);
  assert.ok(
    readJsonLines(path.join(fixture.outDir, "topology-holds.jsonl")).some(
      (row) => row.reason === "FOREIGN_ONLY_TARGET",
    ),
  );
});

test("an exact owner target remains no-write when an unrelated foreign copy exists", () => {
  const fixture = createTopologyConvergenceFixture("owner-and-foreign", (state) => {
    const id = topologyIds.flows[2];
    const payload = state.flowPayloads.get(id);
    state.foreignFlowRows.push({
      table: "flows",
      id,
      version: "00.00.001",
      user_id: "90000000-0000-4000-8000-000000000009",
      state_code: 0,
      json_ordered: payload,
      payload_sha256: fixtureSha(payload),
    });
  });
  const result = compose(fixture);
  assert.equal(result.code, 0);
  assert.equal(result.json.status, "ready_for_admission");
  assert.equal(result.json.counts.flow_owner_no_write, 1);
});

test("every changed occurrence requires an audited old-to-new flow mapping", () => {
  const fixture = createTopologyConvergenceFixture("missing-mapping", (state) => {
    state.mappingRows = state.mappingRows.filter(
      (row) =>
        !(row.old_flow_id === topologyIds.oldFlows[0] && row.new_flow_id === topologyIds.flows[0]),
    );
  });
  const result = compose(fixture);
  assert.equal(result.code, 1);
  assert.equal(result.json.status, "rejected");
  assert.ok(result.json.p0 > 0);
  assert.equal(result.json.independent_audit, "FAIL");
});

test("admission binds the full pre-admission request", () => {
  const fixture = createTopologyConvergenceFixture("request-binding-drift");
  fixture.requestValue.expected.amount_changes += 1;
  fs.writeFileSync(fixture.requestPath, `${JSON.stringify(fixture.requestValue, null, 2)}\n`);
  const result = composeRaw(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /request binding mismatch/u);
  assert.equal(fs.existsSync(fixture.outDir), false);
});

test("candidate package bytes are verified before derived topology is accepted", () => {
  const fixture = createTopologyConvergenceFixture("candidate-package-drift");
  fs.appendFileSync(fixture.candidatePackage, "drift\n");
  const result = composeRaw(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Candidate package SHA-256 or byte binding mismatch/u);
  assert.equal(fs.existsSync(fixture.outDir), false);
});

test("fixed classification conflict must resolve to the authorized leaf code", () => {
  const fixture = createTopologyConvergenceFixture("classification-conflict", (state) => {
    const target = state.classificationRows.find((row) => row.entity.id === topologyIds.flows[1]);
    target.selected_code = "34550";
  });
  const result = compose(fixture);
  assert.equal(result.code, 1);
  assert.equal(result.json.status, "rejected");
  assert.ok(result.json.p0 > 0);
});

test("input SHA drift fails before creating any output", () => {
  const fixture = createTopologyConvergenceFixture("sha-drift");
  fs.appendFileSync(fixture.ownerFlows, "\n");
  const result = composeRaw(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /binding mismatch/u);
  assert.equal(fs.existsSync(fixture.outDir), false);
});
