import assert from "node:assert/strict";
import test from "node:test";
import {
  bafuProcessScopeE2eTestHooks,
  createBafuProcessScopeE2eCommands,
} from "../../scripts/commands/bafu-process-scope-e2e.ts";
import {
  createFileArtifactFact,
  createFoundryCommandSpec,
} from "../../scripts/lib/foundry-command-spec.ts";
import {
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  spawnSync,
  testTmpRoot,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.ts";

const fixtureRoot = testTmpRoot("bafu-process-scope-e2e-test");
const processId = "11111111-2222-4333-8444-555555555555";
type DependencyFactory = (dependencies: never) => unknown;

function bindFactory<Factory extends DependencyFactory>(
  factory: Factory,
  dependencies: unknown,
): ReturnType<Factory> {
  return factory(dependencies as never) as ReturnType<Factory>;
}

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return textValue(record["#text"] ?? record.value ?? record.id);
  }
  return "";
}

bindFactory(createBafuProcessScopeE2eCommands, {
  booleanOption: (value: unknown) => value === true || value === "true",
  fileExists: (filePath: string | null) =>
    Boolean(filePath) && fs.existsSync(filePath!) && fs.statSync(filePath!).isFile(),
  nowIso: () => "2026-01-01T00:00:00.000Z",
  readJson,
  readJsonLines,
  readRowsFile: (filePath: string) => {
    if (String(filePath).toLowerCase().endsWith(".jsonl")) return readJsonLines(filePath);
    const value = readJson(filePath);
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.rows)) return value.rows;
    return [value];
  },
  repoRelativeMaybe: (filePath: string | null) => (filePath ? rel(filePath) : null),
  resolveRepoPath: (filePath: string | null) =>
    filePath ? (path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath)) : null,
  shellQuote: (value: unknown) => {
    const text = String(value);
    return /^[A-Za-z0-9_./:=@%+-]+$/u.test(text) ? text : `'${text.replace(/'/gu, "'\\''")}'`;
  },
  textValue,
  writeJson,
});

function processRow(id: string = processId) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          "common:name": { "#text": "BAFU process scope fixture" },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

