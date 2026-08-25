import test from "node:test";
import {
  assert,
  crypto,
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  spawnSync,
  testTmpRoot,
  writeJson,
} from "../fixtures/foundry-core.ts";

const scopeBinding = crypto.createHash("sha256").update("generic-fixture-scope").digest("hex");
const toolchainFingerprint = crypto
  .createHash("sha256")
  .update("generic-fixture-toolchain")
  .digest("hex");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function refreshLeaf(stageDir, leaf) {
  const buffer = fs.readFileSync(path.join(stageDir, leaf.path));
  leaf.raw_hash = {
    algorithm: "sha256",
    sha256: hashBuffer(buffer),
    bytes: buffer.byteLength,
  };
  const semantic =
    leaf.semantic_hash.canonicalizer_id === "canonical-json-v1"
      ? Buffer.from(JSON.stringify(stableValue(JSON.parse(buffer.toString("utf8")))), "utf8")
      : buffer;
  leaf.semantic_hash.sha256 = hashBuffer(
    Buffer.concat([Buffer.from(`${leaf.semantic_hash.domain}\0`, "utf8"), semantic]),
  );
}

function createFixture(name, mutate = () => {}) {
  const root = testTmpRoot(`execution-capsule-${name}`);
  const stageDir = path.join(root, "stage");
  const outDir = path.join(root, "admission");
  fs.rmSync(root, { recursive: true, force: true });

  const payloadPath = path.join(stageDir, "desired-payload.json");
  const consumerProgramPath = path.join(stageDir, "consumer.mjs");
  const boundaryPath = path.join(stageDir, "consumer-boundary.json");
  const reviewerPath = path.join(stageDir, "reviewer-report.json");
  const materializedBoundary = {
    cwd: "/workspace/generic-task",
    argv: ["node", "consumer.mjs", "--payload", "desired-payload.json"],
    program_path: "consumer.mjs",
    declared_fields: ["action_id", "desired_sha256"],
    producer_outputs: { payload: "desired-payload.json" },
    consumer_inputs: { payload: "desired-payload.json" },
    network_mode: "disabled",
  };
  const boundary = {
    schema_version: "foundry-execution-capsule-boundary.v1",
    required: materializedBoundary,
    observed: {
      ...structuredClone(materializedBoundary),
      network_dispatch_count: 0,
      database_dispatch_count: 0,
    },
  };
  const reviewer = {
    schema_version: "generic-independent-review.v1",
    status: "PASS",
    reviewer_id: "independent-reviewer",
    scope_binding_sha256: scopeBinding,
    reviewed_leaf_ids: ["desired-payload", "consumer-program"],
    findings: { p0: 0, p1: 0 },
  };
  writeJson(payloadPath, {
    schema_version: "generic-desired-payload.v1",
    actions: [{ action_id: "generic-action-1", desired_value: "ready" }],
  });
  fs.writeFileSync(consumerProgramPath, "export const consume = (payload) => payload;\n");
  writeJson(boundaryPath, boundary);
  writeJson(reviewerPath, reviewer);

  const leaves = [
    {
      leaf_id: "desired-payload",
      role: "desired_payload",
      path: "desired-payload.json",
      raw_hash: {},
      semantic_hash: {
        algorithm: "sha256",
        domain: "generic-desired-payload.v1",
        canonicalizer_id: "canonical-json-v1",
      },
      scope_binding_sha256: scopeBinding,
      dependency_leaf_ids: [],
      freshness_class: "SEMANTIC_IMMUTABLE",
      freshness: {},
      executable_input: true,
    },
    {
      leaf_id: "consumer-program",
      role: "consumer_program",
      path: "consumer.mjs",
      raw_hash: {},
      semantic_hash: {
        algorithm: "sha256",
        domain: "generic-consumer-program.v1",
        canonicalizer_id: "raw-bytes-v1",
      },
      scope_binding_sha256: scopeBinding,
      dependency_leaf_ids: [],
      freshness_class: "TOOLCHAIN_BOUND",
      freshness: { toolchain_fingerprint_sha256: toolchainFingerprint },
      executable_input: true,
    },
    {
      leaf_id: "consumer-boundary",
      role: "consumer_boundary_contract",
      path: "consumer-boundary.json",
      raw_hash: {},
      semantic_hash: {
        algorithm: "sha256",
        domain: "foundry-execution-capsule-boundary.v1",
        canonicalizer_id: "canonical-json-v1",
      },
      scope_binding_sha256: scopeBinding,
      dependency_leaf_ids: ["desired-payload"],
      freshness_class: "TOOLCHAIN_BOUND",
      freshness: { toolchain_fingerprint_sha256: toolchainFingerprint },
      executable_input: false,
    },
    {
      leaf_id: "reviewer-report",
      role: "reviewer_report",
      path: "reviewer-report.json",
      raw_hash: {},
      semantic_hash: {
        algorithm: "sha256",
        domain: "generic-independent-review.v1",
        canonicalizer_id: "canonical-json-v1",
      },
      scope_binding_sha256: scopeBinding,
      dependency_leaf_ids: ["desired-payload", "consumer-boundary"],
      freshness_class: "DERIVED_REPORT",
      freshness: {},
      executable_input: false,
    },
  ];
  for (const leaf of leaves) refreshLeaf(stageDir, leaf);

  const manifest = {
    schema_version: "foundry-execution-capsule-stage.v1",
    stage_id: `generic-${name}`,
    producer_id: "generic-producer",
    revision: 1,
    predecessor_stage_manifest_sha256: null,
    stage_root: ".",
    admission_mode: "OFFLINE_ONLY",
    production_authority: false,
    scope_binding_sha256: scopeBinding,
    attempt_state: {
      status: "UNATTEMPTED",
      attempt_count: 0,
      primary_attempt_count: 0,
      dispatch_state: "NOT_DISPATCHED",
      mutation_state: "NONE",
      readback_state: "NOT_STARTED",
    },
    findings: { p0: 0, p1: 0 },
    leaves,
    boundary_contract_leaf_id: "consumer-boundary",
    reviewer_report_leaf_ids: ["reviewer-report"],
  };

  mutate({ boundary, leaves, manifest, reviewer, stageDir });
  const manifestPath = path.join(stageDir, "revision-0001.json");
  writeJson(manifestPath, manifest);
  return { manifestPath, outDir, root, stageDir };
}

