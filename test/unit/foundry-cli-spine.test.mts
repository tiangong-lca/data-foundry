import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs, parseScalar } from "../../scripts/lib/foundry-args.ts";
import {
  datasetPolicyCommands,
  exitCodeForCommand,
  knownCommands,
  publicCommands,
  usage,
} from "../../scripts/lib/foundry-command-registry.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

const expectedPublicCommands = [
  "init",
  "doctor",
  "env-check",
  "workflow-check",
  "storage-check",
  "surface-audit",
  "acceptance-check",
  "workspace-map",
  "capabilities-list",
  "profiles-list",
  "route-task",
  "tasks-list",
  "tasks-check",
  "task-complete",
  "tidas-handshake",
];

const expectedDatasetPolicyCommands = [
  "dataset-tidas-import",
  "dataset-tidas-validate",
  "execution-capsule-admit",
  "dataset-incremental-change-set-compose",
  "dataset-topology-convergence-compose",
  "dataset-curation-queue-build",
  "dataset-curation-gate",
  "dataset-authoring-plan",
  "dataset-authoring-task-build",
  "dataset-authoring-patch-collect",
  "dataset-identity-decision-task-build",
  "dataset-classification-decision-task-build",
  "dataset-library-classification-decisions-project",
  "dataset-bafu-leaf-classification-tasks-prepare",
  "dataset-bafu-leaf-classification-category-map-project",
  "dataset-bafu-identity-decisions-autofill",
  "dataset-bafu-authoring-patches-autofill",
  "dataset-classification-decisions-apply",
  "dataset-location-decision-task-build",
  "dataset-location-decisions-suggest",
  "dataset-location-decisions-apply",
  "dataset-curation-cleanup",
  "dataset-patch-apply",
  "dataset-support-cache-refresh",
  "dataset-canonical-support-mappings-autofill",
  "dataset-bundle-sample-rows",
  "dataset-identity-preflight-requests-build",
  "dataset-identity-preflight-query-audit",
  "dataset-identity-preflight-run",
  "dataset-identity-preflight-index-merge",
  "dataset-library-index-build",
  "dataset-library-authoring-plan",
  "dataset-library-identity-decisions-from-preflight",
  "dataset-library-decisions-apply",
  "dataset-process-scope-run",
  "dataset-bafu-process-scope-e2e",
  "dataset-bafu-batch-import-run",
  "dataset-uslci-batch-import-run",
  "dataset-worldsteel-batch-import-run",
  "dataset-bafu-universe-coverage-report",
  "dataset-identity-reference-rewrites-apply",
  "dataset-identity-decisions-apply",
  "dataset-post-authoring-finalize",
  "dataset-commit-handoff-plan",
  "dataset-post-write-closeout",
  "dataset-import-completion-report",
  "dataset-import-ledger-report",
  "dataset-mutation-manifest",
];

const ownershipNote =
  "Foundry public surface is task/profile/workspace/gate control. Foundry dataset commands are policy, artifact, and owner-command adapters only; deterministic import/conversion/schema validation belongs in Rust tidas, while context, queue state, QA/curation, database write/delete/redo, and readback behavior belongs in tiangong-lca CLI or checked-in skills.";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function walkFiles(
  relativeDirectory: string,
  predicate: (relativePath: string) => boolean,
): string[] {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return [];
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return walkFiles(relativePath, predicate);
    return entry.isFile() && predicate(relativePath) ? [relativePath] : [];
  });
}

function isHistoricalDocument(relativePath: string): boolean {
  if (!relativePath.endsWith(".md")) return false;
  return /^status:\s*historical\s*$/imu.test(
    readRepoFile(relativePath).split(/\r?\n/u).slice(0, 40).join("\n"),
  );
}

test("scalar parsing preserves the established CLI coercion boundary", () => {
  assert.deepEqual(
    [
      undefined,
      null,
      "",
      " true ",
      "false",
      "0",
      "-17",
      "+4",
      "01",
      "1.5",
      '"quoted value"',
      "'single quoted'",
      " mixed ",
    ].map(parseScalar),
    ["", "", "", true, false, 0, -17, "+4", 1, "1.5", "quoted value", "single quoted", "mixed"],
  );
});

