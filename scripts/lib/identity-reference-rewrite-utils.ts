import fs from "node:fs";
import path from "node:path";

export function createIdentityReferenceRewriteUtils({
  asText,
  cloneJson,
  countRowsFile,
  datasetIdentity,
  datasetRowsFileStem,
  ensureArray,
  fileExists,
  foundryTraceNamespace,
  identityPreflightCommands,
  languageForText,
  multiLang,
  normalizedList,
  nowIso,
  pathExpression,
  preferredSourceLanguageText,
  readJson,
  readJsonLines,
  readRowsFile,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  supportText,
  unique,
  writeJson,
  writeJsonLines,
}: any) {
  function identityReferenceRewriteIndexPath(options: any, rowsFile: any) {
    const explicit =
      options.identityPreflightIndex ||
      options.identityPreflightRequests ||
      options.identityPreflightRequestsIndex ||
      options.identityPreflightFile;
    if (explicit) return resolveRepoPath(explicit);
    if (!rowsFile) return null;
    const defaultPath = path.join(
      path.dirname(path.dirname(rowsFile)),
      "identity-preflight-requests",
      "identity-preflight-requests.jsonl",
    );
    return fileExists(defaultPath) ? defaultPath : null;
  }

  function firstCandidateName(candidate: any) {
    return (
      preferredSourceLanguageText(candidate?.names) ||
      asText(candidate?.name_en) ||
      asText(candidate?.name)
    );
  }

  function flowGlobalReference({ id, version, shortDescription }: any) {
    const description = shortDescription || id;
    return {
      "@type": "flow data set",
      "@refObjectId": id,
      "@version": version || "00.00.001",
      "@uri": `../flows/${id}.json`,
      "common:shortDescription": multiLang(description, languageForText(description)),
    };
  }

  function referenceShortDescription(reference: any) {
    const description = reference?.["common:shortDescription"] ?? reference?.shortDescription;
    if (typeof description === "string") return description.trim();
    if (description && typeof description === "object" && !Array.isArray(description)) {
      return asText(description["#text"] ?? description.value);
    }
    return "";
  }

  function duplicateFlowCandidateFromReport(report: any) {
    if (
      asText(report?.kind) !== "flow" ||
      asText(report?.decision) !== "block_duplicate" ||
      asText(report?.confidence) !== "high"
    ) {
      return null;
    }
    return (
      ensureArray(report?.candidates).find((candidate: any) => {
        const reasons = ensureArray(candidate?.match_reasons).map(asText);
        return (
          asText(candidate?.decision_hint) === "block_duplicate" ||
          reasons.includes("equivalent_flow_core_fields") ||
          reasons.includes("same_identity_key")
        );
      }) ?? null
    );
  }

  function loadIdentityDuplicateFlowMappings(indexPath: any) {
    const mappings = new Map<string, any>();
    const rows = indexPath && fileExists(indexPath) ? readJsonLines(indexPath) : [];
    for (const row of rows) {
      const datasetType = asText(row.dataset_type || row.type);
      if (datasetType !== "flow") continue;
      const sourceId = asText(row.dataset_id || row.entity_id || row.id);
      const sourceVersion = asText(row.dataset_version || row.version) || "00.00.001";
      if (!sourceId) continue;
      const reportFile = identityPreflightCommands.identityPreflightRunReportFile(row);
      const report = reportFile && fileExists(reportFile) ? readJson(reportFile) : null;
      const candidate = duplicateFlowCandidateFromReport(report);
      const canonicalId = asText(candidate?.id);
      if (!canonicalId) continue;
      const mapping = {
        source: {
          ref_object_id: sourceId,
          version: sourceVersion,
        },
        canonical: {
          table: "flows",
          ref_object_id: canonicalId,
          version: asText(candidate?.version) || "00.00.001",
          short_description: firstCandidateName(candidate) || canonicalId,
        },
        identity_preflight: {
          index_file: repoRelativePath(indexPath),
          report_file: repoRelativeMaybe(reportFile),
          decision: report.decision,
          status: report.status,
          confidence: report.confidence ?? null,
          candidate_index: candidate.index ?? null,
          candidate_match_score: candidate.match_score ?? null,
          candidate_match_reasons: ensureArray(candidate.match_reasons),
        },
      };
      mappings.set(`${sourceId}@@${sourceVersion}`, mapping);
      if (!mappings.has(sourceId)) mappings.set(sourceId, mapping);
    }
    return { rows, mappings };
  }

  function jsonLineFileHasRows(filePath: any) {
    return Boolean(filePath && fileExists(filePath) && readJsonLines(filePath).length > 0);
  }

  function identityReferenceRewriteInputFiles(options: any = {}) {
    const files: any[] = [];
    const directOptions = [
      options.identityReferenceRewrites,
      options.identityReferenceRewritesFile,
      options.identityFlowReferenceRewrites,
      options.identityFlowReferenceRewritesFile,
    ];
    for (const directOption of directOptions) {
      for (const item of normalizedList(directOption)) {
        const filePath = resolveRepoPath(item);
        if (jsonLineFileHasRows(filePath)) files.push(filePath);
      }
    }
    const reportOptions = unique([
      ...normalizedList(options.identityDecisionApplyReport),
      ...normalizedList(options.identityDecisionsApplyReport),
      ...normalizedList(options.identityDecisionApplyReports),
      ...normalizedList(options.identityDecisionsApplyReports),
    ]);
    for (const reportOption of reportOptions) {
      const reportFile = resolveRepoPath(reportOption);
      if (!reportFile || !fileExists(reportFile)) continue;
      const report = readJson(reportFile);
      const rewriteFile = resolveRepoPath(report.files?.identity_reference_rewrites);
      if (jsonLineFileHasRows(rewriteFile)) files.push(rewriteFile);
    }
    return unique(files);
  }

  function identityUnresolvedReferenceInputFiles(options: any = {}) {
    const files: any[] = [];
    const directOptions = [
      options.identityUnresolvedReferences,
      options.identityUnresolvedReferencesFile,
      options.identityUnresolvedReferenceFile,
    ];
    for (const directOption of directOptions) {
      for (const item of normalizedList(directOption)) {
        const filePath = resolveRepoPath(item);
        if (filePath && fileExists(filePath)) files.push(filePath);
      }
    }
    const reportOptions = unique([
      ...normalizedList(options.identityDecisionApplyReport),
      ...normalizedList(options.identityDecisionsApplyReport),
      ...normalizedList(options.identityDecisionApplyReports),
      ...normalizedList(options.identityDecisionsApplyReports),
    ]);
    for (const reportOption of reportOptions) {
      const reportFile = resolveRepoPath(reportOption);
      if (!reportFile || !fileExists(reportFile)) continue;
      const report = readJson(reportFile);
      const unresolvedFile = resolveRepoPath(report.files?.identity_unresolved_references);
      if (unresolvedFile && fileExists(unresolvedFile)) files.push(unresolvedFile);
    }
    return unique(files);
  }

  function loadIdentityReferenceRewriteMappings(rewriteFiles: any) {
    const mappings = new Map<string, any>();
    const rows: any[] = [];
    for (const rewriteFile of ensureArray(rewriteFiles)) {
      if (!rewriteFile || !fileExists(rewriteFile)) continue;
      for (const row of readJsonLines(rewriteFile)) {
        rows.push(row);
        const original = row?.original ?? {};
        const canonical = row?.canonical ?? {};
        const sourceId = asText(
          original.ref_object_id ?? original.refObjectId ?? original.id ?? row?.dataset_id,
        );
        const sourceVersion =
          asText(
            original.version ??
              original.ref_version ??
              original["@version"] ??
              row?.dataset_version,
          ) || "00.00.001";
        const canonicalId = asText(
          canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id,
        );
        if (!sourceId || !canonicalId) continue;
        const mapping = {
          source: {
            ref_object_id: sourceId,
            version: sourceVersion,
          },
          canonical: {
            table: asText(canonical.table) || "flows",
            ref_object_id: canonicalId,
            version:
              asText(canonical.version ?? canonical.ref_version ?? canonical["@version"]) ||
              "00.00.001",
            short_description:
              asText(canonical.short_description ?? canonical.shortDescription) || canonicalId,
          },
          identity_preflight: row.identity_preflight ?? null,
          identity_decision: row.identity_decision ?? null,
          rewrite_source: {
            file: repoRelativePath(rewriteFile),
            relation: row.relation ?? null,
            action: row.action ?? null,
            reason: row.reason ?? null,
          },
        };
        mappings.set(`${sourceId}@@${sourceVersion}`, mapping);
        if (!mappings.has(sourceId)) mappings.set(sourceId, mapping);
      }
    }
    return { rows, mappings };
  }

  function loadIdentityUnresolvedReferenceMappings(files: any) {
    const mappings = new Map<string, any>();
    const rows: any[] = [];
    for (const filePath of ensureArray(files)) {
      if (!filePath || !fileExists(filePath)) continue;
      for (const row of readJsonLines(filePath)) {
        rows.push(row);
        const original = row?.original ?? {};
        const sourceId = asText(
          original.ref_object_id ?? original.refObjectId ?? original.id ?? row?.dataset_id,
        );
        const sourceVersion =
          asText(
            original.version ??
              original.ref_version ??
              original["@version"] ??
              row?.dataset_version,
          ) || "00.00.001";
        if (!sourceId) continue;
        const mapping = {
          source: {
            ref_object_id: sourceId,
            version: sourceVersion,
            short_description:
              asText(original.short_description ?? original.shortDescription) || sourceId,
          },
          identity_decision: row.identity_decision ?? null,
          identity_evidence: row.evidence ?? null,
          unresolved_source: {
            file: repoRelativePath(filePath),
            relation: row.relation ?? null,
            action: row.action ?? null,
            reason: row.reason ?? null,
          },
        };
        mappings.set(`${sourceId}@@${sourceVersion}`, mapping);
        if (!mappings.has(sourceId)) mappings.set(sourceId, mapping);
      }
    }
    return { rows, mappings };
  }

  function processDataSetInformation(row: any) {
    return row?.processDataSet?.processInformation?.dataSetInformation ?? null;
  }

  function ensureCommonOther(dataSetInformation: any) {
    if (!dataSetInformation || typeof dataSetInformation !== "object") return null;
    const current = dataSetInformation["common:other"];
    if (current && typeof current === "object" && !Array.isArray(current)) {
      return current;
    }
    dataSetInformation["common:other"] = {};
    return dataSetInformation["common:other"];
  }

  function appendUnresolvedFlowReferenceTrace(row: any, traceEntry: any) {
    const commonOther = ensureCommonOther(processDataSetInformation(row));
    if (!commonOther) return false;
    commonOther["@xmlns:tiangongfoundry"] =
      commonOther["@xmlns:tiangongfoundry"] ?? foundryTraceNamespace;
    const key = "tiangongfoundry:unresolvedTrace";
    const current = commonOther[key];
    if (current === undefined) {
      commonOther[key] = [traceEntry];
    } else if (Array.isArray(current)) {
      current.push(traceEntry);
    } else {
      commonOther[key] = [current, traceEntry];
    }
    return true;
  }

  function unresolvedFlowTraceReferenceId(trace: any) {
    return asText(
      trace?.reference_id ??
        trace?.referenceId ??
        trace?.evidence?.target?.id ??
        trace?.evidence?.target?.["@refObjectId"] ??
        trace?.evidence?.identity_decision?.evidence?.target?.id ??
        trace?.evidence?.identity_decision?.evidence?.target?.["@refObjectId"],
    );
  }

  function blockedFlowReferenceBlockerFiles(options: any = {}) {
    return normalizedList(
      options.blockedFlowReferenceBlockers ||
        options.blockedFlowReferenceBlockersFile ||
        options.upstreamFlowBlockers ||
        options.upstreamFlowBlockersFile ||
        options.canonicalSupportBlockers ||
        options.canonicalSupportBlockersFile,
    )
      .map(resolveRepoPath)
      .filter(fileExists);
  }

  function blockedFlowReferenceBlockersById(options: any = {}) {
    const byId = new Map<string, any[]>();
    for (const filePath of blockedFlowReferenceBlockerFiles(options)) {
      for (const blocker of readJsonLines(filePath)) {
        const datasetType = asText(blocker.dataset_type ?? blocker.datasetType ?? blocker.type);
        const code = asText(blocker.code ?? blocker.blocker_code ?? blocker.blockerCode);
        if (datasetType && datasetType !== "flow") continue;
        if (code && code !== "canonical_flow_property_reference_unresolved") {
          continue;
        }
        const id = asText(
          blocker.dataset_id ?? blocker.datasetId ?? blocker.entity_id ?? blocker.id,
        );
        if (!id) continue;
        const existing = byId.get(id) ?? [];
        existing.push({
          ...blocker,
          blocker_file: repoRelativePath(filePath),
        });
        byId.set(id, existing);
      }
    }
    return byId;
  }

  function externalizeUnresolvedProcessFlowExchanges({
    datasetType,
    rowsFile,
    outFile,
    outDir,
    options = {},
  }: any) {
    const reportFile = path.join(outDir, "unresolved-exchange-externalization-report.json");
    const tracesFile = path.join(outDir, "unresolved-exchanges.jsonl");
    if (datasetType !== "process") {
      const report = {
        schema_version: 1,
        generated_at_utc: nowIso(),
        stage: "unresolved_exchange_externalization",
        status: "not_required",
        input_rows_file: repoRelativePath(rowsFile),
        output_rows_file: repoRelativePath(rowsFile),
        counts: {
          rows: countRowsFile(rowsFile),
          affected_rows: 0,
          externalized_exchanges: 0,
        },
        files: {
          report: repoRelativePath(reportFile),
          output_rows: repoRelativePath(rowsFile),
          traces: null,
        },
      };
      writeJson(reportFile, report);
      return report;
    }

    fs.mkdirSync(outDir, { recursive: true });
    const rows = readRowsFile(rowsFile);
    const externalized: any[] = [];
    const blockedFlowReferencesById = blockedFlowReferenceBlockersById(options);
    let affectedRows = 0;
    let elementaryFlowExternalized = 0;
    let blockedDependencyExternalized = 0;

    rows.forEach((row: any, rowIndex: number) => {
      const processDataSet = row?.processDataSet ?? row?.json_ordered?.processDataSet;
      const dataSetInformation = processDataSet?.processInformation?.dataSetInformation ?? null;
      const commonOther = ensureCommonOther(dataSetInformation);
      const unresolvedTraces = ensureArray(commonOther?.["tiangongfoundry:unresolvedTrace"]);
      const unresolvedById = new Map();
      for (const trace of unresolvedTraces) {
        if (trace?.action_item_code !== "elementary_flow_identity_manual_review") {
          continue;
        }
        const referenceId = unresolvedFlowTraceReferenceId(trace);
        if (referenceId) {
          unresolvedById.set(referenceId, trace);
        }
      }
      if (unresolvedById.size === 0 && blockedFlowReferencesById.size === 0) {
        return;
      }

      const exchanges = ensureArray(processDataSet?.exchanges?.exchange);
      if (exchanges.length === 0) return;
      const kept = [];
      let rowExternalized = 0;
      for (const [exchangeIndex, exchange] of exchanges.entries()) {
        const reference = exchange?.referenceToFlowDataSet;
        const referenceId = asText(reference?.["@refObjectId"] ?? reference?.refObjectId);
        const unresolvedTrace = referenceId ? unresolvedById.get(referenceId) : null;
        const blockedFlowReferenceBlockers = referenceId
          ? (blockedFlowReferencesById.get(referenceId) ?? [])
          : [];
        if (!referenceId || (!unresolvedTrace && blockedFlowReferenceBlockers.length === 0)) {
          kept.push(exchange);
          continue;
        }

        commonOther["@xmlns:tiangongfoundry"] =
          commonOther["@xmlns:tiangongfoundry"] ?? foundryTraceNamespace;
        const actionItemCode = unresolvedTrace
          ? "elementary_flow_exchange_externalized"
          : "blocked_flow_dependency_exchange_externalized";
        const externalizedTrace = {
          status: "externalized_before_remote_write",
          action_item_code: actionItemCode,
          blocked_path: `processDataSet.exchanges.exchange.${exchangeIndex}.referenceToFlowDataSet`,
          reference_id: referenceId,
          reference_version: asText(reference?.["@version"] ?? reference?.version) || null,
          reason: unresolvedTrace
            ? "Formal exchange references an unresolved elementary flow identity. Foundry moved the full exchange into common:other trace before remote write planning so the process can remain schema-valid while preserving source evidence for later repair."
            : "Formal exchange references a flow row that cannot be written because its required Flow Property or Unit Group is not backed by a canonical public database support row. Foundry moved the full exchange into common:other trace before remote write planning to avoid a dangling flow reference.",
          unresolved_trace: unresolvedTrace ? cloneJson(unresolvedTrace) : null,
          upstream_flow_blockers:
            blockedFlowReferenceBlockers.length > 0 ? cloneJson(blockedFlowReferenceBlockers) : [],
          original_exchange: cloneJson(exchange),
          next_action: unresolvedTrace
            ? "Resolve this elementary flow against an approved public TianGong flow, then restore a formal process exchange in a later curated repair."
            : "Add the missing public canonical Flow Property or Unit Group support row, rerun flow finalization, then restore this process exchange in a later curated repair.",
        };
        const traceKey = "tiangongfoundry:unresolvedExchangeTrace";
        const current = commonOther[traceKey];
        if (current === undefined) {
          commonOther[traceKey] = [externalizedTrace];
        } else if (Array.isArray(current)) {
          current.push(externalizedTrace);
        } else {
          commonOther[traceKey] = [current, externalizedTrace];
        }
        externalized.push({
          relation: unresolvedTrace
            ? "process_exchange_to_unresolved_elementary_flow_trace"
            : "process_exchange_to_blocked_flow_dependency_trace",
          action: "externalize_exchange_before_remote_write",
          dataset_type: "process",
          dataset_id: datasetIdentity(row, "process").id || null,
          dataset_version: datasetIdentity(row, "process").version || null,
          row_index: rowIndex,
          exchange_index: exchangeIndex,
          path: externalizedTrace.blocked_path,
          original: {
            table: "flows",
            ref_object_id: referenceId,
            version: externalizedTrace.reference_version,
            short_description: referenceShortDescription(reference) || null,
          },
          trace: externalizedTrace,
        });
        if (unresolvedTrace) {
          elementaryFlowExternalized += 1;
        } else {
          blockedDependencyExternalized += 1;
        }
        rowExternalized += 1;
      }
      if (rowExternalized > 0) {
        affectedRows += 1;
        processDataSet.exchanges = processDataSet.exchanges ?? {};
        processDataSet.exchanges.exchange = kept;
      }
    });

    writeJsonLines(outFile, rows);
    writeJsonLines(tracesFile, externalized);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      stage: "unresolved_exchange_externalization",
      status: "completed",
      input_rows_file: repoRelativePath(rowsFile),
      output_rows_file: repoRelativePath(outFile),
      counts: {
        rows: rows.length,
        affected_rows: affectedRows,
        externalized_exchanges: externalized.length,
        elementary_flow_externalized: elementaryFlowExternalized,
        blocked_flow_dependency_externalized: blockedDependencyExternalized,
        upstream_blocked_flow_references: blockedFlowReferencesById.size,
      },
      files: {
        report: repoRelativePath(reportFile),
        output_rows: repoRelativePath(outFile),
        traces: repoRelativePath(tracesFile),
        blocked_flow_reference_blockers:
          blockedFlowReferenceBlockerFiles(options).map(repoRelativePath),
      },
    };
    writeJson(reportFile, report);
    return report;
  }

  function rewriteIdentityDuplicateFlowReferences(
    value: any,
    {
      mappings,
      unresolvedMappings,
      datasetIdentityCache,
      rowRoot,
      rowIndex,
      rewriteRows,
      unresolvedRows,
      stats,
      pathSegments = [],
    }: any,
  ) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        rewriteIdentityDuplicateFlowReferences(item, {
          mappings,
          unresolvedMappings,
          datasetIdentityCache,
          rowRoot,
          rowIndex,
          rewriteRows,
          unresolvedRows,
          stats,
          pathSegments: [...pathSegments, index],
        }),
      );
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...pathSegments, key];
      if (
        key === "referenceToFlowDataSet" &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        const reference = child as any;
        const originalId = asText(reference["@refObjectId"] ?? reference.refObjectId);
        const originalVersion = asText(reference["@version"] ?? reference.version) || "00.00.001";
        const mapping =
          mappings.get(`${originalId}@@${originalVersion}`) ?? mappings.get(originalId);
        if (mapping) {
          const canonicalId = mapping.canonical.ref_object_id;
          const canonicalVersion = mapping.canonical.version || "00.00.001";
          const originalShortDescription = referenceShortDescription(child);
          const preservesExistingShortDescription =
            originalShortDescription &&
            originalId === canonicalId &&
            originalVersion === canonicalVersion;
          const next = flowGlobalReference({
            id: canonicalId,
            version: canonicalVersion,
            shortDescription: preservesExistingShortDescription
              ? originalShortDescription
              : mapping.canonical.short_description,
          });
          value[key] = next;
          stats.rewrites += 1;
          rewriteRows.push({
            relation:
              mapping.rewrite_source?.relation ?? "flow_reference_to_identity_preflight_duplicate",
            action:
              mapping.rewrite_source?.action ?? "rewrite_to_identity_preflight_duplicate_reference",
            dataset_type: "process",
            dataset_id: datasetIdentityCache?.id ?? null,
            dataset_version: datasetIdentityCache?.version ?? null,
            row_index: rowIndex,
            path: pathExpression(childPath),
            original: {
              table: "flows",
              ref_object_id: originalId || null,
              version: originalVersion || null,
              short_description: referenceShortDescription(child) || null,
            },
            canonical: {
              table: "flows",
              ref_object_id: next["@refObjectId"],
              version: next["@version"],
              short_description: next["common:shortDescription"]?.["#text"] ?? null,
              short_description_source: preservesExistingShortDescription
                ? "existing_reference_display_text"
                : "canonical_reference",
            },
            identity_preflight: mapping.identity_preflight,
            identity_decision: mapping.identity_decision ?? null,
            rewrite_source: mapping.rewrite_source ?? null,
            reason:
              mapping.rewrite_source?.reason ||
              "CLI identity-preflight selected an existing TianGong elementary flow duplicate; Foundry rewrote the process exchange reference before validation and write planning.",
          });
          continue;
        }
        const unresolvedMapping =
          unresolvedMappings?.get(`${originalId}@@${originalVersion}`) ??
          unresolvedMappings?.get(originalId);
        if (unresolvedMapping && rowRoot) {
          const blockedPath = pathExpression(childPath);
          const traceEntry = {
            status: "unresolved_deferred",
            action_item_code: "elementary_flow_identity_manual_review",
            blocked_path: blockedPath,
            reference_id: originalId || null,
            reference_version: originalVersion || null,
            reason:
              unresolvedMapping.unresolved_source?.reason ||
              "AI identity authoring could not select a sufficient existing TianGong elementary flow reference; Foundry preserved the original process reference with a structured unresolved trace.",
            evidence: {
              source: "dataset-identity-decisions-apply",
              identity_decision: unresolvedMapping.identity_decision,
              unresolved_reference_file: unresolvedMapping.unresolved_source?.file,
              quote_or_trace: unresolvedMapping.source?.short_description || originalId || null,
              remote_search: unresolvedMapping.identity_evidence?.remote_search ?? null,
              target: unresolvedMapping.identity_evidence?.target ?? null,
              top_candidates: unresolvedMapping.identity_evidence?.top_candidates ?? null,
            },
            next_action:
              "Resolve this elementary flow against an approved public TianGong flow before publishing an upgraded row; do not create a BAFU-owned elementary flow.",
          };
          if (appendUnresolvedFlowReferenceTrace(rowRoot, traceEntry)) {
            stats.unresolved_traces += 1;
            unresolvedRows.push({
              relation: "flow_reference_to_unresolved_elementary_identity",
              action: "preserve_reference_with_unresolved_trace",
              dataset_type: "process",
              dataset_id: datasetIdentityCache?.id ?? null,
              dataset_version: datasetIdentityCache?.version ?? null,
              row_index: rowIndex,
              path: blockedPath,
              original: {
                table: "flows",
                ref_object_id: originalId || null,
                version: originalVersion || null,
                short_description: referenceShortDescription(child) || null,
              },
              identity_decision: unresolvedMapping.identity_decision,
              unresolved_source: unresolvedMapping.unresolved_source,
              trace: traceEntry,
              reason: traceEntry.reason,
            });
          }
          continue;
        }
      }
      rewriteIdentityDuplicateFlowReferences(child, {
        mappings,
        unresolvedMappings,
        datasetIdentityCache,
        rowRoot,
        rowIndex,
        rewriteRows,
        unresolvedRows,
        stats,
        pathSegments: childPath,
      });
    }
  }

  function applyIdentityReferenceRewrites({
    datasetType,
    rowsFile,
    outFile,
    outDir,
    options = {},
    allowMissingIndex = false,
  }: any) {
    const indexPath = identityReferenceRewriteIndexPath(options, rowsFile);
    const explicitRewriteFiles = identityReferenceRewriteInputFiles(options);
    const unresolvedReferenceFiles = identityUnresolvedReferenceInputFiles(options);
    const explicitRewriteMappings = loadIdentityReferenceRewriteMappings(explicitRewriteFiles);
    const unresolvedReferenceMappings =
      loadIdentityUnresolvedReferenceMappings(unresolvedReferenceFiles);
    const blockers: any[] = [];
    if (
      (!indexPath || !fileExists(indexPath)) &&
      explicitRewriteMappings.mappings.size === 0 &&
      unresolvedReferenceMappings.mappings.size === 0
    ) {
      if (!allowMissingIndex) {
        blockers.push({
          code: "identity_preflight_index_required",
          message:
            "Identity reference rewrites require a completed identity-preflight index or an identity decision rewrite file.",
        });
      }
      return {
        status: blockers.length > 0 ? "blocked" : "completed_no_index",
        rows_file: repoRelativePath(rowsFile),
        output_rows_file: repoRelativePath(rowsFile),
        identity_preflight_index: indexPath ? repoRelativePath(indexPath) : null,
        identity_reference_rewrites_input: explicitRewriteFiles.map((file: any) =>
          repoRelativePath(file),
        ),
        identity_unresolved_references_input: unresolvedReferenceFiles.map((file: any) =>
          repoRelativePath(file),
        ),
        rewrite_rows: [],
        unresolved_reference_rows: [],
        rewrite_file: null,
        unresolved_references_file: null,
        counts: {
          input_rows: countRowsFile(rowsFile),
          output_rows: countRowsFile(rowsFile),
          identity_preflight_rows: 0,
          identity_unresolved_reference_rows: 0,
          duplicate_flow_mappings: 0,
          flow_reference_rewrites: 0,
          flow_reference_unresolved_traces: 0,
        },
        blockers,
      };
    }
    const rows = readRowsFile(rowsFile);
    const { rows: indexRows, mappings } = loadIdentityDuplicateFlowMappings(indexPath);
    for (const [key, mapping] of explicitRewriteMappings.mappings) {
      mappings.set(key, mapping);
    }
    const rewriteRows: any[] = [];
    const unresolvedRows: any[] = [];
    const referenceRows: any[] = [];
    const stats = { rewrites: 0, unresolved_traces: 0, root_unresolved: 0 };
    const rewrittenRows: any[] = [];
    rows.forEach((row: any, rowIndex: number) => {
      const next = cloneJson(row);
      if (datasetType === "flow") {
        const identity = datasetIdentity(next, "flow");
        const unresolvedMapping =
          unresolvedReferenceMappings.mappings.get(
            `${identity.id}@@${identity.version || "00.00.001"}`,
          ) ?? unresolvedReferenceMappings.mappings.get(identity.id);
        if (unresolvedMapping) {
          stats.unresolved_traces += 1;
          stats.root_unresolved += 1;
          unresolvedRows.push({
            relation: "root_flow_identity_unresolved",
            action: "defer_flow_row_before_remote_write",
            dataset_type: "flow",
            dataset_id: identity.id ?? null,
            dataset_version: identity.version || "00.00.001",
            row_index: rowIndex,
            path: "/flowDataSet",
            original: {
              table: "flows",
              ref_object_id: identity.id ?? null,
              version: identity.version || "00.00.001",
              short_description:
                asText(
                  next?.flowDataSet?.flowInformation?.dataSetInformation?.name?.baseName?.["#text"],
                ) ||
                supportText(next?.flowDataSet?.flowInformation?.dataSetInformation?.name) ||
                identity.id ||
                null,
            },
            identity_decision: unresolvedMapping.identity_decision ?? null,
            unresolved_source: unresolvedMapping.unresolved_source ?? null,
            evidence: unresolvedMapping.identity_evidence ?? null,
            reason:
              unresolvedMapping.unresolved_source?.reason ||
              "AI identity authoring could not select a sufficient existing TianGong elementary flow reference; Foundry deferred this root flow row before remote write planning.",
            next_action:
              "Resolve this elementary flow against an approved public TianGong flow before publishing an upgraded row; do not create an account-local elementary flow.",
          });
          return;
        }
        const mapping =
          mappings.get(`${identity.id}@@${identity.version || "00.00.001"}`) ??
          mappings.get(identity.id);
        if (mapping) {
          referenceRows.push(next);
          stats.rewrites += 1;
          rewriteRows.push({
            relation: "flow_identity_preflight_duplicate_reference",
            action: "reuse_identity_preflight_duplicate_reference",
            dataset_type: "flow",
            dataset_id: identity.id ?? null,
            dataset_version: identity.version || "00.00.001",
            row_index: rowIndex,
            path: "/flowDataSet",
            original: {
              table: "flows",
              ref_object_id: identity.id ?? null,
              version: identity.version || "00.00.001",
              short_description:
                referenceShortDescription(
                  next?.flowDataSet?.flowInformation?.dataSetInformation?.name,
                ) || null,
            },
            canonical: mapping.canonical,
            identity_preflight: mapping.identity_preflight,
            reason:
              "CLI identity-preflight selected an existing TianGong flow duplicate; Foundry moved this row to reference reuse instead of planning a BAFU-owned flow write.",
          });
          return;
        }
      }
      if (datasetType === "process") {
        rewriteIdentityDuplicateFlowReferences(next, {
          mappings,
          unresolvedMappings: unresolvedReferenceMappings.mappings,
          datasetIdentityCache: datasetIdentity(next, "process"),
          rowRoot: next,
          rowIndex,
          rewriteRows,
          unresolvedRows,
          stats,
        });
      }
      rewrittenRows.push(next);
    });
    const resolvedOutDir =
      outDir || path.join(path.dirname(rowsFile), "identity-reference-rewrites");
    const resolvedOutFile =
      outFile ||
      path.join(resolvedOutDir, `${datasetRowsFileStem(datasetType)}.identity-rewritten.jsonl`);
    const rewriteFile = path.join(resolvedOutDir, "identity-reference-rewrites.jsonl");
    const unresolvedReferencesFile = path.join(
      resolvedOutDir,
      "identity-unresolved-references.jsonl",
    );
    const referenceRowsFile = path.join(
      resolvedOutDir,
      `${datasetRowsFileStem(datasetType)}.reference-reuse.jsonl`,
    );
    writeJsonLines(resolvedOutFile, rewrittenRows);
    writeJsonLines(rewriteFile, rewriteRows);
    writeJsonLines(unresolvedReferencesFile, unresolvedRows);
    writeJsonLines(referenceRowsFile, referenceRows);
    return {
      status:
        blockers.length > 0
          ? "blocked"
          : rewriteRows.length > 0 || unresolvedRows.length > 0
            ? "completed"
            : "completed_no_rewrites",
      rows_file: repoRelativePath(rowsFile),
      output_rows_file: repoRelativePath(resolvedOutFile),
      reference_rows_file: referenceRows.length > 0 ? repoRelativePath(referenceRowsFile) : null,
      identity_preflight_index: indexPath ? repoRelativePath(indexPath) : null,
      identity_reference_rewrites_input: explicitRewriteFiles[0]
        ? repoRelativePath(explicitRewriteFiles[0])
        : null,
      identity_reference_rewrites_inputs: explicitRewriteFiles.map((file: any) =>
        repoRelativePath(file),
      ),
      identity_unresolved_references_input: unresolvedReferenceFiles.map((file: any) =>
        repoRelativePath(file),
      ),
      rewrite_rows: rewriteRows,
      unresolved_reference_rows: unresolvedRows,
      rewrite_file: repoRelativePath(rewriteFile),
      unresolved_references_file: repoRelativePath(unresolvedReferencesFile),
      counts: {
        input_rows: rows.length,
        output_rows: rewrittenRows.length,
        reference_rows: referenceRows.length,
        identity_preflight_rows: indexRows.length,
        identity_reference_rewrite_rows: explicitRewriteMappings.rows.length,
        identity_unresolved_reference_rows: unresolvedReferenceMappings.rows.length,
        duplicate_flow_mappings: new Set(
          [...mappings.values()].map((mapping) => mapping.source.ref_object_id),
        ).size,
        flow_reference_rewrites: rewriteRows.length,
        flow_reference_unresolved_traces: unresolvedRows.length,
        root_flow_unresolved_rows: stats.root_unresolved,
      },
      blockers,
    };
  }

  return {
    applyIdentityReferenceRewrites,
    externalizeUnresolvedProcessFlowExchanges,
    identityReferenceRewriteIndexPath,
    referenceShortDescription,
  };
}
