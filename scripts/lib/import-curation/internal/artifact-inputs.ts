import path from "node:path";
import { asText, ensureArray, fileExists, readJsonOrJsonl, resolveRepoPath } from "./runtime-io.ts";

type JsonRecord = Record<string, unknown>;

function asJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export type QaFinding = JsonRecord;

export type QaCurationAction = {
  source: string;
  code: string;
  path: string | null;
  message: unknown;
  evidence: unknown;
  instruction: string | null;
  action_kind: "ai_authoring";
  required_owner: "foundry_ai_authoring";
  ai_required: true;
};

export function idFromArtifactFile(fileName: unknown): string {
  const base = path.basename(String(fileName ?? ""));
  const withoutExt = base.replace(/\.json$/u, "").replace(/\.jsonl$/u, "");
  return withoutExt.split("__")[0] || "";
}

export function entityIdFromFinding(finding: unknown, datasetType: string): string {
  if (!finding || typeof finding !== "object") return "";
  const findingRecord = finding as JsonRecord;
  const directKeys = [`${datasetType}_id`, "entity_id", "dataset_id", "row_id", "id"];
  for (const key of directKeys) {
    const value = asText(findingRecord[key]);
    if (value) return value;
  }
  const fileKeys = [
    `${datasetType}_file`,
    "process_file",
    "flow_file",
    "lifecyclemodel_file",
    "model_file",
    "file",
  ];
  for (const key of fileKeys) {
    const value = idFromArtifactFile(findingRecord[key]);
    if (value) return value;
  }
  return "";
}

export function readJsonLinesIfExists(filePath: string | null | undefined): unknown[] {
  if (!filePath || !fileExists(filePath)) return [];
  const parsed = readJsonOrJsonl(filePath);
  if (Array.isArray(parsed)) return parsed;
  const record = asJsonRecord(parsed);
  if (Array.isArray(record?.findings)) return record.findings;
  if (Array.isArray(record?.rows)) return record.rows;
  return [];
}

export function resolveArtifactPath(
  repoRoot: string,
  filePath: string | null | undefined,
  baseDir: string,
): string | null {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  const fromBase = path.resolve(baseDir, filePath);
  if (fileExists(fromBase)) return fromBase;
  return resolveRepoPath(repoRoot, filePath);
}

export function qaFindingCode(finding: QaFinding | null | undefined): string {
  return (
    asText(finding?.code ?? finding?.rule_code ?? finding?.rule_id ?? finding?.id) || "qa_finding"
  );
}

export const qaFindingPathDefaults: Record<string, Record<string, string>> = {
  process: {
    process_missing_source_base_name:
      "processDataSet.processInformation.dataSetInformation.name.baseName",
    process_missing_functional_unit:
      "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther",
    process_missing_system_boundary:
      "processDataSet.processInformation.dataSetInformation.common:generalComment",
    process_missing_time: "processDataSet.processInformation.time.common:referenceYear",
    process_missing_geography:
      "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction",
    process_missing_technology:
      "processDataSet.processInformation.technology.technologyDescriptionAndIncludedProcesses",
  },
  flow: {
    flow_missing_base_name: "flowDataSet.flowInformation.dataSetInformation.name.baseName",
    flow_missing_classification:
      "flowDataSet.flowInformation.dataSetInformation.classificationInformation",
    flow_missing_reference_flow_property:
      "flowDataSet.flowInformation.quantitativeReference.referenceToReferenceFlowProperty",
  },
  lifecyclemodel: {
    lifecyclemodel_missing_functional_unit:
      "lifeCycleModelDataSet.lifeCycleModelInformation.quantitativeReference.functionalUnitOrOther",
    lifecyclemodel_missing_reference_process:
      "lifeCycleModelDataSet.lifeCycleModelInformation.quantitativeReference.referenceToReferenceProcess",
  },
};

export function qaFindingPath(
  finding: QaFinding | null | undefined,
  datasetType: string,
): string | null {
  return (
    asText(finding?.path ?? finding?.field_path ?? finding?.fieldPath) ||
    qaFindingPathDefaults[datasetType]?.[qaFindingCode(finding)] ||
    null
  );
}

export function qaFindingInstruction(
  finding: QaFinding | null | undefined,
  datasetType: string,
): string | null {
  const code = qaFindingCode(finding);
  if (datasetType === "process" && code === "process_missing_functional_unit") {
    return "Use the source row, reference exchange, source unit, process name, SDK schema, and methodology YAML quantitativeReference rules to write source-language functionalUnitOrOther. Do not invent a value when source evidence is absent.";
  }
  if (datasetType === "process" && code === "process_missing_source_base_name") {
    return "Use source-language evidence, methodology YAML naming rules, and full task context to write name.baseName without placeholder tokens or geography braces. Preserve the source-language variant and add English for TIDAS-required multilingual fields before write planning.";
  }
  if (datasetType === "process" && code === "process_missing_geography") {
    return "Use source geography evidence and the TIDAS location code workflow before writing location fields.";
  }
  if (datasetType === "process" && code === "process_missing_time") {
    return "Use source temporal coverage evidence to fill the process reference year or leave the action item unresolved if no source-backed year exists.";
  }
  return asText(finding?.instruction) || null;
}

export function qaFindingCurationAction(finding: QaFinding, datasetType: string): QaCurationAction {
  return {
    source: `${datasetType}_qa`,
    code: qaFindingCode(finding),
    path: qaFindingPath(finding, datasetType),
    message: finding.message ?? null,
    evidence: finding.evidence ?? null,
    instruction: qaFindingInstruction(finding, datasetType),
    action_kind: "ai_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
  };
}

export function readQaFindings(
  repoRoot: string,
  qaReport: unknown,
  qaReportPath: string,
  datasetType: string,
): QaFinding[] {
  const qaReportDir = path.dirname(qaReportPath);
  const report = asJsonRecord(qaReport);
  const reportFiles = asJsonRecord(report.files);
  const rulesetGate = asJsonRecord(report.ruleset_gate);
  const fileRefs = [
    reportFiles.rule_findings,
    reportFiles.findings,
    reportFiles.llm_findings,
  ].filter(Boolean);
  const findings: unknown[] = [];
  for (const fileRef of fileRefs) {
    const resolved = resolveArtifactPath(repoRoot, fileRef as string, qaReportDir);
    findings.push(...readJsonLinesIfExists(resolved));
  }
  findings.push(...ensureArray(rulesetGate.blockers));
  findings.push(...ensureArray(report.blockers));
  findings.push(...ensureArray(report.findings));
  const deduped: QaFinding[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    if (!finding || typeof finding !== "object") continue;
    const findingRecord = finding as QaFinding;
    const key = JSON.stringify([
      entityIdFromFinding(findingRecord, datasetType),
      qaFindingCode(findingRecord),
      findingRecord.path ?? null,
      findingRecord.message ?? null,
      findingRecord.evidence ?? null,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(findingRecord);
  }
  return deduped;
}
