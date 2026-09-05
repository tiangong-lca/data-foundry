import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertFoundryRuntimeContext,
  FoundryContextError,
  type FoundryRuntimeContext,
  type FoundryInputFact,
  captureFoundryInput,
  pendingFoundryMigration,
} from "./foundry-runtime-context.ts";
import {
  inventoryFoundryWorkspace,
  migrationCredentialPath,
  type FoundryWorkspaceMigrationPlan,
  inventoryFoundryMigrationTree,
  type FoundryMigrationTree,
} from "./foundry-migration-inventory.ts";
import {
  inspectFoundryMigrationStage,
  normalizeMigrationStagePath,
  type MigrationStageEvidence,
} from "./foundry-migration-stage.ts";
export type { MigrationStageEvidence } from "./foundry-migration-stage.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { describeFoundryRuntime } from "./foundry-runtime-paths.ts";
import { assertFoundryPackage } from "./foundry-package-contract.ts";

export const FOUNDRY_MIGRATION_TRANSFER_PLAN_SCHEMA =
  "tiangong-foundry.workspace-migration-transfer-plan.v2" as const;

export interface FoundryMigrationTransferPlan {
  readonly schema: typeof FOUNDRY_MIGRATION_TRANSFER_PLAN_SCHEMA;
  readonly request_id: string;
  readonly actor_id: string;
  readonly destination_workspace: string;
  readonly account_intent: { readonly project_ref: string; readonly user_id: string } | null;
  readonly runtime: {
    readonly package_name: string;
    readonly package_version: string;
    readonly manifest_sha256: string;
    readonly entry_sha256: string;
    readonly platform: string;
    readonly scope: "entry-only" | "installed-package";
    readonly payload_sha256: string | null;
  };
  readonly source_inventory: FoundryWorkspaceMigrationPlan;
  readonly source_queue: FoundryMigrationTree;
  readonly external_inputs: readonly FoundryInputFact[];
  readonly stages: readonly MigrationStageEvidence[];
  readonly omitted_private_paths: readonly string[];
  readonly blockers: readonly { readonly code: string; readonly path: string | null }[];
  readonly source_must_remain_unchanged: true;
  readonly remote_write_allowed: false;
  readonly plan_sha256: string;
}

export interface FoundryMigrationPlanningOptions {
  readonly sourceWorkspace: string;
  readonly requestId: string;
  readonly actorId: string;
  readonly stageManifests?: readonly string[];
  readonly externalInputs?: readonly string[];
}

const maxDocumentBytes = 8 * 1024 * 1024;

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("migration_document_invalid", "Migration evidence must be a JSON object.");
  return value as Record<string, unknown>;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    !relative ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function runtimeFacts(context: FoundryRuntimeContext): FoundryMigrationTransferPlan["runtime"] {
  try {
    const actual = describeFoundryRuntime(pathToFileURL(context.runtime.entryPath).href);
    if (sha256Json(actual) !== sha256Json(context.runtime))
      fail("migration_runtime_changed", "Runtime identity changed after context construction.");
    const packaged = actual.entryRepoRelativePath.startsWith("package-dist/");
    return Object.freeze({
      package_name: actual.packageName,
      package_version: actual.packageVersion,
      manifest_sha256: actual.packageManifestSha256,
      entry_sha256: actual.entrySha256,
      platform: context.platform,
      scope: packaged ? "installed-package" : "entry-only",
      payload_sha256: packaged ? assertFoundryPackage(actual.runtimeRoot).files_sha256 : null,
    });
  } catch {
    return fail(
      "migration_runtime_changed",
      "The selected runtime no longer matches its captured identity or package closure.",
    );
  }
}

