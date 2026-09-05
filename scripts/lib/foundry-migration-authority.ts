import path from "node:path";
import { sha256Json } from "./identity-preflight-proof.ts";
import {
  transferFail,
  transferRead,
  transferHash,
  transferPath,
  transferFileFact,
} from "./foundry-migration-transfer-io.ts";
import type { FoundryRuntimeContext } from "./foundry-runtime-context-types.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import {
  datasetIdentity,
  detectDatasetType,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";
import { assertNotFoundrySessionFile } from "./foundry-private-path.ts";

export const FOUNDRY_MIGRATION_ACTIVATION_SCHEMA =
  "tiangong-foundry.migration-activation.v1" as const;
export const FOUNDRY_MIGRATED_WORKSPACE_SCHEMA = "tiangong-foundry.workspace.v2" as const;
export const FOUNDRY_MIGRATED_WORKSPACE_FEATURES = Object.freeze([
  "migration-adoption-v1",
  "registered-tasks-v2",
]);

export interface MigrationProtectedFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface MigrationTaskAuthority {
  readonly source_task: string;
  readonly origin_sha256: string;
  readonly disposition:
    "local-unattempted" | "terminal-retained" | "owner-readback-only" | "blocked-evidence";
  readonly task_id: string | null;
  readonly request_id: string | null;
  readonly actor_id: string;
  readonly spec_fingerprint_sha256: string | null;
  readonly scope_keys: readonly string[];
  readonly scope_complete: boolean;
}
export interface FoundryMigrationActivation {
  readonly schema: typeof FOUNDRY_MIGRATION_ACTIVATION_SCHEMA;
  readonly workspace_id: string;
  readonly plan_sha256: string;
  readonly adoption_sha256: string;
  readonly created_at_utc: string;
  readonly tasks: readonly MigrationTaskAuthority[];
  readonly protected_files: readonly MigrationProtectedFile[];
  readonly remote_write_allowed: false;
  readonly activation_sha256: string;
}

const sha = /^[0-9a-f]{64}$/u;
const taskId = /^task-[0-9a-f]{64}-r\d{4}$/u;
const scopeKey =
  /^(?:contact|source|flow|flowproperty|unitgroup|process|lifecyclemodel):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@[0-9]{2}\.[0-9]{2}\.[0-9]{3}$/u;

