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
}: any) {
  function profileFullContextRequirement(profileId: any, datasetType: any) {
    const listing = listImportProfiles({ repoRoot });
    const requestedProfileId = asText(
      profileId || listing.default_profile || "generic",
    ).toLowerCase();
    const defaultProfileId = asText(listing.default_profile || "generic").toLowerCase();
    const profile =
      listing.profiles?.[requestedProfileId] ??
      listing.profiles?.[defaultProfileId] ??
      listing.profiles?.generic;
    const requirement = profile?.full_context_ai_completion;
    if (requirement?.required !== true) return null;

    const requiredDatasetTypes = normalizedList(
      requirement.dataset_types ?? requirement.datasetTypes,
    ).map((value: any) => value.toLowerCase());
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

  function taskProfileId(task: any) {
    return asText(
      task?.meta?.profile ??
        task?.meta?.import_profile ??
        task?.meta?.importProfile ??
        task?.meta?.dataset_profile ??
        task?.meta?.datasetProfile,
    );
  }

  function taskDatasetType(task: any) {
    return asText(task?.meta?.dataset_type ?? task?.meta?.datasetType);
  }

  function fullContextCount(counts: any, key: any) {
    const value = Number(counts?.[key] ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function normalizeProofRows(value: any) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (Array.isArray(value?.decisions)) return value.decisions.filter(Boolean);
    if (Array.isArray(value?.rows)) return value.rows.filter(Boolean);
    return value && typeof value === "object" ? [value] : [];
  }

  function readJsonOrJsonlRowsArtifact(value: any) {
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

  function patchEvidenceResolution(entry: any) {
    return entry?.resolution && typeof entry.resolution === "object" ? entry.resolution : {};
  }

  function patchEvidenceResolutionMode(entry: any) {
    return asText(patchEvidenceResolution(entry).mode);
  }

  function patchEvidenceResolutionContextKinds(entry: any) {
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
  }: any) {
    const packagePath = resolveRepoPath(packageRef);
    const proof: any = {
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
    let payload = null;
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
    proof.contract_context_files = ensureArray(payload?.contract_context_files);
    proof.missing_context_files = ensureArray(payload?.missing_context_files);
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

  function authoringPackageProofsFromPatchCollect(patchCollectArtifact: any) {
    const manifestRef = patchCollectArtifact?.value?.task_manifest;
    const manifestArtifact = readJsonArtifactOption(manifestRef);
    if (!manifestArtifact) return [];
    return ensureArray(manifestArtifact.value?.tasks)
      .map((task: any) => {
        const packageRef = asText(task?.files?.authoring_package ?? task?.files?.authoringPackage);
        if (!packageRef) return null;
        return readAuthoringPackageProofForFullContext({
          packageRef,
          expectedSha256: task?.context?.authoring_package_sha256,
          source: "patch_collect_task_manifest",
        });
      })
      .filter(Boolean);
  }

  function authoringPackageProofsFromCurationGate(mutationManifest: any) {
    const curationGateArtifact = readJsonArtifactOption(
      mutationManifest?.evidence?.curation_gate_report,
    );
    if (!curationGateArtifact) return [];
    const entities = ensureArray(
      curationGateArtifact.value?.entities ??
        curationGateArtifact.value?.processes ??
        curationGateArtifact.value?.flows ??
        curationGateArtifact.value?.items,
    );
    return entities
      .map((entity: any) => {
        const packageRef = asText(entity?.authoring_package ?? entity?.authoringPackage);
        if (!packageRef) return null;
        return readAuthoringPackageProofForFullContext({
          packageRef,
          expectedSha256: entity?.authoring_package_sha256,
          source: "curation_gate",
        });
      })
      .filter(Boolean);
  }

  function fullContextEvidenceArtifactBlocker({
    prefix,
    codePrefix,
    suffix,
    message,
    details = {},
  }: any) {
    return {
      ...prefix,
      code: `${codePrefix}_full_context_${suffix}`,
      message,
      ...details,
    };
  }

  function decisionApplyTasksFromReport(report: any) {
    const tasks = ensureArray(report?.decision_tasks ?? report?.decisionTasks);
    if (tasks.length > 0) return tasks;
    return report?.decision_task || report?.decisionTask
      ? [report.decision_task ?? report.decisionTask]
      : [];
  }

  function decisionTaskReferencePath(task: any) {
    return asText(task?.path ?? task?.task ?? task?.decision_task ?? task?.decisionTask);
  }

  function readDecisionTaskArtifactForProof(task: any) {
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
    const contextBundle = artifact.value?.context_bundle ?? artifact.value?.authoring_context ?? {};
    const expectedSha256 = asText(task?.sha256);
    const expectedContextBundleSha256 = asText(
      task?.context_bundle_sha256 ?? task?.contextBundleSha256,
    );
    const contextBundleSha256 = asText(
      contextBundle?.sha256 ?? contextBundle?.context_bundle_sha256,
    );
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
      status: asText(artifact.value?.status),
      task_kind: asText(artifact.value?.task_kind),
      blockers,
    };
  }

  function decisionApplyReportRefs(evidence: any, reportKey: any, kind: any) {
    const values =
      kind === "identity"
        ? [
            ...ensureArray(evidence.identity_decision_apply_reports),
            ...ensureArray(evidence[reportKey]),
          ]
        : ensureArray(evidence[reportKey]);
    return unique(values.map((value: any) => asText(value)));
  }

  function buildDecisionApplyProofBlockers({
    mutationArtifact,
    requirement,
    prefix,
    codePrefix,
    kind,
    expectedCount,
  }: any) {
    if (expectedCount <= 0) return [];
    const blockers: any[] = [];
    const mutationManifest = mutationArtifact?.value ?? {};
    const evidence = mutationManifest.evidence ?? {};
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
      .map((reportRef: any) => readJsonArtifactOption(reportRef))
      .filter(Boolean);
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

    const report = reportArtifact.value ?? {};
    for (const candidateReportArtifact of reportArtifacts) {
      const candidateReportStatus = asText(candidateReportArtifact.value?.status);
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

    const decisionRows = [];
    const decisionFiles = [];
    for (const candidateReportArtifact of reportArtifacts) {
      const candidateReport = candidateReportArtifact.value ?? {};
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
        decisionFiles.push(repoRelativePath(decisionsArtifact.path));
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
            reports: reportArtifacts.map((artifact: any) => repoRelativePath(artifact.path)),
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
        : decisionApplyTasksFromReport(report).map((task: any) =>
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

    const contextBundleHashes = unique(taskProofs.map((proof: any) => proof.context_bundle_sha256));
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
    const missingEvidence = decisionsArtifact.rows.filter(
      (decision) => !decision?.evidence || typeof decision.evidence !== "object",
    );
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
  }: any) {
    if (expectedCount <= 0) return [];
    const blockers: any[] = [];
    const mutationManifest = mutationArtifact?.value ?? {};
    const evidence = mutationManifest.evidence ?? {};
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
    } else if (patchCollectArtifact.value?.status !== "ready_for_patch_apply") {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_collect_not_ready",
          message: `Patch collect report status is ${patchCollectArtifact.value?.status ?? "missing"}.`,
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
    if (patchApplyArtifact.value?.status !== "completed") {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_apply_not_completed",
          message: `Patch apply report status is ${patchApplyArtifact.value?.status ?? "missing"}.`,
          details: { report: repoRelativePath(patchApplyArtifact.path) },
        }),
      );
    }
    const patchEvidenceFile =
      evidence.patch_evidence_file ?? patchApplyArtifact.value?.files?.patch_evidence;
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
            patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
            expected_patch_evidence_entries: expectedCount,
            actual_patch_evidence_entries: patchEvidenceArtifact.rows.length,
          },
        }),
      );
    }
    if (!patchEvidenceArtifact.error) {
      const patchEvidenceRows = patchEvidenceArtifact.rows;
      const missingPackageHash = patchEvidenceRows.filter(
        (entry: any) => !asText(entry?.authoring_package_sha256),
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
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
              count: missingPackageHash.length,
            },
          }),
        );
      }
      const knownPackageHashes = new Set(
        authoringPackageProofs.map((proof) => asText(proof.sha256)).filter(Boolean),
      );
      const unknownPackageHash = patchEvidenceRows.filter((entry: any) => {
        const hash = asText(entry?.authoring_package_sha256);
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
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
              count: unknownPackageHash.length,
            },
          }),
        );
      }
      const missingClosures = patchEvidenceRows.filter(
        (entry: any) => ensureArray(entry?.closes_action_items).length === 0,
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
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
              count: missingClosures.length,
            },
          }),
        );
      }
      const missingEvidence = patchEvidenceRows.filter(
        (entry: any) => !entry?.evidence || typeof entry.evidence !== "object",
      );
      if (missingEvidence.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_evidence_missing",
            message: "Every retained AI patch evidence row must still include structured evidence.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
              count: missingEvidence.length,
            },
          }),
        );
      }
      const missingResolution = patchEvidenceRows.filter(
        (entry: any) => !patchEvidenceResolutionMode(entry),
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
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
              count: missingResolution.length,
            },
          }),
        );
      }
      const invalidResolutionMode = patchEvidenceRows.filter((entry: any) => {
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
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
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
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path),
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
  }: any) {
    const mutationManifest = mutationArtifact?.value ?? null;
    if (!mutationManifest?.evidence?.full_context_ai_completion_required) {
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
  }: any) {
    const mutationManifest = mutationArtifact?.value ?? null;
    const profileRequirement = profileId
      ? profileFullContextRequirement(profileId, datasetType)
      : null;
    const mutationMarkedRequired =
      mutationManifest?.evidence?.full_context_ai_completion_required === true;
    if (!profileRequirement && !mutationMarkedRequired) {
      return { required: false, blockers: [] };
    }

    const blockerPrefix = {
      ...prefix,
      profile: profileRequirement?.profile_id ?? (asText(profileId) || null),
      dataset_type: profileRequirement?.dataset_type ?? (asText(datasetType).toLowerCase() || null),
    };
    const semanticEvidenceCount = (counts: any) =>
      (Number(counts?.ai_patch_evidence_entries ?? 0) || 0) +
      (Number(counts?.ai_classification_decision_entries ?? 0) || 0) +
      (Number(counts?.ai_location_decision_entries ?? 0) || 0) +
      (Number(counts?.ai_identity_decision_entries ?? 0) || 0) +
      (Number(counts?.source_contact_rewrite_semantic_evidence_entries ?? 0) || 0);
    const blockers: any[] = [];
    if (closeoutCounts) {
      if (closeoutCounts.full_context_ai_completion_required !== true) {
        blockers.push({
          ...blockerPrefix,
          code: `${codePrefix}_full_context_scope_missing`,
          message:
            "This committed scope belongs to a profile or manifest that requires full schema/YAML/context AI completion, but the closeout does not mark the scope as full-context completed.",
        });
      }
      if (semanticEvidenceCount(closeoutCounts) <= 0) {
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
    if (mutationManifest?.evidence?.full_context_ai_completion_required !== true) {
      blockers.push({
        ...blockerPrefix,
        code: `${codePrefix}_full_context_mutation_requirement_missing`,
        message: "Mutation manifest does not prove that full-context AI completion was required.",
        mutation_manifest: repoRelativePath(mutationArtifact.path),
      });
    }
    if (!mutationManifest?.evidence?.full_context_ai_completion_proof) {
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

  function completionFullContextBlockers({ task, completionReport }: any) {
    const blockers: any[] = [];
    const closeouts = ensureArray(completionReport?.closeouts).filter(
      (closeout: any) => closeout && typeof closeout === "object" && !Array.isArray(closeout),
    );
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

    closeouts.forEach((closeout: any, index: number) => {
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
        ...fullContextCheck.blockers.map((blocker: any) => ({
          ...blocker,
          closeout_index: index,
          closeout_report: closeout.closeout_report ?? null,
        })),
      );
    });

    const reportFullContextScopes = Number(completionReport?.counts?.full_context_scopes ?? 0);
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
