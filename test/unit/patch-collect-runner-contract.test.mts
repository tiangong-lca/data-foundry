import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDatasetAuthoringPatchCollect } from "../../scripts/lib/import-curation/patch-collect.ts";

type PatchCollectRunner = (args?: {
  repoRoot?: string;
  options?: Record<string, unknown>;
}) => Record<string, unknown>;

const runPatchCollect: PatchCollectRunner = runDatasetAuthoringPatchCollect;

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function task(id: string, patchFile: string, code = `action-${id}`): Record<string, unknown> {
  return {
    status: "ready_for_ai_authoring",
    action_item_count: 1,
    entity: {
      dataset_type: "flow",
      entity_id: id,
      version: "00.00.001",
    },
    context: {
      full_context_ai_completion: { required: false },
      contract_context_files: [],
      missing_context_files: [],
    },
    action_items: [{ code, path: `flowDataSet.${id}` }],
    files: {
      output_patch_file: patchFile,
      authoring_package: `packages/${id}.authoring-package.json`,
    },
  };
}

function patchSet(id: string, labels: string[]): Record<string, unknown> {
  return {
    dataset_id: id,
    version: "00.00.001",
    authoring_package: `${id}.authoring-package.json`,
    operations: labels.map((label) => ({
      op: "replace",
      path: `/${label}`,
      value: label,
      basis: `source-${label}`,
      resolution: { mode: "evidence_backed_completion", used_context_kinds: [] },
      closes_action_items: [`action-${id}`],
    })),
  };
}

test("patch collect preserves exact help without reading a manifest", () => {
  assert.deepEqual(runPatchCollect({ options: { help: true } }), {
    schema_version: 1,
    status: "help",
    command: "dataset-authoring-patch-collect",
    usage: [
      "node scripts/foundry.ts dataset-authoring-patch-collect --task-manifest <authoring-task-manifest.json>",
      "node scripts/foundry.ts dataset-authoring-patch-collect --task-manifest ./authoring-tasks/authoring-task-manifest.json",
    ],
    purpose:
      "Collect per-task AI patch outputs into one batch patch file and block if any task output is missing or structurally invalid. This command is local-only and never writes the database.",
  });
});

test("blocker and invalid-JSON classification preserves task order and never writes a fresh batch", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-w23-patch-blockers-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasks = [
    task("missing", "patches/missing.json"),
    task("malformed", "patches/malformed.json"),
    task("template", "patches/template.json"),
    task("draft", "patches/draft.json"),
    task("empty", "patches/empty.json"),
  ];
  writeText(path.join(root, "patches", "malformed.json"), "{ malformed\n");
  writeJson(path.join(root, "patches", "template.json"), {
    patch_status: "completed",
    template_status: "requires_ai_completion",
    patch_sets: [patchSet("template", ["value"])],
  });
  writeJson(path.join(root, "patches", "draft.json"), {
    patch_status: "draft",
    patch_sets: [patchSet("draft", ["value"])],
  });
  writeJson(path.join(root, "patches", "empty.json"), { patch_status: "completed" });
  writeJson(path.join(root, "manifest.json"), {
    tasks,
    batch_patch_contract: { output_patch_file: "out/ai-patches.batch.json" },
    commands: { apply_all_patches: "node scripts/foundry.ts dataset-patch-apply" },
  });

  const report = runPatchCollect({
    repoRoot: root,
    options: { taskManifest: "manifest.json", outDir: "out" },
  });
  assert.equal(report.status, "blocked");
  const blockers = report.blockers as Array<Record<string, unknown>>;
  assert.deepEqual(
    blockers.map((blocker) => blocker.code),
    [
      "ai_patch_missing",
      "ai_patch_invalid_json",
      "ai_patch_template_incomplete",
      "ai_patch_status_not_completed",
      "ai_patch_no_patch_sets",
    ],
  );
  assert.deepEqual(
    blockers.map((blocker) => blocker.task_index),
    [0, 1, 2, 3, 4],
  );
  assert.equal(fs.existsSync(path.join(root, "out", "ai-patches.batch.json")), false);
  const reportPath = path.join(root, "out", "authoring-patch-collect-report.json");
  assert.equal(fs.readFileSync(reportPath, "utf8"), `${JSON.stringify(report, null, 2)}\n`);
});

test("ready collect preserves patch-file, patch-set, and operation order and writes exact batch bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-w23-patch-ready-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const firstTask = task("first", "patches/first.json");
  const secondTask = task("second", "patches/second.json");
  const firstA = patchSet("first", ["first-a", "first-b"]);
  const firstB = patchSet("first", ["first-c"]);
  const second = patchSet("second", ["second-a", "second-b"]);
  writeJson(path.join(root, "patches", "first.json"), {
    patch_status: "completed",
    patch_sets: [firstA, firstB],
  });
  writeJson(path.join(root, "patches", "second.json"), {
    status: "completed",
    patchSets: [second],
  });
  writeJson(path.join(root, "manifest.json"), {
    tasks: [firstTask, secondTask],
    batch_patch_contract: { output_patch_file: "out/ai-patches.batch.json" },
    commands: { apply_all_patches: "apply-all" },
  });

  const report = runPatchCollect({
    repoRoot: root,
    options: { manifest: "manifest.json", outDir: "out" },
  });
  assert.equal(report.status, "ready_for_patch_apply");
  assert.deepEqual(report.patch_files, ["patches/first.json", "patches/second.json"]);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.counts, {
    tasks: 2,
    required_tasks: 2,
    patch_files: 2,
    patch_sets: 3,
    operations: 5,
    blockers: 0,
  });

  const batchPath = path.join(root, "out", "ai-patches.batch.json");
  const parsed: unknown = JSON.parse(fs.readFileSync(batchPath, "utf8"));
  const batch = asRecord(parsed);
  assert.deepEqual(batch.patch_sets, [firstA, firstB, second]);
  assert.ok(Array.isArray(batch.patch_sets));
  assert.deepEqual(
    batch.patch_sets.map((set) => {
      const typedSet = asRecord(set);
      assert.ok(Array.isArray(typedSet.operations));
      return typedSet.operations.map((operation) => asRecord(operation).path);
    }),
    [["/first-a", "/first-b"], ["/first-c"], ["/second-a", "/second-b"]],
  );
  assert.equal(fs.readFileSync(batchPath, "utf8"), `${JSON.stringify(batch, null, 2)}\n`);
});

test("malformed readable manifest retains native SyntaxError before output creation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-w23-patch-manifest-error-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeText(path.join(root, "manifest.json"), "{ malformed\n");
  assert.throws(
    () =>
      runPatchCollect({
        repoRoot: root,
        options: { taskManifest: "manifest.json", outDir: "out" },
      }),
    SyntaxError,
  );
  assert.equal(fs.existsSync(path.join(root, "out")), false);
});
