import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const entry = path.resolve(import.meta.dirname, "../../scripts/package-entry.ts");

test("a killed staging process leaves an inactive recoverable transfer", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-killed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"),
    destination = path.join(root, "destination");
  fs.mkdirSync(path.join(source, ".foundry/outputs"), { recursive: true });
  for (let i = 0; i < 400; i++)
    fs.writeFileSync(
      path.join(source, ".foundry/outputs", `${i}.bin`),
      Buffer.alloc(65536, i % 251),
    );
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    USERPROFILE: root,
    SystemRoot: process.env.SystemRoot,
  };
  const common = [
    entry,
    "workspace",
    "migrate",
    "--workspace",
    source,
    "--to",
    destination,
    "--actor",
    "crash-test",
    "--request",
    "kill-once",
    "--json",
  ];
  const planning = spawnSync(process.execPath, [...common, "--dry-run"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(planning.status, 0, planning.stderr || planning.stdout);
  const plan = JSON.parse(planning.stdout).artifacts[0].value,
    planFile = path.join(root, "plan.json");
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const child = spawn(process.execPath, [...common, "--stage", "--plan", planFile], {
    cwd: root,
    env,
    stdio: "ignore",
  });
  const stopped = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const marker = path.join(destination, ".foundry/workspace.json");
  const deadline = Date.now() + 30000;
  while (
    !fs.existsSync(marker) &&
    child.exitCode === null &&
    child.signalCode === null &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fs.existsSync(marker), true, "staging process never published its pending marker");
  assert.equal(child.exitCode, null, "process completed before crash injection");
  child.kill("SIGKILL");
  const exit = await stopped;
  assert.notEqual(exit.code, 0);
  assert.equal(
    JSON.parse(fs.readFileSync(marker, "utf8")).schema,
    "tiangong-foundry.workspace-migration-pending.v1",
  );
  const resumed = spawnSync(process.execPath, [...common, "--stage", "--plan", planFile], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  const receiptPath = JSON.parse(resumed.stdout).artifacts[0].path;
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  assert.equal(receipt.files.length, 400);
  assert.equal(receipt.activated, false);
  assert.deepEqual(
    fs.readFileSync(path.join(source, ".foundry/outputs/399.bin")),
    Buffer.alloc(65536, 399 % 251),
  );
});

test("migration staging preserves control state, root queues and explicit external input without activating the destination", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-transfer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "legacy"),
    destination = path.join(root, "new 中文 workspace");
  fs.mkdirSync(path.join(source, ".foundry/workspaces/one/attempts"), { recursive: true });
  fs.mkdirSync(path.join(source, "tasks/active"), { recursive: true });
  fs.writeFileSync(
    path.join(source, ".foundry/workspaces/one/attempts/state.json"),
    '{"state":"UNKNOWN_DO_NOT_REPLAY"}\n',
  );
  fs.writeFileSync(
    path.join(source, "tasks/active/one.md"),
    "# Legacy task\nPreserve its owner and evidence.\n",
  );
  const input = path.join(root, "external.json");
  fs.writeFileSync(input, '{"flowDataSet":{}}\n');
  const invoke = (args: string[]) =>
    spawnSync(process.execPath, [entry, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: root,
        USERPROFILE: root,
        SystemRoot: process.env.SystemRoot,
      },
    });
  const common = [
    "workspace",
    "migrate",
    "--workspace",
    source,
    "--to",
    destination,
    "--actor",
    "test-actor",
    "--request",
    "transfer-one",
    "--input",
    input,
    "--json",
  ];
  const before = invoke([...common, "--dry-run"]);
  assert.equal(before.status, 0, before.stderr || before.stdout);
  const plan = JSON.parse(before.stdout).artifacts[0].value;
  assert.equal(plan.schema, "tiangong-foundry.workspace-migration-transfer-plan.v2");
  assert.equal(
    plan.source_queue.entries.some((item: { path: string }) => item.path === "active/one.md"),
    true,
  );
  assert.equal(plan.external_inputs.length, 1);
  const planFile = path.join(root, "plan.json");
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const staged = invoke([...common, "--stage", "--plan", planFile]);
  assert.equal(staged.status, 0, staged.stderr || staged.stdout);
  const report = JSON.parse(staged.stdout).artifacts.find(
    (a: { role: string }) => a.role === "migration_transfer_receipt",
  );
  assert.equal(report.kind, "file");
  const receipt = JSON.parse(fs.readFileSync(report.path, "utf8"));
  assert.equal(receipt.state, "staged");
  assert.equal(receipt.activated, false);
  assert.equal(receipt.remote_write_allowed, false);
  for (const copied of receipt.files)
    assert.deepEqual(
      fs.readFileSync(path.join(destination, ".foundry", copied.destination)),
      fs.readFileSync(copied.source),
    );
  assert.equal(receipt.files.length, 3);
  assert.equal(invoke([...common, "--stage", "--plan", planFile]).stdout, staged.stdout);
  const audit = invoke([...common, "--audit", "--plan", planFile]);
  assert.equal(audit.status, 0, audit.stderr || audit.stdout);
  const init = invoke(["workspace", "init", "--workspace", destination, "--json"]);
  assert.notEqual(init.status, 0);
  assert.equal(JSON.parse(init.stdout).blockers[0].code, "workspace_migration_pending");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(destination, ".foundry/workspace.json"), "utf8")).schema,
    "tiangong-foundry.workspace-migration-pending.v1",
  );
  assert.equal(
    fs.readFileSync(path.join(source, ".foundry/workspaces/one/attempts/state.json"), "utf8"),
    '{"state":"UNKNOWN_DO_NOT_REPLAY"}\n',
  );
});
