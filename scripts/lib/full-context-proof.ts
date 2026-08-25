type JsonRecord = Record<string, unknown>;

interface JsonArtifact {
  path: string;
  value: unknown;
}

interface FullContextRequirement extends JsonRecord {
  profile_id: unknown;
  dataset_type: string | null;
  required_context_kinds: string[];
  required_context_file_patterns: string[];
}

interface ProofBlocker extends JsonRecord {
  code: string;
  message: string;
}

interface AuthoringPackageProof extends JsonRecord {
  source: unknown;
  path: unknown;
  sha256: string | null;
  expected_sha256: string | null;
  contract_context_files: unknown[];
  missing_context_files: unknown[];
  blockers: ProofBlocker[];
}

interface FullContextProofDependencies {
  asText: (value: unknown) => string;
  classificationDecisionUsedContextKinds: (row: unknown) => string[];
  decisionCompletionStatus: (row: unknown) => string;
  decisionContextBundleSha256: (row: unknown) => string;
  ensureArray: (value: unknown) => unknown[];
  fileExists: (filePath: string) => boolean;
  listImportProfiles: (options: { repoRoot: string }) => unknown;
  normalizedList: (value: unknown) => string[];
  readJson: (filePath: string) => unknown;
  readJsonArtifactOption: (value: unknown) => JsonArtifact | null;
  readJsonLines: (filePath: string) => unknown[];
  readText: (filePath: string) => string;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (value: unknown) => string | null;
  repoRoot: string;
  sha256Text: (value: unknown) => string;
  unique: <T>(values: T[]) => T[];
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asJsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function nestedValue(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isJsonRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

export function createFullContextProofUtils({
  asText,
  classificationDecisionUsedContextKinds,
  decisionCompletionStatus,
  decisionContextBundleSha256,
  ensureArray,
  fileExists,
  listImportProfiles,
  normalizedList,
  readJson,
  readJsonArtifactOption,
  readJsonLines,
  readText,
  repoRelativePath,
  resolveRepoPath,
  repoRoot,
  sha256Text,
  unique,
}: FullContextProofDependencies) {
  function profileFullContextRequirement(
    profileId: unknown,
    datasetType: unknown,
  ): FullContextRequirement | null {
    const listing = asJsonRecord(listImportProfiles({ repoRoot }));
    const requestedProfileId = asText(
      profileId || listing.default_profile || "generic",
    ).toLowerCase();
    const defaultProfileId = asText(listing.default_profile || "generic").toLowerCase();
    const profiles = asJsonRecord(listing.profiles);
    const profile = asJsonRecord(
      profiles[requestedProfileId] ?? profiles[defaultProfileId] ?? profiles.generic,
    );
    const requirement = asJsonRecord(profile.full_context_ai_completion);
    if (requirement.required !== true) return null;

    const requiredDatasetTypes = normalizedList(
      requirement.dataset_types ?? requirement.datasetTypes,
    ).map((value) => value.toLowerCase());
    const normalizedDatasetType = asText(datasetType).toLowerCase();
    if (requiredDatasetTypes.length > 0 && !requiredDatasetTypes.includes(normalizedDatasetType)) {
      return null;
    }

    return {
      profile_id: profile?.id ?? requestedProfileId,
      dataset_type: normalizedDatasetType || null,
      required_context_kinds: normalizedList(
        requirement.required_context_kinds ?? requirement.requiredContextKinds,
      ),
      required_context_file_patterns: normalizedList(
        requirement.required_context_file_patterns ?? requirement.requiredContextFilePatterns,
      ),
    };
  }

  function taskProfileId(task: unknown): string {
    return asText(
      nestedValue(task, "meta", "profile") ??
        nestedValue(task, "meta", "import_profile") ??
        nestedValue(task, "meta", "importProfile") ??
        nestedValue(task, "meta", "dataset_profile") ??
        nestedValue(task, "meta", "datasetProfile"),
    );
  }

  function taskDatasetType(task: unknown): string {
    return asText(
      nestedValue(task, "meta", "dataset_type") ?? nestedValue(task, "meta", "datasetType"),
    );
  }

  function fullContextCount(counts: unknown, key: string): number {
    const value = Number(asJsonRecord(counts)[key] ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function normalizeProofRows(value: unknown): unknown[] {
    if (Array.isArray(value)) return value.filter(Boolean);
    const record = asJsonRecord(value);
    if (Array.isArray(record.decisions)) return record.decisions.filter(Boolean);
    if (Array.isArray(record.rows)) return record.rows.filter(Boolean);
    return value && typeof value === "object" ? [value] : [];
  }

  function readJsonOrJsonlRowsArtifact(value: unknown): {
    path: string | null;
    rows: unknown[];
    error: string | null;
  } {
    const resolved = resolveRepoPath(value);
    if (!resolved || !fileExists(resolved)) {
      return { path: resolved, rows: [], error: "missing" };
    }
    try {
      if (resolved.endsWith(".jsonl")) {
        return { path: resolved, rows: readJsonLines(resolved), error: null };
      }
      return {
        path: resolved,
        rows: normalizeProofRows(readJson(resolved)),
        error: null,
      };
    } catch (error) {
      return {
        path: resolved,
        rows: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const fullContextPatchResolutionModes = new Set([
    "evidence_backed_completion",
    "source_language_normalization",
    "classification_decision",
    "location_decision",
    "source_trace_verified",
    "deferred_to_common_other",
  ]);

  function patchEvidenceResolution(entry: unknown): JsonRecord {
    return asJsonRecord(asJsonRecord(entry).resolution);
  }

  function patchEvidenceResolutionMode(entry: unknown): string {
    return asText(patchEvidenceResolution(entry).mode);
  }

  function patchEvidenceResolutionContextKinds(entry: unknown): string[] {
    return unique(
      normalizedList(
        patchEvidenceResolution(entry).used_context_kinds ??
          patchEvidenceResolution(entry).usedContextKinds,
      ),
    );
  }

  function readAuthoringPackageProofForFullContext({
    packageRef,
    expectedSha256 = null,
    source = null,
  }: {
    packageRef: unknown;
    expectedSha256?: unknown;
    source?: unknown;
  }): AuthoringPackageProof {
    const packagePath = resolveRepoPath(packageRef);
    const proof: AuthoringPackageProof = {
      source,
      path: packageRef || null,
      sha256: null,
      expected_sha256: asText(expectedSha256) || null,
      contract_context_files: [],
      missing_context_files: [],
      blockers: [],
    };
    if (!packageRef || !packagePath || !fileExists(packagePath)) {
      proof.blockers.push({
        code: "authoring_package_missing",
        message: "Patch evidence references no readable full-context authoring package.",
        authoring_package: packageRef || null,
        source,
      });
      return proof;
    }
    proof.path = repoRelativePath(packagePath);
    let payload: unknown = null;
    try {
      const rawText = readText(packagePath);
      proof.sha256 = sha256Text(rawText);
      payload = JSON.parse(rawText);
    } catch (error) {
      proof.blockers.push({
        code: "authoring_package_invalid",
        message: error instanceof Error ? error.message : String(error),
        authoring_package: proof.path,
        source,
      });
      return proof;
    }
    const payloadRecord = asJsonRecord(payload);
    proof.contract_context_files = ensureArray(payloadRecord.contract_context_files);
    proof.missing_context_files = ensureArray(payloadRecord.missing_context_files);
    if (proof.expected_sha256 && proof.expected_sha256 !== proof.sha256) {
      proof.blockers.push({
        code: "authoring_package_hash_mismatch",
        message:
          "Recorded authoring_package_sha256 does not match the current authoring package content.",
        authoring_package: proof.path,
        expected_sha256: proof.expected_sha256,
        actual_sha256: proof.sha256,
        source,
      });
    }
    return proof;
  }

  function authoringPackageProofsFromPatchCollect(
    patchCollectArtifact: JsonArtifact | null | undefined,
  ): AuthoringPackageProof[] {
    const manifestRef = nestedValue(patchCollectArtifact?.value, "task_manifest");
    const manifestArtifact = readJsonArtifactOption(manifestRef);
    if (!manifestArtifact) return [];
    return ensureArray(nestedValue(manifestArtifact.value, "tasks"))
      .map((taskValue) => {
        const task = asJsonRecord(taskValue);
        const packageRef = asText(
          nestedValue(task, "files", "authoring_package") ??
            nestedValue(task, "files", "authoringPackage"),
        );
        if (!packageRef) return null;
        return readAuthoringPackageProofForFullContext({
          packageRef,
          expectedSha256: nestedValue(task, "context", "authoring_package_sha256"),
          source: "patch_collect_task_manifest",
        });
      })
      .filter((proof): proof is AuthoringPackageProof => proof !== null);
  }

  function authoringPackageProofsFromCurationGate(
    mutationManifest: unknown,
  ): AuthoringPackageProof[] {
    const manifest = asJsonRecord(mutationManifest);
    const evidence = asJsonRecord(manifest.evidence);
    const curationGateArtifact = readJsonArtifactOption(evidence.curation_gate_report);
    if (!curationGateArtifact) return [];
    const entities = ensureArray(
      nestedValue(curationGateArtifact.value, "entities") ??
        nestedValue(curationGateArtifact.value, "processes") ??
        nestedValue(curationGateArtifact.value, "flows") ??
        nestedValue(curationGateArtifact.value, "items"),
    );
    return entities
      .map((entityValue) => {
        const entity = asJsonRecord(entityValue);
        const packageRef = asText(entity.authoring_package ?? entity.authoringPackage);
        if (!packageRef) return null;
        return readAuthoringPackageProofForFullContext({
          packageRef,
          expectedSha256: entity?.authoring_package_sha256,
          source: "curation_gate",
        });
      })
      .filter((proof): proof is AuthoringPackageProof => proof !== null);
  }

  function fullContextEvidenceArtifactBlocker({
    prefix,
    codePrefix,
    suffix,
    message,
    details = {},
  }: {
    prefix: JsonRecord;
    codePrefix: string;
    suffix: string;
    message: string;
    details?: JsonRecord;
  }): JsonRecord {
    return {
      ...prefix,
      code: `${codePrefix}_full_context_${suffix}`,
      message,
      ...details,
    };
  }

  function decisionApplyTasksFromReport(reportValue: unknown): unknown[] {
    const report = asJsonRecord(reportValue);
    const tasks = ensureArray(report.decision_tasks ?? report.decisionTasks);
    if (tasks.length > 0) return tasks;
    return report?.decision_task || report?.decisionTask
      ? [report.decision_task ?? report.decisionTask]
      : [];
  }

  function decisionTaskReferencePath(taskValue: unknown): string {
    const task = asJsonRecord(taskValue);
    return asText(task.path ?? task.task ?? task.decision_task ?? task.decisionTask);
  }

  function readDecisionTaskArtifactForProof(taskValue: unknown) {
    const task = asJsonRecord(taskValue);
    const taskRef = decisionTaskReferencePath(task);
    const artifact = readJsonArtifactOption(taskRef);
    if (!artifact) {
      return {
        task_ref: taskRef || null,
        artifact: null,
        sha256: null,
        context_bundle_sha256: null,
        status: null,
        task_kind: null,
        blockers: [
          {
            code: "decision_task_missing",
            message: "Decision apply report references an unreadable AI decision task.",
            decision_task: taskRef || null,
          },
        ],
      };
    }
    const rawText = readText(artifact.path);
    const sha256 = sha256Text(rawText);
    const artifactValue = asJsonRecord(artifact.value);
    const contextBundle = asJsonRecord(
      artifactValue.context_bundle ?? artifactValue.authoring_context,
    );
    const expectedSha256 = asText(task?.sha256);
    const expectedContextBundleSha256 = asText(
      task?.context_bundle_sha256 ?? task?.contextBundleSha256,
    );
    const contextBundleSha256 = asText(contextBundle.sha256 ?? contextBundle.context_bundle_sha256);
    const blockers = [];
    if (expectedSha256 && expectedSha256 !== sha256) {
      blockers.push({
        code: "decision_task_hash_mismatch",
        message:
          "Decision apply report records a decision task sha256 that no longer matches the task file.",
        decision_task: repoRelativePath(artifact.path),
        expected_sha256: expectedSha256,
        actual_sha256: sha256,
      });
    }
    if (
      expectedContextBundleSha256 &&
      contextBundleSha256 &&
      expectedContextBundleSha256 !== contextBundleSha256
    ) {
      blockers.push({
        code: "decision_task_context_bundle_hash_mismatch",
        message:
          "Decision apply report records a context_bundle_sha256 that no longer matches the task file.",
        decision_task: repoRelativePath(artifact.path),
        expected_context_bundle_sha256: expectedContextBundleSha256,
        actual_context_bundle_sha256: contextBundleSha256,
      });
    }
    return {
      task_ref: taskRef || null,
      artifact,
      sha256,
      context_bundle_sha256: contextBundleSha256,
      status: asText(artifactValue.status),
      task_kind: asText(artifactValue.task_kind),
      blockers,
    };
  }

  function decisionApplyReportRefs(
    evidence: JsonRecord,
    reportKey: string,
    kind: string,
  ): string[] {
    const values =
      kind === "identity"
        ? [
            ...ensureArray(evidence.identity_decision_apply_reports),
            ...ensureArray(evidence[reportKey]),
          ]
        : ensureArray(evidence[reportKey]);
    return unique(values.map((value) => asText(value)));
  }

  function buildDecisionApplyProofBlockers({
    mutationArtifact,
    requirement,
    prefix,
    codePrefix,
    kind,
    expectedCount,
  }: {
    mutationArtifact: JsonArtifact;
    requirement: FullContextRequirement | null;
    prefix: JsonRecord;
    codePrefix: string;
    kind: "classification" | "location" | "identity";
    expectedCount: number;
  }): JsonRecord[] {
    if (expectedCount <= 0) return [];
    const blockers: JsonRecord[] = [];
    const mutationManifest = asJsonRecord(mutationArtifact.value);
    const evidence = asJsonRecord(mutationManifest.evidence);
    const reportKey =
      kind === "identity"
        ? "identity_decision_apply_report"
        : kind === "location"
          ? "location_decision_apply_report"
          : "classification_decision_apply_report";
    const reportStatusKey =
      kind === "identity"
        ? "identity_decision_apply_status"
        : kind === "location"
          ? "location_decision_apply_status"
          : "classification_decision_apply_status";
    const expectedTaskKind =
      kind === "location" ? "location_decision_authoring" : "classification_decision_authoring";
    const expectedTaskStatus =
      kind === "location"
        ? "ready_for_ai_location_decisions"
        : "ready_for_ai_classification_decisions";
    const reportRefs = decisionApplyReportRefs(evidence, reportKey, kind);
    const reportArtifacts = reportRefs
      .map((reportRef) => readJsonArtifactOption(reportRef))
      .filter((artifact): artifact is JsonArtifact => artifact !== null);
    const reportArtifact = reportArtifacts[0] ?? null;
    if (!reportArtifact) {
      return [
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_apply_report_missing`,
          message:
            "Mutation manifest full-context decision evidence references no readable decision apply report.",
          details: {
            mutation_manifest: repoRelativePath(mutationArtifact.path),
            expected_decision_entries: expectedCount,
            report: evidence[reportKey] ?? null,
            reports: reportRefs,
          },
        }),
      ];
    }

    const report = asJsonRecord(reportArtifact.value);
    for (const candidateReportArtifact of reportArtifacts) {
      const candidateReportStatus = asText(asJsonRecord(candidateReportArtifact.value).status);
      if (candidateReportStatus !== "completed") {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: `${kind}_decision_apply_not_completed`,
            message: `Decision apply report status is ${candidateReportStatus || "missing"}.`,
            details: { report: repoRelativePath(candidateReportArtifact.path) },
          }),
        );
      }
      if (
        asText(evidence[reportStatusKey]) &&
        asText(evidence[reportStatusKey]) !== candidateReportStatus
      ) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: `${kind}_decision_apply_status_mismatch`,
            message:
              "Mutation manifest recorded decision apply status does not match the current report.",
            details: {
              report: repoRelativePath(candidateReportArtifact.path),
              manifest_status: asText(evidence[reportStatusKey]),
              actual_status: candidateReportStatus || null,
            },
          }),
        );
      }
    }

    const decisionRows: unknown[] = [];
    const decisionFiles: string[] = [];
    for (const candidateReportArtifact of reportArtifacts) {
      const candidateReport = asJsonRecord(candidateReportArtifact.value);
      const decisionsRef = candidateReport.decisions_file ?? candidateReport.decisionsFile;
      const decisionsArtifact = readJsonOrJsonlRowsArtifact(decisionsRef);
      if (decisionsArtifact.error) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: `${kind}_decision_file_unreadable`,
            message:
              "Decision apply report must reference readable AI decision rows for closeout proof.",
            details: {
              report: repoRelativePath(candidateReportArtifact.path),
              decisions_file: decisionsRef ?? null,
              error: decisionsArtifact.error,
            },
          }),
        );
      } else {
        decisionRows.push(...decisionsArtifact.rows);
        decisionFiles.push(repoRelativePath(decisionsArtifact.path!));
      }
    }
    const decisionsArtifact = { rows: decisionRows };
    if (decisionsArtifact.rows.length < expectedCount) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_count_incomplete`,
          message:
            "Decision rows referenced by the apply report are fewer than the mutation manifest semantic evidence count.",
          details: {
            report: repoRelativePath(reportArtifact.path),
            reports: reportArtifacts.map((artifact) => repoRelativePath(artifact.path)),
            decisions_files: decisionFiles,
            expected_decision_entries: expectedCount,
            actual_decision_entries: decisionsArtifact.rows.length,
          },
        }),
      );
    }

    const taskProofs =
      kind === "identity"
        ? []
        : decisionApplyTasksFromReport(report).map((task) =>
            readDecisionTaskArtifactForProof(task),
          );
    if (kind !== "identity" && taskProofs.length === 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_task_missing`,
          message:
            "Decision apply report must bind full-context AI decisions to the decision task context bundle.",
          details: { report: repoRelativePath(reportArtifact.path) },
        }),
      );
    }
    for (const taskProof of taskProofs) {
      for (const blocker of taskProof.blockers) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: `${kind}_${blocker.code}`,
            message: blocker.message,
            details: {
              ...blocker,
              report: repoRelativePath(reportArtifact.path),
            },
          }),
        );
      }
      if (taskProof.artifact && taskProof.task_kind !== expectedTaskKind) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: `${kind}_decision_task_kind_invalid`,
            message: "Decision apply report references a decision task with the wrong task kind.",
            details: {
              report: repoRelativePath(reportArtifact.path),
              decision_task: repoRelativePath(taskProof.artifact.path),
              expected_task_kind: expectedTaskKind,
              actual_task_kind: taskProof.task_kind || null,
            },
          }),
        );
      }
      if (taskProof.artifact && taskProof.status !== expectedTaskStatus) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: `${kind}_decision_task_status_invalid`,
            message:
              "Decision apply report references a decision task that is no longer ready for AI decisions.",
            details: {
              report: repoRelativePath(reportArtifact.path),
              decision_task: repoRelativePath(taskProof.artifact.path),
              expected_status: expectedTaskStatus,
              actual_status: taskProof.status || null,
            },
          }),
        );
      }
      if (taskProof.artifact && !taskProof.context_bundle_sha256) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: `${kind}_decision_task_context_bundle_missing`,
            message: "Decision task must still carry context_bundle.sha256 for closeout proof.",
            details: {
              report: repoRelativePath(reportArtifact.path),
              decision_task: repoRelativePath(taskProof.artifact.path),
            },
          }),
        );
      }
    }

    const contextBundleHashes = unique(taskProofs.map((proof) => proof.context_bundle_sha256));
    const missingCompletedStatus = decisionsArtifact.rows.filter(
      (decision) => decisionCompletionStatus(decision) !== "completed",
    );
    if (missingCompletedStatus.length > 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_status_not_completed`,
          message:
            "Every AI decision retained as full-context proof must still declare decision_status=completed.",
          details: {
            report: repoRelativePath(reportArtifact.path),
            count: missingCompletedStatus.length,
          },
        }),
      );
    }
    const missingEvidence = decisionsArtifact.rows.filter((decision) => {
      const evidenceValue = asJsonRecord(decision).evidence;
      return !evidenceValue || typeof evidenceValue !== "object";
    });
    if (missingEvidence.length > 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_evidence_missing`,
          message:
            "Every AI decision retained as full-context proof must still include structured evidence.",
          details: {
            report: repoRelativePath(reportArtifact.path),
            count: missingEvidence.length,
          },
        }),
      );
    }
    if (contextBundleHashes.length > 0) {
      const mismatchedContext = decisionsArtifact.rows.filter((decision) => {
        const hash = decisionContextBundleSha256(decision);
        return !hash || !contextBundleHashes.includes(hash);
      });
      if (mismatchedContext.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: `${kind}_decision_context_bundle_mismatch`,
            message:
              "Every AI decision retained as full-context proof must still reference the bound decision task context bundle.",
            details: {
              report: repoRelativePath(reportArtifact.path),
              count: mismatchedContext.length,
              expected_context_bundle_sha256_any_of: contextBundleHashes,
            },
          }),
        );
      }
    }
    const missingContextKinds = [];
    for (const decision of decisionsArtifact.rows) {
      const usedKinds = new Set(classificationDecisionUsedContextKinds(decision));
      for (const requiredKind of requirement?.required_context_kinds ?? []) {
        if (!usedKinds.has(requiredKind)) {
          missingContextKinds.push({ decision, requiredKind });
        }
      }
    }
    if (missingContextKinds.length > 0) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: `${kind}_decision_context_missing`,
          message:
            "Every AI decision retained as full-context proof must still list all required used_context_kinds.",
          details: {
            report: repoRelativePath(reportArtifact.path),
            count: missingContextKinds.length,
            required_context_kinds: requirement?.required_context_kinds ?? [],
          },
        }),
      );
    }
    return blockers;
  }

  function buildPatchApplyProofBlockers({
    mutationArtifact,
    requirement,
    prefix,
    codePrefix,
    expectedCount,
  }: {
    mutationArtifact: JsonArtifact;
    requirement: FullContextRequirement | null;
    prefix: JsonRecord;
    codePrefix: string;
    expectedCount: number;
  }): JsonRecord[] {
    if (expectedCount <= 0) return [];
    const blockers: JsonRecord[] = [];
    const mutationManifest = asJsonRecord(mutationArtifact.value);
    const evidence = asJsonRecord(mutationManifest.evidence);
    const patchCollectArtifact = readJsonArtifactOption(evidence.patch_collect_report);
    if (!patchCollectArtifact) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_collect_report_missing",
          message:
            "Mutation manifest full-context patch evidence references no readable patch collect report.",
          details: {
            mutation_manifest: repoRelativePath(mutationArtifact.path),
            report: evidence.patch_collect_report ?? null,
          },
        }),
      );
    } else if (asJsonRecord(patchCollectArtifact.value).status !== "ready_for_patch_apply") {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_collect_not_ready",
          message: `Patch collect report status is ${asJsonRecord(patchCollectArtifact.value).status ?? "missing"}.`,
          details: { report: repoRelativePath(patchCollectArtifact.path) },
        }),
      );
    }
    const authoringPackageProofs = [
      ...authoringPackageProofsFromPatchCollect(patchCollectArtifact),
      ...authoringPackageProofsFromCurationGate(mutationManifest),
    ];
    for (const proof of authoringPackageProofs) {
      for (const blocker of proof.blockers) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: `patch_${blocker.code}`,
            message: blocker.message,
            details: blocker,
          }),
        );
      }
    }

    const patchApplyArtifact = readJsonArtifactOption(evidence.patch_apply_report);
    if (!patchApplyArtifact) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_apply_report_missing",
          message:
            "Mutation manifest full-context patch evidence references no readable patch apply report.",
          details: {
            mutation_manifest: repoRelativePath(mutationArtifact.path),
            report: evidence.patch_apply_report ?? null,
          },
        }),
      );
      return blockers;
    }
    const patchApplyReport = asJsonRecord(patchApplyArtifact.value);
    if (patchApplyReport.status !== "completed") {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_apply_not_completed",
          message: `Patch apply report status is ${patchApplyReport.status ?? "missing"}.`,
          details: { report: repoRelativePath(patchApplyArtifact.path) },
        }),
      );
    }
    const patchEvidenceFile =
      evidence.patch_evidence_file ?? nestedValue(patchApplyReport, "files", "patch_evidence");
    const patchEvidenceArtifact = readJsonOrJsonlRowsArtifact(patchEvidenceFile);
    if (patchEvidenceArtifact.error) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_evidence_file_unreadable",
          message:
            "Patch apply report must retain readable AI patch evidence rows for closeout proof.",
          details: {
            report: repoRelativePath(patchApplyArtifact.path),
            patch_evidence_file: patchEvidenceFile ?? null,
            error: patchEvidenceArtifact.error,
          },
        }),
      );
    } else if (patchEvidenceArtifact.rows.length < expectedCount) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_evidence_count_incomplete",
          message:
            "Patch evidence rows are fewer than the mutation manifest AI patch evidence count.",
          details: {
            report: repoRelativePath(patchApplyArtifact.path),
            patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
            expected_patch_evidence_entries: expectedCount,
            actual_patch_evidence_entries: patchEvidenceArtifact.rows.length,
          },
        }),
      );
    }
    if (!patchEvidenceArtifact.error) {
      const patchEvidenceRows = patchEvidenceArtifact.rows;
      const missingPackageHash = patchEvidenceRows.filter(
        (entry) => !asText(asJsonRecord(entry).authoring_package_sha256),
      );
      if (missingPackageHash.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_package_hash_missing",
            message:
              "Every retained AI patch evidence row must still include authoring_package_sha256.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: missingPackageHash.length,
            },
          }),
        );
      }
      const knownPackageHashes = new Set(
        authoringPackageProofs.map((proof) => asText(proof.sha256)).filter(Boolean),
      );
      const unknownPackageHash = patchEvidenceRows.filter((entry) => {
        const hash = asText(asJsonRecord(entry).authoring_package_sha256);
        return hash && !knownPackageHashes.has(hash);
      });
      if (unknownPackageHash.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_package_hash_unknown",
            message:
              "Every retained AI patch evidence authoring_package_sha256 must match a readable full-context authoring package from patch collect or curation gate evidence.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: unknownPackageHash.length,
            },
          }),
        );
      }
      const missingClosures = patchEvidenceRows.filter(
        (entry) => ensureArray(asJsonRecord(entry).closes_action_items).length === 0,
      );
      if (missingClosures.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_action_closure_missing",
            message:
              "Every retained AI patch evidence row must still close at least one authoring action item.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: missingClosures.length,
            },
          }),
        );
      }
      const missingEvidence = patchEvidenceRows.filter((entry) => {
        const evidenceValue = asJsonRecord(entry).evidence;
        return !evidenceValue || typeof evidenceValue !== "object";
      });
      if (missingEvidence.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_evidence_missing",
            message: "Every retained AI patch evidence row must still include structured evidence.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: missingEvidence.length,
            },
          }),
        );
      }
      const missingResolution = patchEvidenceRows.filter(
        (entry) => !patchEvidenceResolutionMode(entry),
      );
      if (missingResolution.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_resolution_missing",
            message: "Every retained AI patch evidence row must still include resolution.mode.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: missingResolution.length,
            },
          }),
        );
      }
      const invalidResolutionMode = patchEvidenceRows.filter((entry) => {
        const mode = patchEvidenceResolutionMode(entry);
        return mode && !fullContextPatchResolutionModes.has(mode);
      });
      if (invalidResolutionMode.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_resolution_mode_invalid",
            message: "Retained AI patch evidence contains unsupported resolution.mode values.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: invalidResolutionMode.length,
            },
          }),
        );
      }
      const missingContextKinds = [];
      for (const entry of patchEvidenceRows) {
        const usedKinds = new Set(patchEvidenceResolutionContextKinds(entry));
        for (const requiredKind of requirement?.required_context_kinds ?? []) {
          if (!usedKinds.has(requiredKind)) {
            missingContextKinds.push({ entry, requiredKind });
          }
        }
      }
      if (missingContextKinds.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_resolution_context_missing",
            message:
              "Retained AI patch evidence resolution.used_context_kinds must still include every required full-context kind.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: missingContextKinds.length,
              required_context_kinds: requirement?.required_context_kinds ?? [],
            },
          }),
        );
      }
    }
    return blockers;
  }

  function fullContextEvidenceArtifactBlockers({
    mutationArtifact,
    requirement,
    prefix,
    codePrefix,
  }: {
    mutationArtifact: JsonArtifact;
    requirement: FullContextRequirement | null;
    prefix: JsonRecord;
    codePrefix: string;
  }): JsonRecord[] {
    const mutationManifest = asJsonRecord(mutationArtifact.value);
    const evidence = asJsonRecord(mutationManifest.evidence);
    if (!evidence.full_context_ai_completion_required) {
      return [];
    }
    const counts = mutationManifest.counts ?? {};
    return [
      ...buildPatchApplyProofBlockers({
        mutationArtifact,
        requirement,
        prefix,
        codePrefix,
        expectedCount: fullContextCount(counts, "ai_patch_evidence_entries"),
      }),
      ...buildDecisionApplyProofBlockers({
        mutationArtifact,
        requirement,
        prefix,
        codePrefix,
        kind: "classification",
        expectedCount: fullContextCount(counts, "ai_classification_decision_entries"),
      }),
      ...buildDecisionApplyProofBlockers({
        mutationArtifact,
        requirement,
        prefix,
        codePrefix,
        kind: "location",
        expectedCount: fullContextCount(counts, "ai_location_decision_entries"),
      }),
      ...buildDecisionApplyProofBlockers({
        mutationArtifact,
        requirement,
        prefix,
        codePrefix,
        kind: "identity",
        expectedCount: fullContextCount(counts, "ai_identity_decision_entries"),
      }),
    ];
  }

  function fullContextProofCheck({
    prefix = {},
    profileId,
    datasetType,
    closeoutCounts = null,
    mutationArtifact = null,
    codePrefix = "completion",
  }: {
    prefix?: JsonRecord;
    profileId?: unknown;
    datasetType?: unknown;
    closeoutCounts?: unknown;
    mutationArtifact?: JsonArtifact | null;
    codePrefix?: string;
  }): { required: boolean; blockers: JsonRecord[] } {
    const mutationManifest = mutationArtifact ? asJsonRecord(mutationArtifact.value) : null;
    const mutationEvidence = asJsonRecord(mutationManifest?.evidence);
    const profileRequirement = profileId
      ? profileFullContextRequirement(profileId, datasetType)
      : null;
    const mutationMarkedRequired = mutationEvidence.full_context_ai_completion_required === true;
    if (!profileRequirement && !mutationMarkedRequired) {
      return { required: false, blockers: [] };
    }

    const blockerPrefix = {
      ...prefix,
      profile: profileRequirement?.profile_id ?? (asText(profileId) || null),
      dataset_type: profileRequirement?.dataset_type ?? (asText(datasetType).toLowerCase() || null),
    };
    const semanticEvidenceCount = (countsValue: unknown) => {
      const counts = asJsonRecord(countsValue);
      return (
        (Number(counts.ai_patch_evidence_entries ?? 0) || 0) +
        (Number(counts.ai_classification_decision_entries ?? 0) || 0) +
        (Number(counts.ai_location_decision_entries ?? 0) || 0) +
        (Number(counts.ai_identity_decision_entries ?? 0) || 0) +
        (Number(counts.source_contact_rewrite_semantic_evidence_entries ?? 0) || 0)
      );
    };
    const blockers: JsonRecord[] = [];
    if (closeoutCounts) {
      const closeoutCountRecord = asJsonRecord(closeoutCounts);
      if (closeoutCountRecord.full_context_ai_completion_required !== true) {
        blockers.push({
          ...blockerPrefix,
          code: `${codePrefix}_full_context_scope_missing`,
          message:
            "This committed scope belongs to a profile or manifest that requires full schema/YAML/context AI completion, but the closeout does not mark the scope as full-context completed.",
        });
      }
      if (semanticEvidenceCount(closeoutCountRecord) <= 0) {
        blockers.push({
          ...blockerPrefix,
          code: `${codePrefix}_full_context_semantic_evidence_missing`,
          message:
            "Full-context AI completion requires at least one AI patch evidence, AI identity decision, AI classification decision, or AI location decision entry.",
        });
      }
    }

    if (!mutationArtifact) {
      blockers.push({
        ...blockerPrefix,
        code: `${codePrefix}_full_context_mutation_manifest_missing`,
        message: "Full-context completion requires a readable mutation manifest.",
      });
      return { required: true, blockers };
    }
    if (mutationEvidence.full_context_ai_completion_required !== true) {
      blockers.push({
        ...blockerPrefix,
        code: `${codePrefix}_full_context_mutation_requirement_missing`,
        message: "Mutation manifest does not prove that full-context AI completion was required.",
        mutation_manifest: repoRelativePath(mutationArtifact.path),
      });
    }
    if (!mutationEvidence.full_context_ai_completion_proof) {
      blockers.push({
        ...blockerPrefix,
        code: `${codePrefix}_full_context_mutation_proof_missing`,
        message: "Mutation manifest does not carry the full-context AI completion proof snapshot.",
        mutation_manifest: repoRelativePath(mutationArtifact.path),
      });
    }
    if (semanticEvidenceCount(mutationManifest?.counts ?? {}) <= 0) {
      blockers.push({
        ...blockerPrefix,
        code: `${codePrefix}_full_context_mutation_semantic_evidence_missing`,
        message:
          "Mutation manifest has no AI patch evidence, AI identity decision, AI classification decision, or AI location decision entries for the full-context scope.",
        mutation_manifest: repoRelativePath(mutationArtifact.path),
      });
    }
    blockers.push(
      ...fullContextEvidenceArtifactBlockers({
        mutationArtifact,
        requirement: profileRequirement,
        prefix: blockerPrefix,
        codePrefix,
      }),
    );

    return { required: true, blockers };
  }

  function completionFullContextBlockers({
    task,
    completionReport,
  }: {
    task: unknown;
    completionReport: unknown;
  }): JsonRecord[] {
    const blockers: JsonRecord[] = [];
    const completion = asJsonRecord(completionReport);
    const closeouts = ensureArray(completion.closeouts).filter(isJsonRecord);
    const taskProfile = taskProfileId(task);
    const taskType = taskDatasetType(task);
    const taskRequirement = taskProfile
      ? profileFullContextRequirement(taskProfile, taskType)
      : null;
    let requiredCloseoutCount = 0;

    if (taskRequirement && closeouts.length === 0) {
      blockers.push({
        code: "completion_full_context_closeout_missing",
        message:
          "Task profile requires full schema/YAML/context AI completion, but the completion report has no closeout scope.",
        profile: taskRequirement.profile_id,
        dataset_type: taskRequirement.dataset_type,
      });
    }

    closeouts.forEach((closeout, index) => {
      const profileId = asText(closeout.profile) || taskProfile;
      const datasetType = asText(closeout.dataset_type) || taskType;
      const mutationArtifact = readJsonArtifactOption(closeout.mutation_manifest);
      const fullContextCheck = fullContextProofCheck({
        prefix: {
          closeout_index: index,
          closeout_report: closeout.closeout_report ?? null,
        },
        profileId,
        datasetType,
        closeoutCounts: closeout.counts ?? {},
        mutationArtifact,
        codePrefix: "completion",
      });
      if (!fullContextCheck.required) return;
      requiredCloseoutCount += 1;
      blockers.push(
        ...fullContextCheck.blockers.map((blocker) => ({
          ...blocker,
          closeout_index: index,
          closeout_report: closeout.closeout_report ?? null,
        })),
      );
    });

    const reportFullContextScopes = Number(
      nestedValue(completion, "counts", "full_context_scopes") ?? 0,
    );
    if (requiredCloseoutCount > 0 && reportFullContextScopes < requiredCloseoutCount) {
      blockers.push({
        code: "completion_full_context_scope_count_incomplete",
        message:
          "Completion report full_context_scopes does not cover every profile-required full-context closeout scope.",
        expected_minimum: requiredCloseoutCount,
        actual: Number.isFinite(reportFullContextScopes) ? reportFullContextScopes : 0,
      });
    }

    return blockers;
  }

  return {
    completionFullContextBlockers,
    fullContextProofCheck,
    profileFullContextRequirement,
  };
}
