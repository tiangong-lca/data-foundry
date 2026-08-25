import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  type ReadyFinalizeFixtureOptions,
  writeReadyFinalizeFixture,
} from "../fixtures/finalize-fixtures.ts";
import * as fixtureRoots from "../fixtures/fixture-roots.ts";
import { repoRoot, testRunId } from "../fixtures/foundry-core.ts";

const fixtureRootBasenames = {
  annualSupplyFixtureRoot: "annual-supply-deferral-test",
  classificationFixtureRoot: "classification-queue-gate-test",
  elementaryFlowManifestFixtureRoot: "elementary-flow-manifest-gate-test",
  finalizeAutoQueueFixtureRoot: "finalize-auto-queue-test",
  finalizeCurationGateFixtureRoot: "finalize-curation-gate-test",
  finalizeIdentityPreflightFixtureRoot: "finalize-identity-preflight-test",
  finalizeLocationFixtureRoot: "finalize-location-audit-test",
  fixtureRoot: "full-context-gate-test",
  flowClassificationFixtureRoot: "flow-classification-gate-test",
  flowIdentityReferenceFixtureRoot: "flow-identity-reference-reuse-test",
  identityPreflightRunFixtureRoot: "identity-preflight-run-test",
  locationFixtureRoot: "location-queue-gate-test",
  mutationFixtureRoot: "mutation-manifest-trace-test",
  packageContextFixtureRoot: "authoring-package-context-test",
  qaPathFixtureRoot: "qa-path-gate-test",
  referenceClosureFixtureRoot: "mutation-manifest-reference-closure-test",
  sourceExchangeFixtureRoot: "source-exchange-completeness-test",
  supportManifestFixtureRoot: "mutation-manifest-support-scope-test",
} as const;

const expectedFixtureRootConsumers = [
  "test/fixtures/full-context-fixtures.ts",
  "test/fixtures/mutation-fixtures.ts",
  "test/scenarios/authoring-shared-context.test.mts",
  "test/scenarios/curation-cleanup-quality-gates.test.mts",
  "test/scenarios/decision-task-context-and-classification.test.mts",
  "test/scenarios/flow-classification-authoring.test.mts",
  "test/scenarios/flow-identity-decisions.test.mjs",
  "test/scenarios/full-context-completion-closeout.test.mjs",
  "test/scenarios/identity-curation-context.test.mjs",
  "test/scenarios/identity-preflight-run-and-merge.test.mjs",
  "test/scenarios/location-and-finalize-gates.test.mts",
  "test/scenarios/mutation-full-context-evidence.test.mjs",
  "test/scenarios/mutation-lineage-helpers.test.mjs",
  "test/scenarios/mutation-manifest-reference-closure.test.mjs",
  "test/scenarios/post-authoring-finalize-gates.test.mjs",
  "test/unit/context-identity-mutation-fixture-migration.test.mts",
  "test/unit/fixture-helpers-contract.test.mts",
] as const;

const targetUserId = "00000000-0000-4000-8000-000000000001";

type MigrationInventory = {
  remaining_count: number;
  canonical_path_list_sha256: string;
  baseline_paths: string[];
};

function expectedRootValues(runId: string | number): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fixtureRootBasenames).map(([name, basename]) => [
      name,
      path.join(repoRoot, "tmp", `${basename}-${runId}`),
    ]),
  );
}

