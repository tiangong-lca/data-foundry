import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

type DatasetIdentity = {
  id: string | null;
  version: string | null;
};

type CanonicalSupportRewriteDependencies = {
  asText: (value: unknown) => string;
  booleanOption: (value: unknown) => boolean;
  cloneJson: <T>(value: T) => T;
  datasetIdentity: (row: JsonRecord, datasetType: string) => DatasetIdentity;
  datasetRowsFileStem: (datasetType: string) => string;
  ensureArray: (value: unknown) => unknown[];
  fileExists: (filePath: string) => boolean;
  multiLang: (text: string, language?: string) => JsonRecord;
  nowIso: () => string;
  pathExpression: (parts: Array<string | number>) => string;
  readJson: (filePath: string) => JsonRecord;
  readRowsFile: (filePath: string) => JsonRecord[];
  repoRelativeMaybe: (filePath: string | null) => string | null;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: unknown[]) => void;
};

type CanonicalSupportOptions = JsonRecord & {
  canonicalSupportCache?: unknown;
  supportCache?: unknown;
  cacheFile?: unknown;
};

type CanonicalSupportIndex = {
  flowPropertyById: Map<string, JsonRecord>;
  flowPropertyMappingByUnit: Map<string, JsonRecord & { canonicalId: string }>;
  unitGroupById: Map<string, JsonRecord>;
};

type CanonicalSupportCacheContext = {
  cache: JsonRecord | null;
  cachePath: string | null;
  index: CanonicalSupportIndex;
};

type RewriteStats = {
  canonical_flow_property_reference_rewrites: number;
  canonical_unit_group_reference_proofs: number;
  amount_scaling_required_rewrites: number;
  amount_scaling_blocked: number;
  amount_scaling_unresolved: number;
};

type RewriteContext = {
  cacheContext: CanonicalSupportCacheContext;
  datasetType: string;
  sourceFile: string;
  stats: RewriteStats;
  rewriteRows: JsonRecord[];
  blockers: JsonRecord[];
  scalingRequirements?: JsonRecord[];
  blockOnUnscaled?: boolean;
  datasetIdentityCache: DatasetIdentity;
  rowIndex?: number | null;
  language?: string;
  pathSegments?: Array<string | number>;
  allowAccountLocalSupportAndElementary?: boolean;
};

