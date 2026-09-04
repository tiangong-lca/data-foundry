import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import type { BinaryLike } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

type JsonRecord = Record<string, unknown>;

export type TidasAdapterOptions = Record<string, unknown> & {
  tidasBin?: unknown;
  tidasExecutable?: unknown;
  tidasConfig?: unknown;
  config?: unknown;
  memoryBudgetMib?: unknown;
  queueCapacity?: unknown;
  input?: unknown;
  source?: unknown;
  output?: unknown;
  outDir?: unknown;
  fromFormat?: unknown;
  target?: unknown;
  writeMapping?: unknown;
  noProcessBundles?: unknown;
  failOnWarning?: unknown;
  maxEntryMib?: unknown;
  inputFormat?: unknown;
  issues?: unknown;
  rowsFile?: unknown;
  type?: unknown;
  datasetType?: unknown;
};

export type TidasInvocation = {
  executable: string;
  executable_source: "option" | "TIDAS_BIN" | "PATH";
  config: string | null;
  config_source: "option" | "TIDAS_CONFIG" | "none";
};

export type TidasProcessCommand = {
  command: string;
  prefixArgs: string[];
};

type TidasOperationSummary = JsonRecord & {
  binary_version?: unknown;
  operation_report_schema?: unknown;
  validation_describe?: unknown;
  import?: unknown;
  validation?: unknown;
  validation_batch_final?: unknown;
};

export type TidasOperationReport = JsonRecord & {
  schema_version?: unknown;
  command?: unknown;
  status?: unknown;
  completeness?: unknown;
  exit_class?: unknown;
  diagnostics?: unknown;
  artifacts?: unknown;
  next_actions?: unknown;
  summary?: TidasOperationSummary;
};

type ValidationDescribe = JsonRecord & {
  schema_version?: unknown;
  protocols?: string[];
  event_schema_versions?: string[];
  asset_fingerprint?: unknown;
};

type TidasOperationResult = JsonRecord & {
  command: string;
  executable: string;
  executable_source: string;
  config_source: string;
  args: string[];
  exit_code: number;
  stderr: string;
  binary_version: string;
  handshake: TidasOperationReport;
  validation_describe: ValidationDescribe;
  validation_describe_report: TidasOperationReport;
  report: TidasOperationReport;
};

type RootCategoryConfig = {
  category: string;
  informationKey: string;
};

export const TIDAS_OPERATION_REPORT_SCHEMA = "tidas.operation-report.v1";
export const TIDAS_IMPORT_REPORT_SCHEMA = "tidas.import-execution-report.v1";
export const TIDAS_VALIDATION_SUMMARY_SCHEMA = "tidas.validation-summary.v1";
export const TIDAS_VALIDATION_DESCRIBE_SCHEMA = "tidas.validation-describe.v1";
export const TIDAS_VALIDATION_BATCH_FINAL_SCHEMA = "tidas.validation-final-event.v1";
export const TIDAS_SUPPORTED_VERSION_LINE = "0.2";

const EXIT_CODES = new Map([
  ["success", 0],
  ["data-issues", 2],
  ["usage", 64],
  ["unavailable", 69],
  ["internal", 70],
  ["io", 74],
  ["cancelled", 130],
]);

