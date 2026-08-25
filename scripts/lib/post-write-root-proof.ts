export type IntendedRoot = {
  rowIndex: number;
  table: string;
  id: string;
  version: string;
  payloadSha256: string;
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
};

export type RootProofBlocker = {
  code: string;
  message: string;
  key?: string;
  row_index?: number | null;
};

function rootKey(table: unknown, id: unknown, version: unknown): string {
  return `${String(table ?? "")}:${String(id ?? "")}@${String(version ?? "00.00.001")}`;
}

export function validateUniqueRootReadbacks(input: {
  intended: IntendedRoot[];
  checks: RootReadbackCheck[];
  targetUserId: string;
  expectedStateCode: number;
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
        row_index: Number.isInteger(Number(check.row_index)) ? Number(check.row_index) : null,
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
    if (Number(check.row_index) !== root.rowIndex) {
      blockers.push({
        code: "root_readback_index_mismatch",
        message: `Root ${key} readback row_index does not match the final rows index.`,
        key,
        row_index: Number.isInteger(Number(check.row_index)) ? Number(check.row_index) : null,
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
    if (
      check.local_payload_sha256 !== root.payloadSha256 ||
      check.remote_payload_sha256 !== root.payloadSha256
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
    if (Number(check.remote_state_code) !== input.expectedStateCode) {
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
