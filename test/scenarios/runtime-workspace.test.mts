import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const entry = path.join(repoRoot, "scripts/foundry.ts");
const moduleUrl = new URL("../../scripts/runtime-entry.ts", import.meta.url).href;
const inputBytes =
  JSON.stringify({
    flowDataSet: {
      administrativeInformation: {
        dataEntryBy: { "common:timeStamp": "2026-08-01T12:30:00+08:00" },
      },
    },
  }) + "\n";

test("explicit workspace CLI initializes and cleans data outside the package from an unrelated CWD", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-runtime-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "user project");
  const cwd = path.join(root, "unrelated");
  fs.mkdirSync(cwd);
  const input = path.join(root, "realistic-flow.jsonl");
  fs.writeFileSync(input, inputBytes);
  function run(args: string[]) {
    const env: NodeJS.ProcessEnv = { HOME: root, USERPROFILE: root };
    for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"])
      if (process.env[key]) env[key] = process.env[key];
    const result = spawnSync(process.execPath, [entry, ...args], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.equal(result.stderr, "");
    return { exit: result.status, result: JSON.parse(result.stdout) as Record<string, unknown> };
  }
  const initialized = run(["init", "--workspace", workspace]);
  assert.equal(initialized.exit, 0);
  assert.equal(initialized.result.status, "created");
  const repeated = run(["init", `--workspace=${workspace}`]);
  assert.equal(repeated.result.workspace_id, initialized.result.workspace_id);
  assert.equal(repeated.result.status, "existing");
  const profiles = run(["profiles-list", "--workspace", workspace]);
  assert.deepEqual(Object.keys(profiles.result.profiles as object), [
    "generic",
    "bafu",
    "uslci",
    "worldsteel",
  ]);
  const cleaned = run([
    "dataset-curation-cleanup",
    "--workspace",
    workspace,
    "--task-id",
    "case-one",
    "--actor-id",
    "test-agent",
    "--type",
    "flow",
    "--rows-file",
    input,
  ]);
  assert.equal(cleaned.exit, 0);
  assert.equal(cleaned.result.status, "completed");
  const out = path.join(workspace, String(cleaned.result.cleaned_rows_file));
  assert.ok(out.startsWith(path.join(workspace, ".foundry", "workspaces", "case-one", "outputs")));
  assert.ok(fs.existsSync(out));
  assert.equal(fs.readFileSync(input, "utf8"), inputBytes);
  const escape = run([
    "dataset-curation-cleanup",
    "--workspace",
    workspace,
    "--task-id",
    "case-one",
    "--actor-id",
    "test-agent",
    "--type",
    "flow",
    "--rows-file",
    input,
    "--out-dir",
    path.join(root, "outside-output"),
  ]);
  assert.equal(escape.exit, 1);
  assert.equal(escape.result.code, "path_outside_root");
  assert.equal(fs.existsSync(path.join(root, "outside-output")), false);
});

test("runtime API reuses the cleanup owner with isolated contexts and immutable artifacts", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-runtime-api-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "input.jsonl");
  fs.writeFileSync(input, inputBytes);
  const fact = captureFoundryInput(input);
  const runtimes = ["first", "second"].map((id) => {
    const options = {
      moduleUrl,
      workspace: path.join(root, id),
      cacheBase: path.join(root, "cache"),
    };
    initializeFoundryWorkspace(createFoundryRuntimeContext(options));
    return createFoundryRuntime(
      createFoundryRuntimeContext({ ...options, taskId: "case", actorId: "agent", inputs: [fact] }),
    );
  });
  const results = await Promise.all(
    runtimes.map((runtime) => runtime.cleanup({ input, type: "flow" })),
  );
  assert.equal(results[0].status, "completed");
  assert.equal(results[1].status, "completed");
  assert.equal(fs.readFileSync(input, "utf8"), inputBytes);
  const firstPath = path.join(
    runtimes[0].context.workspaceRoot,
    String(results[0].cleaned_rows_file),
  );
  const secondPath = path.join(
    runtimes[1].context.workspaceRoot,
    String(results[1].cleaned_rows_file),
  );
  assert.notEqual(firstPath, secondPath);
  assert.equal(fs.readFileSync(firstPath, "utf8"), fs.readFileSync(secondPath, "utf8"));
  await assert.rejects(async () =>
    runtimes[0].cleanup({ input, type: "flow", outputDirectory: path.dirname(secondPath) }),
  );
  assert.deepEqual(fs.readdirSync(path.join(root, "first")).sort(), [".foundry"]);
});