function runHelper(args: string[]) {
  const result = spawnSync(
    process.execPath,
    ["scripts/foundry.ts", "dataset-bafu-process-scope-e2e", ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.notEqual(
    result.stdout.trim(),
    "",
    `expected helper JSON stdout; status=${result.status}; stderr=${result.stderr}`,
  );
  return {
    code: result.status,
    json: JSON.parse(result.stdout),
    stderr: result.stderr,
  };
}

function writeRows(root: string) {
  const rowsFile = path.join(root, "rows", "process.jsonl");
  writeJsonLines(rowsFile, [processRow()]);
  const sourceSupportRowsFile = path.join(root, "rows", "sources.jsonl");
  writeJsonLines(sourceSupportRowsFile, [
    {
      sourceDataSet: {
        sourceInformation: {
          dataSetInformation: {
            "common:UUID": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            shortName: { "#text": "BAFU source fixture" },
          },
        },
      },
    },
  ]);
  return { rowsFile, sourceSupportRowsFile };
}

test("BAFU process scope helper treats lookup_failed post-write verify as retryable", () => {
  const root = path.join(fixtureRoot, "verify-retry-reason");
  fs.rmSync(root, { recursive: true, force: true });
  const verifyReport = path.join(root, "remote-verification-report.json");
  writeJson(verifyReport, {
    schema_version: 1,
    status: "blocked_remote_verification",
    blockers: [
      {
        code: "lookup_failed",
        table: "processes",
      },
    ],
  });

  try {
    assert.equal(
      bafuProcessScopeE2eTestHooks.postWriteVerifyRetryReason(verifyReport),
      "lookup_failed",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU process scope helper plans existing finalize command with source support rows", () => {
  const root = path.join(fixtureRoot, "plan");
  fs.rmSync(root, { recursive: true, force: true });
  const { rowsFile, sourceSupportRowsFile } = writeRows(root);
  const outDir = path.join(root, "run");

  try {
    const result = runHelper([
      "--rows-file",
      rel(rowsFile),
      "--source-support-rows-file",
      rel(sourceSupportRowsFile),
      "--out-dir",
      rel(outDir),
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "planned");
    assert.equal(result.json.policy.remote_commit_executed, false);
    assert.match(result.json.commands.post_authoring_finalize, /dataset-post-authoring-finalize/u);
    assert.match(result.json.commands.post_authoring_finalize, /--source-support-rows-file/u);
    assert.match(result.json.commands.post_authoring_finalize, /sources\.jsonl/u);
    assert.match(result.json.resume.rerun_command, /--source-support-rows-file/u);
    assert.equal(fs.existsSync(path.join(repoRoot, result.json.files.report)), true);
    const ledger = readJsonLines(path.join(repoRoot, result.json.files.run_ledger));
    assert.equal(ledger.at(-1).stage, "plan");
    assert.equal(ledger.at(-1).state, "planned");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU process scope helper hard-blocks unresolved AI curation items on resume", () => {
  const root = path.join(fixtureRoot, "blocked-ai");
  fs.rmSync(root, { recursive: true, force: true });
  const { rowsFile } = writeRows(root);
  const outDir = path.join(root, "run");
  const curationGateReport = path.join(
    outDir,
    "finalize",
    "curation-gate",
    "dataset-curation-gate-report.json",
  );
  const finalizeReport = path.join(
    outDir,
    "finalize",
    "dataset-post-authoring-finalize-report.json",
  );
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    counts: {
      action_items: 2,
      identity_action_items: 1,
      semantic_action_items: 1,
      classification_queue_action_items: 0,
      location_queue_action_items: 0,
      deterministic_cleanup_items: 0,
    },
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        action_item_count: 2,
        authoring_package: "tmp/fixture/authoring-package.json",
      },
    ],
  });
  writeJson(finalizeReport, {
    schema_version: 1,
    status: "blocked",
    rows_file: rel(rowsFile),
    counts: {
      blockers: 1,
      commit_handoff_blockers: 1,
    },
    files: {
      curation_gate_report: rel(curationGateReport),
    },
    commit_handoff: {
      status: "blocked",
      command: null,
      post_write_verify_command: null,
      blockers: [{ code: "finalize_not_ready" }],
    },
    blockers: [{ code: "post_authoring_curation_gate_not_ready" }],
  });

  try {
    const result = runHelper(["--rows-file", rel(rowsFile), "--out-dir", rel(outDir)]);

    assert.equal(result.code, 1);
    assert.equal(result.json.status, "blocked_unresolved_ai_curation");
    assert.equal(result.json.counts.ai_action_items, 2);
    assert.equal(
      result.json.blockers.some(
        (blocker: Record<string, unknown>) => blocker.code === "unresolved_ai_curation_items",
      ),
      true,
    );
    const report = readJson(path.join(repoRoot, result.json.files.report));
    assert.equal(report.status, "blocked_unresolved_ai_curation");
    const ledger = readJsonLines(path.join(repoRoot, result.json.files.run_ledger));
    assert.equal(ledger.at(-1).stage, "resume");
    assert.equal(ledger.at(-1).state, "blocked_unresolved_ai_curation");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU process scope helper recognizes post-finalize semantic-only recovery", () => {
  const root = path.join(fixtureRoot, "semantic-recovery-gate");
  fs.rmSync(root, { recursive: true, force: true });
  const curationGateReport = path.join(root, "dataset-curation-gate-report.json");
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    counts: {
      action_items: 1,
      identity_action_items: 0,
      semantic_action_items: 1,
      classification_queue_action_items: 0,
      location_queue_action_items: 0,
      deterministic_cleanup_items: 0,
    },
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        action_item_count: 1,
        authoring_package: "tmp/fixture/process.authoring-package.json",
      },
    ],
  });

  try {
    const finalizeReport = {
      files: {
        curation_gate_report: rel(curationGateReport),
      },
    };

    assert.equal(
      bafuProcessScopeE2eTestHooks.canRunPostFinalizeSemanticRecovery(finalizeReport),
      true,
    );
    assert.equal(
      bafuProcessScopeE2eTestHooks.canRunPostFinalizeIdentityRecovery(finalizeReport),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU process scope helper reads verified support identities for handoff reuse", () => {
  const root = path.join(fixtureRoot, "support-cache");
  fs.rmSync(root, { recursive: true, force: true });
  const supportRowsFile = path.join(root, "support.jsonl");
  const cacheFile = path.join(root, "verified-support-identities.jsonl");
  writeJsonLines(supportRowsFile, [
    {
      contactDataSet: {
        contactInformation: {
          dataSetInformation: {
            "common:UUID": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
          },
        },
      },
    },
    {
      sourceDataSet: {
        sourceInformation: {
          dataSetInformation: {
            "common:UUID": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
          },
        },
      },
    },
  ]);
  writeJsonLines(cacheFile, [
    {
      schema_version: 1,
      identity_key: "contact:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee@00.00.001",
      status: "verified",
    },
    {
      schema_version: 1,
      dataset_type: "source",
      dataset_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      dataset_version: "00.00.001",
      status: "verified",
    },
  ]);

  try {
    const handoffPlan = {
      commands: {
        commit: createFoundryCommandSpec({
          executable: process.execPath,
          argv: [
            "scripts/foundry.ts",
            "dataset",
            "save-draft",
            "--type",
            "auto",
            "--input",
            rel(supportRowsFile),
          ],
          binding: {
            artifacts: [
              createFileArtifactFact({
                role: "final_rows",
                path: rel(supportRowsFile),
                filePath: supportRowsFile,
              }),
            ],
          },
        }),
      },
    };
    const identities = bafuProcessScopeE2eTestHooks.supportIdentityKeysFromHandoffPlan(handoffPlan);
    const cached = bafuProcessScopeE2eTestHooks.loadVerifiedSupportIdentities(cacheFile);

    assert.deepEqual(identities, [
      "contact:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee@00.00.001",
      "source:bbbbbbbb-cccc-4ddd-8eee-ffffffffffff@00.00.001",
    ]);
    assert.equal(
      identities.every((identityKey) => cached.has(identityKey)),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU process scope helper resumes ready handoff without executing remote commit", () => {
  const root = path.join(fixtureRoot, "ready");
  fs.rmSync(root, { recursive: true, force: true });
  const { rowsFile } = writeRows(root);
  const outDir = path.join(root, "run");
  const curationGateReport = path.join(
    outDir,
    "finalize",
    "curation-gate",
    "dataset-curation-gate-report.json",
  );
  const finalizeReport = path.join(
    outDir,
    "finalize",
    "dataset-post-authoring-finalize-report.json",
  );
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "ready",
    counts: {
      action_items: 0,
      deterministic_cleanup_items: 0,
    },
    entities: [],
  });
  writeJson(finalizeReport, {
    schema_version: 1,
    status: "ready_for_remote_write",
    rows_file: rel(rowsFile),
    counts: {
      blockers: 0,
      commit_handoff_blockers: 0,
    },
    files: {
      curation_gate_report: rel(curationGateReport),
      mutation_manifest: "tmp/fixture/mutation-manifest.json",
      commit_handoff_plan: "tmp/fixture/dataset-commit-handoff-plan.json",
    },
    commit_handoff: {
      status: "ready_for_explicit_commit",
      command: createFoundryCommandSpec({
        executable: process.execPath,
        argv: ["cli.js", "process", "save-draft", "--input", rel(rowsFile)],
        binding: {
          artifacts: [
            createFileArtifactFact({
              role: "final_rows",
              path: rel(rowsFile),
              filePath: rowsFile,
            }),
          ],
        },
      }),
      post_write_verify_command: createFoundryCommandSpec({
        executable: process.execPath,
        argv: ["cli.js", "dataset", "verify-remote", "--input", rel(rowsFile)],
        binding: {
          artifacts: [
            createFileArtifactFact({
              role: "final_rows",
              path: rel(rowsFile),
              filePath: rowsFile,
            }),
          ],
        },
      }),
      blockers: [],
    },
    blockers: [],
  });

  try {
    const result = runHelper(["--rows-file", rel(rowsFile), "--out-dir", rel(outDir)]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "ready_for_explicit_commit");
    assert.equal(result.json.policy.remote_commit_executed, false);
    assert.match(result.json.commands.commit_handoff.display, /process save-draft/u);
    const ledger = readJsonLines(path.join(repoRoot, result.json.files.run_ledger));
    assert.equal(ledger.at(-1).state, "ready_for_explicit_commit");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
