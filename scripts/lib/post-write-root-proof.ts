export type IntendedRoot = {
  rowIndex: number;
  table: string;
  id: string;
  version: string;
  payloadSha256: string;
  acceptedNormalizedPayloadSha256?: string | null;
  acceptedNormalizedRemovedPaths?: string[];
};

export type RootReadbackCheck = {
  role?: unknown;
  row_index?: unknown;
  table?: unknown;
  id?: unknown;
  version?: unknown;
  path?: unknown;
  status?: unknown;
  local_payload_sha256?: unknown;
  remote_payload_sha256?: unknown;
  remote_user_id?: unknown;
  remote_state_code?: unknown;
  foundry_verification_mode?: unknown;
  foundry_original_status?: unknown;
  foundry_original_local_payload_sha256?: unknown;
  foundry_original_remote_payload_sha256?: unknown;
  foundry_accepted_differences?: unknown;
};

export type RootProofBlocker = {
  code: string;
  message: string;
  key?: string;
  row_index?: number | null;
};

function rootKey(table: unknown, id: unknown, version: unknown): string {
  return `${String(table ?? "")}:${String(id ?? "")}@${String(version ?? "")}`;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJsonValue((value as Record<string, unknown>)[key])]),
  );
}

export function canonicalPayloadSha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJsonValue(value)))
    .digest("hex");
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function acceptedTraceHashPayloadMatches(
  root: IntendedRoot,
  check: RootReadbackCheck,
  allowed: boolean,
): boolean {
  if (
    !allowed ||
    !root.acceptedNormalizedPayloadSha256 ||
    !Array.isArray(root.acceptedNormalizedRemovedPaths) ||
    root.acceptedNormalizedRemovedPaths.length === 0 ||
    check.foundry_verification_mode !== "accepted_normalized_payload" ||
    check.foundry_original_status !== "payload_mismatch" ||
    check.local_payload_sha256 !== root.acceptedNormalizedPayloadSha256 ||
    check.remote_payload_sha256 !== root.acceptedNormalizedPayloadSha256 ||
    typeof check.foundry_original_local_payload_sha256 !== "string" ||
    typeof check.foundry_original_remote_payload_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(check.foundry_original_local_payload_sha256) ||
    !/^[a-f0-9]{64}$/u.test(check.foundry_original_remote_payload_sha256) ||
    check.foundry_original_local_payload_sha256 !== root.payloadSha256 ||
    check.foundry_original_local_payload_sha256 === check.foundry_original_remote_payload_sha256 ||
    !Array.isArray(check.foundry_accepted_differences) ||
    check.foundry_accepted_differences.length !== 1
  ) {
    return false;
  }
  const evidence = check.foundry_accepted_differences[0];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  const record = evidence as Record<string, unknown>;
  const localRemovedPaths = stringArray(record.local_removed_paths);
  const remoteRemovedPaths = stringArray(record.remote_removed_paths);
  return Boolean(
    record.accepted_difference === "tiangongfoundry_import_trace_summary_trace_hash_only" &&
    record.normalized_payload_sha256 === root.acceptedNormalizedPayloadSha256 &&
    record.original_local_payload_sha256 === check.foundry_original_local_payload_sha256 &&
    record.original_remote_payload_sha256 === check.foundry_original_remote_payload_sha256 &&
    localRemovedPaths?.length &&
    remoteRemovedPaths?.length &&
    sameStrings(localRemovedPaths, root.acceptedNormalizedRemovedPaths) &&
    sameStrings(remoteRemovedPaths, root.acceptedNormalizedRemovedPaths),
  );
}

export function validateUniqueRootReadbacks(input: {
  intended: IntendedRoot[];
  checks: RootReadbackCheck[];
  targetUserId: string;
  expectedStateCode: number;
  allowTraceHashOnlyNormalization?: boolean;
}): { blockers: RootProofBlocker[]; uniqueReadbackCount: number } {
  const blockers: RootProofBlocker[] = [];
  const intendedByKey = new Map<string, IntendedRoot>();
  for (const root of input.intended) {
    const key = rootKey(root.table, root.id, root.version);
    if (intendedByKey.has(key)) {
      blockers.push({
        code: "intended_root_duplicate",
        message: `Final rows contain duplicate intended root ${key}.`,
        key,
        row_index: root.rowIndex,
      });
    } else {
      intendedByKey.set(key, root);
    }
  }

  const rootChecks = input.checks.filter(
    (check) => check.role === "root" && String(check.path ?? "").endsWith("#readback"),
  );
  const checksByKey = new Map<string, RootReadbackCheck[]>();
  for (const check of rootChecks) {
    const key = rootKey(check.table, check.id, check.version);
    if (!intendedByKey.has(key)) {
      blockers.push({
        code: "root_readback_unexpected",
        message: `Readback contains an unexpected root ${key}.`,
        key,
        row_index:
          typeof check.row_index === "number" && Number.isInteger(check.row_index)
            ? check.row_index
            : null,
      });
      continue;
    }
    const matches = checksByKey.get(key) ?? [];
    matches.push(check);
    checksByKey.set(key, matches);
  }

  let uniqueReadbackCount = 0;
  for (const [key, root] of intendedByKey) {
    const matches = checksByKey.get(key) ?? [];
    if (matches.length === 0) {
      blockers.push({
        code: "root_readback_missing",
        message: `No root readback proves intended root ${key}.`,
        key,
        row_index: root.rowIndex,
      });
      continue;
    }
    if (matches.length !== 1) {
      blockers.push({
        code: "root_readback_duplicate",
        message: `Root ${key} has ${matches.length} readback checks; expected exactly one.`,
        key,
        row_index: root.rowIndex,
      });
      continue;
    }
    const check = matches[0];
    uniqueReadbackCount += 1;
    if (
      typeof check.row_index !== "number" ||
      !Number.isInteger(check.row_index) ||
      check.row_index !== root.rowIndex
    ) {
      blockers.push({
        code: "root_readback_index_mismatch",
        message: `Root ${key} readback row_index does not match the final rows index.`,
        key,
        row_index:
          typeof check.row_index === "number" && Number.isInteger(check.row_index)
            ? check.row_index
            : null,
      });
    }
    if (check.status !== "ok") {
      blockers.push({
        code: "root_readback_status_not_ok",
        message: `Root ${key} readback status is not ok.`,
        key,
        row_index: root.rowIndex,
      });
    }
    const directPayloadMatch =
      check.local_payload_sha256 === root.payloadSha256 &&
      check.remote_payload_sha256 === root.payloadSha256;
    if (
      !directPayloadMatch &&
      !acceptedTraceHashPayloadMatches(root, check, input.allowTraceHashOnlyNormalization === true)
    ) {
      blockers.push({
        code: "root_readback_payload_mismatch",
        message: `Root ${key} does not bind both local and remote hashes to the intended payload.`,
        key,
        row_index: root.rowIndex,
      });
    }
    if (check.remote_user_id !== input.targetUserId) {
      blockers.push({
        code: "root_readback_owner_mismatch",
        message: `Root ${key} is not owned by the intended account.`,
        key,
        row_index: root.rowIndex,
      });
    }
    if (
      typeof check.remote_state_code !== "number" ||
      check.remote_state_code !== input.expectedStateCode
    ) {
      blockers.push({
        code: "root_readback_state_mismatch",
        message: `Root ${key} is not in the intended state.`,
        key,
        row_index: root.rowIndex,
      });
    }
  }

  return { blockers, uniqueReadbackCount };
}
import { createHash } from "node:crypto";
