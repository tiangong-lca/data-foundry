import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "../..");

test("a selected session named workspace.json is never opened as a workspace marker", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-private-marker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".foundry"));
  const file = path.join(root, ".foundry/workspace.json");
  fs.writeFileSync(file, "synthetic private session");
  const module = pathToFileURL(
    path.join(repoRoot, "scripts/lib/foundry-migration-inventory.ts"),
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict'; import fs from 'node:fs';
    const {inventoryFoundryWorkspace} = await import(${JSON.stringify(module)});
    let reads=0; const original=fs.readFileSync; const forbidden=${JSON.stringify(fs.realpathSync(file))};
    fs.readFileSync=(file,...args)=>{if(String(file)===forbidden){reads++;throw new Error('private_read');}return original(file,...args);};
    const inventory=inventoryFoundryWorkspace(${JSON.stringify(root)},{sessionReference:forbidden});
    assert.equal(reads,0); assert.equal(inventory.marker_schema,null); assert.equal(inventory.entries[0].sha256,null);
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("public migration rejects retired macOS Intel before reading legacy state", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-migration-host-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const api = pathToFileURL(path.join(repoRoot, "scripts/public-api.ts")).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const { createFoundryFacade } = await import(${JSON.stringify(api)});
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Object.defineProperty(process, 'arch', { value: 'x64' });
    const original = fs.realpathSync;
    fs.realpathSync = (file, ...args) => {
      if (String(file).includes(${JSON.stringify(path.basename(root))})) throw new Error('legacy_state_read');
      return original(file, ...args);
    };
    const result = createFoundryFacade({workspace:${JSON.stringify(root)}}).migrationDryRun();
    assert.equal(result.status, 'blocked');
    assert.equal(result.blockers[0].code, 'platform_unsupported');
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("migration inventory never reads credential or OAuth session contents", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-migration-private-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".foundry"));
  const files = [
    ".env.local",
    "oauth-session.json",
    "credentials.json",
    "accounts/private.json",
    "opaque.store",
  ];
  for (const file of files) {
    const target = path.join(root, ".foundry", file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "synthetic contents must never be opened");
  }
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const forbidden = new Set(${JSON.stringify(files.map((file) => fs.realpathSync(path.join(root, ".foundry", file))))});
    for (const name of ['openSync', 'readFileSync']) {
      const original = fs[name];
      fs[name] = (file, ...args) => {
        if (forbidden.has(String(file))) throw new Error('credential_content_access');
        return original(file, ...args);
      };
    }
    syncBuiltinESMExports();
    const { inventoryFoundryWorkspace } = await import(${JSON.stringify(pathToFileURL(path.join(repoRoot, "scripts/lib/foundry-migration-inventory.ts")).href)});
    const result = inventoryFoundryWorkspace(${JSON.stringify(root)}, {sessionReference:${JSON.stringify(path.join(root, ".foundry", "opaque.store"))}});
    for (const file of result.entries.filter((item) => item.kind === 'file')) {
      assert.equal(file.sha256, null);
      assert.equal(file.state_class, 'authorization-or-account');
    }
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("public migration planning binds destination, actor, runtime and declared attempt evidence without writes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-migration-plan-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "legacy 中文");
  const destination = path.join(root, "new workspace");
  const state = path.join(source, ".foundry", "capsules");
  fs.mkdirSync(state, { recursive: true });
  const manifest = path.join(state, "stage-manifest.json");
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      schema_version: "foundry-execution-capsule-stage.v1",
      stage_id: "legacy-stage",
      producer_id: "legacy-owner",
      revision: 1,
      scope_binding_sha256: "a".repeat(64),
      attempt_state: {
        status: "UNATTEMPTED",
        attempt_count: 0,
        primary_attempt_count: 0,
        dispatch_state: "NOT_DISPATCHED",
        mutation_state: "NONE",
        readback_state: "NOT_STARTED",
      },
    }),
  );
  const before = fs.readFileSync(manifest);
  const args = [
    path.join(repoRoot, "scripts/package-entry.ts"),
    "workspace",
    "migrate",
    "--workspace",
    source,
    "--to",
    destination,
    "--actor",
    "test-owner",
    "--request",
    "migration-one",
    "--stage-manifest",
    "capsules/stage-manifest.json",
    "--dry-run",
    "--json",
  ];
  const run = () => spawnSync(process.execPath, args, { encoding: "utf8", cwd: root });
  const result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  const envelope = JSON.parse(result.stdout);
  const plan = envelope.artifacts[0].value;
  assert.equal(plan.schema, "tiangong-foundry.workspace-migration-transfer-plan.v2");
  assert.equal(plan.actor_id, "test-owner");
  assert.equal(plan.destination_workspace, path.join(fs.realpathSync(root), "new workspace"));
  assert.equal(plan.source_inventory.workspace_root, fs.realpathSync(source));
  assert.equal(plan.stages[0].disposition, "UNATTEMPTED");
  assert.equal(plan.stages[0].migration_action, "rebuild-local-preparation");
  assert.equal(plan.remote_write_allowed, false);
  assert.match(plan.plan_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(run().stdout, result.stdout);
  assert.equal(fs.existsSync(destination), false);
  assert.deepEqual(fs.readFileSync(manifest), before);
  assert.deepEqual(fs.readdirSync(path.join(source, ".foundry")), ["capsules"]);
});