function admit(fixture, predecessorManifestPath = null) {
  const args = [
    "execution-capsule-admit",
    "--stage-manifest",
    rel(fixture.manifestPath),
    "--out-dir",
    rel(fixture.outDir),
  ];
  if (predecessorManifestPath) {
    args.push("--predecessor-stage-manifest", rel(predecessorManifestPath));
  }
  return runFoundry(args);
}

test("execution capsule command has no network, database, or subprocess dispatch surface", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "scripts", "commands", "execution-capsule.ts"),
    "utf8",
  );
  for (const forbidden of [
    "node:child_process",
    "node:http",
    "node:https",
    "node:net",
    "fetch(",
    "spawn(",
    "exec(",
  ]) {
    assert.equal(source.includes(forbidden), false, `unexpected dispatch surface: ${forbidden}`);
  }
});

test("execution capsule admission seals exact offline evidence", () => {
  const fixture = createFixture("pass");
  const result = admit(fixture);

  assert.equal(result.code, 0);
  assert.equal(result.json.status, "sealed");
  assert.equal(result.json.counts.p0, 0);
  assert.equal(result.json.counts.p1, 0);
  assert.equal(result.json.counts.primary_attempts, 0);
  assert.equal(result.json.counts.network_dispatches, 0);
  assert.equal(result.json.counts.database_dispatches, 0);
  assert.equal(result.json.counts.mutations, 0);

  const report = readJson(path.join(fixture.outDir, "execution-capsule-admission-report.json"));
  const seal = readJson(path.join(fixture.outDir, "execution-capsule-seal.json"));
  const ledger = readJsonLines(
    path.join(fixture.outDir, "execution-capsule-admission-ledger.jsonl"),
  );
  assert.equal(report.status, "sealed");
  assert.equal(report.failed_checks.length, 0);
  assert.ok(ledger.length > 40);
  assert.ok(ledger.every((row) => row.status === "PASS"));
  assert.equal(seal.schema_version, "foundry-execution-capsule-seal.v1");
  assert.equal(seal.production_authority, false);
  assert.equal(seal.attempt_state.attempt_count, 0);
  assert.match(seal.seal_payload_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    fs.readFileSync(path.join(fixture.outDir, "execution-capsule-stage-revision.json"), "utf8"),
    fs.readFileSync(fixture.manifestPath, "utf8"),
  );
});

test("execution capsule admission verifies exact predecessor revision lineage", () => {
  const predecessor = createFixture("lineage-predecessor", ({ manifest }) => {
    manifest.stage_id = "generic-lineage";
  });
  const successor = createFixture("lineage-successor", ({ manifest }) => {
    manifest.stage_id = "generic-lineage";
    manifest.revision = 2;
    manifest.predecessor_stage_manifest_sha256 = hashBuffer(
      fs.readFileSync(predecessor.manifestPath),
    );
  });

  const result = admit(successor, predecessor.manifestPath);
  assert.equal(result.code, 0);
  assert.equal(result.json.status, "sealed");
});

test("execution capsule admission rejects an unproven predecessor hash", () => {
  const predecessor = createFixture("lineage-wrong-predecessor", ({ manifest }) => {
    manifest.stage_id = "generic-lineage-wrong";
  });
  const successor = createFixture("lineage-wrong-successor", ({ manifest }) => {
    manifest.stage_id = "generic-lineage-wrong";
    manifest.revision = 2;
    manifest.predecessor_stage_manifest_sha256 = toolchainFingerprint;
  });

  const result = admit(successor, predecessor.manifestPath);
  assert.equal(result.code, 1);
  assert.equal(result.json.status, "rejected");
  const report = readJson(path.join(successor.outDir, "execution-capsule-admission-report.json"));
  assert.ok(report.failed_checks.includes("stage_predecessor_hash_exact"));
  assert.equal(fs.existsSync(path.join(successor.outDir, "execution-capsule-seal.json")), false);
});

