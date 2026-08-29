import {
  parseBatchItemContract,
  type BatchAttemptedResumeItem,
  type BatchEvent,
  type BatchItemContract,
} from "@tiangong-lca/cli/batch";

import type { ScopeResumeContract } from "./scope-resume-contract.ts";

type JsonRecord = Record<string, unknown>;

export interface ScopeAttemptLedgerAdapter {
  nowIso: () => string;
  readJsonLines: (filePath: string) => JsonRecord[];
  appendJsonLine: (filePath: string, row: JsonRecord) => void;
  writeJsonLines: (filePath: string, rows: readonly JsonRecord[]) => void;
}

export interface ScopeAttemptLedgerPaths {
  state: string;
  events: string;
}

export interface ScopeAttemptEventInput {
  event: BatchEvent;
  itemContract: BatchItemContract | null;
  scopeResumeContract?: ScopeResumeContract | null;
}

interface AttemptState {
  itemContract: BatchItemContract;
  attempts: number;
  scopeResumeContract: ScopeResumeContract | null;
}

function positiveAttempts(value: unknown): number | null {
  const attempts = Number(value);
  return Number.isSafeInteger(attempts) && attempts > 0 ? attempts : null;
}

function parseState(row: JsonRecord): AttemptState | null {
  try {
    const itemContract = parseBatchItemContract(row.item_contract);
    const attempts = positiveAttempts(row.attempts);
    if (attempts === null) return null;
    return {
      itemContract,
      attempts,
      scopeResumeContract: (row.scope_resume_contract as ScopeResumeContract | null) ?? null,
    };
  } catch {
    return null;
  }
}

function reduceAttemptState(rows: readonly JsonRecord[]): Map<string, AttemptState> {
  const states = new Map<string, AttemptState>();
  for (const row of rows) {
    const type = String(row.type ?? "");
    const itemId = String(row.item_id ?? "");
    if (!itemId) {
      const state = parseState(row);
      if (state) states.set(state.itemContract.item_id, state);
      continue;
    }
    if (["attempt_succeeded", "recovery_succeeded", "item_resumed"].includes(type)) {
      states.delete(itemId);
      continue;
    }
    if (type !== "attempt_started") continue;
    const state = parseState({
      item_contract: row.item_contract,
      attempts: row.attempt,
      scope_resume_contract: row.scope_resume_contract,
    });
    if (state) states.set(itemId, state);
  }
  return states;
}

export function createScopeAttemptLedgerService({
  paths,
  adapter,
}: {
  paths: ScopeAttemptLedgerPaths;
  adapter: ScopeAttemptLedgerAdapter;
}) {
  function currentStates(): Map<string, AttemptState> {
    return reduceAttemptState([
      ...adapter.readJsonLines(paths.state),
      ...adapter.readJsonLines(paths.events),
    ]);
  }

  function loadResumeItems(selectedIds: ReadonlySet<string>): BatchAttemptedResumeItem[] {
    return [...currentStates().values()]
      .filter((state) => selectedIds.has(state.itemContract.item_id))
      .map((state) => ({ ...state.itemContract, state: "attempted", attempts: state.attempts }));
  }

  function recordEvent(input: ScopeAttemptEventInput): void {
    adapter.appendJsonLine(paths.events, {
      schema_version: 1,
      generated_at_utc: adapter.nowIso(),
      ...input.event,
      item_contract: input.itemContract,
      scope_resume_contract: input.scopeResumeContract ?? null,
    });
  }

  function compact(): void {
    const rows = [...currentStates().values()]
      .sort((left, right) => left.itemContract.item_id.localeCompare(right.itemContract.item_id))
      .map((state) => ({
        schema_version: 1,
        generated_at_utc: adapter.nowIso(),
        state: "attempted",
        item_contract: state.itemContract,
        attempts: state.attempts,
        scope_resume_contract: state.scopeResumeContract,
      }));
    adapter.writeJsonLines(paths.state, rows);
    adapter.writeJsonLines(paths.events, []);
  }

  return Object.freeze({ loadResumeItems, record: recordEvent, compact });
}
