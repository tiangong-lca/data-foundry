import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FoundryContextError } from "./foundry-runtime-context.ts";
import {
  migrationCredentialPath,
  type FoundryWorkspaceMigrationPlan,
} from "./foundry-migration-inventory.ts";
import { modelExecutionAttemptDisposition } from "./foundry-execution-attempt.ts";

export interface MigrationStageEvidence {
  readonly path: string;
  readonly sha256: string;
  readonly stage_id: string;
  readonly producer_id: string;
  readonly revision: number;
  readonly scope_binding_sha256: string;
  readonly disposition: ReturnType<typeof modelExecutionAttemptDisposition>["disposition"];
  readonly migration_action:
    "rebuild-local-preparation" | "retain-terminal" | "owner-readback-only";
  readonly grants_write_authority: false;
}

const maxDocumentBytes = 8 * 1024 * 1024;
const digestPattern = /^[a-f0-9]{64}$/u;

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

export function normalizeMigrationStagePath(value: string): string {
  if (typeof value !== "string") fail("migration_path_invalid", "Stage paths must be strings.");
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.length > 4096 ||
    path.isAbsolute(normalized) ||
    normalized.includes(":") ||
    normalized.split("").some((character) => character.charCodeAt(0) < 32) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail("migration_path_invalid", "Select a portable relative path within the source state root.");
  return normalized;
}

function readEvidence(
  inventory: FoundryWorkspaceMigrationPlan,
  selected: string,
): { value: Record<string, unknown>; sha256: string } {
  const relative = normalizeMigrationStagePath(selected);
  if (migrationCredentialPath(relative))
    fail(
      "migration_credential_forbidden",
      "Credential or session storage cannot be migration stage evidence.",
    );
  const fact = inventory.entries.find((entry) => entry.path === relative);
  if (
    !fact ||
    fact.kind !== "file" ||
    fact.bytes === null ||
    fact.sha256 === null ||
    fact.bytes > maxDocumentBytes
  )
    fail("migration_evidence_invalid", "Stage evidence must be a bounded hashed inventory file.");
  const sourceRoot = path.join(inventory.workspace_root, ".foundry");
  let target = sourceRoot;
  for (const part of ["", ...relative.split("/")]) {
    if (part) target = path.join(target, part);
    const stat = fs.lstatSync(target);
    if (
      stat.isSymbolicLink() ||
      (target !== path.join(sourceRoot, relative) && !stat.isDirectory())
    )
      fail("migration_evidence_invalid", "Stage evidence cannot traverse a link or non-directory.");
  }
  const canonical = fs.realpathSync(target);
  if (!inside(sourceRoot, canonical))
    fail("migration_evidence_invalid", "Stage evidence escapes the source state root.");
  const before = fs.lstatSync(canonical, { bigint: true });
  if (!before.isFile() || before.size !== BigInt(fact.bytes))
    fail("migration_source_changed", "Selected stage evidence changed after inventory.");
  const fd = fs.openSync(canonical, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (
      !opened.isFile() ||
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      opened.size !== before.size
    )
      fail("migration_source_changed", "Selected stage evidence changed while opening.");
    bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) break;
      offset += count;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const linked = fs.lstatSync(canonical, { bigint: true });
    if (
      offset !== bytes.length ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      linked.ino !== before.ino ||
      linked.dev !== before.dev ||
      linked.isSymbolicLink() ||
      createHash("sha256").update(bytes).digest("hex") !== fact.sha256
    )
      fail("migration_source_changed", "Selected stage bytes or identity changed while reading.");
  } finally {
    fs.closeSync(fd);
  }
  try {
    return { value: record(JSON.parse(bytes.toString("utf8"))), sha256: fact.sha256 };
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    return fail("migration_document_invalid", "Stage evidence must contain complete JSON.");
  }
}

export function inspectFoundryMigrationStage(
  inventory: FoundryWorkspaceMigrationPlan,
  selected: string,
): MigrationStageEvidence {
  const { value, sha256 } = readEvidence(inventory, selected);
  if (
    value.schema_version !== "foundry-execution-capsule-stage.v1" ||
    typeof value.stage_id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,255}$/u.test(value.stage_id) ||
    typeof value.producer_id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(value.producer_id) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    typeof value.scope_binding_sha256 !== "string" ||
    !digestPattern.test(value.scope_binding_sha256)
  )
    fail(
      "migration_stage_unsupported",
      "Selected evidence is not a recognized content-bound legacy stage.",
    );
  const attempt = record(value.attempt_state);
  const modeled = modelExecutionAttemptDisposition({
    dispatch_state: typeof attempt.dispatch_state === "string" ? attempt.dispatch_state : undefined,
    readback_state: typeof attempt.readback_state === "string" ? attempt.readback_state : undefined,
  });
  const countsValid =
    Number.isSafeInteger(attempt.attempt_count) &&
    Number(attempt.attempt_count) >= 0 &&
    Number.isSafeInteger(attempt.primary_attempt_count) &&
    Number(attempt.primary_attempt_count) >= 0 &&
    Number(attempt.primary_attempt_count) <= Number(attempt.attempt_count);
  const pristine =
    countsValid &&
    attempt.status === "UNATTEMPTED" &&
    attempt.attempt_count === 0 &&
    attempt.primary_attempt_count === 0 &&
    attempt.dispatch_state === "NOT_DISPATCHED" &&
    attempt.mutation_state === "NONE" &&
    attempt.readback_state === "NOT_STARTED";
  const disposition =
    (modeled.disposition === "UNATTEMPTED" && !pristine) ||
    !countsValid ||
    (modeled.terminal && Number(attempt.attempt_count) === 0)
      ? "UNKNOWN_DO_NOT_REPLAY"
      : modeled.disposition;
  return Object.freeze({
    path: selected,
    sha256,
    stage_id: value.stage_id,
    producer_id: value.producer_id,
    revision: Number(value.revision),
    scope_binding_sha256: value.scope_binding_sha256,
    disposition,
    migration_action:
      disposition === "UNATTEMPTED"
        ? "rebuild-local-preparation"
        : disposition === "UNKNOWN_DO_NOT_REPLAY"
          ? "owner-readback-only"
          : "retain-terminal",
    grants_write_authority: false,
  });
}
