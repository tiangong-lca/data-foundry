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
} from "../fixtures/foundry-core.mjs";
import {
  createIncrementalChangeSetFixture,
  fixtureBoundRule,
  fixtureComparison,
  fixtureEntityKey,
  fixtureOwnerRow,
  fixturePayload,
  fixtureSha256Json,
  fixtureTables,
  fixtureUpdatePointer,
} from "../fixtures/incremental-change-set-fixtures.mjs";

function compose(fixture) {
  return runFoundry([
    "dataset-incremental-change-set-compose",
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
      "scripts/foundry.ts",
      "dataset-incremental-change-set-compose",
      "--request",
      rel(fixture.requestPath),
      "--out-dir",
      rel(fixture.outDir),
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

function bytesSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function decisionFromEvent(event) {
  return {
    conversion_id: event.conversion_id,
    entity: event.entity,
    input_hashes: {
      old: event.input_refs.old,
      candidate: event.input_refs.candidate,
      current: event.input_refs.current,
    },
    disposition: event.outcome.disposition,
    reason_codes: event.outcome.reason_codes,
    expected_operation: event.outcome.expected_operation,
    before_sha256: event.outcome.before_sha256,
    desired_sha256: event.outcome.desired_sha256,
    dependencies: event.dependencies.declared_conversion_ids,
    dependency_action_ids: event.dependencies.dependency_action_ids,
    evidence: event.evidence,
    terminal_success: event.outcome.terminal_success,
    preserved_paths: event.curation.preserved_paths,
    applied_paths: event.diff.applied_paths,
    noise_paths: event.normalization.noise_paths,
  };
}

function assertCompositionHashes(fixture, result) {
  const eventsPath = path.join(fixture.outDir, "incremental-change-set-conversion-events.jsonl");
  const events = readJsonLines(eventsPath);
  for (const event of events) {
    const { event_sha256: recordedEventSha256, ...eventBody } = event;
    assert.equal(fixtureSha256Json(eventBody), recordedEventSha256);
    const decision = event.decision ?? decisionFromEvent(event);
    assert.equal(fixtureSha256Json(decision), event.decision_binding_sha256);

    const outputPath = path.join(fixture.outDir, event.output.artifact);
    const outputLines = fs
      .readFileSync(outputPath, "utf8")
      .split(/\r?\n/u)
      .filter((line) => line.trim());
    const outputRow = JSON.parse(outputLines[event.output.line - 1]);
    assert.equal(fixtureSha256Json(outputRow), event.output.row_sha256);
  }

  const manifestPath = path.join(fixture.outDir, "incremental-change-set-manifest.json");
  const manifest = readJson(manifestPath);
  for (const artifact of manifest.output_artifacts) {
    const artifactPath = path.join(fixture.outDir, artifact.path);
    const bytes = fs.readFileSync(artifactPath);
    assert.equal(bytes.byteLength, artifact.bytes, artifact.path);
    assert.equal(bytesSha256(artifactPath), artifact.sha256, artifact.path);
    if (artifact.rows != null && artifact.path.endsWith(".jsonl")) {
      const rows = bytes
        .toString("utf8")
        .split(/\r?\n/u)
        .filter((line) => line.trim()).length;
      assert.equal(rows, artifact.rows, artifact.path);
    }
  }
  assert.equal(fixtureSha256Json(manifest.output_artifacts), manifest.output_binding_sha256);
  assert.equal(fs.readFileSync(manifestPath).byteLength, result.json.manifest.bytes);
  assert.equal(bytesSha256(manifestPath), result.json.manifest.sha256);
}

test("incremental composer emits one terminal log per conversion and exact CLI artifacts", () => {
  const fixture = createIncrementalChangeSetFixture("complete");
  const result = compose(fixture);
  assert.equal(result.code, 0);
  assert.equal(result.json.status, "completed_with_holds");
  assert.deepEqual(result.json.counts, {
    universe: 8,
    insert: 2,
    update: 2,
    no_write: 3,
    hold: 1,
    actions: 4,
    delta_rows: 4,
    conversion_log_rows: 8,
    delete_actions: 0,
  });
  assert.deepEqual(result.json.dispatch_counts, { network: 0, database: 0, cli: 0, dml: 0 });

  const expectedFiles = [
    "incremental-change-set-request.snapshot.json",
    "incremental-change-set-conversion-events.jsonl",
    "incremental-change-set-delta.jsonl",
    "incremental-change-set-no-write.jsonl",
    "incremental-change-set-holds.jsonl",
    "incremental-change-set-dependency-closure.json",
    "dataset-save-draft-input.jsonl",
    "dataset-save-draft-execution-contract.json",
    "incremental-change-set-report.json",
    "incremental-change-set-manifest.json",
  ];
  assert.deepEqual(fs.readdirSync(fixture.outDir).sort(), expectedFiles.sort());
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(fixture.outDir).mode & 0o777, 0o700);
    for (const file of expectedFiles) {
      assert.equal(fs.statSync(path.join(fixture.outDir, file)).mode & 0o777, 0o600, file);
    }
  }

  const events = readJsonLines(
    path.join(fixture.outDir, "incremental-change-set-conversion-events.jsonl"),
  );
  const delta = readJsonLines(path.join(fixture.outDir, "incremental-change-set-delta.jsonl"));
  const cliInput = readJsonLines(path.join(fixture.outDir, "dataset-save-draft-input.jsonl"));
  const noWrite = readJsonLines(path.join(fixture.outDir, "incremental-change-set-no-write.jsonl"));
  const holds = readJsonLines(path.join(fixture.outDir, "incremental-change-set-holds.jsonl"));
  const contract = readJson(
    path.join(fixture.outDir, "dataset-save-draft-execution-contract.json"),
  );
  assert.equal(events.length, 8);
  assert.equal(new Set(events.map((event) => event.conversion_id)).size, 8);
  assert.ok(events.every((event) => event.terminal && event.output.row_sha256));
  assert.equal(events[0].previous_event_sha256, null);
  for (let index = 1; index < events.length; index += 1) {
    assert.equal(events[index].previous_event_sha256, events[index - 1].event_sha256);
  }
  const noiseEvent = events.find((event) => event.conversion_id === "source-noise");
  assert.equal(
    noiseEvent.input_refs.old.semantic_sha256,
    noiseEvent.input_refs.candidate.semantic_sha256,
  );
  assert.equal(
    noiseEvent.input_refs.candidate.semantic_sha256,
    noiseEvent.input_refs.current.semantic_sha256,
  );
  assert.notEqual(
    noiseEvent.input_refs.old.payload_sha256,
    noiseEvent.input_refs.candidate.payload_sha256,
  );
  assert.equal(noiseEvent.evidence.policy_sha256, bytesSha256(fixture.policyPath));
  assert.equal(noiseEvent.evidence.noise_evidence_sha256.length, 1);
  const curatedEvent = events.find((event) => event.conversion_id === "source-curated");
  assert.equal(curatedEvent.evidence.preserve_owner_evidence_sha256.length, 1);
  assert.deepEqual(curatedEvent.evidence.take_candidate_evidence_sha256, []);
  assert.deepEqual(curatedEvent.evidence.stable_array_evidence_sha256, []);
  assert.deepEqual(delta, cliInput);
  assert.equal(noWrite.length, 3);
  assert.equal(holds.length, 1);
  assert.deepEqual(holds[0].reason_codes, ["HOLD_DELETE_FORBIDDEN"]);
  assert.equal(contract.actions.length, 4);
  assert.deepEqual(
    contract.actions.map((action) => action.expected_operation),
    ["insert", "insert", "save_draft", "save_draft"],
  );
  contract.actions.forEach((action, index) => {
    assert.equal(action.desired_sha256, fixtureSha256Json(delta[index]));
    assert.equal(action.before_sha256 === null, action.expected_operation === "insert");
    const earlier = new Set(contract.actions.slice(0, index).map((entry) => entry.action_id));
    assert.ok(action.dependency_action_ids.every((dependency) => earlier.has(dependency)));
  });
  assert.deepEqual(contract.actions[1].dependency_action_ids, [contract.actions[0].action_id]);

  const report = readJson(path.join(fixture.outDir, "incremental-change-set-report.json"));
  const manifest = readJson(path.join(fixture.outDir, "incremental-change-set-manifest.json"));
  assert.equal(report.production_authority, false);
  assert.equal(report.algebra.passed, true);
  assert.equal(report.algebra.delete_actions_zero, true);
  assert.equal(report.execution_requirements.allow_account_local_support, false);
  assert.equal(report.execution_requirements.support_action_count, 0);
  assert.equal(
    manifest.input_artifacts.owner_snapshot_receipt.sha256,
    bytesSha256(fixture.receiptPath),
  );
  assert.equal(manifest.output_artifacts.length, 9);
  assertCompositionHashes(fixture, result);
});

test("all six CLI table identities accept their exact TIDAS roots, including flowPropertiesInformation", () => {
  const fixture = createIncrementalChangeSetFixture(
    "six-table-identities",
    ({ comparisons, owner, ownerRows, projectRef, settings }) => {
      comparisons.splice(0);
      ownerRows.splice(0);
      fixtureTables.forEach((table, index) => {
        const id = `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
        const payload = fixturePayload(table, id, { name: `${table} fixture` });
        comparisons.push(fixtureComparison(`${table}-exact`, table, id, payload, payload));
        ownerRows.push(fixtureOwnerRow(table, id, payload, owner, projectRef));
      });
      settings.allowedTables = [...fixtureTables];
    },
  );
  const flowProperty = fixture.comparisons.find(
    (row) => row.entity.table === "flowproperties",
  ).old_payload;
  assert.ok(flowProperty.flowPropertyDataSet.flowPropertiesInformation);
  const result = compose(fixture);
  assert.equal(result.code, 0);
  assert.equal(result.json.status, "completed_no_actions");
  assert.equal(result.json.counts.no_write, 6);
  assert.equal(result.json.counts.hold, 0);
});

test("missing dataset version is rejected before any output is admitted", () => {
  const fixture = createIncrementalChangeSetFixture("missing-version", ({ comparisons }) => {
    comparisons[0].entity.version = "";
  });
  const result = composeRaw(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /version|schema/u);
  assert.equal(fs.existsSync(fixture.outDir), false);
});

test("incremental composer globally rejects a foreign owner while logging every conversion", () => {
  const fixture = createIncrementalChangeSetFixture("foreign-owner", ({ ownerRows }) => {
    ownerRows[0].owner.user_id = "20000000-0000-4000-8000-000000000002";
  });
  const result = compose(fixture);
  assert.equal(result.code, 1);
  assert.equal(result.json.status, "rejected");
  assert.equal(result.json.findings.p0, 1);
  assert.equal(result.json.counts.actions, 0);
  assert.equal(result.json.counts.conversion_log_rows, 8);
  assert.equal(
    fs.existsSync(path.join(fixture.outDir, "dataset-save-draft-execution-contract.json")),
    false,
  );
});

test("owner snapshot project mismatch is rejected before any output is admitted", () => {
  const fixture = createIncrementalChangeSetFixture("foreign-project", ({ ownerRows }) => {
    ownerRows[0].project_ref = "different-project-ref";
  });
  const result = composeRaw(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /project.*binding|binding.*project/iu);
  assert.equal(fs.existsSync(fixture.outDir), false);
});

test("incremental composer rejects input hash drift, receipt drift, and immutable output reuse", async (t) => {
  await t.test("comparison hash drift", () => {
    const fixture = createIncrementalChangeSetFixture("hash-drift");
    fs.appendFileSync(fixture.comparisonsPath, "\n");
    const result = composeRaw(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SHA-256 mismatch/u);
    assert.equal(fs.existsSync(fixture.outDir), false);
  });

  await t.test("owner receipt hash drift", () => {
    const fixture = createIncrementalChangeSetFixture("receipt-hash-drift");
    fs.appendFileSync(fixture.receiptPath, "\n");
    const result = composeRaw(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /owner_snapshot_receipt SHA-256 mismatch/u);
    assert.equal(fs.existsSync(fixture.outDir), false);
  });

  await t.test("owner receipt snapshot binding drift", () => {
    const fixture = createIncrementalChangeSetFixture("receipt-content-drift", ({ settings }) => {
      settings.receiptOverrides.snapshot = {
        sha256: "0".repeat(64),
        bytes: 0,
        rows: 0,
      };
    });
    const result = composeRaw(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /receipt.*snapshot|snapshot.*receipt/iu);
    assert.equal(fs.existsSync(fixture.outDir), false);
  });

  await t.test("owner receipt canonical scope binding drift", () => {
    const fixture = createIncrementalChangeSetFixture("receipt-scope-drift", ({ settings }) => {
      settings.receiptOverrides.scope_binding = {
        allowed_target_keys: ["sources/random@01.00.000"],
        allowed_target_keys_sha256: "0".repeat(64),
        canonical_scope_sha256: "0".repeat(64),
      };
    });
    const result = composeRaw(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /scope|target ledger/iu);
    assert.equal(fs.existsSync(fixture.outDir), false);
  });

  await t.test("owner receipt cannot omit a present target row", () => {
    const fixture = createIncrementalChangeSetFixture("receipt-target-gap", ({ settings }) => {
      settings.receiptOverrides.target_ledger = [];
    });
    const result = composeRaw(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /target_ledger|target ledger/iu);
    assert.equal(fs.existsSync(fixture.outDir), false);
  });

  await t.test("immutable output", () => {
    const fixture = createIncrementalChangeSetFixture("immutable-output");
    assert.equal(compose(fixture).code, 0);
    const second = composeRaw(fixture);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /must not already exist/u);
  });
});

test("request update allowlists accept zero update authority but reject root wildcard prefixes", async (t) => {
  const insertOnly = createIncrementalChangeSetFixture("zero-update-authority", ({ settings }) => {
    settings.allowedUpdatePointerPrefixes.flows = [];
  });
  assert.equal(compose(insertOnly).code, 0);

  for (const [name, prefixes] of [
    ["root-empty-token", [""]],
    ["root-slash", ["/"]],
  ]) {
    await t.test(name, () => {
      const fixture = createIncrementalChangeSetFixture(
        `bad-update-scope-${name}`,
        ({ settings }) => {
          settings.allowedUpdatePointerPrefixes.processes = prefixes;
        },
      );
      const result = composeRaw(fixture);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /allowed_update_pointer_prefixes|scope/u);
      assert.equal(fs.existsSync(fixture.outDir), false);
    });
  }
});

test("terminal exclusions bind a readable success receipt and consume one exact candidate action", () => {
  const fixture = createIncrementalChangeSetFixture(
    "terminal-exclusion",
    ({ comparisons, terminalExclusions }) => {
      const flow = comparisons.find((row) => row.conversion_id === "flow-create");
      terminalExclusions.push({
        schema_version: "foundry-incremental-change-set-terminal-exclusion.v1",
        action_id: `flow-create@${flow.candidate_payload_sha256}`,
        desired_sha256: flow.candidate_payload_sha256,
      });
    },
  );
  const result = compose(fixture);
  assert.equal(result.code, 0);
  assert.equal(result.json.status, "completed_with_holds");
  assert.equal(result.json.counts.actions, 3);
  const noWrites = new Map(
    readJsonLines(path.join(fixture.outDir, "incremental-change-set-no-write.jsonl")).map((row) => [
      row.conversion_id,
      row,
    ]),
  );
  assert.deepEqual(noWrites.get("flow-create").reason_codes, ["NOOP_TERMINAL_SUCCESS"]);
  const contract = readJson(
    path.join(fixture.outDir, "dataset-save-draft-execution-contract.json"),
  );
  assert.ok(contract.actions.every((action) => !action.action_id.startsWith("flow-create@")));
  assert.ok(contract.actions.some((action) => action.action_id.startsWith("process-create@")));
  assert.ok(
    contract.actions.some((action) => action.action_id.startsWith("process-independent-update@")),
  );
  const events = readJsonLines(
    path.join(fixture.outDir, "incremental-change-set-conversion-events.jsonl"),
  );
  const event = events.find((row) => row.conversion_id === "flow-create");
  assert.equal(event.outcome.terminal_success.receipt_status, "success");
  assert.equal(event.outcome.terminal_success.receipt_bytes > 0, true);
  assert.equal(event.dependencies.dispositions.length, 1);
  const process = events.find((row) => row.conversion_id === "process-create");
  assert.deepEqual(process.dependencies.dispositions, [
    { dependency_conversion_id: "flow-create", disposition: "satisfied_terminal_success" },
  ]);
  const report = readJson(path.join(fixture.outDir, "incremental-change-set-report.json"));
  assert.equal(report.algebra.terminal_replay_zero, true);
});

test("malformed, drifted, or duplicate terminal success receipts are rejected", async (t) => {
  const cases = [
    [
      "bad-schema",
      (row) => {
        row.schema_version = "wrong-terminal-schema";
      },
    ],
    [
      "desired-mismatch",
      (row) => {
        row.desired_sha256 = "0".repeat(64);
      },
    ],
    [
      "bad-receipt-sha",
      (_row, _terminalExclusions, settings) => {
        settings.terminalReceiptReferenceOverrides.sha256 = "0".repeat(64);
      },
    ],
    ["duplicate", (_row, terminalExclusions) => terminalExclusions.push({ ..._row })],
  ];
  for (const [name, corrupt] of cases) {
    await t.test(name, () => {
      const fixture = createIncrementalChangeSetFixture(
        `terminal-${name}`,
        ({ comparisons, settings, terminalExclusions }) => {
          const flow = comparisons.find((row) => row.conversion_id === "flow-create");
          const row = {
            schema_version: "foundry-incremental-change-set-terminal-exclusion.v1",
            action_id: `flow-create@${flow.candidate_payload_sha256}`,
            desired_sha256: flow.candidate_payload_sha256,
          };
          terminalExclusions.push(row);
          corrupt(row, terminalExclusions, settings);
        },
      );
      const result = composeRaw(fixture);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /terminal/i);
      assert.equal(fs.existsSync(fixture.outDir), false);
    });
  }
});

test("terminal exclusion consumes an exact-current recovery NOOP", () => {
  const fixture = createIncrementalChangeSetFixture(
    "terminal-exact-current-recovery",
    ({ comparisons, ownerRows, terminalExclusions }) => {
      const comparison = comparisons.find(
        (row) => row.conversion_id === "process-independent-update",
      );
      const ownerRow = ownerRows.find((row) => row.entity.id === comparison.entity.id);
      ownerRow.json_ordered = comparison.new_payload;
      ownerRow.payload_sha256 = comparison.candidate_payload_sha256;
      terminalExclusions.push({
        schema_version: "foundry-incremental-change-set-terminal-exclusion.v1",
        action_id: `process-independent-update@${comparison.candidate_payload_sha256}`,
        desired_sha256: comparison.candidate_payload_sha256,
      });
    },
  );
  const result = compose(fixture);
  assert.equal(result.code, 0);
  const noWrites = readJsonLines(
    path.join(fixture.outDir, "incremental-change-set-no-write.jsonl"),
  );
  assert.deepEqual(
    noWrites.find((row) => row.conversion_id === "process-independent-update").reason_codes,
    ["NOOP_TERMINAL_SUCCESS_RECOVERED"],
  );
  const contract = readJson(
    path.join(fixture.outDir, "dataset-save-draft-execution-contract.json"),
  );
  assert.ok(
    contract.actions.every((action) => !action.action_id.startsWith("process-independent-update@")),
  );
});

test("unmatched random terminal success receipt is rejected before output", () => {
  const fixture = createIncrementalChangeSetFixture(
    "terminal-unmatched",
    ({ terminalExclusions }) => {
      const desired = "a".repeat(64);
      terminalExclusions.push({
        schema_version: "foundry-incremental-change-set-terminal-exclusion.v1",
        action_id: `random-action@${desired}`,
        desired_sha256: desired,
      });
    },
  );
  const result = composeRaw(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must consume exactly one/iu);
  assert.equal(fs.existsSync(fixture.outDir), false);
});

test("an absent NOOP cannot satisfy a dependency and holds only its descendant closure", () => {
  const fixture = createIncrementalChangeSetFixture(
    "absent-dependency",
    ({ comparisons, ownerRows }) => {
      const absent = comparisons.find((row) => row.conversion_id === "ug-exact");
      absent.old_payload = null;
      absent.new_payload = null;
      absent.old_payload_sha256 = null;
      absent.candidate_payload_sha256 = null;
      const index = ownerRows.findIndex((row) => row.entity.id === absent.entity.id);
      ownerRows.splice(index, 1);
    },
  );
  const result = compose(fixture);
  assert.equal(result.code, 0);
  const holds = new Map(
    readJsonLines(path.join(fixture.outDir, "incremental-change-set-holds.jsonl")).map((row) => [
      row.conversion_id,
      row,
    ]),
  );
  assert.deepEqual(holds.get("flow-create").reason_codes, ["HOLD_DEPENDENCY_ABSENT"]);
  assert.ok(holds.get("process-create").reason_codes.includes("HOLD_DEPENDENCY"));
  const contract = readJson(
    path.join(fixture.outDir, "dataset-save-draft-execution-contract.json"),
  );
  assert.deepEqual(
    contract.actions.map((action) => action.action_id.split("@")[0]),
    ["process-numeric-update", "process-independent-update"],
  );
});

test("blank, object, and duplicate dependency declarations are schema failures", async (t) => {
  const cases = [
    ["blank", [" "]],
    ["object", [{ conversion_id: "ug-exact" }]],
    ["duplicate", ["ug-exact", "ug-exact"]],
  ];
  for (const [name, dependencies] of cases) {
    await t.test(name, () => {
      const fixture = createIncrementalChangeSetFixture(
        `dependency-schema-${name}`,
        ({ comparisons }) => {
          comparisons.find((row) => row.conversion_id === "flow-create").dependency_conversion_ids =
            dependencies;
        },
      );
      const result = composeRaw(fixture);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /dependency/i);
      assert.equal(fs.existsSync(fixture.outDir), false);
    });
  }
});

test("dependency cycles hold only the affected action closure", () => {
  const fixture = createIncrementalChangeSetFixture("dependency-cycle", ({ comparisons }) => {
    comparisons.find(
      (row) => row.conversion_id === "process-numeric-update",
    ).dependency_conversion_ids = ["process-independent-update"];
    comparisons.find(
      (row) => row.conversion_id === "process-independent-update",
    ).dependency_conversion_ids = ["process-numeric-update"];
  });
  const result = compose(fixture);
  assert.equal(result.code, 0);
  assert.equal(result.json.counts.actions, 2);
  const holds = readJsonLines(path.join(fixture.outDir, "incremental-change-set-holds.jsonl"));
  const cycleRows = holds.filter((row) => row.reason_codes.includes("HOLD_DEPENDENCY_CYCLE"));
  assert.equal(cycleRows.length, 2);
  const contract = readJson(
    path.join(fixture.outDir, "dataset-save-draft-execution-contract.json"),
  );
  assert.deepEqual(
    contract.actions.map((action) => action.action_id.split("@")[0]),
    ["flow-create", "process-create"],
  );
});

test("reordered or duplicate array identities become HOLD dispositions", async (t) => {
  const cases = [
    {
      name: "reordered",
      oldItems: [
        { id: "a", amount: 1 },
        { id: "b", amount: 1 },
      ],
      candidateItems: [
        { id: "b", amount: 2 },
        { id: "a", amount: 1 },
      ],
      currentItems: [
        { id: "a", amount: 1 },
        { id: "b", amount: 3 },
      ],
    },
    {
      name: "duplicate",
      oldItems: [
        { id: "a", amount: 1 },
        { id: "a", amount: 2 },
      ],
      candidateItems: [
        { id: "a", amount: 3 },
        { id: "a", amount: 4 },
      ],
      currentItems: [
        { id: "a", amount: 5 },
        { id: "a", amount: 6 },
      ],
    },
  ];
  for (const { name, oldItems, candidateItems, currentItems } of cases) {
    await t.test(name, () => {
      const fixture = createIncrementalChangeSetFixture(
        `array-${name}`,
        ({ comparisons, owner, ownerRows, policy, projectRef }) => {
          comparisons.splice(0);
          ownerRows.splice(0);
          const id = "40000000-0000-4000-8000-000000000001";
          const oldPayload = fixturePayload("processes", id, { items: oldItems });
          const candidatePayload = fixturePayload("processes", id, {
            items: candidateItems,
          });
          const currentPayload = fixturePayload("processes", id, { items: currentItems });
          comparisons.push(
            fixtureComparison(
              "process-array-update",
              "processes",
              id,
              oldPayload,
              candidatePayload,
            ),
          );
          ownerRows.push(fixtureOwnerRow("processes", id, currentPayload, owner, projectRef));
          policy.table_policies.processes.array_merge_rules.push(
            fixtureBoundRule({
              entityKey: fixtureEntityKey("processes", id),
              pointer: `${fixtureUpdatePointer("processes")}/items`,
              oldValue: oldItems,
              candidateValue: candidateItems,
              currentValue: currentItems,
              mode: "stable_identity_by_index_v1",
              element_identity_pointer: "/id",
              evidence: { source: `${name}-array-review` },
            }),
          );
        },
      );
      const result = compose(fixture);
      assert.equal(result.code, 0);
      assert.equal(result.json.status, "completed_with_holds");
      assert.equal(result.json.counts.actions, 0);
      const holds = readJsonLines(path.join(fixture.outDir, "incremental-change-set-holds.jsonl"));
      assert.deepEqual(holds[0].reason_codes, ["HOLD_ARRAY_IDENTITY_UNSTABLE"]);
      assert.deepEqual(holds[0].conflicts, [
        {
          pointer: `${fixtureUpdatePointer("processes")}/items`,
          reason: "array_identity_unstable",
        },
      ]);
    });
  }
});

test("zero-action composition emits logs and reports but no consumable empty CLI contract", () => {
  const fixture = createIncrementalChangeSetFixture(
    "zero-actions",
    ({ comparisons, owner, ownerRows, projectRef }) => {
      comparisons.splice(0);
      ownerRows.splice(0);
      const id = "30000000-0000-4000-8000-000000000001";
      const payload = fixturePayload("sources", id, { name: "Exact source" });
      comparisons.push(fixtureComparison("source-exact", "sources", id, payload, payload));
      ownerRows.push(fixtureOwnerRow("sources", id, payload, owner, projectRef));
    },
  );
  const result = compose(fixture);
  assert.equal(result.code, 0);
  assert.equal(result.json.status, "completed_no_actions");
  assert.equal(result.json.counts.actions, 0);
  assert.equal(result.json.counts.conversion_log_rows, 1);
  assert.equal(
    fs.existsSync(path.join(fixture.outDir, "dataset-save-draft-execution-contract.json")),
    false,
  );
  const manifest = readJson(path.join(fixture.outDir, "incremental-change-set-manifest.json"));
  assert.equal(
    manifest.output_artifacts.some(
      (artifact) => artifact.path === "dataset-save-draft-execution-contract.json",
    ),
    false,
  );
});

test("account-local unitgroup/flowproperty actions require the explicit request flag and are reported", async (t) => {
  function supportFixture(name, allowAccountLocalSupport) {
    return createIncrementalChangeSetFixture(name, ({ comparisons, ids, ownerRows, settings }) => {
      comparisons.splice(0);
      ownerRows.splice(0);
      const payload = fixturePayload("unitgroups", ids.unitgroup, { name: "New support" });
      comparisons.push(
        fixtureComparison("unitgroup-create", "unitgroups", ids.unitgroup, null, payload),
      );
      settings.allowAccountLocalSupport = allowAccountLocalSupport;
    });
  }

  await t.test("flag false holds support", () => {
    const fixture = supportFixture("support-not-authorized", false);
    const result = compose(fixture);
    assert.equal(result.code, 0);
    assert.equal(result.json.counts.actions, 0);
    const holds = readJsonLines(path.join(fixture.outDir, "incremental-change-set-holds.jsonl"));
    assert.deepEqual(holds[0].reason_codes, ["HOLD_SUPPORT_ACTION_NOT_AUTHORIZED"]);
    const report = readJson(path.join(fixture.outDir, "incremental-change-set-report.json"));
    assert.equal(report.execution_requirements.allow_account_local_support, false);
    assert.equal(report.execution_requirements.support_action_count, 0);
  });

  await t.test("flag true emits and reports support", () => {
    const fixture = supportFixture("support-authorized", true);
    const result = compose(fixture);
    assert.equal(result.code, 0);
    assert.equal(result.json.counts.actions, 1);
    const report = readJson(path.join(fixture.outDir, "incremental-change-set-report.json"));
    assert.equal(report.execution_requirements.allow_account_local_support, true);
    assert.equal(report.execution_requirements.support_action_count, 1);
    const contract = readJson(
      path.join(fixture.outDir, "dataset-save-draft-execution-contract.json"),
    );
    assert.equal(contract.actions[0].table, "unitgroups");
  });
});

test("incremental composer has no network, database, subprocess, or dataset-specific literal", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "scripts", "commands", "incremental-change-set.ts"),
    "utf8",
  );
  for (const forbidden of [
    "node:child_process",
    "node:http",
    "node:https",
    "node:net",
    "fetch(",
    "spawn(",
    "execFile(",
    "spawnSync(",
    "bafudata@",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
