import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDatasetAuthoringTaskBuild } from "../../scripts/lib/import-curation/authoring-packages.ts";

type AuthoringTaskRunner = (args?: {
  repoRoot?: string;
  options?: Record<string, unknown>;
}) => Record<string, unknown>;

const runAuthoringTaskBuild: AuthoringTaskRunner = runDatasetAuthoringTaskBuild;

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeText(filePath, text);
  return text;
}

function packagePayload(id: string): Record<string, unknown> {
  return {
    schema_version: 1,
    dataset_type: "flow",
    entity_id: id,
    version: "01.02.003",
    profile: "generic",
    source_row: { source_id: `source-${id}` },
    entity_payload: { flowDataSet: { id } },
    action_items: [],
    profile_context_files: [],
    contract_context_files: [],
  };
}

test("authoring package runner preserves exact help without touching the filesystem", () => {
  assert.deepEqual(runAuthoringTaskBuild({ options: { help: true } }), {
    schema_version: 1,
    status: "help",
    command: "dataset-authoring-task-build",
    usage: [
      "node scripts/foundry.ts dataset-authoring-task-build --authoring-package <package.json> --out-dir <task-dir>",
      "node scripts/foundry.ts dataset-authoring-task-build --curation-gate-report <dataset-curation-gate-report.json> --out-dir <tasks-dir> [--shared-context-cache-dir <cache-dir>]",
      "node scripts/foundry.ts dataset-authoring-task-build --package ./curation-gate/ai-authoring-packages/process-<uuid>.authoring-package.json --out-dir ./authoring-task",
    ],
    purpose:
      "Build Codex/skill-facing authoring tasks and strict patch templates from Foundry AI authoring packages. This command is local-only and never writes the database.",
  });
});

test("gate manifest build preserves entry order, snapshot names and bytes, task directories, and manifest bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-w23-authoring-packages-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageB = path.join(root, "packages", "b.authoring-package.json");
  const packageA = path.join(root, "packages", "a.authoring-package.json");
  const packageBText = writeJson(packageB, packagePayload("flow-b"));
  const packageAText = writeJson(packageA, packagePayload("flow-a"));
  const gateReport = path.join(root, "gate", "dataset-curation-gate-report.json");
  writeJson(gateReport, {
    entities: [
      {
        status: "ready_no_action_items",
        dataset_type: "flow",
        entity_id: "flow-b",
        authoring_package: "packages/b.authoring-package.json",
        action_item_count: 0,
      },
      {
        status: "ready_no_action_items",
        dataset_type: "flow",
        entity_id: "flow-a",
        authoring_package: "packages/a.authoring-package.json",
        action_item_count: 0,
      },
    ],
  });

  const result = runAuthoringTaskBuild({
    repoRoot: root,
    options: {
      curationGateReport: "gate/dataset-curation-gate-report.json",
      outDir: "authoring-output",
      includeReady: true,
    },
  });
  assert.equal(result.status, "ready_no_action_items");
  const tasks = result.tasks as Array<Record<string, unknown>>;
  assert.deepEqual(
    tasks.map((task) => String((task.entity as Record<string, unknown>).entity_id)),
    ["flow-b", "flow-a"],
  );

  const expected = [
    ["flow-b", packageBText, "b.authoring-package.json"],
    ["flow-a", packageAText, "a.authoring-package.json"],
  ] as const;
  for (const [index, [id, originalText, originalName]] of expected.entries()) {
    const task = tasks[index];
    const files = task.files as Record<string, unknown>;
    const snapshotRef = String(files.authoring_package);
    const expectedSha = createHash("sha256").update(originalText).digest("hex");
    assert.equal(
      path.posix.basename(snapshotRef),
      `${path.parse(originalName).name}.${expectedSha}.snapshot.json`,
    );
    assert.equal(fs.readFileSync(path.join(root, snapshotRef), "utf8"), originalText);
    assert.equal(files.task_json, `authoring-output/flow-${id}/ai-authoring-task.json`);
    assert.equal(files.task_markdown, `authoring-output/flow-${id}/ai-authoring-task.md`);
  }

  const manifestPath = path.join(root, "authoring-output", "authoring-task-manifest.json");
  const { files: runtimeFiles, ...manifest } = result;
  assert.deepEqual(runtimeFiles, {
    manifest: "authoring-output/authoring-task-manifest.json",
    tasks: "authoring-output/authoring-tasks.jsonl",
    shared_context_bundle: "authoring-output/shared-context-bundle.json",
  });
  assert.equal(fs.readFileSync(manifestPath, "utf8"), `${JSON.stringify(manifest, null, 2)}\n`);
  assert.equal(
    fs.readFileSync(path.join(root, "authoring-output", "authoring-tasks.jsonl"), "utf8"),
    tasks.map((task) => JSON.stringify(task)).join("\n") + "\n",
  );
});

test("missing packages remain ordered blockers and malformed readable JSON keeps native SyntaxError", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-w23-authoring-errors-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJson(path.join(root, "gate.json"), {
    entities: [
      {
        dataset_type: "flow",
        entity_id: "first",
        authoring_package: "missing-first.json",
        action_item_count: 1,
      },
      {
        dataset_type: "flow",
        entity_id: "second",
        authoring_package: "missing-second.json",
        action_item_count: 1,
      },
    ],
  });
  const blocked = runAuthoringTaskBuild({
    repoRoot: root,
    options: { curationGateReport: "gate.json", outDir: "out" },
  });
  assert.equal(blocked.status, "blocked_missing_authoring_packages");
  const missingPackages = blocked.missing_packages as Array<Record<string, unknown>>;
  assert.deepEqual(
    missingPackages.map((entry) => entry.authoring_package),
    ["missing-first.json", "missing-second.json"],
  );
  assert.equal(fs.existsSync(path.join(root, "out")), false);

  writeText(path.join(root, "malformed.json"), "{ malformed\n");
  assert.throws(
    () =>
      runAuthoringTaskBuild({
        repoRoot: root,
        options: { authoringPackage: "malformed.json", outDir: "single" },
      }),
    SyntaxError,
  );
  assert.throws(
    () =>
      runAuthoringTaskBuild({
        repoRoot: root,
        options: { curationGateReport: "missing-gate.json" },
      }),
    /--curation-gate-report must point to dataset-curation-gate-report\.json\./u,
  );
});