const mutationVectors = [
  {
    name: "tampered-raw-bytes",
    expected: "leaf_raw_hash:desired-payload",
    mutate({ stageDir }) {
      fs.appendFileSync(path.join(stageDir, "desired-payload.json"), " ");
    },
  },
  {
    name: "materialized-argv-drift",
    expected: "boundary_exact_argv",
    mutate({ boundary, leaves, stageDir }) {
      boundary.observed.argv = ["node", "different-consumer.mjs"];
      writeJson(path.join(stageDir, "consumer-boundary.json"), boundary);
      refreshLeaf(
        stageDir,
        leaves.find((leaf) => leaf.leaf_id === "consumer-boundary"),
      );
    },
  },
  {
    name: "missing-materialized-boundary-fields",
    expected: "boundary_materialized_shape",
    mutate({ boundary, leaves, stageDir }) {
      delete boundary.required.cwd;
      delete boundary.required.program_path;
      delete boundary.required.declared_fields;
      delete boundary.observed.cwd;
      delete boundary.observed.program_path;
      delete boundary.observed.declared_fields;
      writeJson(path.join(stageDir, "consumer-boundary.json"), boundary);
      refreshLeaf(
        stageDir,
        leaves.find((leaf) => leaf.leaf_id === "consumer-boundary"),
      );
    },
  },
  {
    name: "reviewer-coverage-not-an-array",
    expected: "reviewer_report_coverage_shape:reviewer-report",
    mutate({ leaves, reviewer, stageDir }) {
      reviewer.reviewed_leaf_ids = "desired-payload consumer-program";
      writeJson(path.join(stageDir, "reviewer-report.json"), reviewer);
      refreshLeaf(
        stageDir,
        leaves.find((leaf) => leaf.leaf_id === "reviewer-report"),
      );
    },
  },
  {
    name: "scope-drift",
    expected: "scope_leaf_binding:desired-payload",
    mutate({ leaves }) {
      leaves[0].scope_binding_sha256 = toolchainFingerprint;
    },
  },
  {
    name: "semantic-domain-relabel",
    expected: "leaf_semantic_hash:desired-payload",
    mutate({ leaves }) {
      leaves[0].semantic_hash.domain = "different-semantic-domain.v1";
    },
  },
  {
    name: "dependency-cycle",
    expected: "dependency_acyclic",
    mutate({ leaves }) {
      leaves[0].dependency_leaf_ids = ["reviewer-report"];
    },
  },
  {
    name: "consumed-attempt",
    expected: "attempt_unconsumed",
    mutate({ manifest }) {
      manifest.attempt_state.status = "ATTEMPTED";
      manifest.attempt_state.attempt_count = 1;
      manifest.attempt_state.primary_attempt_count = 1;
      manifest.attempt_state.dispatch_state = "DISPATCH_CONFIRMED";
    },
  },
  {
    name: "stale-live-leaf",
    expected: "freshness_live:desired-payload",
    mutate({ leaves }) {
      leaves[0].freshness_class = "LIVE_RECONCILIATION";
      leaves[0].freshness = {};
    },
  },
];

for (const vector of mutationVectors) {
  test(`execution capsule rejects mutation vector: ${vector.name}`, () => {
    const fixture = createFixture(vector.name, vector.mutate);
    const result = admit(fixture);

    assert.equal(result.code, 1);
    assert.equal(result.json.status, "rejected");
    assert.equal(result.json.seal, null);
    assert.equal(fs.existsSync(path.join(fixture.outDir, "execution-capsule-seal.json")), false);
    const report = readJson(path.join(fixture.outDir, "execution-capsule-admission-report.json"));
    assert.ok(report.failed_checks.includes(vector.expected), report.failed_checks.join("\n"));
    assert.ok(report.counts.p0 + report.counts.p1 > 0);
    assert.equal(report.counts.primary_attempts, 0);
    assert.equal(report.counts.network_dispatches, 0);
    assert.equal(report.counts.database_dispatches, 0);
    assert.equal(report.counts.mutations, 0);
  });
}

test("execution capsule admission refuses to overwrite immutable evidence", () => {
  const fixture = createFixture("immutable-output");
  assert.equal(admit(fixture).code, 0);
  const second = spawnSync(
    process.execPath,
    [
      "scripts/foundry.mjs",
      "execution-capsule-admit",
      "--stage-manifest",
      rel(fixture.manifestPath),
      "--out-dir",
      rel(fixture.outDir),
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(second.status, 1);
  assert.match(second.stderr, /already exists and is immutable/u);
});