test("argument parsing preserves positionals, camel-case keys, repeats, inline values, and flags", () => {
  assert.deepEqual(
    parseArgs([
      "first-positional",
      "--dry-run",
      "--limit",
      "7",
      "--profile=generic",
      "--tag",
      "alpha",
      "--tag=beta",
      "second-positional",
      "--enabled=false",
      "--empty=",
      "--next-flag",
      "--final-flag",
    ]),
    {
      _: ["first-positional", "second-positional"],
      dryRun: true,
      limit: 7,
      profile: "generic",
      tag: ["alpha", "beta"],
      enabled: false,
      empty: "",
      nextFlag: true,
      finalFlag: true,
    },
  );
});

test("repeated flags retain their first parsed value and append in encounter order", () => {
  assert.deepEqual(parseArgs(["--mode", "--mode=false", "--mode", "3"]), {
    _: [],
    mode: [true, false, 3],
  });
});

test("help JSON retains exact command order, categories, and ownership note", () => {
  assert.deepEqual(publicCommands, expectedPublicCommands);
  assert.deepEqual(datasetPolicyCommands, expectedDatasetPolicyCommands);
  assert.deepEqual(knownCommands, [...expectedPublicCommands, ...expectedDatasetPolicyCommands]);
  assert.deepEqual(usage(), {
    public_commands: expectedPublicCommands,
    dataset_policy_commands: expectedDatasetPolicyCommands,
    commands: [...expectedPublicCommands, ...expectedDatasetPolicyCommands],
    ownership_note: ownershipNote,
  });
});

test("exit mapping preserves adapter, aggregate, wrapper, status-family, and default behavior", () => {
  assert.equal(exitCodeForCommand("tidas-handshake", { foundry_adapter: { exit_code: 7 } }), 7);
  assert.equal(exitCodeForCommand("dataset-tidas-import", { status: "help" }), 0);
  assert.equal(exitCodeForCommand("dataset-tidas-validate", { status: "failed" }), 1);

  const healthyDoctor = {
    workflow_check: { ok: true },
    storage_check: { ok: true },
    env_example_surface: { ok: true },
    surface_audit: { status: "passed" },
  };
  assert.equal(exitCodeForCommand("doctor", healthyDoctor), 0);
  assert.equal(exitCodeForCommand("doctor", { ...healthyDoctor, storage_check: { ok: false } }), 1);
  assert.equal(exitCodeForCommand("env-check", { env_example_surface: { ok: true } }), 0);
  assert.equal(exitCodeForCommand("env-check", { env_example_surface: { ok: false } }), 1);

  for (const command of ["workflow-check", "storage-check", "surface-audit", "tasks-check"]) {
    assert.equal(exitCodeForCommand(command, { ok: true }), 0, command);
    assert.equal(exitCodeForCommand(command, { status: "passed" }), 0, command);
    assert.equal(exitCodeForCommand(command, { status: "failed" }), 1, command);
  }
  assert.equal(exitCodeForCommand("acceptance-check", { status: "passed" }), 0);
  assert.equal(exitCodeForCommand("acceptance-check", { status: "failed" }), 1);
  assert.equal(exitCodeForCommand("route-task", { status: "missing_capabilities" }), 1);
  assert.equal(exitCodeForCommand("route-task", { status: "ready" }), 0);

  for (const status of ["help", "ready", "completed"]) {
    assert.equal(exitCodeForCommand("task-complete", { status }), 0, status);
  }
  assert.equal(exitCodeForCommand("task-complete", { status: "blocked" }), 1);
  assert.equal(
    exitCodeForCommand("dataset-curation-queue-build", {
      foundry_wrapper: { exit_code: 0 },
    }),
    0,
  );
  assert.equal(exitCodeForCommand("dataset-patch-apply", { foundry_wrapper: { exit_code: 9 } }), 9);
  assert.equal(exitCodeForCommand("dataset-patch-apply", {}), 1);

  for (const command of [
    "dataset-authoring-plan",
    "dataset-library-index-build",
    "dataset-curation-cleanup",
  ]) {
    assert.equal(exitCodeForCommand(command, { status: "failed" }), 0, command);
  }
  assert.equal(exitCodeForCommand("execution-capsule-admit", { status: "sealed" }), 0);
  assert.equal(exitCodeForCommand("execution-capsule-admit", { status: "blocked" }), 1);
  assert.equal(
    exitCodeForCommand("dataset-bafu-batch-import-run", {
      status: "paused_with_retryable_failures",
    }),
    0,
  );
  assert.equal(exitCodeForCommand("dataset-bafu-batch-import-run", { status: "failed" }), 1);
  assert.equal(
    exitCodeForCommand("dataset-identity-preflight-run", {
      status: "completed_with_identity_findings",
    }),
    0,
  );
  assert.equal(
    exitCodeForCommand("dataset-post-authoring-finalize", {
      status: "ready_reference_only",
    }),
    0,
  );
  assert.equal(
    exitCodeForCommand("dataset-commit-handoff-plan", {
      status: "ready_for_explicit_commit",
    }),
    0,
  );
  assert.equal(exitCodeForCommand("unknown-command", { status: "failed" }), 0);
});