export function createCanonicalSupportRewriteUtils({
  asText,
  booleanOption,
  cloneJson,
  datasetIdentity,
  datasetRowsFileStem,
  ensureArray,
  fileExists,
  multiLang,
  nowIso,
  pathExpression,
  readJson,
  readRowsFile,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
  writeJsonLines,
}: CanonicalSupportRewriteDependencies) {
  const defaultCanonicalSupportCacheFile =
    "specs/canonical-support/flow-properties-unit-groups.json";

  function supportText(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (Array.isArray(value)) {
      return value.map(supportText).filter(Boolean).join(" | ");
    }
    if (typeof value === "object") {
      const record = value as JsonRecord;
      if (typeof record["#text"] === "string") return record["#text"].trim();
      return Object.values(record).map(supportText).filter(Boolean).join(" | ");
    }
    return "";
  }

  function normalizeSupportKey(value: unknown): string {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\u00b2/gu, "2")
      .replace(/\u00b3/gu, "3")
      .replace(/\u00b5/gu, "u")
      .replace(/[\u00b7\u2219]/gu, "*")
      .replace(/\s+/gu, "")
      .replace(/\./gu, "");
  }

  // Resolve the scale factor that converts an amount in `unit` into the canonical
  // Flow Property's reference unit (e.g. kWh -> MJ = 3.6, t*km -> kg*km = 1000).
  // The factor lives in the mapping's source_unit_scales (authoritative, sourced
  // from the canonical UnitGroup mean values); 1 means no conversion is needed.
  function resolveAmountScale(
    mapping: JsonRecord | undefined,
    unit: string,
    normalizedUnit: string,
  ): number | null {
    const scales = mapping?.source_unit_scales;
    if (!scales || typeof scales !== "object") return null;
    const scaleRecord = scales as JsonRecord;
    if (Object.hasOwn(scaleRecord, unit)) return Number(scaleRecord[unit]);
    if (Object.hasOwn(scaleRecord, normalizedUnit)) return Number(scaleRecord[normalizedUnit]);
    for (const [key, value] of Object.entries(scaleRecord)) {
      if (normalizeSupportKey(key) === normalizedUnit) return Number(value);
    }
    return null;
  }

  function canonicalSupportCachePath(options: CanonicalSupportOptions = {}): string | null {
    return resolveRepoPath(
      options.canonicalSupportCache ||
        options.supportCache ||
        options.cacheFile ||
        defaultCanonicalSupportCacheFile,
    );
  }

  function flowPropertyReferenceText(reference: JsonRecord | null | undefined): string {
    return supportText(
      reference?.["common:shortDescription"] ?? reference?.shortDescription ?? reference?.name,
    );
  }

  function unitFromFlowPropertyReference(reference: JsonRecord): string {
    const text = flowPropertyReferenceText(reference);
    const match = text.match(/^amount\s+in\s+(.+)$/iu);
    return match ? match[1].trim() : text;
  }

  function buildCanonicalSupportIndex(cache: JsonRecord | null): CanonicalSupportIndex {
    const flowPropertyById = new Map<string, JsonRecord>();
    for (const value of ensureArray(cache?.flow_properties)) {
      const row = value as JsonRecord;
      const id = asText(row?.id);
      if (id) flowPropertyById.set(id, row);
    }
    const unitGroupById = new Map<string, JsonRecord>();
    for (const value of ensureArray(cache?.unit_groups)) {
      const row = value as JsonRecord;
      const id = asText(row?.id);
      if (id) unitGroupById.set(id, row);
    }
    const flowPropertyMappingByUnit = new Map<string, JsonRecord & { canonicalId: string }>();
    for (const value of ensureArray(cache?.flow_property_mappings)) {
      const mapping = value as JsonRecord;
      const canonicalId = asText(mapping?.canonical_flow_property_id);
      for (const unit of ensureArray(mapping?.source_units)) {
        const key = normalizeSupportKey(unit);
        if (key) flowPropertyMappingByUnit.set(key, { ...mapping, canonicalId });
      }
    }
    return { flowPropertyById, flowPropertyMappingByUnit, unitGroupById };
  }

  function loadCanonicalSupportCache(
    options: CanonicalSupportOptions = {},
  ): CanonicalSupportCacheContext {
    const cachePath = canonicalSupportCachePath(options);
    if (!cachePath || !fileExists(cachePath)) {
      return { cache: null, cachePath, index: buildCanonicalSupportIndex(null) };
    }
    const cache = readJson(cachePath);
    return { cache, cachePath, index: buildCanonicalSupportIndex(cache) };
  }

  function canonicalFlowPropertyReference(entry: JsonRecord, language = "en") {
    const id = asText(entry?.id);
    const version = asText(entry?.version);
    const rawShortDescription =
      supportText(entry?.reference_short_description) ||
      supportText(entry?.short_description) ||
      supportText(entry?.name) ||
      id;
    const shortDescription = rawShortDescription.split("|")[0].trim() || id;
    return {
      "@type": "flow property data set",
      "@refObjectId": id,
      "@version": version,
      "@uri": `../flowproperties/${id}.json`,
      "common:shortDescription": multiLang(shortDescription, language),
    };
  }

  function canonicalFlowPropertyUnitGroupProof(
    entry: JsonRecord,
    cacheContext: CanonicalSupportCacheContext,
  ) {
    const referenceUnitGroup = (entry?.reference_unit_group ?? {}) as JsonRecord;
    const unitGroupId = asText(
      referenceUnitGroup.id ??
        referenceUnitGroup.ref_object_id ??
        referenceUnitGroup["@refObjectId"],
    );
    const unitGroup = unitGroupId ? cacheContext.index.unitGroupById.get(unitGroupId) : null;
    const unitGroupVersion =
      asText(referenceUnitGroup.version ?? referenceUnitGroup["@version"]) ||
      asText(unitGroup?.version) ||
      null;
    const shortDescription =
      supportText(referenceUnitGroup.short_description) ||
      supportText(referenceUnitGroup["common:shortDescription"]) ||
      supportText(unitGroup?.short_description) ||
      supportText(unitGroup?.name) ||
      null;
    return {
      proven: Boolean(unitGroupId && unitGroup),
      ref_object_id: unitGroupId || null,
      version: unitGroupVersion,
      short_description: shortDescription,
    };
  }

  function rewriteCanonicalFlowPropertyReferences(
    value: unknown,
    {
      cacheContext,
      datasetType,
      sourceFile,
      stats,
      rewriteRows,
      blockers,
      scalingRequirements = [],
      blockOnUnscaled = false,
      datasetIdentityCache,
      rowIndex = null,
      language = "en",
      pathSegments = [],
      allowAccountLocalSupportAndElementary = false,
    }: RewriteContext,
  ): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        rewriteCanonicalFlowPropertyReferences(item, {
          cacheContext,
          datasetType,
          sourceFile,
          stats,
          rewriteRows,
          blockers,
          scalingRequirements,
          blockOnUnscaled,
          datasetIdentityCache,
          rowIndex,
          language,
          pathSegments: [...pathSegments, index],
          allowAccountLocalSupportAndElementary,
        }),
      );
      return;
    }
    const record = value as JsonRecord;
    for (const [key, child] of Object.entries(record)) {
      const childPath = [...pathSegments, key];
      if (
        key === "referenceToFlowPropertyDataSet" &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        const reference = child as JsonRecord;
        const originalId = asText(reference["@refObjectId"]);
        const originalVersion = asText(reference["@version"]);
        const unit = unitFromFlowPropertyReference(reference);
        const normalizedUnit = normalizeSupportKey(unit);
        const alreadyCanonical = originalId && cacheContext.index.flowPropertyById.has(originalId);
        const mapping = cacheContext.index.flowPropertyMappingByUnit.get(normalizedUnit);
        const canonical = mapping
          ? cacheContext.index.flowPropertyById.get(mapping.canonicalId)
          : null;
        const provenCanonical = alreadyCanonical
          ? cacheContext.index.flowPropertyById.get(originalId)
          : canonical;
        const unitGroupProof = provenCanonical
          ? canonicalFlowPropertyUnitGroupProof(provenCanonical, cacheContext)
          : null;
        if (provenCanonical && !unitGroupProof?.proven) {
          // Override: when the BAFU profile may mint account-local support, do not block on
          // an unproven canonical Unit Group; leave the source flow-property reference as-is
          // so it is written as a My Data (state_code=0) FP/UG keeping its source unit.
          if (!allowAccountLocalSupportAndElementary) {
            blockers.push({
              code: "canonical_flow_property_unit_group_unproven",
              message:
                "The selected canonical Flow Property must prove its Reference Unit Group through the local canonical support cache. Foundry must not create account-local Unit Group support rows.",
              dataset_type: datasetType,
              dataset_id: datasetIdentityCache?.id ?? null,
              dataset_version: datasetIdentityCache?.version ?? null,
              row_index: rowIndex,
              source_file: repoRelativeMaybe(sourceFile),
              path: pathExpression(childPath),
              source_unit: unit || null,
              original_ref_object_id: originalId || null,
              canonical_flow_property_id: asText(provenCanonical.id) || null,
              canonical_reference_unit_group_id: unitGroupProof?.ref_object_id ?? null,
              required_resolution:
                "Refresh specs/canonical-support/flow-properties-unit-groups.json from the database or select a canonical Flow Property whose Reference Unit Group is present in that cache.",
            });
          }
          continue;
        }
        // Account-local override: a flow that ALREADY references the canonical FP
        // UUID but at a stale version (e.g. a BAFU source flow referencing the Time
        // FP @00.00.001 while the written My Data FP is @01.00.000) must be bumped to
        // the cached canonical version. Otherwise every downstream remote-verify layer
        // (reference closure, precommit verify, post-write readback) reports the
        // reference as `version_outdated` and blocks the scope. The support-cache rewrite
        // normally only swaps non-canonical UUIDs, so it would leave the stale version
        // untouched; here we repoint the existing canonical reference to its latest
        // proven version. Account-local minted FP/UG keep their source unit, so no scale
        // conversion applies to this version bump.
        if (allowAccountLocalSupportAndElementary && alreadyCanonical && provenCanonical) {
          const cachedVersion = asText(provenCanonical.version);
          if (cachedVersion && cachedVersion !== originalVersion) {
            const next = canonicalFlowPropertyReference(provenCanonical, language);
            record[key] = next;
            stats.canonical_flow_property_reference_rewrites =
              Number(stats.canonical_flow_property_reference_rewrites ?? 0) + 1;
            stats.canonical_unit_group_reference_proofs =
              Number(stats.canonical_unit_group_reference_proofs ?? 0) + 1;
            rewriteRows.push({
              relation: "flow_property_reference_version_bump_to_canonical_support",
              dataset_type: datasetType,
              dataset_id: datasetIdentityCache?.id ?? null,
              dataset_version: datasetIdentityCache?.version ?? null,
              row_index: rowIndex,
              source_file: repoRelativeMaybe(sourceFile),
              path: pathExpression(childPath),
              source_unit: unit || null,
              canonical_reference_unit: mapping?.canonical_reference_unit ?? null,
              amount_scale_to_canonical_reference: 1,
              amount_scaling_required: false,
              original: {
                ref_object_id: originalId || null,
                version: originalVersion || null,
                short_description: flowPropertyReferenceText(reference) || null,
              },
              canonical: {
                ref_object_id: next["@refObjectId"],
                version: next["@version"],
                short_description: next["common:shortDescription"]["#text"],
              },
              canonical_reference_unit_group: unitGroupProof,
              mapping_reason:
                "Account-local canonical Flow Property version bump to the latest written My Data version.",
            });
          }
          continue;
        }
        if (!alreadyCanonical && mapping && canonical) {
          const next = canonicalFlowPropertyReference(canonical, language);
          record[key] = next;
          stats.canonical_flow_property_reference_rewrites =
            Number(stats.canonical_flow_property_reference_rewrites ?? 0) + 1;
          stats.canonical_unit_group_reference_proofs =
            Number(stats.canonical_unit_group_reference_proofs ?? 0) + 1;
          // The source unit may differ in scale from the canonical reference unit
          // (e.g. kWh->MJ = 3.6, t*km->kg*km = 1000). The rewrite only swaps the FP
          // pointer; exchange amounts are NOT converted here, so any scale != 1 must
          // be surfaced (and optionally block) rather than silently shipped. The
          // documented profile policy requires explicit scaling, not silent magic.
          const amountScale = resolveAmountScale(mapping, unit, normalizedUnit);
          const scaleResolved = amountScale !== null && Number.isFinite(amountScale);
          const needsScaling = scaleResolved && amountScale !== 1;
          const scaleInvalid = !scaleResolved || amountScale <= 0;
          rewriteRows.push({
            relation: "flow_property_reference_to_canonical_support",
            dataset_type: datasetType,
            dataset_id: datasetIdentityCache?.id ?? null,
            dataset_version: datasetIdentityCache?.version ?? null,
            row_index: rowIndex,
            source_file: repoRelativeMaybe(sourceFile),
            path: pathExpression(childPath),
            source_unit: unit,
            canonical_reference_unit: mapping.canonical_reference_unit ?? null,
            amount_scale_to_canonical_reference: scaleResolved ? amountScale : null,
            amount_scaling_required: needsScaling,
            original: {
              ref_object_id: originalId || null,
              version: originalVersion || null,
              short_description: flowPropertyReferenceText(reference) || null,
            },
            canonical: {
              ref_object_id: next["@refObjectId"],
              version: next["@version"],
              short_description: next["common:shortDescription"]["#text"],
            },
            canonical_reference_unit_group: unitGroupProof,
            mapping_reason: mapping.reason ?? null,
            legacy_support_note: mapping.legacy_support_note ?? null,
          });
          if (blockOnUnscaled && scaleInvalid) {
            stats.amount_scaling_unresolved = Number(stats.amount_scaling_unresolved ?? 0) + 1;
            const unresolvedRequirement = {
              dataset_type: datasetType,
              dataset_id: datasetIdentityCache?.id ?? null,
              dataset_version: datasetIdentityCache?.version ?? null,
              row_index: rowIndex,
              source_file: repoRelativeMaybe(sourceFile),
              path: pathExpression(childPath),
              source_unit: unit,
              canonical_reference_unit: mapping.canonical_reference_unit ?? null,
              amount_scale_to_canonical_reference: null,
              configured_amount_scale_to_canonical_reference: scaleResolved ? amountScale : null,
              scale_resolution_status: "unresolved_scale",
              note: "The canonical mapping does not provide a finite positive amount scale for this source unit. The reference may be rewritten for evidence, but the scope must remain blocked because no physically valid conversion factor is proven.",
            };
            scalingRequirements.push(unresolvedRequirement);
            blockers.push({
              code: "canonical_support_amount_scale_unresolved",
              message:
                "Canonical Flow Property mapping is missing a finite positive amount scale for the source unit; block before write because the rewritten reference cannot prove physical quantity equivalence.",
              ...unresolvedRequirement,
              required_resolution:
                "Add a finite positive source_unit_scales value backed by the canonical Unit Group conversion, refresh the support cache, and rerun with --block-on-unscaled-canonical-support.",
            });
          } else if (needsScaling) {
            stats.amount_scaling_required_rewrites =
              Number(stats.amount_scaling_required_rewrites ?? 0) + 1;
            const requirement = {
              dataset_type: datasetType,
              dataset_id: datasetIdentityCache?.id ?? null,
              dataset_version: datasetIdentityCache?.version ?? null,
              row_index: rowIndex,
              source_file: repoRelativeMaybe(sourceFile),
              path: pathExpression(childPath),
              source_unit: unit,
              canonical_reference_unit: mapping.canonical_reference_unit ?? null,
              amount_scale_to_canonical_reference: amountScale,
              note: "Exchange amounts referencing this flow must be multiplied by amount_scale_to_canonical_reference to stay physically correct against the canonical reference unit; canonical-support rewrite does not convert amounts.",
            };
            scalingRequirements.push(requirement);
            if (blockOnUnscaled) {
              stats.amount_scaling_blocked = Number(stats.amount_scaling_blocked ?? 0) + 1;
              blockers.push({
                code: "canonical_support_amount_scaling_required",
                message:
                  "Source unit differs in scale from the canonical reference unit; exchange amounts must be explicitly scaled before remote write. Rewriting the flow property reference without scaling amounts causes an order-of-magnitude error.",
                ...requirement,
                required_resolution:
                  "Apply amount_scale_to_canonical_reference to affected exchange amounts (explicit scaling decision per profile policy), then re-run; or choose a canonical Flow Property whose reference unit matches the source unit (scale 1).",
              });
            }
          }
        } else if (
          !alreadyCanonical &&
          mapping?.pending_canonical_support &&
          !allowAccountLocalSupportAndElementary
        ) {
          blockers.push({
            code: "canonical_support_pending_upstream",
            message:
              "Source unit maps to a canonical Flow Property that does not yet exist in the public library; import must stay blocked until upstream creates and publishes it.",
            dataset_type: datasetType,
            dataset_id: datasetIdentityCache?.id ?? null,
            dataset_version: datasetIdentityCache?.version ?? null,
            row_index: rowIndex,
            source_file: repoRelativeMaybe(sourceFile),
            path: pathExpression(childPath),
            source_unit: unit || null,
            canonical_reference_unit: mapping.canonical_reference_unit ?? null,
            amount_scale_to_canonical_reference: resolveAmountScale(mapping, unit, normalizedUnit),
            mapping_reason: mapping.reason ?? null,
            pending_upstream_note: mapping.pending_upstream_note ?? null,
            required_resolution:
              "Create the public canonical Flow Property + Unit Group (state_code=100) upstream, refresh the support cache, set canonical_flow_property_id on this mapping, then re-run.",
          });
        } else if (!alreadyCanonical && !allowAccountLocalSupportAndElementary) {
          blockers.push({
            code: "canonical_flow_property_reference_unresolved",
            message:
              "Flow property references must point to an existing canonical database row; Foundry must not write account-local flowproperty/unitgroup support rows.",
            dataset_type: datasetType,
            dataset_id: datasetIdentityCache?.id ?? null,
            dataset_version: datasetIdentityCache?.version ?? null,
            row_index: rowIndex,
            source_file: repoRelativeMaybe(sourceFile),
            path: pathExpression(childPath),
            source_unit: unit || null,
            original_ref_object_id: originalId || null,
            original_version: originalVersion || null,
            required_resolution:
              "Add or select a public canonical flow property mapping in the support cache, or block the import until the platform has the required canonical support row.",
          });
        }
        continue;
      }
      rewriteCanonicalFlowPropertyReferences(child, {
        cacheContext,
        datasetType,
        sourceFile,
        stats,
        rewriteRows,
        blockers,
        scalingRequirements,
        blockOnUnscaled,
        datasetIdentityCache,
        rowIndex,
        language,
        pathSegments: childPath,
        allowAccountLocalSupportAndElementary,
      });
    }
  }

  function applyCanonicalSupportRewrites({
    datasetType,
    rowsFile,
    outFile = null,
    outDir = null,
    options = {},
  }: {
    datasetType: string;
    rowsFile: string;
    outFile?: string | null;
    outDir?: string | null;
    options?: CanonicalSupportOptions;
  }) {
    const resolvedOutDir =
      outDir || path.join(path.dirname(rowsFile), "canonical-support-rewrites");
    const resolvedOutFile =
      outFile ||
      path.join(
        resolvedOutDir,
        `${datasetRowsFileStem(datasetType)}.canonical-support-rewritten.jsonl`,
      );
    fs.mkdirSync(resolvedOutDir, { recursive: true });
    const cacheContext = loadCanonicalSupportCache(options);
    const rows = readRowsFile(rowsFile);
    const stats = {
      canonical_flow_property_reference_rewrites: 0,
      canonical_unit_group_reference_proofs: 0,
      amount_scaling_required_rewrites: 0,
      amount_scaling_blocked: 0,
      amount_scaling_unresolved: 0,
    };
    const rewriteRows: JsonRecord[] = [];
    const blockers: JsonRecord[] = [];
    const scalingRequirements: JsonRecord[] = [];
    const blockOnUnscaled = booleanOption(
      options.blockOnUnscaledCanonicalSupport || options.blockUnscaledCanonicalSupport,
    );
    const allowAccountLocalSupportAndElementary = booleanOption(
      options.prepareAccountLocalSupportCandidates,
    );
    const outputRows = rows.map((row, rowIndex) => {
      const next = cloneJson(row);
      rewriteCanonicalFlowPropertyReferences(next, {
        cacheContext,
        datasetType,
        sourceFile: rowsFile,
        stats,
        rewriteRows,
        blockers,
        scalingRequirements,
        blockOnUnscaled,
        datasetIdentityCache: datasetIdentity(next, datasetType),
        rowIndex,
        language: asText(options.language || options.lang || "en") || "en",
        allowAccountLocalSupportAndElementary,
      });
      return next;
    });
    const deferBlockedRows =
      datasetType === "flow" &&
      blockers.length > 0 &&
      booleanOption(
        options.deferBlockedCanonicalSupportRows ||
          options.deferCanonicalSupportBlockedRows ||
          options.deferBlockedSupportRows,
      );
    const blockedRowIndexes = new Set<number>(
      blockers
        .map((blocker) => Number(blocker.row_index))
        .filter((rowIndex) => Number.isInteger(rowIndex) && rowIndex >= 0),
    );
    const writeOutputRows = deferBlockedRows
      ? outputRows.filter((_, rowIndex) => !blockedRowIndexes.has(rowIndex))
      : outputRows;
    const deferredRows = deferBlockedRows
      ? outputRows.filter((_, rowIndex) => blockedRowIndexes.has(rowIndex))
      : [];

    const rewritesFile = path.join(resolvedOutDir, "canonical-support-rewrites.jsonl");
    const blockersFile = path.join(resolvedOutDir, "canonical-support-blockers.jsonl");
    const scalingFile = path.join(resolvedOutDir, "canonical-support-amount-scaling.jsonl");
    const reportFile = path.join(resolvedOutDir, "canonical-support-rewrite-report.json");
    const deferredRowsFile = path.join(
      resolvedOutDir,
      `${datasetRowsFileStem(datasetType)}.canonical-support-deferred.jsonl`,
    );
    writeJsonLines(resolvedOutFile, writeOutputRows);
    writeJsonLines(deferredRowsFile, deferredRows);
    writeJsonLines(rewritesFile, rewriteRows);
    writeJsonLines(blockersFile, blockers);
    writeJsonLines(scalingFile, scalingRequirements);
    const hardBlockers = deferBlockedRows ? [] : blockers;
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      command: "dataset-canonical-support-rewrites-apply",
      stage: "canonical_support_rewrites",
      status: deferBlockedRows
        ? "completed_with_deferred_rows"
        : blockers.length > 0
          ? "blocked"
          : rewriteRows.length > 0
            ? "completed"
            : "completed_no_rewrites",
      dataset_type: datasetType,
      remote_write_mode: "read-only",
      rows_file: repoRelativePath(rowsFile),
      output_rows_file: repoRelativePath(resolvedOutFile),
      policy: allowAccountLocalSupportAndElementary
        ? {
            public_canonical_first:
              "Flow Properties and Unit Groups must reuse defensible public canonical rows when available.",
            account_local_support_rows:
              "Prepare local FP/UG candidates for a canonical gap, targeting same-owner state_code=0 only. This preparation option grants no write permission; current task authorization must admit each action before a guarded owner-draft CLI plan, audit and readback.",
            rewrite_command_boundary:
              "This rewrite command does not mint or publish support rows and must not place account-local candidates in the public canonical cache or generic support writer.",
          }
        : {
            reference_only_support:
              "Flow Properties and Unit Groups are reference-only support data for Foundry imports. Finalize must rewrite converted package-local flow property references to existing canonical database rows, or block before dry-run/remote write planning.",
            no_account_local_support_rows:
              "Foundry must not create account-local My Data rows for flowproperties or unitgroups.",
          },
      counts: {
        input_rows: rows.length,
        output_rows: writeOutputRows.length,
        deferred_rows: deferredRows.length,
        canonical_flow_property_reference_rewrites:
          stats.canonical_flow_property_reference_rewrites,
        canonical_unit_group_reference_proofs: stats.canonical_unit_group_reference_proofs,
        amount_scaling_required_rewrites: stats.amount_scaling_required_rewrites,
        amount_scaling_blocked: stats.amount_scaling_blocked,
        ...(stats.amount_scaling_unresolved > 0
          ? { amount_scaling_unresolved: stats.amount_scaling_unresolved }
          : {}),
        blockers: hardBlockers.length,
        deferred_blockers: deferBlockedRows ? blockers.length : 0,
      },
      amount_scaling_policy: {
        rewrite_does_not_convert_amounts:
          "Canonical support rewrite only repoints referenceToFlowPropertyDataSet; it never converts exchange amounts. When source_unit scale to the canonical reference unit is not 1, downstream exchange amounts must be scaled explicitly (profile policy: explicit scaling in canonical support mapping, not silent).",
        block_flag:
          "Pass --block-on-unscaled-canonical-support to convert scale!=1 rewrites into hard blockers.",
      },
      amount_scaling_requirements: scalingRequirements,
      files: {
        report: repoRelativePath(reportFile),
        output_rows: repoRelativePath(resolvedOutFile),
        deferred_rows: deferredRows.length > 0 ? repoRelativePath(deferredRowsFile) : null,
        canonical_support_rewrites: repoRelativePath(rewritesFile),
        canonical_support_blockers: repoRelativePath(blockersFile),
        canonical_support_amount_scaling:
          scalingRequirements.length > 0 ? repoRelativePath(scalingFile) : null,
        canonical_support_cache: repoRelativeMaybe(cacheContext.cachePath),
      },
      blockers: hardBlockers,
      deferred_blockers: deferBlockedRows ? blockers : [],
    };
    writeJson(reportFile, report);
    return report;
  }

  return {
    applyCanonicalSupportRewrites,
    loadCanonicalSupportCache,
    rewriteCanonicalFlowPropertyReferences,
    supportText,
  };
}
