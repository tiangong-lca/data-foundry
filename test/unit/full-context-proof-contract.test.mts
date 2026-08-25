import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as fullContext from "../../scripts/lib/import-curation/internal/full-context-proof.ts";
import { sha256Json, sha256Text } from "../../scripts/lib/import-curation/internal/hash-utils.ts";

type JsonRecord = Record<string, unknown>;

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeText(filePath, text);
  return text;
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function withTempRoot(name: string, body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const contextFiles = [
  { kind: "schema", path: "context/schema.json", text: '{"type":"object"}' },
  { kind: "methodology_yaml", path: "context/methodology.yaml", text: "rules: true\n" },
];

test("context discovery and resolution preserve aliases, coercion, order, bytes, and native TypeError", () => {
  const artifact = {
    value: {
      context: {
        contract_context_file_details: [
          { kind: " schema ", path: "Context/TIDAS_FLOWS_PRODUCT_CATEGORY.JSON" },
        ],
        contract_context_files: ["Context/Methodology.YAML", "Context/runtime-ruleset.json"],
      },
    },
  };
  assert.equal(fullContext.curationGateContextHasKind(artifact, "schema"), true);
  assert.equal(fullContext.curationGateContextHasKind(artifact, "methodology_yaml"), true);
  assert.equal(fullContext.curationGateContextHasKind(artifact, "ruleset"), true);
  assert.equal(fullContext.curationGateContextHasKind(artifact, "location_schema"), false);
  assert.equal(
    fullContext.curationGateContextHasPattern(artifact, "tidas_flows_product_category.json"),
    true,
  );
  assert.equal(fullContext.curationGateContextHasPattern(artifact, "METHODOLOGY.yaml"), true);
  assert.equal(fullContext.curationGateContextHasPattern(artifact, "missing.json"), false);
  assert.throws(
    () => fullContext.curationGateContextHasPattern(artifact, null),
    (error: unknown) => error instanceof TypeError,
  );

  const resolution = {
    resolution: {
      mode: " source_trace_verified ",
      usedContextKinds: [" schema ", "", null, "schema", " methodology_yaml "],
    },
  };
  assert.equal(fullContext.evidenceResolution(resolution), resolution.resolution);
  assert.equal(fullContext.evidenceResolution({ resolution: [] }), null);
  assert.equal(fullContext.evidenceResolution(null), null);
  assert.equal(fullContext.evidenceResolutionMode(resolution), "source_trace_verified");
  assert.equal(fullContext.evidenceResolutionMode({ resolution: "invalid" }), "");
  assert.deepEqual(fullContext.evidenceResolutionContextKinds(resolution), [
    "schema",
    "schema",
    "methodology_yaml",
  ]);

  assert.equal(fullContext.contextFileHasNonEmptyText({ text: "" }), false);
  assert.equal(fullContext.contextFileHasNonEmptyText({ text: " " }), true);
  assert.equal(fullContext.contextFileHasNonEmptyText({ text: "中" }), true);
  assert.equal(fullContext.contextFilesHaveKind(contextFiles, "schema"), true);
  assert.equal(fullContext.contextFilesHaveKind([{ kind: "schema", text: "" }], "schema"), false);
  assert.equal(fullContext.contextFilesHavePattern(contextFiles, "SCHEMA.JSON"), true);
  assert.equal(fullContext.contextFilesHavePattern(contextFiles, null), false);
});

test("authoring package proofs preserve exact bytes, path/order, aliases, blockers, and caught parse errors", () => {
  withTempRoot("full-context-package", (root) => {
    const missing = fullContext.readAuthoringPackageProof(
      root,
      "packages/missing.json",
      null,
      "missing-source",
    );
    assert.deepEqual(missing.blockers, [
      {
        code: "full_context_authoring_package_missing",
        stage: "full_context_ai_completion",
        message: "Full-context AI completion evidence references an unreadable authoring package.",
        authoring_package: "packages/missing.json",
        source: "missing-source",
      },
    ]);

    const invalidPath = path.join(root, "packages", "invalid.json");
    const invalidText = "{bad json\n";
    writeText(invalidPath, invalidText);
    const invalid = fullContext.readAuthoringPackageProof(root, invalidPath, null, "invalid");
    assert.equal(invalid.exists, true);
    assert.equal(invalid.sha256, sha256Text(invalidText));
    assert.equal(invalid.payload, null);
    assert.equal(invalid.blockers[0].code, "full_context_authoring_package_invalid");
    assert.match(invalid.blockers[0].message, /JSON/u);

    const arrayPath = path.join(root, "packages", "array.json");
    writeJson(arrayPath, []);
    const arrayProof = fullContext.readAuthoringPackageProof(root, arrayPath);
    assert.equal(arrayProof.blockers[0].message, "Authoring package must be a JSON object.");

    const packagePayload = {
      contract_context_files: contextFiles,
      missing_context_files: ["context/runtime-ruleset.json"],
    };
    const packagePath = path.join(root, "packages", "good.json");
    const packageText = writeJson(packagePath, packagePayload);
    const proof = fullContext.readAuthoringPackageProof(
      root,
      "packages/good.json",
      "wrong-package-sha",
      "curation_gate",
    );
    assert.equal(proof.path, "packages/good.json");
    assert.equal(proof.sha256, sha256Text(packageText));
    assert.equal(proof.expected_sha256, "wrong-package-sha");
    assert.deepEqual(proof.payload, packagePayload);
    assert.deepEqual(proof.contract_context_files, contextFiles);
    assert.deepEqual(
      proof.contract_context_file_details.map((file) => ({
        kind: file.kind,
        path: file.path,
        bytes: file.bytes,
      })),
      [
        { kind: "schema", path: "context/schema.json", bytes: 17 },
        { kind: "methodology_yaml", path: "context/methodology.yaml", bytes: 12 },
      ],
    );
    assert.deepEqual(
      proof.blockers.map((blocker: JsonRecord) => blocker.code),
      ["full_context_authoring_package_hash_mismatch"],
    );

    const completeProof = fullContext.readAuthoringPackageProof(root, packagePath);
    const blockers = fullContext.fullContextPackageProofBlockers({
      requirement: {
        requiredContextKinds: ["ruleset", "location_schema"],
        requiredContextFilePatterns: ["runtime-ruleset.json", "tidas_locations_category.json"],
      },
      proof: completeProof,
    });
    assert.deepEqual(
      blockers.map((blocker: JsonRecord) => blocker.code),
      [
        "full_context_authoring_package_context_kind_missing",
        "full_context_authoring_package_context_kind_missing",
        "full_context_authoring_package_context_file_missing",
        "full_context_authoring_package_context_file_missing",
        "full_context_authoring_package_missing_context_files",
      ],
    );
    assert.deepEqual(
      blockers.slice(0, 2).map((blocker: JsonRecord) => blocker.required_kind),
      ["ruleset", "location_schema"],
    );

    const gateProofs = fullContext.authoringPackageProofsFromCurationGate(root, {
      value: {
        entities: [
          { ignored: true },
          {
            authoringPackage: "packages/good.json",
            authoring_package_sha256: sha256Text(packageText),
          },
        ],
        processes: [{ authoring_package: "ignored-by-entities.json" }],
      },
    });
    assert.equal(gateProofs.length, 1);
    assert.equal(gateProofs[0].source, "curation_gate");
    assert.equal(gateProofs[0].blockers.length, 0);

    const invalidManifestPath = path.join(root, "manifests", "invalid.json");
    writeText(invalidManifestPath, "{bad\n");
    assert.deepEqual(
      fullContext.authoringPackageProofsFromPatchCollect(root, {
        value: { task_manifest: "manifests/invalid.json" },
      }),
      [],
    );
    const manifestPath = path.join(root, "manifests", "tasks.json");
    writeJson(manifestPath, {
      tasks: [
        { files: {} },
        {
          files: { authoringPackage: "packages/good.json" },
          context: { authoring_package_sha256: sha256Text(packageText) },
        },
      ],
    });
    const collected = fullContext.authoringPackageProofsFromPatchCollect(root, {
      value: { task_manifest: "manifests/tasks.json" },
    });
    assert.equal(collected.length, 1);
    assert.equal(collected[0].source, "patch_collect_task_manifest");
  });
});

test("decision task and shared bundle proofs preserve hashes, file order, aliases, and blocker order", () => {
  withTempRoot("full-context-decision", (root) => {
    const missing = fullContext.readDecisionTaskProof(
      root,
      "tasks/missing.json",
      null,
      null,
      "apply",
    );
    assert.equal(missing.blockers[0].code, "full_context_decision_task_missing");

    const invalidPath = path.join(root, "tasks", "invalid.json");
    writeText(invalidPath, "{bad\n");
    const invalid = fullContext.readDecisionTaskProof(root, invalidPath);
    assert.equal(invalid.blockers[0].code, "full_context_decision_task_invalid");
    assert.match(invalid.blockers[0].message, /JSON/u);

    const arrayPath = path.join(root, "tasks", "array.json");
    writeJson(arrayPath, []);
    assert.equal(
      fullContext.readDecisionTaskProof(root, arrayPath).blockers[0].message,
      "Decision task must be a JSON object.",
    );

    const sharedPath = path.join(root, "context", "shared.json");
    writeJson(sharedPath, {
      sha256: "actual-shared-sha",
      files: [{ kind: "ruleset", path: "context/runtime-ruleset.json", text: "rules" }],
    });
    const taskPayload = {
      status: "ready_for_ai_classification_decisions",
      task_kind: "classification_decision_authoring",
      context_bundle: {
        sha256: "actual-context-sha",
        shared_context_bundle: { path: "context/shared.json", sha256: "expected-shared-sha" },
      },
      contract_context_files: [contextFiles[0]],
      missing_context_files: ["context/methodology.yaml"],
    };
    const taskPath = path.join(root, "tasks", "classification.json");
    const taskText = writeJson(taskPath, taskPayload);
    const proof = fullContext.readDecisionTaskProof(
      root,
      "tasks/classification.json",
      "wrong-task-sha",
      "expected-context-sha",
      "classification_apply",
    );
    assert.equal(proof.sha256, sha256Text(taskText));
    assert.equal(proof.status, "ready_for_ai_classification_decisions");
    assert.equal(proof.task_kind, "classification_decision_authoring");
    assert.equal(proof.context_bundle_sha256, "actual-context-sha");
    assert.deepEqual(
      proof.contract_context_files.map((file: JsonRecord) => file.kind),
      ["schema", "ruleset"],
    );
    assert.deepEqual(
      proof.blockers.map((blocker: JsonRecord) => blocker.code),
      [
        "full_context_decision_task_shared_context_bundle_hash_mismatch",
        "full_context_decision_task_hash_mismatch",
        "full_context_decision_task_context_hash_mismatch",
      ],
    );

    const directShared = fullContext.readDecisionTaskSharedContextBundleProof(
      root,
      { files: { shared_context_bundle: "context/shared.json" } },
      "tasks/alias.json",
    );
    assert.equal(directShared.path, "context/shared.json");
    assert.equal(directShared.sha256, "actual-shared-sha");

    const invalidSharedPath = path.join(root, "context", "invalid.json");
    writeText(invalidSharedPath, "{bad\n");
    const invalidShared = fullContext.readDecisionTaskSharedContextBundleProof(
      root,
      { shared_context_bundle: { path: "context/invalid.json" } },
      "tasks/task.json",
    );
    assert.equal(
      invalidShared.blockers[0].code,
      "full_context_decision_task_shared_context_bundle_invalid",
    );
    const missingShared = fullContext.readDecisionTaskSharedContextBundleProof(
      root,
      { shared_context_bundle: { path: "context/missing.json" } },
      "tasks/task.json",
    );
    assert.equal(
      missingShared.blockers[0].code,
      "full_context_decision_task_shared_context_bundle_missing",
    );

    const single = fullContext.decisionTaskProofFromApplyReport(
      root,
      {
        decisionTask: {
          decisionTask: "tasks/classification.json",
          sha256: sha256Text(taskText),
          contextBundleSha256: "actual-context-sha",
        },
      },
      "single",
    );
    assert.ok(single);
    assert.equal(single.source, "single");
    assert.equal(
      single.blockers[0].code,
      "full_context_decision_task_shared_context_bundle_hash_mismatch",
    );
    assert.equal(fullContext.decisionTaskProofFromApplyReport(root, {}, "none"), null);

    const plural = fullContext.decisionTaskProofsFromApplyReport(
      root,
      {
        decision_tasks: [
          { ignored: true },
          {
            path: "tasks/classification.json",
            sha256: sha256Text(taskText),
            context_bundle_sha256: "actual-context-sha",
          },
        ],
      },
      "plural",
    );
    assert.equal(plural.length, 1);
    assert.equal(plural[0].source, "plural");
    assert.equal(
      fullContext.decisionTaskProofsFromApplyReport(
        root,
        { decision_tasks: [], decision_task: { path: "tasks/classification.json" } },
        "fallback",
      ).length,
      1,
    );
  });
});

test("decision blocker and required-pattern selection preserve profile order and fail-closed evidence", () => {
  const profilePatterns = [
    "schema.json",
    "methodology.yaml",
    "runtime-ruleset.json",
    "tidas_locations_category.json",
    "tidas_flows_elementary_category.json",
    "tidas_processes_category.json",
    "custom-present.json",
  ];
  const requirement = {
    requiredContextKinds: ["schema", "ruleset"],
    requiredContextFilePatterns: profilePatterns,
  };
  const proof = {
    blockers: [],
    payload: { schemaTypes: [" FLOW-ELEMENTARY "] },
    path: "tasks/classification.json",
    source: "classification_apply",
    task_kind: "wrong_kind",
    status: "wrong_status",
    contract_context_files: [
      { kind: "schema", path: "context/schema.json", text: "schema" },
      {
        kind: "classification_schema",
        path: "context/tidas_flows_elementary_category.json",
        text: "elementary",
      },
    ],
    missing_context_files: ["context/methodology.yaml"],
    context_bundle_sha256: "",
  };
  assert.deepEqual(
    fullContext.decisionTaskRequiredContextFilePatterns({
      requirement,
      proof,
      label: "classification",
    }),
    [
      "schema.json",
      "methodology.yaml",
      "runtime-ruleset.json",
      "tidas_locations_category.json",
      "tidas_flows_elementary_category.json",
    ],
  );
  assert.deepEqual(
    fullContext.decisionTaskRequiredContextFilePatterns({
      requirement,
      proof,
      label: "location",
    }),
    ["schema.json", "methodology.yaml", "runtime-ruleset.json", "tidas_locations_category.json"],
  );
  assert.equal(
    fullContext.decisionTaskRequiredContextFilePatterns({
      requirement,
      proof,
      label: "identity",
    }),
    profilePatterns,
  );

  const blockers = fullContext.fullContextDecisionTaskProofBlockers({
    requirement,
    proof,
    label: "classification",
  });
  assert.deepEqual(
    blockers.map((blocker: JsonRecord) => blocker.code),
    [
      "full_context_ai_classification_decision_task_kind_invalid",
      "full_context_ai_classification_decision_task_status_invalid",
      "full_context_ai_classification_decision_task_context_kind_missing",
      "full_context_ai_classification_decision_task_context_file_missing",
      "full_context_ai_classification_decision_task_context_file_missing",
      "full_context_ai_classification_decision_task_context_file_missing",
      "full_context_ai_classification_decision_task_missing_context_files",
      "full_context_ai_classification_decision_task_context_hash_missing",
    ],
  );
  assert.deepEqual(
    blockers
      .filter((blocker: JsonRecord) => blocker.required_file_pattern)
      .map((blocker: JsonRecord) => blocker.required_file_pattern),
    ["methodology.yaml", "runtime-ruleset.json", "tidas_locations_category.json"],
  );
  assert.equal(
    fullContext.fullContextDecisionTaskProofBlockers({
      requirement,
      proof: null,
      label: "location",
    })[0].code,
    "full_context_ai_location_decision_task_required",
  );
  const upstream = { code: "upstream_invalid" };
  assert.deepEqual(
    fullContext.fullContextDecisionTaskProofBlockers({
      requirement,
      proof: { ...proof, blockers: [upstream] },
      label: "classification",
    }),
    [upstream],
  );

  const noSchemaTypes = {
    ...proof,
    payload: {},
    contract_context_files: [
      ...proof.contract_context_files,
      { kind: "custom", path: "context/custom-present.json", text: "custom" },
    ],
  };
  assert.deepEqual(
    fullContext.decisionTaskRequiredContextFilePatterns({
      requirement,
      proof: noSchemaTypes,
      label: "classification",
    }),
    [
      "schema.json",
      "methodology.yaml",
      "runtime-ruleset.json",
      "tidas_locations_category.json",
      "tidas_flows_elementary_category.json",
      "custom-present.json",
    ],
  );
});

test("decision rows and payload identity hashes preserve envelope precedence, file/row order, last-write, and native parse errors", () => {
  assert.deepEqual(fullContext.normalizeClassificationDecisionRows([0, null, "x", { id: 1 }]), [
    "x",
    { id: 1 },
  ]);
  assert.deepEqual(
    fullContext.normalizeClassificationDecisionRows({ decisions: [], rows: [{ ignored: true }] }),
    [],
  );
  assert.deepEqual(
    fullContext.normalizeClassificationDecisionRows({ rows: [null, { id: "row" }] }),
    [{ id: "row" }],
  );
  assert.deepEqual(fullContext.normalizeClassificationDecisionRows({ id: "single" }), [
    { id: "single" },
  ]);
  assert.deepEqual(fullContext.normalizeClassificationDecisionRows("invalid"), []);

  withTempRoot("full-context-payload-hash", (root) => {
    const firstPath = path.join(root, "rows", "first.jsonl");
    const secondPath = path.join(root, "rows", "second.json");
    const firstPayload = { processDataSet: { marker: "first" } };
    const oldDuplicatePayload = { processDataSet: { marker: "old-duplicate" } };
    const secondPayload = { processDataSet: { marker: "second" } };
    const newDuplicatePayload = { processDataSet: { marker: "new-duplicate" } };
    writeJsonLines(firstPath, [
      { id: "first", version: "01.00.000", payload: firstPayload },
      { id: "duplicate", version: "01.00.000", payload: oldDuplicatePayload },
    ]);
    writeJson(secondPath, {
      rows: [
        { id: "second", version: "01.00.000", payload: secondPayload },
        { id: "duplicate", version: "01.00.000", payload: newDuplicatePayload },
      ],
    });
    const hashes = fullContext.payloadSha256ByIdentityForRows(
      root,
      ["rows/first.jsonl", "rows/missing.json", "rows/second.json"],
      "process",
    );
    assert.deepEqual(
      [...hashes.keys()],
      ["process:first@@01.00.000", "process:duplicate@@01.00.000", "process:second@@01.00.000"],
    );
    assert.equal(hashes.get("process:first@@01.00.000"), sha256Json(firstPayload));
    assert.equal(hashes.get("process:duplicate@@01.00.000"), sha256Json(newDuplicatePayload));
    assert.equal(hashes.get("process:second@@01.00.000"), sha256Json(secondPayload));

    const invalidPath = path.join(root, "rows", "invalid.jsonl");
    writeText(invalidPath, '{"ok":true}\n{bad}\n');
    assert.throws(
      () => fullContext.payloadSha256ByIdentityForRows(root, [invalidPath], "process"),
      (error: unknown) => error instanceof SyntaxError,
    );
  });
});

test("internal full-context proof retains its exact export surface", () => {
  assert.deepEqual(Object.keys(fullContext).sort(), [
    "authoringPackageProofsFromCurationGate",
    "authoringPackageProofsFromPatchCollect",
    "contextFileHasNonEmptyText",
    "contextFilesHaveKind",
    "contextFilesHavePattern",
    "curationGateContextHasKind",
    "curationGateContextHasPattern",
    "decisionTaskProofFromApplyReport",
    "decisionTaskProofsFromApplyReport",
    "decisionTaskRequiredContextFilePatterns",
    "evidenceResolution",
    "evidenceResolutionContextKinds",
    "evidenceResolutionMode",
    "fullContextDecisionTaskProofBlockers",
    "fullContextPackageProofBlockers",
    "normalizeClassificationDecisionRows",
    "payloadSha256ByIdentityForRows",
    "readAuthoringPackageProof",
    "readDecisionTaskProof",
    "readDecisionTaskSharedContextBundleProof",
  ]);
});
