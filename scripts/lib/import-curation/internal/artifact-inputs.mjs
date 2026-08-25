import path from "node:path";
import { asText, ensureArray, fileExists, readJsonOrJsonl, resolveRepoPath } from "./runtime-io.ts";

export function idFromArtifactFile(fileName) {
  const base = path.basename(String(fileName ?? ""));
  const withoutExt = base.replace(/\.json$/u, "").replace(/\.jsonl$/u, "");
  return withoutExt.split("__")[0] || "";
}

export function entityIdFromFinding(finding, datasetType) {
  if (!finding || typeof finding !== "object") return "";
  const directKeys = [`${datasetType}_id`, "entity_id", "dataset_id", "row_id", "id"];
  for (const key of directKeys) {
    const value = asText(finding[key]);
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
    const value = idFromArtifactFile(finding[key]);
    if (value) return value;
  }
  return "";
}

export function readJsonLinesIfExists(filePath) {
  if (!filePath || !fileExists(filePath)) return [];
  const parsed = readJsonOrJsonl(filePath);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.findings)) return parsed.findings;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  return [];
}

export function resolveArtifactPath(repoRoot, filePath, baseDir) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  const fromBase = path.resolve(baseDir, filePath);
  if (fileExists(fromBase)) return fromBase;
  return resolveRepoPath(repoRoot, filePath);
}

export function qaFindingCode(finding) {
  return (
    asText(finding?.code ?? finding?.rule_code ?? finding?.rule_id ?? finding?.id) || "qa_finding"
  );
}

export const qaFindingPathDefaults = {
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

export function qaFindingPath(finding, datasetType) {
  return (
    asText(finding?.path ?? finding?.field_path ?? finding?.fieldPath) ||
    qaFindingPathDefaults[datasetType]?.[qaFindingCode(finding)] ||
    null
  );
}

export function qaFindingInstruction(finding, datasetType) {
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

export function qaFindingCurationAction(finding, datasetType) {
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

export function readQaFindings(repoRoot, qaReport, qaReportPath, datasetType) {
  const qaReportDir = path.dirname(qaReportPath);
  const fileRefs = [
    qaReport?.files?.rule_findings,
    qaReport?.files?.findings,
    qaReport?.files?.llm_findings,
  ].filter(Boolean);
  const findings = [];
  for (const fileRef of fileRefs) {
    const resolved = resolveArtifactPath(repoRoot, fileRef, qaReportDir);
    findings.push(...readJsonLinesIfExists(resolved));
  }
  findings.push(...ensureArray(qaReport?.ruleset_gate?.blockers));
  findings.push(...ensureArray(qaReport?.blockers));
  findings.push(...ensureArray(qaReport?.findings));
  const deduped = [];
  const seen = new Set();
  for (const finding of findings) {
    if (!finding || typeof finding !== "object") continue;
    const key = JSON.stringify([
      entityIdFromFinding(finding, datasetType),
      qaFindingCode(finding),
      finding.path ?? null,
      finding.message ?? null,
      finding.evidence ?? null,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}