test("CLI spine leaves are native TypeScript and every static consumer targets them", () => {
  for (const stem of ["foundry-args", "foundry-command-registry"]) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, `scripts/lib/${stem}.ts`)),
      true,
      `${stem}.ts must exist`,
    );
    assert.equal(
      fs.existsSync(path.join(repoRoot, `scripts/lib/${stem}.mjs`)),
      false,
      `${stem}.mjs must be removed after the typed migration`,
    );
  }

  const expectedImports = [
    ["scripts/foundry.mjs", "./lib/foundry-args.ts"],
    ["scripts/foundry.mjs", "./lib/foundry-command-registry.ts"],
    ["scripts/lib/surface-audit.ts", "./foundry-command-registry.ts"],
    [
      "test/unit/foundry-command-metadata.test.mts",
      "../../scripts/lib/foundry-command-registry.ts",
    ],
  ] as const;
  for (const [consumer, specifier] of expectedImports) {
    assert.match(
      readRepoFile(consumer),
      new RegExp(`from ["']${specifier.replaceAll(".", "\\.")}["']`, "u"),
      `${consumer} must import ${specifier}`,
    );
  }
});

test("active documentation and source contain no references to removed CLI spine modules", () => {
  const removedModulePaths = [
    "foundry-args.mjs",
    "foundry-command-registry.mjs",
    "foundry-command-metadata.mjs",
    "surface-audit.mjs",
    "bundle-row-types.mjs",
    "tidas-language-utils.mjs",
    "hash-utils.mjs",
    "dataset-types.mjs",
    "runtime-io.mjs",
    "artifact-inputs.mjs",
    "dataset-payload.mjs",
    "context-inputs.mjs",
    "internal/trace-summary.mjs",
    "canonical-support-mappings.mjs",
    "source-semantics.mjs",
    "trace-coverage.mjs",
    "tidas-row-utils.mjs",
    "decision-task-utils.mjs",
    "identity-reference-rewrite-utils.mjs",
    "identity-preflight-artifacts.mjs",
    "./lib/full-context-proof.mjs",
    "bafu-family-signatures.mjs",
    "lib/import-ledger.mjs",
    "canonical-support-rewrites.mjs",
    "bundle-sample-utils.mjs",
    "fixture-roots.mjs",
    "finalize-fixtures.mjs",
    "foundry-runtime-utils.mjs",
    "location-quality-utils.mjs",
    "prewrite-cleanup.mjs",
    "workflow-queue-context.mjs",
    "internal/full-context-proof.mjs",
    "workflow-decision-apply-context.mjs",
    "profiles-config.mjs",
    "workflow-patch-collect.mjs",
    "workflow-identity-decision-context.mjs",
    "workflow-patch-evidence-context.mjs",
    "workflow-row-transform-context.mjs",
    "workflow-dry-run-context.mjs",
    "workflow-evidence-scope.mjs",
    "workflow-decision-full-context.mjs",
    "workflow-authoring-tasks.mjs",
    "workflow-semantic-actions.mjs",
    "workflow-patch-evidence.mjs",
    "workflow-identity-preflight.mjs",
  ];
  const files = [
    "AGENTS.md",
    "README.md",
    "WORKFLOW.md",
    ...walkFiles("docs", (relativePath) => relativePath.endsWith(".md")),
    ...walkFiles("scripts", (relativePath) => /\.(?:[cm]?[jt]s)$/u.test(relativePath)),
  ].filter((relativePath) => !isHistoricalDocument(relativePath));
  const findings = files.flatMap((relativePath) => {
    const text = readRepoFile(relativePath);
    return removedModulePaths
      .filter((removedPath) => text.includes(removedPath))
      .map((removedPath) => ({ path: relativePath, removed_module: removedPath }));
  });

  assert.deepEqual(findings, []);
});