const ROOT_CATEGORY = new Map<string, RootCategoryConfig>([
  ["contactDataSet", { category: "contacts", informationKey: "contactInformation" }],
  [
    "flowPropertyDataSet",
    { category: "flowproperties", informationKey: "flowPropertiesInformation" },
  ],
  ["flowDataSet", { category: "flows", informationKey: "flowInformation" }],
  ["LCIAMethodDataSet", { category: "lciamethods", informationKey: "LCIAMethodInformation" }],
  [
    "lifeCycleModelDataSet",
    { category: "lifecyclemodels", informationKey: "lifeCycleModelInformation" },
  ],
  ["processDataSet", { category: "processes", informationKey: "processInformation" }],
  ["sourceDataSet", { category: "sources", informationKey: "sourceInformation" }],
  ["unitGroupDataSet", { category: "unitgroups", informationKey: "unitGroupInformation" }],
]);

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function parseJsonOutput(result: SpawnSyncReturns<string>, label: string): TidasOperationReport {
  try {
    return JSON.parse(result.stdout || "{}") as TidasOperationReport;
  } catch {
    throw new Error(
      [
        `${label} did not emit JSON.`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function assertOperationReport(
  report: TidasOperationReport,
  command: string,
  exitCode: number,
): TidasOperationReport {
  const expectedExitCode = EXIT_CODES.get(String(report.exit_class ?? ""));
  if (
    report?.schema_version !== TIDAS_OPERATION_REPORT_SCHEMA ||
    report?.command !== command ||
    !["succeeded", "completed-with-issues", "failed", "cancelled"].includes(
      String(report.status ?? ""),
    ) ||
    !["complete", "partial", "not-started"].includes(String(report.completeness ?? "")) ||
    expectedExitCode === undefined ||
    !Array.isArray(report?.diagnostics) ||
    !Array.isArray(report?.artifacts) ||
    !Array.isArray(report?.next_actions)
  ) {
    throw new Error(`tidas_operation_report_invalid:${command}`);
  }
  if (exitCode !== expectedExitCode) {
    throw new Error(
      `tidas_exit_contract_mismatch:${command}:exit=${exitCode}:class=${report.exit_class}`,
    );
  }
  return report;
}

function assertCompatibleVersion(report: TidasOperationReport): string {
  const version = String(report?.summary?.binary_version ?? "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u.exec(version);
  if (!match) throw new Error(`tidas_version_invalid:${version || "missing"}`);
  if (`${match[1]}.${match[2]}` !== TIDAS_SUPPORTED_VERSION_LINE) {
    throw new Error(
      `tidas_version_unsupported:${version}:required=${TIDAS_SUPPORTED_VERSION_LINE}.x`,
    );
  }
  return version;
}

export function resolveTidasInvocation(
  options: TidasAdapterOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): TidasInvocation {
  const explicit = String(options.tidasBin ?? options.tidasExecutable ?? "").trim();
  const environment = String(env.TIDAS_BIN ?? "").trim();
  const executable = explicit || environment || "tidas";
  const config = String(options.tidasConfig ?? options.config ?? env.TIDAS_CONFIG ?? "").trim();
  return {
    executable,
    executable_source: explicit ? "option" : environment ? "TIDAS_BIN" : "PATH",
    config: config || null,
    config_source:
      options.tidasConfig || options.config ? "option" : config ? "TIDAS_CONFIG" : "none",
  };
}

export function resolveTidasProcessCommand(executable: string): TidasProcessCommand {
  if (/\.(?:[cm]?[jt]s)$/iu.test(executable)) {
    return {
      command: process.execPath,
      prefixArgs: [executable],
    };
  }
  return {
    command: executable,
    prefixArgs: [],
  };
}

function globalArgs(
  invocation: TidasInvocation,
  options: TidasAdapterOptions = {},
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const args = ["--format", "json", "--progress", "never"];
  if (invocation.config) args.push("--config", invocation.config);
  const memoryBudgetMib = options.memoryBudgetMib ?? environment.TIDAS_MEMORY_BUDGET_MIB;
  const queueCapacity = options.queueCapacity ?? environment.TIDAS_QUEUE_CAPACITY;
  if (String(memoryBudgetMib ?? "").trim()) {
    args.push("--memory-budget-mib", String(memoryBudgetMib).trim());
  }
  if (String(queueCapacity ?? "").trim()) {
    args.push("--queue-capacity", String(queueCapacity).trim());
  }
  return args;
}

function portableRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join(path.posix.sep);
}

function runProcess(
  invocation: TidasInvocation,
  args: string[],
  cwd: string,
  maxBuffer = 512 * 1024 * 1024,
  environment: NodeJS.ProcessEnv = process.env,
): SpawnSyncReturns<string> {
  const processCommand = resolveTidasProcessCommand(invocation.executable);
  const result = spawnSync(processCommand.command, [...processCommand.prefixArgs, ...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    maxBuffer,
  });
  if (result.error) throw result.error;
  return result;
}

export function runTidasHandshake({
  repoRoot,
  options = {},
  environment = process.env,
}: {
  repoRoot: string;
  options?: TidasAdapterOptions;
  environment?: NodeJS.ProcessEnv;
}) {
  const invocation = resolveTidasInvocation(options, environment);
  const args = ["version", ...globalArgs(invocation, options, environment)];
  const result = runProcess(invocation, args, repoRoot, undefined, environment);
  const exitCode = typeof result.status === "number" ? result.status : 70;
  const report = assertOperationReport(
    parseJsonOutput(result, "tidas version"),
    "version",
    exitCode,
  );
  const binaryVersion = assertCompatibleVersion(report);
  if (report.summary?.operation_report_schema !== TIDAS_OPERATION_REPORT_SCHEMA) {
    throw new Error("tidas_version_handshake_operation_schema_mismatch");
  }
  const describeArgs = ["validate", "--describe", ...globalArgs(invocation, options, environment)];
  const describeResult = runProcess(invocation, describeArgs, repoRoot, undefined, environment);
  const describeExitCode = typeof describeResult.status === "number" ? describeResult.status : 70;
  const describeReport = assertOperationReport(
    parseJsonOutput(describeResult, "tidas validate --describe"),
    "validate",
    describeExitCode,
  );
  const validationDescribe: ValidationDescribe | null = record(
    describeReport?.summary?.validation_describe,
  );
  if (
    validationDescribe?.schema_version !== TIDAS_VALIDATION_DESCRIBE_SCHEMA ||
    !validationDescribe.protocols?.includes("document-validation-batch.v1") ||
    !validationDescribe.event_schema_versions?.includes(TIDAS_VALIDATION_BATCH_FINAL_SCHEMA) ||
    !/^[0-9a-f]{64}$/u.test(String(validationDescribe.asset_fingerprint ?? ""))
  ) {
    throw new Error("tidas_validation_describe_handshake_invalid");
  }
  return {
    invocation,
    args,
    describe_args: describeArgs,
    exit_code: exitCode,
    stderr: result.stderr || "",
    validation_describe_stderr: describeResult.stderr || "",
    binary_version: binaryVersion,
    report,
    validation_describe: validationDescribe,
    validation_describe_report: describeReport,
  };
}

function runTidasOperation({
  repoRoot,
  command,
  commandArgs,
  options = {},
  environment = process.env,
}: {
  repoRoot: string;
  command: string;
  commandArgs: string[];
  options?: TidasAdapterOptions;
  environment?: NodeJS.ProcessEnv;
}): TidasOperationResult {
  const handshake = runTidasHandshake({ repoRoot, options, environment });
  const args = [command, ...commandArgs, ...globalArgs(handshake.invocation, options, environment)];
  const result = runProcess(handshake.invocation, args, repoRoot, undefined, environment);
  const exitCode = typeof result.status === "number" ? result.status : 70;
  const report = assertOperationReport(
    parseJsonOutput(result, `tidas ${command}`),
    command,
    exitCode,
  );
  return {
    command,
    executable: handshake.invocation.executable,
    executable_source: handshake.invocation.executable_source,
    config_source: handshake.invocation.config_source,
    args,
    exit_code: exitCode,
    stderr: result.stderr || "",
    binary_version: handshake.binary_version,
    handshake: handshake.report,
    validation_describe: handshake.validation_describe,
    validation_describe_report: handshake.validation_describe_report,
    report,
  };
}

export function runTidasImport({
  repoRoot,
  options = {},
  environment = process.env,
}: {
  repoRoot: string;
  options?: TidasAdapterOptions;
  environment?: NodeJS.ProcessEnv;
}): TidasOperationResult {
  const input = path.resolve(repoRoot, String(options.input ?? options.source ?? ""));
  const output = path.resolve(repoRoot, String(options.output ?? options.outDir ?? ""));
  if (!options.input && !options.source) throw new Error("--input is required.");
  if (!options.output && !options.outDir) throw new Error("--output is required.");
  const args = [input, "--output", output];
  if (options.fromFormat) args.push("--from-format", String(options.fromFormat));
  if (options.target) args.push("--target", String(options.target));
  if (options.writeMapping === true || options.writeMapping === "true")
    args.push("--write-mapping");
  if (options.noProcessBundles === true || options.noProcessBundles === "true") {
    args.push("--no-process-bundles");
  }
  if (options.failOnWarning === true || options.failOnWarning === "true") {
    args.push("--fail-on-warning");
  }
  if (options.maxEntryMib) args.push("--max-entry-mib", String(options.maxEntryMib));
  const operation = runTidasOperation({
    repoRoot,
    command: "import",
    commandArgs: args,
    options,
    environment,
  });
  const importReport = record(operation.report?.summary?.import);
  if (importReport && importReport.schema_version !== TIDAS_IMPORT_REPORT_SCHEMA) {
    throw new Error("tidas_import_report_invalid");
  }
  if (operation.exit_code === 0 && !importReport) {
    throw new Error("tidas_import_report_missing");
  }
  return operation;
}

export function runTidasPackageValidation({
  repoRoot,
  options = {},
  environment = process.env,
}: {
  repoRoot: string;
  options?: TidasAdapterOptions;
  environment?: NodeJS.ProcessEnv;
}): TidasOperationResult {
  const input = path.resolve(repoRoot, String(options.input ?? ""));
  if (!options.input) throw new Error("--input is required.");
  const args = [input, "--input-format", String(options.inputFormat ?? "tidas-json")];
  if (options.issues) args.push("--issues", path.resolve(repoRoot, String(options.issues)));
  const operation = runTidasOperation({
    repoRoot,
    command: "validate",
    commandArgs: args,
    options,
    environment,
  });
  const summary = record(operation.report?.summary?.validation);
  if (summary && summary.schema_version !== TIDAS_VALIDATION_SUMMARY_SCHEMA) {
    throw new Error("tidas_validation_summary_invalid");
  }
  if ([0, 2].includes(operation.exit_code) && !summary) {
    throw new Error("tidas_validation_summary_missing");
  }
  if (
    summary?.asset_fingerprint &&
    summary.asset_fingerprint !== operation.validation_describe.asset_fingerprint
  ) {
    throw new Error("tidas_validation_asset_fingerprint_mismatch");
  }
  return operation;
}

function readRows(filePath: string): JsonRecord[] {
  const text = fs.readFileSync(filePath, "utf8");
  if (filePath.toLowerCase().endsWith(".jsonl")) {
    return text
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as JsonRecord);
  }
  const value = JSON.parse(text) as JsonRecord | JsonRecord[];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  return [value];
}

function payloadForRow(row: JsonRecord): JsonRecord {
  for (const key of [
    "payload",
    "contact",
    "flowproperty",
    "flow",
    "lciamethod",
    "lifecyclemodel",
    "process",
    "source",
    "unitgroup",
  ]) {
    const payload = record(row[key]);
    if (payload) return payload;
  }
  return row;
}

function documentCategory(payload: JsonRecord): RootCategoryConfig & { rootKey: string } {
  for (const [rootKey, config] of ROOT_CATEGORY) {
    if (record(payload?.[rootKey])) return { rootKey, ...config };
  }
  throw new Error("tidas_row_category_unknown");
}

function firstText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstText(item);
      if (text) return text;
    }
  }
  const valueRecord = record(value);
  if (valueRecord) return firstText(valueRecord["#text"]);
  return "";
}