function relativeToRepo(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function expectedMutationReport(
  options: Required<Pick<ReadyFinalizeFixtureOptions, "datasetType" | "profile">> & {
    rowsFile: string;
  },
): object {
  return {
    status: "ready_for_remote_write",
    dataset_type: options.datasetType,
    profile: options.profile,
    rows_file: relativeToRepo(options.rowsFile),
    target_user_id: targetUserId,
    counts: {
      blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
    files: {
      unresolved_traces: null,
      source_exchange_completeness_traces: null,
      source_reference_rewrites: null,
    },
  };
}

function expectedFinalizeReport(
  options: Required<Pick<ReadyFinalizeFixtureOptions, "datasetType" | "profile">> & {
    rowsFile: string;
    mutationReport: string;
  },
): object {
  return {
    status: "ready_for_remote_write",
    dataset_type: options.datasetType,
    profile: options.profile,
    rows_file: relativeToRepo(options.rowsFile),
    target_user_id: targetUserId,
    files: {
      final_rows: relativeToRepo(options.rowsFile),
      mutation_manifest: relativeToRepo(options.mutationReport),
    },
    counts: {
      blockers: 0,
      location_audit_blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
  };
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
  });
}

function staticConsumers(stem: string): string[] {
  const importPattern = new RegExp(`from\\s+["'][^"']*${stem}\\.(?:mjs|ts)["']`, "u");
  return sourceFiles(path.join(repoRoot, "test"))
    .filter((filePath) => /\.(?:mjs|mts|ts)$/u.test(filePath))
    .filter((filePath) => importPattern.test(fs.readFileSync(filePath, "utf8")))
    .map((filePath) => relativeToRepo(filePath))
    .sort();
}

test("fixture roots retain the exact 18-name worktree-local path contract", () => {
  const actualRoots = Object.fromEntries(Object.entries(fixtureRoots));
  assert.deepEqual(Object.keys(actualRoots).sort(), Object.keys(fixtureRootBasenames).sort());
  assert.deepEqual(actualRoots, expectedRootValues(testRunId));
});

test("fixture roots honor a worktree-local testRunId override", () => {
  const overrideRunId = `fixture-helper-contract-${process.pid}`;
  const fixtureModuleUrl = pathToFileURL(
    path.join(repoRoot, "test", "fixtures", "fixture-roots.ts"),
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import * as roots from ${JSON.stringify(fixtureModuleUrl)}; process.stdout.write(JSON.stringify(roots));`,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        FOUNDRY_FULL_CONTEXT_TEST_RUN_ID: overrideRunId,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), expectedRootValues(overrideRunId));
});

test("writeReadyFinalizeFixture preserves exact default and override report contracts", (t) => {
  fs.mkdirSync(path.join(repoRoot, "tmp"), { recursive: true });
  const contractRoot = fs.mkdtempSync(path.join(repoRoot, "tmp", "fixture-helper-contract-"));
  t.after(() => fs.rmSync(contractRoot, { recursive: true, force: true }));

  const defaultRoot = path.join(contractRoot, "default");
  const defaultRowsFile = path.join(defaultRoot, "rows", "processes.jsonl");
  const defaultMutationReport = path.join(defaultRoot, "process-mutation-manifest.json");
  const defaultFinalizeReport = path.join(
    defaultRoot,
    "process-dataset-post-authoring-finalize-report.json",
  );
  const defaultResult = writeReadyFinalizeFixture({
    root: defaultRoot,
    datasetType: "process",
    rowsFile: defaultRowsFile,
  });

  assert.deepEqual(defaultResult, {
    mutationReport: defaultMutationReport,
    finalizeReport: defaultFinalizeReport,
  });
  assert.equal(
    fs.readFileSync(defaultMutationReport, "utf8"),
    prettyJson(
      expectedMutationReport({
        datasetType: "process",
        profile: "generic",
        rowsFile: defaultRowsFile,
      }),
    ),
  );
  assert.equal(
    fs.readFileSync(defaultFinalizeReport, "utf8"),
    prettyJson(
      expectedFinalizeReport({
        datasetType: "process",
        profile: "generic",
        rowsFile: defaultRowsFile,
        mutationReport: defaultMutationReport,
      }),
    ),
  );

  const overrideRoot = path.join(contractRoot, "override");
  const overrideRowsFile = path.join(overrideRoot, "rows", "flows.jsonl");
  const overrideMutationReport = path.join(overrideRoot, "flow-mutation-manifest.json");
  const overrideFinalizeReport = path.join(overrideRoot, "reports", "ready.json");
  const overrideResult = writeReadyFinalizeFixture({
    root: overrideRoot,
    datasetType: "flow",
    rowsFile: overrideRowsFile,
    profile: "bafu",
    finalizeReportPath: overrideFinalizeReport,
  });

  assert.deepEqual(overrideResult, {
    mutationReport: overrideMutationReport,
    finalizeReport: overrideFinalizeReport,
  });
  assert.equal(
    fs.existsSync(path.join(overrideRoot, "flow-dataset-post-authoring-finalize-report.json")),
    false,
  );
  assert.equal(
    fs.readFileSync(overrideMutationReport, "utf8"),
    prettyJson(
      expectedMutationReport({
        datasetType: "flow",
        profile: "bafu",
        rowsFile: overrideRowsFile,
      }),
    ),
  );
  assert.equal(
    fs.readFileSync(overrideFinalizeReport, "utf8"),
    prettyJson(
      expectedFinalizeReport({
        datasetType: "flow",
        profile: "bafu",
        rowsFile: overrideRowsFile,
        mutationReport: overrideMutationReport,
      }),
    ),
  );
});

test("fixture helpers exist only as native TypeScript", () => {
  for (const stem of ["fixture-roots", "finalize-fixtures"]) {
    const typedPath = path.join(repoRoot, "test", "fixtures", `${stem}.ts`);
    assert.equal(fs.existsSync(typedPath), true, `${stem}.ts must exist`);
    assert.equal(
      fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")),
      false,
      `${stem}.mjs is removed`,
    );
  }
});

test("every direct fixture helper consumer targets the typed module", () => {
  assert.deepEqual(staticConsumers("fixture-roots"), [...expectedFixtureRootConsumers].sort());
  assert.deepEqual(staticConsumers("finalize-fixtures"), [
    "test/unit/fixture-helpers-contract.test.mts",
  ]);

  for (const consumer of expectedFixtureRootConsumers) {
    const source = fs.readFileSync(path.join(repoRoot, consumer), "utf8");
    assert.match(source, /from\s+["'][^"']*fixture-roots\.ts["']/u);
    assert.doesNotMatch(source, /from\s+["'][^"']*fixture-roots\.mjs["']/u);
  }
  const focusedTestSource = fs.readFileSync(import.meta.filename, "utf8");
  assert.match(focusedTestSource, /from\s+["'][^"']*finalize-fixtures\.ts["']/u);
  assert.doesNotMatch(focusedTestSource, /from\s+["'][^"']*finalize-fixtures\.mjs["']/u);
});

test("fixture migration ledger retains the two-file reduction as later waves continue", () => {
  const inventory = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "specs", "typescript-migration-inventory.json"), "utf8"),
  ) as MigrationInventory;
  assert.ok(inventory.remaining_count <= 128);
  assert.match(inventory.canonical_path_list_sha256, /^[a-f0-9]{64}$/u);
  for (const legacyPath of [
    "test/fixtures/fixture-roots.mjs",
    "test/fixtures/finalize-fixtures.mjs",
  ]) {
    assert.equal(inventory.baseline_paths.includes(legacyPath), true);
    assert.equal(fs.existsSync(path.join(repoRoot, legacyPath)), false);
  }
});
