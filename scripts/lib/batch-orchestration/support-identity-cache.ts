export interface JsonRecord {
  [key: string]: unknown;
}

export interface SupportIdentityPathAdapter {
  readonly join: (...parts: string[]) => string;
  readonly basename: (filePath: string) => string;
  readonly dirname: (filePath: string) => string;
  readonly separator: string;
}

export interface SupportIdentityCacheRuntimeAdapter {
  readonly nowIso: () => string;
  readonly repoRelative: (filePath: string | null | undefined) => string;
  readonly resolveRepoPath: (value: unknown) => string | null;
  readonly fileExists: (filePath: string | null | undefined) => boolean;
  readonly directoryExists: (filePath: string | null | undefined) => boolean;
  readonly readJson: (filePath: string) => unknown;
  readonly readJsonLines: (filePath: string) => unknown[];
  readonly appendJsonLine: (filePath: string, row: unknown) => void;
  readonly findFiles: (rootDir: string, predicate: (filePath: string) => boolean) => string[];
  readonly supportedTypes: () => readonly string[];
  readonly path: SupportIdentityPathAdapter;
}

export interface PrimeSupportIdentityCacheInput {
  readonly outDir: string;
  readonly cacheFile: string;
  readonly sourceLedgerDirs?: readonly string[];
}

