import path from "node:path";

interface LooseRecord {
  [key: string]: LooseRecord | undefined;
}

interface IdentityCanonical {
  table: string;
  ref_object_id: string;
  version: string;
  short_description: string;
}

interface IdentityProfile {
  allowAccountLocalSupportAndElementary?: boolean;
}

interface IdentityDecisionDependencies {
  asText: (value: unknown) => string;
  datasetIdentity: (row: LooseRecord, datasetType: string) => { id: string; version: string };
  datasetRowsFileStem: (datasetType: string) => string;
  fileExists: (filePath: string | null | undefined) => boolean;
  flowTypeOfDataSet: (row: LooseRecord) => string;
  hasUnresolvedAiPlaceholder: (value: unknown) => boolean;
  normalizedList: (value: unknown) => string[];
  nowIso: () => string;
  profileFor: (repoRoot: string, profile: string, options: LooseRecord) => IdentityProfile;
  readJson: (filePath: string) => LooseRecord | LooseRecord[];
  readJsonLines: (filePath: string) => LooseRecord[];
  readRowsFile: (filePath: string) => LooseRecord[];
  readText: (filePath: string) => string;
  referenceShortDescription: (value: unknown) => string;
  repoRelativePath: (filePath: string) => string;
  repoRoot: string;
  resolveRepoPath: (filePath: unknown) => string | null;
  sha256Text: (text: string) => string;
  unique: <T>(values: T[]) => T[];
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

interface IdentityDecisionValidation {
  dataset_id: string;
  dataset_version: string;
  decision: string;
  canonical: IdentityCanonical | null;
  package_path: string | null;
  blockers: Array<Record<string, unknown>>;
}

interface AppliedIdentityDecision extends IdentityDecisionValidation {
  raw: LooseRecord;
}

export function createIdentityDecisionCommands({
  asText,
  datasetIdentity,
  datasetRowsFileStem,
  fileExists,
  flowTypeOfDataSet,
  hasUnresolvedAiPlaceholder,
  normalizedList,
  nowIso,
  profileFor,
  readJson,
  readJsonLines,
  readRowsFile,
  readText,
  referenceShortDescription,
  repoRelativePath,
  repoRoot,
  resolveRepoPath,
  sha256Text,
  unique,
  writeJson,
  writeJsonLines,
}: IdentityDecisionDependencies) {
  function readDecisionRowsFile(filePath: string | null): LooseRecord[] {
    if (!filePath || !fileExists(filePath)) return [];
    if (filePath.toLowerCase().endsWith(".jsonl")) {
      return readJsonLines(filePath);
    }
    const value = readJson(filePath);
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.decisions)) return value.decisions;
    if (Array.isArray(value?.rows)) return value.rows;
    return [value];
  }

  function identityDecisionDatasetId(decision: LooseRecord): string {
    return asText(
      decision?.dataset_id ??
        decision?.datasetId ??
        decision?.entity_id ??
        decision?.entityId ??
        decision?.flow_id ??
        decision?.flowId,
    );
  }

  function identityDecisionDatasetVersion(decision: LooseRecord): string {
    return (
      asText(decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version) ||
      "00.00.001"
    );
  }

  function normalizeIdentityDecisionValue(decision: LooseRecord): string {
    const raw = asText(
      decision?.identity_decision ??
        decision?.identityDecision ??
        decision?.decision ??
        decision?.resolution?.identity_decision ??
        decision?.resolution?.decision,
    );
    if (["reuse", "reuse_existing", "reference_reuse"].includes(raw)) {
      return "reuse_existing_reference";
    }
    if (["new", "insert", "write_new"].includes(raw)) return "create_new";
    if (["block", "blocked", "unresolved"].includes(raw)) return "block_unresolved";
    return raw;
  }

  function identityDecisionCompletionStatus(decision: LooseRecord): string {
    return asText(decision?.decision_status ?? decision?.decisionStatus ?? decision?.status);
  }

  function identityDecisionUsedContextKinds(decision: LooseRecord): string[] {
    return unique([
      ...normalizedList(decision?.used_context_kinds ?? decision?.usedContextKinds),
      ...normalizedList(decision?.resolution?.used_context_kinds),
      ...normalizedList(decision?.evidence?.used_context_kinds),
    ]);
  }

  function identityDecisionCanonical(decision: LooseRecord): IdentityCanonical | null {
    const canonical =
      decision?.canonical ??
      decision?.selected_reference ??
      decision?.selectedReference ??
      decision?.resolution?.canonical ??
      decision?.resolution?.selected_reference ??
      null;
    if (!canonical || typeof canonical !== "object") return null;
    const id = asText(
      canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id ?? canonical["@refObjectId"],
    );
    if (!id) return null;
    return {
      table: asText(canonical.table) || "flows",
      ref_object_id: id,
      version:
        asText(canonical.version ?? canonical.ref_version ?? canonical["@version"]) || "00.00.001",
      short_description:
        asText(
          canonical.short_description ??
            canonical.shortDescription ??
            canonical["common:shortDescription"]?.["#text"],
        ) || id,
    };
  }

  function identityDecisionPackageReference(decision: LooseRecord): string {
    return asText(
      decision?.authoring_package ??
        decision?.authoringPackage ??
        decision?.authoring_context?.authoring_package ??
        decision?.authoringContext?.authoringPackage,
    );
  }

  function identityDecisionPackageSha(decision: LooseRecord): string {
    return asText(
      decision?.authoring_package_sha256 ??
        decision?.authoringPackageSha256 ??
        decision?.authoring_context?.authoring_package_sha256 ??
        decision?.authoringContext?.authoringPackageSha256,
    );
  }

  function identityDecisionPackagePath(
    decision: LooseRecord,
    packageDir: string | null,
  ): string | null {
    const explicit = identityDecisionPackageReference(decision);
    if (explicit) {
      const resolved = resolveRepoPath(explicit);
      if (fileExists(resolved)) return resolved;
    }
    if (!packageDir) return null;
    const id = identityDecisionDatasetId(decision);
    if (!id) return null;
    const candidates = [
      path.join(packageDir, `flow-${id}.authoring-package.json`),
      path.join(packageDir, `process-${id}.authoring-package.json`),
      path.join(packageDir, `${id}.authoring-package.json`),
    ];
    return candidates.find(fileExists) ?? null;
  }

  function identityDecisionClosesAction(decision: LooseRecord, code: string): boolean {
    return normalizedList(
      decision?.closes_action_items ??
        decision?.closesActionItems ??
        decision?.resolution?.closes_action_items,
    ).includes(code);
  }

  function identityDecisionReferenceTable(datasetType: string): string {
    return datasetRowsFileStem(datasetType);
  }

  function isElementaryFlowIdentityRow(row: LooseRecord): boolean {
    return /^elementary flow$/iu.test(flowTypeOfDataSet(row));
  }

  function validateIdentityDecision({
    decision,
    datasetType,
    packageDir,
  }: {
    decision: LooseRecord;
    datasetType: string;
    packageDir: string | null;
  }): IdentityDecisionValidation {
    const blockers: Array<Record<string, unknown>> = [];
    const id = identityDecisionDatasetId(decision);
    const value = normalizeIdentityDecisionValue(decision);
    if (hasUnresolvedAiPlaceholder(decision)) {
      blockers.push({
        code: "identity_decision_template_incomplete",
        dataset_id: id || null,
        message: "Identity decision still contains an AI placeholder.",
      });
    }
    if (!id) {
      blockers.push({
        code: "identity_decision_dataset_id_missing",
        message: "Identity decision must include dataset_id/entity_id.",
      });
    }
    if (identityDecisionCompletionStatus(decision) !== "completed") {
      blockers.push({
        code: "identity_decision_status_not_completed",
        dataset_id: id || null,
        message: "Identity decision must declare decision_status/status = completed.",
      });
    }
    if (!["reuse_existing_reference", "create_new", "block_unresolved"].includes(value)) {
      blockers.push({
        code: "identity_decision_value_invalid",
        dataset_id: id || null,
        value,
        message:
          "Identity decision must be reuse_existing_reference, create_new, or block_unresolved.",
      });
    }
    if (value === "reuse_existing_reference" && !identityDecisionCanonical(decision)) {
      blockers.push({
        code: "identity_decision_canonical_missing",
        dataset_id: id || null,
        message: "reuse_existing_reference decisions must include canonical ref_object_id/version.",
      });
    }
    if (!asText(decision?.basis ?? decision?.reason ?? decision?.resolution?.basis)) {
      blockers.push({
        code: "identity_decision_basis_missing",
        dataset_id: id || null,
        message: "Identity decision must include basis/reason.",
      });
    }
    if (!decision?.evidence || typeof decision.evidence !== "object") {
      blockers.push({
        code: "identity_decision_evidence_missing",
        dataset_id: id || null,
        message: "Identity decision must include structured evidence.",
      });
    }
    const usedContextKinds = identityDecisionUsedContextKinds(decision);
    for (const kind of ["schema", "methodology_yaml", "ruleset"]) {
      if (!usedContextKinds.includes(kind)) {
        blockers.push({
          code: "identity_decision_context_kind_missing",
          dataset_id: id || null,
          required_kind: kind,
          message:
            "Identity decision used_context_kinds must include schema, methodology_yaml, and ruleset.",
        });
      }
    }
    if (datasetType === "flow") {
      const closesManual =
        identityDecisionClosesAction(decision, "identity_preflight_manual_review") ||
        identityDecisionClosesAction(decision, "elementary_flow_identity_manual_review");
      if (!closesManual) {
        blockers.push({
          code: "identity_decision_action_item_closure_missing",
          dataset_id: id || null,
          message:
            "Flow identity decisions must close identity_preflight_manual_review or elementary_flow_identity_manual_review.",
        });
      }
    }
    const packagePath = identityDecisionPackagePath(decision, packageDir);
    const expectedSha = identityDecisionPackageSha(decision);
    if (packageDir && !packagePath) {
      blockers.push({
        code: "identity_decision_authoring_package_missing",
        dataset_id: id || null,
        message:
          "Identity decision must reference a readable authoring package when --authoring-package-dir is provided.",
      });
    } else if (packagePath && expectedSha) {
      const actualSha = sha256Text(readText(packagePath));
      if (actualSha !== expectedSha) {
        blockers.push({
          code: "identity_decision_authoring_package_sha_mismatch",
          dataset_id: id || null,
          expected_sha256: expectedSha,
          actual_sha256: actualSha,
          authoring_package: repoRelativePath(packagePath),
          message:
            "Identity decision authoring_package_sha256 does not match the referenced package.",
        });
      }
    }
    return {
      dataset_id: id,
      dataset_version: identityDecisionDatasetVersion(decision),
      decision: value,
      canonical: identityDecisionCanonical(decision),
      package_path: packagePath,
      blockers,
    };
  }

  function runDatasetIdentityDecisionsApply(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-identity-decisions-apply",
        usage: [
          "node scripts/foundry.mjs dataset-identity-decisions-apply --type flow --rows-file <flows.jsonl> --decisions <identity-decisions.jsonl> --out-dir <apply-dir> --authoring-package-dir <ai-authoring-packages>",
        ],
        purpose:
          "Validate AI-authored identity decisions and deterministically split rows into write candidates and reference-reuse rows before post-authoring finalize.",
      };
    }
    const datasetType = asText(options.type || options.datasetType || "flow").toLowerCase();
    const applyProfile =
      typeof profileFor === "function"
        ? profileFor(
            repoRoot,
            asText(options.profile || "generic")
              .trim()
              .toLowerCase(),
            options,
          )
        : { allowAccountLocalSupportAndElementary: false };
    const rowsFile = resolveRepoPath(options.rowsFile || options.input || options.rows);
    const decisionsFile = resolveRepoPath(
      options.decisions || options.identityDecisions || options.decisionFile,
    );
    if (!rowsFile || !fileExists(rowsFile)) {
      throw new Error("--rows-file is required.");
    }
    if (!decisionsFile || !fileExists(decisionsFile)) {
      throw new Error("--decisions is required.");
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(rowsFile), "identity-decisions"),
    )!;
    const packageDir = resolveRepoPath(options.authoringPackageDir || options.authoringPackagesDir);
    const rows = readRowsFile(rowsFile);
    const inputDecisions = readDecisionRowsFile(decisionsFile);
    const decisions = inputDecisions.filter((decision) => {
      const decisionType = asText(
        decision?.dataset_type ?? decision?.datasetType ?? decision?.type,
      ).toLowerCase();
      return !decisionType || decisionType === datasetType;
    });
    const decisionMap = new Map<string, AppliedIdentityDecision>();
    const blockers: Array<Record<string, unknown>> = [];
    const decisionEvidenceRows: Array<Record<string, unknown>> = [];
    for (const decision of decisions) {
      const validation = validateIdentityDecision({
        decision,
        datasetType,
        packageDir,
      });
      blockers.push(...validation.blockers);
      if (!validation.dataset_id) continue;
      const key = `${validation.dataset_id}@@${validation.dataset_version}`;
      if (decisionMap.has(key)) {
        blockers.push({
          code: "identity_decision_duplicate",
          dataset_id: validation.dataset_id,
          dataset_version: validation.dataset_version,
          message: "Only one identity decision is allowed per dataset id/version.",
        });
        continue;
      }
      decisionMap.set(key, { raw: decision, ...validation });
    }

    const outputRows: LooseRecord[] = [];
    const referenceRows: LooseRecord[] = [];
    const unresolvedRows: LooseRecord[] = [];
    const rewriteRows: Array<Record<string, unknown>> = [];
    const unresolvedReferenceRows: Array<Record<string, unknown>> = [];
    rows.forEach((row, rowIndex) => {
      const identity = datasetIdentity(row, datasetType);
      const key = `${identity.id}@@${identity.version || "00.00.001"}`;
      const decision = decisionMap.get(key);
      if (!decision) {
        outputRows.push(row);
        return;
      }
      if (
        datasetType === "flow" &&
        decision.decision === "create_new" &&
        isElementaryFlowIdentityRow(row) &&
        !applyProfile.allowAccountLocalSupportAndElementary
      ) {
        blockers.push({
          code: "elementary_flow_identity_create_new_blocked",
          dataset_id: identity.id,
          dataset_version: identity.version || "00.00.001",
          message:
            "Elementary flow identity decisions cannot create new account-local flows. Select a canonical existing flow reference or block unresolved with search evidence.",
        });
      }
      decisionEvidenceRows.push({
        dataset_type: datasetType,
        dataset_id: identity.id,
        dataset_version: identity.version || "00.00.001",
        decision_status: identityDecisionCompletionStatus(decision.raw),
        identity_decision: decision.decision,
        canonical: decision.canonical,
        basis:
          asText(decision.raw?.basis ?? decision.raw?.reason) ||
          asText(decision.raw?.resolution?.basis),
        evidence: decision.raw?.evidence ?? null,
        used_context_kinds: identityDecisionUsedContextKinds(decision.raw),
        closes_action_items: normalizedList(
          decision.raw?.closes_action_items ??
            decision.raw?.closesActionItems ??
            decision.raw?.resolution?.closes_action_items,
        ),
        authoring_package: decision.package_path ? repoRelativePath(decision.package_path) : null,
        authoring_package_sha256: decision.package_path
          ? sha256Text(readText(decision.package_path))
          : null,
      });
      if (decision.decision === "reuse_existing_reference") {
        referenceRows.push(row);
        rewriteRows.push({
          relation: "flow_identity_ai_decision_reference",
          action: "reuse_ai_selected_existing_reference",
          dataset_type: datasetType,
          dataset_id: identity.id,
          dataset_version: identity.version || "00.00.001",
          row_index: rowIndex,
          path: datasetType === "flow" ? "/flowDataSet" : "/",
          original: {
            table: identityDecisionReferenceTable(datasetType),
            ref_object_id: identity.id,
            version: identity.version || "00.00.001",
          },
          canonical: decision.canonical,
          identity_decision: {
            source: "dataset-identity-decisions-apply",
            decision: decision.decision,
            basis:
              asText(decision.raw?.basis ?? decision.raw?.reason) ||
              asText(decision.raw?.resolution?.basis),
            evidence: decision.raw?.evidence ?? null,
          },
          reason:
            "AI identity authoring selected an existing database reference; Foundry moved this row to reference reuse instead of planning a new write.",
        });
      } else if (
        datasetType === "flow" &&
        decision.decision === "block_unresolved" &&
        isElementaryFlowIdentityRow(row)
      ) {
        unresolvedRows.push(row);
        unresolvedReferenceRows.push({
          relation: "elementary_flow_identity_ai_decision_unresolved",
          action: "preserve_dependent_process_reference_with_trace",
          dataset_type: datasetType,
          dataset_id: identity.id,
          dataset_version: identity.version || "00.00.001",
          row_index: rowIndex,
          path: "/flowDataSet",
          original: {
            table: identityDecisionReferenceTable(datasetType),
            ref_object_id: identity.id,
            version: identity.version || "00.00.001",
            short_description:
              referenceShortDescription(
                row?.flowDataSet?.flowInformation?.dataSetInformation?.name,
              ) || identity.id,
          },
          identity_decision: {
            source: "dataset-identity-decisions-apply",
            decision: decision.decision,
            basis:
              asText(decision.raw?.basis ?? decision.raw?.reason) ||
              asText(decision.raw?.resolution?.basis),
            evidence: decision.raw?.evidence ?? null,
          },
          evidence: decision.raw?.evidence ?? null,
          reason:
            "AI identity authoring could not select a sufficient existing elementary flow; Foundry will not write a BAFU-owned elementary flow and dependent process rows must carry a structured unresolved trace.",
        });
      } else {
        outputRows.push(row);
        if (decision.decision === "block_unresolved") {
          blockers.push({
            code: "identity_decision_unresolved",
            dataset_id: identity.id,
            dataset_version: identity.version || "00.00.001",
            message:
              "AI identity authoring left this row unresolved, so write planning remains blocked.",
          });
        }
      }
    });

    const outRowsFile = path.join(
      outDir,
      `${datasetRowsFileStem(datasetType)}.identity-decisions-applied.jsonl`,
    );
    const referenceRowsFile = path.join(
      outDir,
      `${datasetRowsFileStem(datasetType)}.reference-reuse.jsonl`,
    );
    const unresolvedRowsFile = path.join(
      outDir,
      `${datasetRowsFileStem(datasetType)}.unresolved-reference.jsonl`,
    );
    const rewritesFile = path.join(outDir, "identity-reference-rewrites.jsonl");
    const unresolvedReferencesFile = path.join(outDir, "identity-unresolved-references.jsonl");
    const evidenceFile = path.join(outDir, "identity-decision-evidence.jsonl");
    const reportFile = path.join(outDir, "identity-decisions-apply-report.json");
    writeJsonLines(outRowsFile, outputRows);
    writeJsonLines(referenceRowsFile, referenceRows);
    writeJsonLines(unresolvedRowsFile, unresolvedRows);
    writeJsonLines(rewritesFile, rewriteRows);
    writeJsonLines(unresolvedReferencesFile, unresolvedReferenceRows);
    writeJsonLines(evidenceFile, decisionEvidenceRows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "blocked" : "completed",
      command: "dataset-identity-decisions-apply",
      dataset_type: datasetType,
      rows_file: repoRelativePath(rowsFile),
      decisions_file: repoRelativePath(decisionsFile),
      remote_write_mode: "read-only",
      counts: {
        input_rows: rows.length,
        input_decisions: inputDecisions.length,
        decisions: decisions.length,
        output_rows: outputRows.length,
        reference_rows: referenceRows.length,
        unresolved_reference_rows: unresolvedRows.length,
        identity_reference_rewrites: rewriteRows.length,
        identity_unresolved_references: unresolvedReferenceRows.length,
        evidence_rows: decisionEvidenceRows.length,
        blockers: blockers.length,
      },
      blockers,
      decisions: decisionEvidenceRows,
      files: {
        report: repoRelativePath(reportFile),
        output_rows: repoRelativePath(outRowsFile),
        reference_rows: repoRelativePath(referenceRowsFile),
        unresolved_reference_rows: repoRelativePath(unresolvedRowsFile),
        identity_reference_rewrites: repoRelativePath(rewritesFile),
        identity_unresolved_references: repoRelativePath(unresolvedReferencesFile),
        evidence: repoRelativePath(evidenceFile),
      },
    };
    writeJson(reportFile, report);
    return report;
  }

  return { runDatasetIdentityDecisionsApply };
}