/** Read-only planning. Stage labels interpret retained evidence; they grant no execution authority. */
export function planFoundryWorkspaceMigration(
  context: FoundryRuntimeContext,
  options: FoundryMigrationPlanningOptions,
  pendingPlanSha256?: string,
): FoundryMigrationTransferPlan {
  assertFoundryRuntimeContext(context);
  const runtime = runtimeFacts(context);
  if (
    typeof options.actorId !== "string" ||
    typeof options.requestId !== "string" ||
    typeof options.sourceWorkspace !== "string" ||
    !path.isAbsolute(options.sourceWorkspace) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(options.actorId) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(options.requestId)
  )
    fail(
      "migration_intent_invalid",
      "Migration planning requires explicit request and actor identifiers.",
    );
  const selection = options.stageManifests ?? [];
  if (
    !Array.isArray(selection) ||
    selection.some((item) => typeof item !== "string") ||
    selection.length > 128
  )
    fail("migration_evidence_invalid", "Stage selections must be unique and bounded.");
  const selected = selection.map(normalizeMigrationStagePath);
  if (new Set(selected).size !== selected.length)
    fail("migration_evidence_invalid", "Stage selections contain canonical duplicate paths.");
  const source = fs.realpathSync(options.sourceWorkspace);
  if (inside(source, context.workspaceRoot) || inside(context.workspaceRoot, source))
    fail("migration_roots_overlap", "Migration source and destination must be disjoint.");
  if (
    fs.existsSync(context.controlRoot) &&
    (!pendingPlanSha256 || pendingFoundryMigration(context) !== pendingPlanSha256)
  )
    fail("migration_destination_exists", "Choose a destination without existing Foundry state.");
  const privateOptions = { sessionReference: context.accountIntent?.sessionReference };
  const inventory = inventoryFoundryWorkspace(source, privateOptions);
  const queue = inventoryFoundryMigrationTree(path.join(source, "tasks"), privateOptions);
  const inputs = options.externalInputs ?? [];
  if (
    !Array.isArray(inputs) ||
    inputs.length > 1000 ||
    inputs.some((file) => typeof file !== "string" || !path.isAbsolute(file))
  )
    fail("migration_inputs_invalid", "External inputs must be explicitly selected absolute files.");
  const externalInputs = inputs
    .map((file) => {
      const canonical = fs.realpathSync(file);
      if (
        migrationCredentialPath(file) ||
        (privateOptions.sessionReference &&
          fs.existsSync(privateOptions.sessionReference) &&
          canonical === fs.realpathSync(privateOptions.sessionReference))
      )
        fail(
          "migration_credential_forbidden",
          "A private file cannot be selected as external migration data.",
        );
      if (inside(context.workspaceRoot, canonical))
        fail("migration_roots_overlap", "External inputs cannot be inside the destination.");
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
        fail("migration_inputs_invalid", "External inputs must be bounded regular files.");
      return captureFoundryInput(file);
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (new Set(externalInputs.map((f) => f.path)).size !== externalInputs.length)
    fail("migration_inputs_invalid", "External inputs contain canonical duplicates.");
  const allEntries = [...inventory.entries, ...queue.entries];
  if (
    allEntries.length + externalInputs.length > 10_000 ||
    allEntries.reduce((n, f) => n + (f.sha256 ? (f.bytes ?? 0) : 0), 0) +
      externalInputs.reduce((n, f) => n + f.bytes, 0) >
      256 * 1024 * 1024
  )
    fail(
      "migration_inventory_limit",
      "Combined migration sources exceed the inventory or byte limit.",
    );
  if (inventory.marker_schema !== null && inventory.marker_schema.length > 256)
    fail(
      "migration_source_schema_unsupported",
      "Source marker schema exceeds the migration protocol limit.",
    );
  if (!inventory.foundry_root_exists && !queue.exists)
    fail("migration_source_empty", "The selected source has no Foundry state to migrate.");
  const stages = Object.freeze(
    [...selected].sort().map((file) => inspectFoundryMigrationStage(inventory, file)),
  );
  const privateReference =
    privateOptions.sessionReference && fs.existsSync(privateOptions.sessionReference)
      ? fs.realpathSync(privateOptions.sessionReference)
      : privateOptions.sessionReference;
  const privatePath = (relative: string) =>
    migrationCredentialPath(relative) ||
    path.join(source, ".foundry", relative) === privateReference;
  const omitted = inventory.entries
    .filter((entry) => privatePath(entry.path))
    .map((entry) => entry.path);
  const queuePrivate = (relative: string) =>
    migrationCredentialPath(relative) || path.join(source, "tasks", relative) === privateReference;
  omitted.push(
    ...queue.entries
      .filter((entry) => queuePrivate(entry.path))
      .map((entry) => `tasks/${entry.path}`),
  );
  const blockers: Array<Readonly<{ code: string; path: string | null }>> = inventory.entries
    .filter((entry) => entry.kind === "file" && entry.sha256 === null && !privatePath(entry.path))
    .map((entry) => Object.freeze({ code: "migration_unhashed_file", path: entry.path }));
  blockers.push(
    ...queue.entries
      .filter((entry) => entry.kind === "file" && !entry.sha256 && !queuePrivate(entry.path))
      .map((entry) =>
        Object.freeze({ code: "migration_unhashed_file", path: `tasks/${entry.path}` }),
      ),
  );
  if (privatePath("workspace.json"))
    blockers.push(Object.freeze({ code: "migration_private_marker", path: "workspace.json" }));
  if (
    inventory.marker_schema !== null &&
    inventory.marker_schema !== "tiangong-foundry.workspace.v1"
  )
    blockers.push(
      Object.freeze({ code: "migration_source_schema_unsupported", path: "workspace.json" }),
    );
  const current = inventoryFoundryWorkspace(source, privateOptions);
  if (
    sha256Json(current) !== sha256Json(inventory) ||
    sha256Json(inventoryFoundryMigrationTree(path.join(source, "tasks"), privateOptions)) !==
      sha256Json(queue) ||
    externalInputs.some((file) => sha256Json(captureFoundryInput(file.path)) !== sha256Json(file))
  )
    fail(
      "migration_source_changed",
      "Source state changed while the migration plan was assembled.",
    );
  if (sha256Json(runtimeFacts(context)) !== sha256Json(runtime))
    fail(
      "migration_runtime_changed",
      "Runtime bytes changed while migration planning was in progress.",
    );
  const payload = {
    schema: FOUNDRY_MIGRATION_TRANSFER_PLAN_SCHEMA,
    request_id: options.requestId,
    actor_id: options.actorId,
    destination_workspace: context.workspaceRoot,
    account_intent: context.accountIntent
      ? Object.freeze({
          project_ref: context.accountIntent.projectRef,
          user_id: context.accountIntent.userId,
        })
      : null,
    runtime,
    source_inventory: inventory,
    source_queue: queue,
    external_inputs: Object.freeze(externalInputs),
    stages,
    omitted_private_paths: Object.freeze(omitted),
    blockers: Object.freeze(blockers),
    source_must_remain_unchanged: true as const,
    remote_write_allowed: false as const,
  };
  const result = Object.freeze({ ...payload, plan_sha256: sha256Json(payload) });
  if (Buffer.byteLength(JSON.stringify(result)) > maxDocumentBytes)
    fail("migration_plan_limit", "The migration plan exceeds its bounded document size.");
  return result;
}

/** Untrusted serialized plans are accepted only when a fresh independent reconstruction matches every field. */
export function revalidateFoundryMigrationPlan(
  context: FoundryRuntimeContext,
  options: FoundryMigrationPlanningOptions,
  value: unknown,
  pendingPlanSha256?: string,
): FoundryMigrationTransferPlan {
  let count = 0;
  const json = (item: unknown, depth: number): void => {
    if (++count > 200_000 || depth > 64)
      fail("migration_plan_limit", "Migration plan JSON exceeds its structural limits.");
    if (typeof item === "string" && item.length > 8192)
      fail("migration_plan_limit", "Migration plan strings exceed their bound.");
    if (
      item === null ||
      typeof item === "boolean" ||
      typeof item === "string" ||
      (typeof item === "number" && Number.isFinite(item))
    )
      return;
    if (!item || typeof item !== "object" || Object.getOwnPropertySymbols(item).length)
      fail("migration_document_invalid", "Migration plan must contain only plain JSON data.");
    if (Array.isArray(item)) {
      if (
        Object.keys(item).length !== item.length ||
        Object.getOwnPropertyNames(item).length !== item.length + 1
      )
        fail(
          "migration_document_invalid",
          "Migration plan arrays cannot contain extra properties.",
        );
      if (item.length > 10_000)
        fail("migration_plan_limit", "Migration plan arrays exceed their bound.");
      for (let index = 0; index < item.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !("value" in descriptor))
          fail(
            "migration_document_invalid",
            "Migration plan cannot contain sparse arrays or accessors.",
          );
        json(descriptor.value, depth + 1);
      }
    } else {
      if (Object.getOwnPropertyNames(item).length !== Object.keys(item).length)
        fail("migration_document_invalid", "Migration plan cannot contain hidden object fields.");
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        fail("migration_document_invalid", "Migration plan objects must be plain records.");
      for (const key of Object.keys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!("value" in descriptor))
          fail("migration_document_invalid", "Migration plan cannot contain accessors.");
        json(descriptor.value, depth + 1);
      }
    }
  };
  json(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > maxDocumentBytes)
    fail("migration_plan_limit", "Migration plan exceeds its document byte limit.");
  const supplied = record(value);
  const current = planFoundryWorkspaceMigration(context, options, pendingPlanSha256);
  if (sha256Json(supplied) !== sha256Json(current))
    fail(
      "migration_plan_changed",
      "The supplied plan differs from current source, destination, intent or runtime facts.",
    );
  return current;
}
