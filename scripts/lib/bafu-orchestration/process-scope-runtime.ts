import path from "node:path";

import { commandSpecOptionValue } from "../foundry-command-spec.ts";
import type { JsonRecord } from "./finalize-recovery-policy.ts";
import type {
  ProcessScopeFinalizeBuildInput,
  ProcessScopeFinalizePlan,
  ProcessScopeFinalizeProjectionInput,
  ProcessScopeRerunCommandInput,
  ProcessScopeVerifiedSupportInput,
} from "./process-scope-run.ts";
import {
  projectBafuProcessScopeFinalizeReport,
  type BafuProcessScopeFinalizeReport,
} from "./process-scope-report.ts";

export interface BafuProcessScopeRuntimeDependencies {
  commandName: string;
  finalizeReportName: string;
  foundryEntryPath: string;
  processExecutable: string;
  nowIso: () => string;
  resolveRepoPath: (value: unknown) => string | null;
  repoRelative: (filePath: string | null | undefined) => string;
  fileExists: (filePath: string | null | undefined) => boolean;
  readJson: (filePath: string) => JsonRecord;
  readJsonLines: (filePath: string) => JsonRecord[];
  readRowsFile: (filePath: string) => JsonRecord[];
  textValue: (value: unknown) => string;
  booleanOption: (value: unknown) => boolean;
  shellQuote: (value: string) => string;
  appendLedger: (ledgerPath: string, row: JsonRecord) => void;
  makeDirectory: (directory: string) => void;
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function datasetTypeFromRow(row: JsonRecord): string | null {
  if (row.contactDataSet) return "contact";
  if (row.sourceDataSet) return "source";
  return null;
}

export function createBafuProcessScopeRuntime({
  commandName,
  finalizeReportName,
  foundryEntryPath,
  processExecutable,
  nowIso,
  resolveRepoPath,
  repoRelative,
  fileExists,
  readJson,
  readJsonLines,
  readRowsFile,
  textValue,
  booleanOption,
  shellQuote,
  appendLedger,
  makeDirectory,
}: BafuProcessScopeRuntimeDependencies) {
  function processIdentity(row: JsonRecord): JsonRecord {
    const payload = jsonRecord(row.processDataSet ?? row);
    const dataSetInformation =
      jsonRecord(payload.processInformation).dataSetInformation ??
      jsonRecord(payload.processInformation)["common:dataSetInformation"] ??
      {};
    const information = jsonRecord(dataSetInformation);
    const publication =
      jsonRecord(payload.administrativeInformation).publicationAndOwnership ??
      jsonRecord(payload.administrativeInformation)["common:publicationAndOwnership"] ??
      {};
    const publicationRecord = jsonRecord(publication);
    return {
      id:
        textValue(information["common:UUID"]) ||
        textValue(information.UUID) ||
        textValue(row.dataset_id) ||
        textValue(row.id),
      version:
        textValue(publicationRecord["common:dataSetVersion"]) ||
        textValue(publicationRecord.dataSetVersion) ||
        textValue(row.dataset_version) ||
        textValue(row.version) ||
        "00.00.001",
    };
  }

  function supportIdentity(
    row: JsonRecord,
    fallbackType: string | null,
  ): { type: string | null; id: string; version: string } {
    const type = datasetTypeFromRow(row) || fallbackType;
    const root = type ? jsonRecord(row[`${type}DataSet`]) : {};
    const information =
      jsonRecord(root[`${type}Information`]).dataSetInformation ??
      jsonRecord(root[`${type}Information`])["common:dataSetInformation"] ??
      {};
    const informationRecord = jsonRecord(information);
    const publication =
      jsonRecord(root.administrativeInformation).publicationAndOwnership ??
      jsonRecord(root.administrativeInformation)["common:publicationAndOwnership"] ??
      {};
    const publicationRecord = jsonRecord(publication);
    return {
      type,
      id:
        textValue(informationRecord["common:UUID"]) ||
        textValue(informationRecord.UUID) ||
        textValue(row.dataset_id) ||
        textValue(row.id),
      version:
        textValue(publicationRecord["common:dataSetVersion"]) ||
        textValue(publicationRecord.dataSetVersion) ||
        textValue(row.dataset_version) ||
        textValue(row.version) ||
        "00.00.001",
    };
  }

  function supportIdentityKeysFromHandoffPlan(handoffPlan: JsonRecord): string[] {
    const commands = jsonRecord(handoffPlan.commands);
    const inputPath = resolveRepoPath(
      commandSpecOptionValue(commands.commit, "--input") ||
        commandSpecOptionValue(commands.commit, "--input-file"),
    );
    const fallbackType = commandSpecOptionValue(commands.commit, "--type");
    if (!fileExists(inputPath)) return [];
    return readRowsFile(inputPath!)
      .map((row) => {
        const identity = supportIdentity(row, fallbackType);
        if (!identity.type || !["contact", "source"].includes(identity.type) || !identity.id) {
          return null;
        }
        return `${identity.type}:${identity.id}@${identity.version}`;
      })
      .filter((key): key is string => Boolean(key));
  }

  function supportIdentityKeyFromCacheRow(row: JsonRecord): string | null {
    if (row.identity_key) return String(row.identity_key);
    const type = textValue(row.dataset_type || row.type || textValue(row.table).replace(/s$/u, ""));
    const id = row.dataset_id || row.id;
    const version = row.dataset_version || row.version || "00.00.001";
    return ["contact", "source"].includes(type) && id ? `${type}:${id}@${version}` : null;
  }

  function loadVerifiedSupportIdentities(cacheFile: unknown): Set<string> {
    const resolved = resolveRepoPath(cacheFile);
    if (!fileExists(resolved)) return new Set();
    return new Set(
      readJsonLines(resolved!)
        .map(supportIdentityKeyFromCacheRow)
        .filter((key): key is string => Boolean(key)),
    );
  }

  function appendVerifiedSupportIdentities({
    cacheFile,
    identityKeys,
    source,
    report,
  }: ProcessScopeVerifiedSupportInput): void {
    const resolved = resolveRepoPath(cacheFile);
    if (!resolved || identityKeys.length === 0) return;
    makeDirectory(path.dirname(resolved));
    for (const identityKey of identityKeys) {
      const match = /^(contact|source):([^@]+)@(.+)$/u.exec(identityKey);
      if (!match) continue;
      appendLedger(resolved, {
        schema_version: 1,
        generated_at_utc: nowIso(),
        identity_key: identityKey,
        dataset_type: match[1],
        dataset_id: match[2],
        dataset_version: match[3],
        status: "verified",
        source,
        report: repoRelative(report),
      });
    }
  }

  function appendOption(args: string[], name: string, value: unknown): void {
    if (value === undefined || value === null || value === "") return;
    if (value === true) {
      args.push(name);
      return;
    }
    args.push(name, String(value));
  }

  function appendPathOption(args: string[], name: string, value: unknown): void {
    if (!value) return;
    appendOption(args, name, repoRelative(resolveRepoPath(value)));
  }

  function appendPathOptions(args: string[], name: string, value: unknown): void {
    const values = Array.isArray(value) ? value : String(value ?? "").split(",");
    for (const item of values.map((entry) => String(entry).trim()).filter(Boolean)) {
      appendPathOption(args, name, item);
    }
  }

  function commandString(argv: readonly string[]): string {
    return argv.map(shellQuote).join(" ");
  }

  function rerunCommand({
    rowsFile,
    outDir,
    sourceSupportRowsFile,
    sourceRowsFile,
  }: ProcessScopeRerunCommandInput): string {
    const args = [
      "node",
      foundryEntryPath,
      commandName,
      "--rows-file",
      repoRelative(rowsFile) || "<rows.jsonl>",
      "--out-dir",
      repoRelative(outDir),
      "--execute",
    ];
    appendPathOption(args, "--source-support-rows-file", sourceSupportRowsFile);
    appendPathOption(args, "--source-rows-file", sourceRowsFile);
    return commandString(args);
  }

  function optionPathList(value: unknown): string[] {
    const values = Array.isArray(value) ? value : String(value ?? "").split(",");
    return values
      .map((entry) => String(entry).trim())
      .filter(Boolean)
      .map(resolveRepoPath)
      .filter((filePath): filePath is string => Boolean(filePath));
  }

  function processIdentityReportsFromOptions(options: JsonRecord): string[] {
    return optionPathList(
      options.identityDecisionApplyReports ||
        options.identityDecisionsApplyReports ||
        options.identityDecisionApplyReport ||
        options.identityDecisionsApplyReport,
    );
  }

  function buildFinalizeCommand({
    options,
    rowsFile,
    outDir,
    importLedgerDir,
  }: ProcessScopeFinalizeBuildInput): ProcessScopeFinalizePlan {
    const finalizeDir = resolveRepoPath(options.finalizeDir) || path.join(outDir, "finalize");
    const args = [
      processExecutable,
      foundryEntryPath,
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      repoRelative(rowsFile),
      "--out-dir",
      repoRelative(finalizeDir),
      "--ledger-dir",
      repoRelative(importLedgerDir),
    ];
    appendPathOption(args, "--source-support-rows-file", options.sourceSupportRowsFile);
    appendPathOption(
      args,
      "--source-rows-file",
      options.sourceRowsFile || options.originalRowsFile,
    );
    appendPathOption(args, "--identity-preflight-index", options.identityPreflightIndex);
    appendPathOption(args, "--schema-file", options.schemaFile);
    appendPathOption(args, "--yaml-file", options.yamlFile);
    appendPathOption(args, "--ruleset-file", options.rulesetFile);
    appendPathOption(args, "--queue-dir", options.queueDir || options.curationQueueDir);
    appendPathOption(args, "--classification-queue", options.classificationQueue);
    appendPathOption(args, "--location-queue", options.locationQueue);
    appendPathOption(
      args,
      "--classification-decision-apply-report",
      options.classificationDecisionApplyReport || options.classificationDecisionsApplyReport,
    );
    appendPathOption(
      args,
      "--location-decision-apply-report",
      options.locationDecisionApplyReport || options.locationDecisionsApplyReport,
    );
    appendPathOptions(
      args,
      "--identity-decision-apply-report",
      options.identityDecisionApplyReports ||
        options.identityDecisionsApplyReports ||
        options.identityDecisionApplyReport ||
        options.identityDecisionsApplyReport,
    );
    appendPathOption(
      args,
      "--patch-collect-report",
      options.patchCollectReport || options.authoringPatchCollectReport,
    );
    appendPathOption(args, "--patch-apply-report", options.patchApplyReport);
    appendOption(args, "--target-user-id", options.targetUserId);
    appendOption(args, "--state-code", options.stateCode);
    appendOption(args, "--root-policy", options.rootPolicy);
    for (const [optionKey, flag] of [
      ["finalizeSourceContactSupport", "--finalize-source-contact-support"],
      ["verifyRemote", "--verify-remote"],
      ["requireQueueContext", "--require-queue-context"],
      ["runIdentityPreflight", "--run-identity-preflight"],
      ["refreshIdentityPreflight", "--refresh-identity-preflight"],
      ["requirePatchCollectReport", "--require-patch-collect-report"],
    ]) {
      if (Object.hasOwn(options, optionKey)) appendOption(args, flag, options[optionKey]);
    }
    return {
      argv: args,
      finalizeDir,
      finalizeReportPath: path.join(finalizeDir, finalizeReportName),
    };
  }

  function readCurationGateReport(finalizeReport: JsonRecord): JsonRecord | null {
    const gateReportPath = resolveRepoPath(jsonRecord(finalizeReport.files).curation_gate_report);
    return fileExists(gateReportPath) ? readJson(gateReportPath!) : null;
  }

  function projectFinalizeReport({
    processScope,
    outDir,
    reportPath,
    ledgerPath,
    finalizeReport,
    finalizeReportPath,
    finalizeCommand,
    mode,
    sourceSupportRowsFile,
    sourceRowsFile,
  }: ProcessScopeFinalizeProjectionInput): BafuProcessScopeFinalizeReport {
    return projectBafuProcessScopeFinalizeReport({
      generatedAtUtc: nowIso(),
      processScope,
      mode,
      finalizeReport,
      gateReport: readCurationGateReport(finalizeReport),
      finalizeCommand: commandString(finalizeCommand),
      rerunCommand: rerunCommand({
        rowsFile: resolveRepoPath(finalizeReport.rows_file)!,
        outDir,
        sourceSupportRowsFile,
        sourceRowsFile,
      }),
      paths: {
        report: repoRelative(reportPath),
        runLedger: repoRelative(ledgerPath),
        finalizeReport: repoRelative(finalizeReportPath),
        sourceSupportRowsFile: repoRelative(sourceSupportRowsFile),
        sourceRowsFile: repoRelative(sourceRowsFile),
      },
    });
  }

  return {
    appendVerifiedSupportIdentities,
    booleanOption,
    buildFinalizeCommand,
    commandString,
    loadVerifiedSupportIdentities,
    processIdentity,
    processIdentityReportsFromOptions,
    projectFinalizeReport,
    readCurationGateReport,
    rerunCommand,
    supportIdentityKeysFromHandoffPlan,
  };
}
