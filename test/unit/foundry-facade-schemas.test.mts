import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { createFoundryOperationResult } from "../../scripts/lib/foundry-operation-result.ts";
import { inventoryFoundryWorkspace } from "../../scripts/lib/foundry-migration-inventory.ts";
import { createFoundryPackageDescriptor } from "../../scripts/lib/foundry-package-contract.ts";
import { createFoundryRuntimeContext } from "../../scripts/lib/foundry-runtime-context.ts";
import { planFoundryWorkspaceMigration } from "../../scripts/lib/foundry-migration-plan.ts";
import { pathToFileURL } from "node:url";

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
const Ajv = Ajv2020 as unknown as new (options: { strict: boolean }) => {
  addSchema: (schema: unknown) => void;
  compile: (schema: unknown) => Validator;
};
const schemaRoot = path.resolve(import.meta.dirname, "../../specs/schemas");
const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(schemaRoot, name), "utf8")) as unknown;

test("facade task, result, request and migration schemas compile and reject unsafe variants", (t) => {
  const ajv = new Ajv({ strict: true });
  const taskSchema = read("foundry-task-start.schema.json");
  ajv.addSchema(taskSchema);
  const task = {
    schema: "tiangong-foundry.task-start.v1",
    request_id: "request",
    actor_id: "actor",
    lane: "external-dataset-curated-import",
    profile_id: "generic",
    target_entities: ["flow"],
    sources: [{ path: "flow.json" }],
    seed: null,
    account_intent: null,
    preparation: null,
  };
  const validateTask = ajv.compile(taskSchema);
  assert.equal(validateTask(task), true, JSON.stringify(validateTask.errors));
  assert.equal(validateTask({ ...task, unexpected: true }), false);

  const validateResult = ajv.compile(read("foundry-operation-result.schema.json"));
  const result = createFoundryOperationResult({
    operation: "task.start",
    status: "ready",
    taskId: "task",
    artifacts: [],
    blockers: [],
    nextActions: [],
    runtimeIdentity: null,
    permissions: { state: "not_required", requested_actions: [], approval_reference: null },
  });
  assert.equal(validateResult(result), true, JSON.stringify(validateResult.errors));
  assert.equal(validateResult({ ...result, blockers: [{ code: "bad" }] }), false);

  const validateRequest = ajv.compile(read("foundry-facade-request-index.schema.json"));
  const digest = "1".repeat(64);
  const request = {
    schema: "tiangong-foundry.facade-request-index.v1",
    workspace_id: "workspace",
    request_id: "request",
    request_sha256: digest,
    revisions: [
      {
        revision: 1,
        task_id: `task-${"1".repeat(64)}-r0001`,
        predecessor_task_id: null,
        fingerprint_sha256: digest,
        spec_source: { path: "/spec.json", bytes: 1, sha256: digest },
        spec: task,
        inputs: [{ path: "/flow.json", bytes: 1, sha256: digest }],
        created_at_utc: "2026-09-05T00:00:00.000Z",
        record_sha256: digest,
      },
    ],
    index_sha256: digest,
  };
  assert.equal(validateRequest(request), true, JSON.stringify(validateRequest.errors));
  assert.equal(validateRequest({ ...request, revisions: [] }), false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-migration-schema-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const validateMigration = ajv.compile(read("foundry-workspace-migration-plan.schema.json"));
  const plan = inventoryFoundryWorkspace(root);
  assert.equal(validateMigration(plan), true, JSON.stringify(validateMigration.errors));
  assert.equal(validateMigration({ ...plan, write_allowed: true }), false);
  fs.mkdirSync(path.join(root, ".foundry"));
  const transferContext = createFoundryRuntimeContext({
    moduleUrl: pathToFileURL(path.resolve(schemaRoot, "../../scripts/public-api.ts")).href,
    workspace: path.join(os.tmpdir(), `transfer-${path.basename(root)}`),
    cacheBase: path.join(root, "cache"),
  });
  const transfer = planFoundryWorkspaceMigration(transferContext, {
    sourceWorkspace: root,
    actorId: "actor",
    requestId: "schema-case",
  });
  const validateTransfer = ajv.compile(
    read("foundry-workspace-migration-transfer-plan.schema.json"),
  );
  assert.equal(validateTransfer(transfer), true, JSON.stringify(validateTransfer.errors));
  assert.equal(validateTransfer({ ...transfer, remote_write_allowed: true }), false);
  assert.equal(
    validateTransfer({
      ...transfer,
      runtime: { ...transfer.runtime, scope: "installed-package", payload_sha256: null },
    }),
    false,
  );
  assert.equal(
    validateTransfer({ ...transfer, runtime: { ...transfer.runtime, platform: "darwin-x64" } }),
    false,
  );
  assert.equal(validateTransfer({ ...transfer, unexpected: true }), false);

  const validatePackage = ajv.compile(read("foundry-package-descriptor.schema.json"));
  const packageDescriptor = createFoundryPackageDescriptor(
    [
      "README.md",
      "LICENSE",
      "package-dist/scripts/package-entry.js",
      "package-dist/scripts/public-api.js",
      "package-dist/scripts/public-api.d.ts",
    ].map((selectedPath) => ({ path: selectedPath, bytes: 1, sha256: digest })),
  );
  assert.equal(validatePackage(packageDescriptor), true, JSON.stringify(validatePackage.errors));
  assert.equal(
    validatePackage({
      ...packageDescriptor,
      runtime: {
        ...packageDescriptor.runtime,
        supported_platforms: [...packageDescriptor.runtime.supported_platforms, "darwin-x64"],
      },
    }),
    false,
  );
});