/** Uses the existing dataset owner interpretation; metadata or opaque inputs never prove an empty scope. */
export function migrationDatasetScope(
  file: string,
  data: Buffer,
): { keys: string[]; complete: boolean } {
  try {
    const rows = readRows(file, () => data.toString("utf8"));
    if (!rows.length || rows.length > 100_000) return { keys: [], complete: false };
    const keys = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const type =
        detectDatasetType(row) ??
        [
          "flow",
          "process",
          "contact",
          "source",
          "unitgroup",
          "flowproperty",
          "lifecyclemodel",
        ].find(
          (candidate) => detectDatasetType(unwrapDatasetPayload(row, candidate)) === candidate,
        );
      if (!type) return { keys: [...keys].sort(), complete: false };
      const identity = datasetIdentity(row, index, type);
      const key = `${identity.dataset_type}:${identity.id.toLowerCase()}@${identity.version}`;
      if (!scopeKey.test(key)) return { keys: [...keys].sort(), complete: false };
      keys.add(key);
    }
    return { keys: [...keys].sort(), complete: true };
  } catch {
    return { keys: [], complete: false };
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    transferFail("migration_authority_invalid", "Migration authority must be a JSON object.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): void {
  if (
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    transferFail(
      "migration_authority_invalid",
      "Migration authority fields differ from the supported contract.",
    );
}

export function readFoundryMigrationAuthority(
  controlRoot: string,
  workspaceId: string,
  migration: { readonly plan_sha256: string; readonly activation_sha256: string },
  verifyProtected = true,
  sessionReference?: string,
): Readonly<FoundryMigrationActivation> {
  const checkedRead = (relative: string, limit = 16 * 1024 * 1024) => {
    const file = transferPath(controlRoot, relative);
    assertNotFoundrySessionFile(file, sessionReference);
    return transferRead(file, limit);
  };
  const bytes = checkedRead(`migrations/${migration.plan_sha256}/activation.json`);
  if (transferHash(bytes) !== migration.activation_sha256)
    transferFail(
      "migration_authority_changed",
      "Migration activation differs from the workspace anchor.",
    );
  const value = object(JSON.parse(bytes.toString("utf8")));
  exact(value, [
    "schema",
    "workspace_id",
    "plan_sha256",
    "adoption_sha256",
    "created_at_utc",
    "tasks",
    "protected_files",
    "remote_write_allowed",
    "activation_sha256",
  ]);
  const { activation_sha256: digest, ...unsigned } = value;
  if (
    value.schema !== FOUNDRY_MIGRATION_ACTIVATION_SCHEMA ||
    value.workspace_id !== workspaceId ||
    value.plan_sha256 !== migration.plan_sha256 ||
    typeof value.adoption_sha256 !== "string" ||
    !sha.test(value.adoption_sha256) ||
    digest !== sha256Json(unsigned) ||
    value.remote_write_allowed !== false ||
    typeof value.created_at_utc !== "string" ||
    !Number.isFinite(Date.parse(value.created_at_utc)) ||
    new Date(value.created_at_utc).toISOString() !== value.created_at_utc ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > 1000 ||
    !Array.isArray(value.protected_files) ||
    value.protected_files.length > 20_000
  )
    transferFail(
      "migration_authority_invalid",
      "Migration activation identity or digest is invalid.",
    );
  const ids = new Set<string>(),
    origins = new Set<string>();
  for (const entry of value.tasks) {
    const item = object(entry);
    exact(item, [
      "source_task",
      "origin_sha256",
      "disposition",
      "task_id",
      "request_id",
      "actor_id",
      "spec_fingerprint_sha256",
      "scope_keys",
      "scope_complete",
    ]);
    if (
      typeof item.source_task !== "string" ||
      !item.source_task ||
      typeof item.origin_sha256 !== "string" ||
      !sha.test(item.origin_sha256) ||
      origins.has(item.origin_sha256) ||
      typeof item.actor_id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(item.actor_id) ||
      ![
        "local-unattempted",
        "terminal-retained",
        "owner-readback-only",
        "blocked-evidence",
      ].includes(String(item.disposition))
    )
      transferFail(
        "migration_authority_invalid",
        "Migration task origin or disposition is invalid.",
      );
    if (
      !Array.isArray(item.scope_keys) ||
      item.scope_keys.length > 100_000 ||
      item.scope_keys.some((key) => typeof key !== "string" || !scopeKey.test(key)) ||
      new Set(item.scope_keys).size !== item.scope_keys.length ||
      typeof item.scope_complete !== "boolean" ||
      (item.scope_complete && item.scope_keys.length === 0)
    )
      transferFail("migration_authority_invalid", "Migration dataset scope is invalid.");
    origins.add(item.origin_sha256);
    if (item.disposition === "local-unattempted") {
      if (
        typeof item.task_id !== "string" ||
        !taskId.test(item.task_id) ||
        ids.has(item.task_id) ||
        typeof item.request_id !== "string" ||
        !item.request_id ||
        typeof item.spec_fingerprint_sha256 !== "string" ||
        !sha.test(item.spec_fingerprint_sha256)
      )
        transferFail("migration_authority_invalid", "Adopted preparation identity is invalid.");
      ids.add(item.task_id);
    } else if (
      item.task_id !== null ||
      item.request_id !== null ||
      item.spec_fingerprint_sha256 !== null
    )
      transferFail(
        "migration_authority_invalid",
        "Retained attempted work cannot become a new executable task.",
      );
  }
  const names = new Set<string>();
  let total = 0;
  for (const entry of value.protected_files) {
    const file = object(entry);
    exact(file, ["path", "bytes", "sha256"]);
    if (
      typeof file.path !== "string" ||
      names.has(file.path) ||
      typeof file.bytes !== "number" ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      typeof file.sha256 !== "string" ||
      !sha.test(file.sha256)
    )
      transferFail("migration_authority_invalid", "Protected migration evidence is invalid.");
    names.add(file.path);
    total += file.bytes;
    if (total > 512 * 1024 * 1024)
      transferFail(
        "migration_authority_invalid",
        "Protected migration evidence exceeds its bound.",
      );
    const selected = transferPath(controlRoot, file.path);
    assertNotFoundrySessionFile(selected, sessionReference);
    if (verifyProtected) {
      const actual = transferFileFact(selected);
      if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
        transferFail(
          "migration_authority_changed",
          "Protected migration evidence changed or is missing.",
        );
    }
  }
  const required = [
    `migrations/${migration.plan_sha256}/plan.json`,
    `migrations/${migration.plan_sha256}/receipt.json`,
    `migrations/${migration.plan_sha256}/adoption.json`,
  ];
  if (required.some((file) => !names.has(file)))
    transferFail("migration_authority_invalid", "Activation omits required migration evidence.");
  const documents = required.map((file) =>
    object(JSON.parse(checkedRead(file, 8 * 1024 * 1024).toString("utf8"))),
  );
  const [plan, receipt, adoption] = documents;
  const { plan_sha256: planDigest, ...planBody } = plan;
  const { receipt_sha256: receiptDigest, ...receiptBody } = receipt;
  const { adoption_sha256: adoptionDigest, ...adoptionBody } = adoption;
  if (
    planDigest !== migration.plan_sha256 ||
    planDigest !== sha256Json(planBody) ||
    receipt.schema !== "tiangong-foundry.migration-transfer-receipt.v1" ||
    receiptDigest !== sha256Json(receiptBody) ||
    receipt.plan_sha256 !== planDigest ||
    receipt.workspace_id !== workspaceId ||
    receipt.activated !== false ||
    receipt.remote_write_allowed !== false ||
    adoption.schema !== "tiangong-foundry.migration-adoption-plan.v1" ||
    adoptionDigest !== value.adoption_sha256 ||
    adoptionDigest !== sha256Json(adoptionBody) ||
    adoption.workspace_id !== workspaceId ||
    adoption.plan_sha256 !== planDigest ||
    adoption.actor_id !== plan.actor_id ||
    !Array.isArray(adoption.tasks) ||
    !Array.isArray(receipt.files)
  )
    transferFail(
      "migration_authority_invalid",
      "Activation, adoption and transfer evidence do not describe the same migration.",
    );
  const protectedByPath = new Map(
    (value.protected_files as MigrationProtectedFile[]).map((file) => [file.path, file]),
  );
  for (const file of receipt.files as Record<string, unknown>[]) {
    const protectedFile = protectedByPath.get(String(file.destination));
    if (
      !protectedFile ||
      protectedFile.sha256 !== file.sha256 ||
      protectedFile.bytes !== file.bytes
    )
      transferFail(
        "migration_authority_invalid",
        "Activation does not protect every archived source file.",
      );
  }
  if (sha256Json(adoption.tasks.map((row) => object(row).authority)) !== sha256Json(value.tasks))
    transferFail(
      "migration_authority_invalid",
      "Activated task dispositions differ from their reviewed adoption.",
    );
  for (const row of adoption.tasks as Record<string, unknown>[]) {
    const task = object(row.authority);
    if (
      !Array.isArray(row.scope_inputs) ||
      row.scope_inputs.some((file) => typeof file !== "string" || !protectedByPath.has(file))
    )
      transferFail(
        "migration_authority_invalid",
        "Adopted dataset scope is not anchored to protected inputs.",
      );
    if (verifyProtected) {
      const keys = new Set<string>();
      let complete = row.scope_inputs.length > 0;
      for (const file of row.scope_inputs as string[]) {
        const input = transferPath(controlRoot, file);
        const scope = migrationDatasetScope(input, checkedRead(file, 64 * 1024 * 1024));
        complete = complete && scope.complete;
        for (const key of scope.keys) keys.add(key);
      }
      if (
        sha256Json([...keys].sort()) !== sha256Json(task.scope_keys) ||
        (task.scope_complete === true && !complete)
      )
        transferFail(
          "migration_authority_changed",
          "Retained dataset scope differs from independently observed archived inputs.",
        );
    }
    if (task.task_id !== null) {
      const id = String(task.task_id);
      const requiredTaskFiles = [
        `workspaces/${id}/foundry-job.json`,
        `workspaces/${id}/source-manifest.json`,
        `workspaces/${id}/profile-lock.json`,
        `state/task-registrations/${id}.json`,
        `state/task-publications/${id}.json`,
        `state/facade-tasks/${id}.json`,
      ];
      if (requiredTaskFiles.some((file) => !protectedByPath.has(file)))
        transferFail(
          "migration_authority_invalid",
          "An adopted task is missing protected registration or predecessor bindings.",
        );
      const pointer = object(
        JSON.parse(checkedRead(`state/facade-tasks/${id}.json`, 64 * 1024).toString("utf8")),
      );
      const index = object(
        JSON.parse(
          checkedRead(`state/facade-requests/${id.slice(5, 69)}.json`, 8 * 1024 * 1024).toString(
            "utf8",
          ),
        ),
      );
      const { index_sha256: indexDigest, ...indexBody } = index;
      if (
        pointer.schema !== "tiangong-foundry.facade-task-pointer.v1" ||
        pointer.workspace_id !== workspaceId ||
        pointer.task_id !== id ||
        index.schema !== "tiangong-foundry.facade-request-index.v1" ||
        index.workspace_id !== workspaceId ||
        index.request_id !== task.request_id ||
        indexDigest !== sha256Json(indexBody) ||
        !Array.isArray(index.revisions) ||
        typeof pointer.revision !== "number"
      )
        transferFail(
          "migration_authority_changed",
          "The adopted request lineage is missing or changed.",
        );
      const revision = object(index.revisions[pointer.revision - 1]);
      const { record_sha256: revisionDigest, ...revisionBody } = revision;
      if (
        revision.task_id !== id ||
        revision.fingerprint_sha256 !== task.spec_fingerprint_sha256 ||
        revisionDigest !== pointer.revision_sha256 ||
        revisionDigest !== sha256Json(revisionBody)
      )
        transferFail(
          "migration_authority_changed",
          "The immutable adopted revision no longer matches its request index.",
        );
    }
  }
  return value as unknown as Readonly<FoundryMigrationActivation>;
}

export function assertMigrationTaskIntent(
  context: FoundryRuntimeContext,
  requestId: string,
  actorId: string,
  id: string,
  fingerprint?: string,
): void {
  if (!context.migration) return;
  const authority = readFoundryMigrationAuthority(
    context.controlRoot,
    context.workspaceId!,
    context.migration,
  );
  const selected = authority.tasks.find(
    (task) => task.task_id === id && task.disposition === "local-unattempted",
  );
  if (!selected) return;
  if (
    selected.actor_id !== actorId ||
    selected.request_id !== requestId ||
    (fingerprint !== undefined && selected.spec_fingerprint_sha256 !== fingerprint)
  )
    transferFail(
      "migration_task_adoption_required",
      "This request is outside the audited migration task mapping; retain the original owner history and use explicit adoption for a changed task.",
    );
}

export function migratedTaskRoot(controlRoot: string, planSha256: string): string {
  return path.join(controlRoot, "migrations", planSha256);
}