export interface SupportIdentityCacheService {
  readonly verifiedIdentities: Set<string>;
  readonly splitIdentityKey: (identityKey: unknown) => JsonRecord | null;
  readonly identityKeyFromCacheRow: (row: JsonRecord) => string | null;
  readonly appendVerifiedRows: (input: {
    cacheFile: string;
    identityKeys: readonly string[];
    source: string;
    report: string | null;
  }) => number;
  readonly appendInvalidationRows: (input: {
    cacheFile: string;
    identityKeys: readonly string[];
    source: string;
    report: string;
  }) => number;
  readonly staleReusedKeys: (
    finalizeReport: JsonRecord,
    supportIdentityKeys: readonly string[],
  ) => string[];
  readonly prime: (input: PrimeSupportIdentityCacheInput) => JsonRecord;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function assertAdapter(
  adapter: SupportIdentityCacheRuntimeAdapter,
): SupportIdentityCacheRuntimeAdapter {
  const functionKeys = [
    "nowIso",
    "repoRelative",
    "resolveRepoPath",
    "fileExists",
    "directoryExists",
    "readJson",
    "readJsonLines",
    "appendJsonLine",
    "findFiles",
    "supportedTypes",
  ] as const satisfies readonly (keyof SupportIdentityCacheRuntimeAdapter)[];
  const pathKeys = [
    "join",
    "basename",
    "dirname",
  ] as const satisfies readonly (keyof SupportIdentityPathAdapter)[];
  const missing = functionKeys.filter((key) => typeof adapter?.[key] !== "function");
  const missingPath = pathKeys
    .filter((key) => typeof adapter?.path?.[key] !== "function")
    .map((key) => `path.${key}`);
  if (typeof adapter?.path?.separator !== "string" || adapter.path.separator.length === 0) {
    missingPath.push("path.separator");
  }
  if (missing.length > 0 || missingPath.length > 0) {
    throw new Error(
      `createSupportIdentityCacheService missing dependencies: ${[...missing, ...missingPath].join(
        ", ",
      )}`,
    );
  }
  return Object.freeze({ ...adapter, path: Object.freeze({ ...adapter.path }) });
}

export function createSupportIdentityCacheService(
  runtimeAdapter: SupportIdentityCacheRuntimeAdapter,
  verifiedIdentities: Set<string> = new Set<string>(),
): SupportIdentityCacheService {
  const runtime = assertAdapter(runtimeAdapter);
  const { path } = runtime;

  function supported(type: string): boolean {
    return runtime.supportedTypes().includes(type);
  }

  function splitIdentityKey(identityKey: unknown): JsonRecord | null {
    const match = /^(contact|source|unitgroup|flowproperty):([^@]+)@(.+)$/u.exec(
      String(identityKey || ""),
    );
    if (!match) return null;
    return { dataset_type: match[1], dataset_id: match[2], dataset_version: match[3] };
  }

  function identityKeyFromCacheRow(row: JsonRecord): string | null {
    if (row.identity_key) return String(row.identity_key);
    const rawType = row.dataset_type || row.type || row.table;
    const type =
      rawType === "flowproperties"
        ? "flowproperty"
        : rawType === "unitgroups"
          ? "unitgroup"
          : String(rawType || "").replace(/s$/u, "");
    const id = row.dataset_id || row.id;
    const version = row.dataset_version || row.version || "00.00.001";
    return supported(type) && id ? `${type}:${id}@${version}` : null;
  }

  function cacheRow(input: {
    identityKey: string;
    source: string;
    report: string | null;
  }): JsonRecord | null {
    const identity = splitIdentityKey(input.identityKey);
    if (!identity) return null;
    return {
      schema_version: 1,
      generated_at_utc: runtime.nowIso(),
      identity_key: input.identityKey,
      ...identity,
      status: "verified",
      source: input.source,
      report: runtime.repoRelative(input.report),
    };
  }

  function appendVerifiedRows(input: {
    cacheFile: string;
    identityKeys: readonly string[];
    source: string;
    report: string | null;
  }): number {
    if (!input.cacheFile || input.identityKeys.length === 0) return 0;
    let written = 0;
    for (const identityKey of input.identityKeys) {
      const row = cacheRow({
        identityKey,
        source: input.source,
        report: input.report,
      });
      if (!row) continue;
      runtime.appendJsonLine(input.cacheFile, row);
      written += 1;
    }
    return written;
  }

  function appendInvalidationRows(input: {
    cacheFile: string;
    identityKeys: readonly string[];
    source: string;
    report: string;
  }): number {
    if (!input.cacheFile || input.identityKeys.length === 0) return 0;
    let written = 0;
    for (const identityKey of input.identityKeys) {
      const identity = splitIdentityKey(identityKey);
      if (!identity) continue;
      runtime.appendJsonLine(input.cacheFile, {
        schema_version: 1,
        generated_at_utc: runtime.nowIso(),
        identity_key: identityKey,
        ...identity,
        status: "invalidated_remote_missing",
        source: input.source,
        report: runtime.repoRelative(input.report),
      });
      written += 1;
    }
    return written;
  }

  function staleReusedKeys(
    finalizeReport: JsonRecord,
    supportIdentityKeys: readonly string[],
  ): string[] {
    const keySet = new Set(supportIdentityKeys);
    const stale = new Set<string>();
    for (const blocker of asArray(finalizeReport.blockers).map(jsonRecord)) {
      if (!["missing_dataset", "reference_closure_unproven"].includes(asText(blocker.code))) {
        continue;
      }
      const table = asText(blocker.table);
      const type =
        table === "contacts"
          ? "contact"
          : table === "sources"
            ? "source"
            : table === "unitgroups"
              ? "unitgroup"
              : table === "flowproperties"
                ? "flowproperty"
                : null;
      if (!type || !supported(type)) continue;
      const id = asText(blocker.reference_id ?? blocker.id);
      if (!id) continue;
      const version = asText(blocker.reference_version ?? blocker.version) || "00.00.001";
      const identityKey = `${type}:${id}@${version}`;
      if (keySet.has(identityKey)) stale.add(identityKey);
    }
    return [...stale];
  }

  function rowsFromFile(cacheFile: string): JsonRecord[] {
    const byKey = new Map<string, JsonRecord>();
    for (const value of runtime.readJsonLines(cacheFile)) {
      const row = jsonRecord(value);
      const identityKey = identityKeyFromCacheRow(row);
      if (!identityKey) continue;
      byKey.set(identityKey, { ...row, identity_key: identityKey });
    }
    return [...byKey.values()];
  }

  function rowIsVerified(row: JsonRecord): boolean {
    return (asText(row.status) || "verified") === "verified";
  }

  function rowsFromCommitSummary(summaryPath: string, closeoutPath: string): JsonRecord[] {
    const summary = jsonRecord(runtime.readJson(summaryPath));
    if (summary.commit !== true || summary.status !== "completed") return [];
    return (Array.isArray(summary.rows) ? summary.rows : [])
      .map(jsonRecord)
      .filter((row) => row.status === "executed")
      .map((row) => {
        const type =
          row.table === "contacts"
            ? "contact"
            : row.table === "sources"
              ? "source"
              : row.table === "unitgroups"
                ? "unitgroup"
                : row.table === "flowproperties"
                  ? "flowproperty"
                  : row.type;
        const normalizedType = asText(type);
        if (!supported(normalizedType) || !row.id) return null;
        return cacheRow({
          identityKey: `${normalizedType}:${row.id}@${row.version || "00.00.001"}`,
          source: "existing_support_closeout_scan",
          report: closeoutPath,
        });
      })
      .filter((row): row is JsonRecord => Boolean(row));
  }

  function rowsFromCloseout(closeoutPath: string): JsonRecord[] {
    const closeout = jsonRecord(runtime.readJson(closeoutPath));
    if (closeout.status !== "completed") return [];
    const commitReport = runtime.resolveRepoPath(closeout.commit_report);
    if (
      !runtime.fileExists(commitReport) ||
      !commitReport!.includes(`${path.separator}dataset-save-draft${path.separator}`)
    ) {
      return [];
    }
    return rowsFromCommitSummary(commitReport!, closeoutPath);
  }

  function discoverRows(outDir: string): JsonRecord[] {
    const scopesDir = path.join(outDir, "scopes");
    if (!runtime.directoryExists(scopesDir)) return [];
    return runtime
      .findFiles(
        scopesDir,
        (filePath) =>
          path.basename(filePath) === "dataset-post-write-closeout-report.json" &&
          filePath.includes(`${path.separator}closeout${path.separator}`),
      )
      .flatMap(rowsFromCloseout);
  }

  function prime(input: PrimeSupportIdentityCacheInput): JsonRecord {
    verifiedIdentities.clear();
    const sourceLedgerDirs = input.sourceLedgerDirs ?? [];
    const seen = new Set<string>();
    let loaded_from_cache = 0;
    let loaded_from_ledger_sources = 0;
    let discovered_from_artifacts = 0;
    let discovered_from_ledger_source_artifacts = 0;
    for (const row of rowsFromFile(input.cacheFile)) {
      const identityKey = asText(row.identity_key);
      if (!identityKey || seen.has(identityKey)) continue;
      seen.add(identityKey);
      if (!rowIsVerified(row)) continue;
      verifiedIdentities.add(identityKey);
      loaded_from_cache += 1;
    }
    for (const ledgerDir of sourceLedgerDirs) {
      const sourceCacheFile = path.join(ledgerDir, "verified-support-identities.jsonl");
      for (const row of rowsFromFile(sourceCacheFile)) {
        const identityKey = asText(row.identity_key);
        if (!identityKey || seen.has(identityKey)) continue;
        seen.add(identityKey);
        runtime.appendJsonLine(input.cacheFile, {
          ...row,
          carried_forward_from: runtime.repoRelative(sourceCacheFile),
          carried_forward_at_utc: runtime.nowIso(),
        });
        if (!rowIsVerified(row)) continue;
        verifiedIdentities.add(identityKey);
        loaded_from_ledger_sources += 1;
      }
    }
    for (const row of discoverRows(input.outDir)) {
      const identityKey = asText(row.identity_key);
      if (!identityKey || seen.has(identityKey)) continue;
      seen.add(identityKey);
      verifiedIdentities.add(identityKey);
      runtime.appendJsonLine(input.cacheFile, row);
      discovered_from_artifacts += 1;
    }
    for (const priorOutDir of sourceLedgerDirs
      .filter((ledgerDir) => path.basename(ledgerDir) === "import-ledger")
      .map((ledgerDir) => path.dirname(ledgerDir))) {
      for (const row of discoverRows(priorOutDir)) {
        const identityKey = asText(row.identity_key);
        if (!identityKey || seen.has(identityKey)) continue;
        seen.add(identityKey);
        verifiedIdentities.add(identityKey);
        runtime.appendJsonLine(input.cacheFile, {
          ...row,
          carried_forward_from: runtime.repoRelative(priorOutDir),
          carried_forward_at_utc: runtime.nowIso(),
        });
        discovered_from_ledger_source_artifacts += 1;
      }
    }
    return {
      cache_file: runtime.repoRelative(input.cacheFile),
      loaded_from_cache,
      loaded_from_ledger_sources,
      discovered_from_artifacts,
      discovered_from_ledger_source_artifacts,
      verified_support_identities: verifiedIdentities.size,
    };
  }

  return Object.freeze({
    verifiedIdentities,
    splitIdentityKey,
    identityKeyFromCacheRow,
    appendVerifiedRows,
    appendInvalidationRows,
    staleReusedKeys,
    prime,
  });
}