function identityForPayload(
  payload: JsonRecord,
  rootKey: string,
  informationKey: string,
): { id: string | null; version: string | null } {
  const root = record(payload[rootKey]) ?? {};
  const informationRecord = record(root[informationKey]);
  const information =
    record(informationRecord?.dataSetInformation) ?? record(root.dataSetInformation) ?? {};
  const id = firstText(information?.["common:UUID"]) || null;
  const administrative = record(root.administrativeInformation);
  const publication = record(administrative?.publicationAndOwnership);
  const version = firstText(publication?.["common:dataSetVersion"]) || null;
  return { id, version };
}

function sha256(bytes: BinaryLike): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(filePath: string, values: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : ""),
  );
}

function replaceDirectoryAtomically(staging: string, output: string): void {
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  const backup = `${output}.rollback-${process.pid}`;
  const hadOutput = fs.existsSync(output);
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  try {
    if (hadOutput) fs.renameSync(output, backup);
    fs.renameSync(staging, output);
    if (hadOutput) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(output) && !hadOutput) fs.rmSync(output, { recursive: true, force: true });
    if (hadOutput && fs.existsSync(backup) && !fs.existsSync(output)) {
      fs.renameSync(backup, output);
    }
    throw error;
  }
}

export function runTidasRowsValidation({
  repoRoot,
  options = {},
  environment = process.env,
}: {
  repoRoot: string;
  options?: TidasAdapterOptions;
  environment?: NodeJS.ProcessEnv;
}): TidasOperationResult {
  const rowsFile = path.resolve(repoRoot, String(options.rowsFile ?? options.input ?? ""));
  const outDir = path.resolve(repoRoot, String(options.outDir ?? ""));
  if (!options.rowsFile && !options.input) throw new Error("--rows-file is required.");
  if (!options.outDir) throw new Error("--out-dir is required.");
  const rows = readRows(rowsFile);
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(outDir), ".tidas-validate-stage-"));
  try {
    const inputRoot = path.join(staging, "input");
    const manifest: Array<{
      document_key: string;
      category: string;
      relative_path: string;
      content_sha256: string;
      identity: {
        dataset_type: string;
        dataset_id: string | null;
        dataset_version: string | null;
      };
    }> = [];
    for (const [ordinal, row] of rows.entries()) {
      const payload = payloadForRow(row);
      const { rootKey, category, informationKey } = documentCategory(payload);
      const identity = identityForPayload(payload, rootKey, informationKey);
      const token = (identity.id || String(ordinal)).replace(/[^A-Za-z0-9_.-]/gu, "_");
      const relativePath = `${category}/${String(ordinal).padStart(8, "0")}-${token}.json`;
      const bytes = Buffer.from(`${JSON.stringify(payload)}\n`);
      const documentPath = path.join(inputRoot, relativePath);
      fs.mkdirSync(path.dirname(documentPath), { recursive: true });
      fs.writeFileSync(documentPath, bytes);
      manifest.push({
        document_key: `${category}:${identity.id || ordinal}:${identity.version || "unknown"}`,
        category,
        relative_path: relativePath,
        content_sha256: sha256(bytes),
        identity: {
          dataset_type: category,
          dataset_id: identity.id,
          dataset_version: identity.version,
        },
      });
    }
    const manifestPath = path.join(staging, "input-manifest.jsonl");
    const eventsPath = path.join(staging, "validation-events.jsonl");
    writeJsonl(manifestPath, manifest);
    const operation = runTidasOperation({
      repoRoot,
      command: "validate",
      commandArgs: [
        inputRoot,
        "--protocol",
        "document-validation-batch.v1",
        "--input-manifest",
        manifestPath,
        "--events",
        eventsPath,
      ],
      options,
      environment,
    });
    if (operation.exit_code !== 0) return operation;
    const finalEvent = record(operation.report?.summary?.validation_batch_final);
    if (
      !finalEvent ||
      finalEvent.schema_version !== TIDAS_VALIDATION_BATCH_FINAL_SCHEMA ||
      finalEvent.completed !== true
    ) {
      throw new Error("tidas_validation_batch_final_invalid");
    }
    const finalFingerprints = record(finalEvent.fingerprints);
    if (finalFingerprints?.asset_fingerprint !== operation.validation_describe.asset_fingerprint) {
      throw new Error("tidas_validation_asset_fingerprint_mismatch");
    }
    const events = fs
      .readFileSync(eventsPath, "utf8")
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as JsonRecord);
    const issuesByOrdinal = new Map<number, unknown[]>();
    for (const event of events) {
      if (event.type !== "issue") continue;
      const ordinal = Number(event.document_ordinal);
      if (!issuesByOrdinal.has(ordinal)) issuesByOrdinal.set(ordinal, []);
      issuesByOrdinal.get(ordinal)!.push(event.issue);
    }
    const invalidOrdinals = new Set(
      events
        .filter((event) => event.type === "issue" && record(event.issue)?.severity === "error")
        .map((event) => Number(event.document_ordinal)),
    );
    const validRows = rows.filter((_, ordinal) => !invalidOrdinals.has(ordinal));
    const invalidRows = rows.filter((_, ordinal) => invalidOrdinals.has(ordinal));
    const reportPath = path.join(staging, "outputs", "validation-report.json");
    const validRowsPath = path.join(staging, "outputs", "valid-rows.jsonl");
    const invalidRowsPath = path.join(staging, "outputs", "invalid-rows.jsonl");
    const operationReportPath = path.join(staging, "tidas-operation-report.json");
    const compatibilityReport = {
      schema_version: 2,
      status: "completed",
      input_path: portableRelativePath(repoRoot, rowsFile),
      requested_type: String(options.type ?? options.datasetType ?? "auto"),
      dataset_type: String(options.type ?? options.datasetType ?? "auto"),
      engine: "tidas",
      binary_version: operation.binary_version,
      rows: manifest.map((entry, ordinal) => ({
        index: ordinal,
        id: entry.identity.dataset_id,
        version: entry.identity.dataset_version,
        type: String(options.type ?? options.datasetType ?? entry.category),
        status: invalidOrdinals.has(ordinal) ? "invalid" : "valid",
        issues: issuesByOrdinal.get(ordinal) ?? [],
      })),
      counts: {
        total: rows.length,
        valid: validRows.length,
        invalid: invalidRows.length,
        issues: Number(record(finalEvent.summary)?.issue_count ?? 0),
        blockers: invalidRows.length,
      },
      rust_contract: {
        operation_report_schema: TIDAS_OPERATION_REPORT_SCHEMA,
        batch_final_schema: TIDAS_VALIDATION_BATCH_FINAL_SCHEMA,
        protocol: finalEvent.protocol,
        profile: finalEvent.profile,
        logical_issue_stream_sha256: finalEvent.logical_issue_stream_sha256,
        asset_fingerprint: finalFingerprints?.asset_fingerprint ?? null,
        validation_describe_schema: TIDAS_VALIDATION_DESCRIBE_SCHEMA,
      },
      files: {
        report: portableRelativePath(
          repoRoot,
          path.join(outDir, "outputs", "validation-report.json"),
        ),
        valid_rows: portableRelativePath(
          repoRoot,
          path.join(outDir, "outputs", "valid-rows.jsonl"),
        ),
        invalid_rows: portableRelativePath(
          repoRoot,
          path.join(outDir, "outputs", "invalid-rows.jsonl"),
        ),
        events: portableRelativePath(repoRoot, path.join(outDir, "validation-events.jsonl")),
        manifest: portableRelativePath(repoRoot, path.join(outDir, "input-manifest.jsonl")),
        operation_report: portableRelativePath(
          repoRoot,
          path.join(outDir, "tidas-operation-report.json"),
        ),
      },
    };
    writeJson(reportPath, compatibilityReport);
    writeJsonl(validRowsPath, validRows);
    writeJsonl(invalidRowsPath, invalidRows);
    writeJson(operationReportPath, operation.report);
    replaceDirectoryAtomically(staging, outDir);
    return {
      ...operation,
      exit_code: invalidRows.length === 0 ? 0 : 2,
      report: compatibilityReport,
      report_file: path.join(outDir, "outputs", "validation-report.json"),
      rust_report: operation.report,
      rust_exit_code: operation.exit_code,
    };
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
}
