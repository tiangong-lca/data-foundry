import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { readCliSupportExport, type CliSupportExport } from "../lib/cli-support-export.ts";
import type { TiangongLcaCliRuntimeCommand } from "../lib/foundry-runtime-utils.ts";
import { defaultCanonicalFlowPropertyMappings } from "../lib/canonical-support-mappings.ts";

type JsonRecord = Record<string, unknown>;

type SupportDatabaseRow = JsonRecord & {
  id?: unknown;
  version?: unknown;
  state_code?: unknown;
  json?: unknown;
};

type SupportSummaryRow = JsonRecord & {
  id?: unknown;
  version?: unknown;
  short_description?: unknown;
  name?: unknown;
  reference_unit_group?: unknown;
};

type SupportMapping = JsonRecord & {
  canonical_flow_property_id?: unknown;
  source_units?: unknown;
  reason?: unknown;
};

type SupportTemplateRow = JsonRecord & {
  support_type?: unknown;
  dataset_type?: unknown;
  type?: unknown;
  source_units?: unknown;
  source_name?: unknown;
  source_reference_unit_group?: unknown;
  source_support_id?: unknown;
  dataset_id?: unknown;
  id?: unknown;
  source_support_version?: unknown;
  dataset_version?: unknown;
  version?: unknown;
  source_entity_key?: unknown;
};

type SupportCache = JsonRecord & {
  flow_properties?: unknown;
  unit_groups?: unknown;
  flow_property_mappings?: unknown;
};

type CanonicalSupportIndex = {
  flowPropertyById: Map<string, SupportSummaryRow>;
  flowPropertyMappingByUnit: Map<string, SupportMapping & { canonicalId: string }>;
  unitGroupById: Map<string, SupportSummaryRow>;
};

type CanonicalSupportMapResult =
  | { mapped: JsonRecord; blocked?: never; unit: string }
  | { mapped?: never; blocked: SupportTemplateRow & JsonRecord; unit: string };

export type SupportCacheOptions = Record<string, unknown> & {
  help?: unknown;
  stateCode?: unknown;
  out?: unknown;
  output?: unknown;
  cacheFile?: unknown;
  authoringPlan?: unknown;
  authoringPlanDir?: unknown;
  template?: unknown;
  supportTemplate?: unknown;
  canonicalSupportTemplate?: unknown;
  canonicalSupportCache?: unknown;
  cache?: unknown;
  outDir?: unknown;
};

export type SupportCacheFactoryDependencies = {
  resolveTiangongLcaCliCommand: () => TiangongLcaCliRuntimeCommand;
  readSupportExport?: typeof readCliSupportExport;
  asText: (value: unknown) => string;
  ensureArray: <T>(value: T | T[] | null | undefined) => T[];
  fileExists: (filePath: string) => boolean;
  nowIso: () => string;
  readJson: (filePath: string) => SupportCache;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (value: unknown) => string | null;
  supportText: (value: unknown) => string;
  writeJson: (filePath: string, value: unknown) => unknown;
};

const defaultCanonicalSupportCacheFile = "specs/canonical-support/flow-properties-unit-groups.json";
const defaultMappingsFileName = "canonical-support-mappings.jsonl";
const defaultBlockedFileName = "canonical-support-blocked.manual-review.jsonl";
const defaultAutofillReportFileName = "canonical-support-mappings-report.json";

export function createSupportCacheCommands({
  resolveTiangongLcaCliCommand,
  readSupportExport = readCliSupportExport,
  asText,
  ensureArray,
  fileExists,
  nowIso,
  readJson,
  repoRelativePath,
  resolveRepoPath,
  supportText,
  writeJson,
}: SupportCacheFactoryDependencies) {
  function record(value: unknown): JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as JsonRecord)
      : {};
  }

  function readJsonLines(filePath: string): SupportTemplateRow[] {
    const text = fs.readFileSync(filePath, "utf8").trim();
    return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as SupportTemplateRow) : [];
  }

  function writeJsonLines(filePath: string, rows: JsonRecord[]): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    );
  }

  function summarizeFlowPropertySupportRow(row: SupportDatabaseRow): JsonRecord {
    const root = record(record(row.json).flowPropertyDataSet);
    const info = record(root.flowPropertiesInformation);
    const data = record(info.dataSetInformation);
    const referenceUnitGroup = record(
      record(info.quantitativeReference).referenceToReferenceUnitGroup,
    );
    return {
      id: asText(row?.id),
      version: asText(row?.version),
      state_code: typeof row?.state_code === "number" ? row.state_code : null,
      name: supportText(data["common:name"] ?? data["common:shortName"]),
      short_description: supportText(data["common:shortName"] ?? data["common:name"]),
      classification: supportText(
        record(record(data.classificationInformation)["common:classification"])["common:class"],
      ),
      reference_unit_group: {
        id: asText(referenceUnitGroup["@refObjectId"]),
        version: asText(referenceUnitGroup["@version"]),
        short_description: supportText(referenceUnitGroup["common:shortDescription"]),
      },
    };
  }

  function summarizeUnitGroupSupportRow(row: SupportDatabaseRow): JsonRecord {
    const root = record(record(row.json).unitGroupDataSet);
    const info = record(root.unitGroupInformation);
    const data = record(info.dataSetInformation);
    const units = ensureArray<JsonRecord>(
      record(root.units).unit as JsonRecord | JsonRecord[] | null | undefined,
    ).map((unit) => ({
      internal_id: asText(unit["@dataSetInternalID"]),
      name: supportText(unit.name ?? unit["common:name"]),
      mean_value: asText(unit.meanValue),
    }));
    return {
      id: asText(row?.id),
      version: asText(row?.version),
      state_code: typeof row?.state_code === "number" ? row.state_code : null,
      name: supportText(data["common:name"] ?? data["common:shortName"]),
      short_description: supportText(data["common:shortName"] ?? data["common:name"]),
      classification: supportText(
        record(record(data.classificationInformation)["common:classification"])["common:class"],
      ),
      reference_unit: record(info.quantitativeReference).referenceToReferenceUnit ?? null,
      units,
    };
  }

  function normalizeSupportUnit(value: unknown): string {
    return asText(value)
      .trim()
      .toLowerCase()
      .replace(/\s+/gu, "")
      .replace(/[·*]/gu, "*")
      .replace(/\byr\b/gu, "y")
      .replace(/\byear\b/gu, "y")
      .replace(/\byears\b/gu, "y")
      .replace(/\bpkm\b/gu, "personkm");
  }

  function supportUnitCandidates(row: SupportTemplateRow): string[] {
    const candidates: unknown[] = [];
    for (const unitValue of ensureArray(row.source_units)) {
      const unit = record(unitValue);
      candidates.push(unit.name, unit.short_description, unitValue);
    }
    candidates.push(row.source_name, record(row.source_reference_unit_group).short_description);
    return [...new Set(candidates.map(extractSupportUnit).filter(Boolean))];
  }

  function extractSupportUnit(value: unknown): string {
    const normalized = normalizeSupportUnit(value);
    if (!normalized) return "";
    const stripped = normalized
      .replace(/^amountin/u, "")
      .replace(/^unitsof/u, "")
      .replace(/^units?of/u, "")
      .replace(/^unit/u, "unit");
    if (stripped === "m3/y" || stripped === "m3pery" || stripped === "m3peryear") {
      return "m3y";
    }
    if (stripped === "m2/y" || stripped === "m2pery" || stripped === "m2peryear") {
      return "m2y";
    }
    return stripped;
  }

  function buildCanonicalSupportIndex(cache: SupportCache): CanonicalSupportIndex {
    const flowPropertyById = new Map<string, SupportSummaryRow>();
    const unitGroupById = new Map<string, SupportSummaryRow>();
    const flowPropertyMappingByUnit = new Map<string, SupportMapping & { canonicalId: string }>();
    for (const row of ensureArray<SupportSummaryRow>(
      cache.flow_properties as SupportSummaryRow | SupportSummaryRow[] | null | undefined,
    )) {
      const id = asText(row?.id);
      if (id) flowPropertyById.set(id, row);
    }
    for (const row of ensureArray<SupportSummaryRow>(
      cache.unit_groups as SupportSummaryRow | SupportSummaryRow[] | null | undefined,
    )) {
      const id = asText(row?.id);
      if (id) unitGroupById.set(id, row);
    }
    for (const mapping of ensureArray<SupportMapping>(
      cache.flow_property_mappings as SupportMapping | SupportMapping[] | null | undefined,
    )) {
      const canonicalId = asText(mapping?.canonical_flow_property_id);
      if (!canonicalId) continue;
      for (const unit of ensureArray(mapping.source_units)) {
        const key = normalizeSupportUnit(unit);
        if (key) flowPropertyMappingByUnit.set(key, { ...mapping, canonicalId });
      }
    }
    return { flowPropertyById, flowPropertyMappingByUnit, unitGroupById };
  }

  function supportShortDescription(row: SupportSummaryRow): string {
    return supportText(row?.short_description ?? row?.name ?? row?.id);
  }

  function canonicalReferenceUnitGroup(
    flowProperty: SupportSummaryRow,
    index: CanonicalSupportIndex,
  ): SupportSummaryRow | null {
    const reference = record(flowProperty.reference_unit_group);
    const id = asText(reference.id ?? reference.ref_object_id ?? reference["@refObjectId"]);
    if (!id) return null;
    return (
      index.unitGroupById.get(id) ?? {
        id,
        version: asText(reference.version ?? reference["@version"]),
        short_description: supportText(
          reference.short_description ?? reference["common:shortDescription"],
        ),
      }
    );
  }

  function supportMappingEvidence({
    row,
    unit,
    canonical,
    supportType,
    mapping,
  }: {
    row: SupportTemplateRow;
    unit: string;
    canonical: SupportSummaryRow;
    supportType: string;
    mapping: SupportMapping;
  }): string {
    const sourceName = supportText(row?.source_name) || row?.source_support_id;
    const canonicalDescription = supportShortDescription(canonical);
    return [
      `Source generated support '${sourceName}' uses unit '${unit}'.`,
      `Canonical '${canonicalDescription}' is selected through the public support cache mapping for the same physical unit/dimension.`,
      "Flowproperty/unitgroup support is reference-only for imports, so Foundry rewrites references to public canonical support instead of creating account-local support rows.",
      mapping?.reason ? `Policy basis: ${mapping.reason}` : null,
      supportType === "unitgroup"
        ? "The target unit group is the selected canonical flow property's reference unit group."
        : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  function mapSupportRow(
    row: SupportTemplateRow,
    index: CanonicalSupportIndex,
  ): CanonicalSupportMapResult {
    const supportType = asText(row?.support_type || row?.dataset_type || row?.type);
    const units = supportUnitCandidates(row);
    for (const unit of units) {
      const mapping = index.flowPropertyMappingByUnit.get(unit);
      if (!mapping) continue;
      const flowProperty = index.flowPropertyById.get(mapping.canonicalId);
      if (!flowProperty) continue;
      const canonical =
        supportType === "unitgroup"
          ? canonicalReferenceUnitGroup(flowProperty, index)
          : flowProperty;
      if (!canonical?.id) continue;
      return {
        mapped: {
          schema_version: 1,
          decision: "reuse_existing_reference",
          support_type: supportType,
          source_support_id: asText(row.source_support_id || row.dataset_id || row.id),
          source_support_version:
            asText(row.source_support_version || row.dataset_version || row.version) || "00.00.001",
          source_entity_key: asText(row.source_entity_key),
          source_name: supportText(row.source_name),
          canonical_support_id: asText(canonical.id),
          canonical_support_version: asText(canonical.version) || "03.00.003",
          canonical_short_description: supportShortDescription(canonical),
          physical_dimension_evidence: supportMappingEvidence({
            row,
            unit,
            canonical,
            supportType,
            mapping,
          }),
          basis:
            "Canonical support mapping from specs/canonical-support/flow-properties-unit-groups.json; units without proven physical equivalence remain blocked.",
          source_unit: unit,
        },
        unit,
      };
    }
    return {
      blocked: {
        ...row,
        decision: "block_unresolved",
        blocked_reason: "unit_physical_dimension_not_proven",
        candidate_units: units,
      },
      unit: units[0] ?? "unknown",
    };
  }

  async function runDatasetSupportCacheRefresh(options: SupportCacheOptions): Promise<JsonRecord> {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-support-cache-refresh",
        usage: [
          "node scripts/foundry.ts dataset-support-cache-refresh --out specs/canonical-support/flow-properties-unit-groups.json",
        ],
        purpose:
          "Refresh the small canonical Flow Properties and Unit Groups cache used to select existing database support rows instead of creating account-local support rows.",
        remote_write_mode: "read-only",
      };
    }

    const stateCode = Number(options.stateCode ?? 100);
    if (stateCode !== 100)
      throw new Error("Canonical support cache accepts public state_code=100 only.");
    const outPath = resolveRepoPath(
      options.out || options.output || options.cacheFile || defaultCanonicalSupportCacheFile,
    )!;
    const existing = fileExists(outPath) ? readJson(outPath) : {};
    const exported: CliSupportExport = readSupportExport({
      cli: resolveTiangongLcaCliCommand(),
      env: process.env,
    });
    const flowPropertyRows = exported.flowproperties;
    const unitGroupRows = exported.unitgroups;
    const existingMappings = ensureArray<JsonRecord>(
      existing.flow_property_mappings as JsonRecord | JsonRecord[] | null | undefined,
    );
    const flowPropertyMappings: JsonRecord[] =
      existingMappings.length > 0 ? existingMappings : defaultCanonicalFlowPropertyMappings();
    const cache = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      source: {
        table_state_code: stateCode,
        project_ref: exported.projectRef,
        cli_package: `@tiangong-lca/cli@${exported.cliVersion}`,
        policy:
          "Flow Properties and Unit Groups are read-only support choices for Foundry imports; import rows must reference existing canonical DB rows instead of creating My Data support rows.",
      },
      flow_properties: flowPropertyRows.map(summarizeFlowPropertySupportRow),
      unit_groups: unitGroupRows.map(summarizeUnitGroupSupportRow),
      flow_property_mappings: flowPropertyMappings,
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const staging = fs.mkdtempSync(path.join(path.dirname(outPath), ".support-cache-"));
    try {
      const pending = path.join(staging, "cache.json");
      writeJson(pending, cache);
      fs.renameSync(pending, outPath);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    return {
      schema_version: 1,
      generated_at_utc: cache.generated_at_utc,
      status: "completed",
      command: "dataset-support-cache-refresh",
      remote_write_mode: "read-only",
      files: {
        cache: repoRelativePath(outPath),
      },
      counts: {
        flow_properties: cache.flow_properties.length,
        unit_groups: cache.unit_groups.length,
        flow_property_mappings: cache.flow_property_mappings.length,
      },
    };
  }

  function runDatasetCanonicalSupportMappingsAutofill(options: SupportCacheOptions): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-canonical-support-mappings-autofill",
        usage: [
          "node scripts/foundry.ts dataset-canonical-support-mappings-autofill --template <canonical-support-mappings.template.jsonl> --out-dir <decisions-dir>",
          "node scripts/foundry.ts dataset-canonical-support-mappings-autofill --authoring-plan <authoring-plan-dir> --out-dir <decisions-dir>",
        ],
        purpose:
          "Generate high-confidence canonical-support-mappings.jsonl from generated support templates and the public canonical support cache; unresolved units are written to manual review.",
        remote_write_mode: "read-only",
      };
    }

    const authoringPlanDir = resolveRepoPath(options.authoringPlan || options.authoringPlanDir);
    const templatePath = resolveRepoPath(
      options.template ||
        options.supportTemplate ||
        options.canonicalSupportTemplate ||
        (authoringPlanDir
          ? path.join(authoringPlanDir, "canonical-support-mappings.template.jsonl")
          : null),
    );
    if (!templatePath || !fileExists(templatePath)) {
      throw new Error(
        "--template or --authoring-plan is required and must point to canonical-support-mappings.template.jsonl.",
      );
    }
    const cachePath = resolveRepoPath(
      options.canonicalSupportCache || options.cache || defaultCanonicalSupportCacheFile,
    );
    if (!cachePath || !fileExists(cachePath)) {
      throw new Error(
        "--canonical-support-cache must point to a readable canonical support cache.",
      );
    }
    const outDir = resolveRepoPath(options.outDir || options.out || path.dirname(templatePath))!;
    const mappingsPath = path.join(outDir, defaultMappingsFileName);
    const blockedPath = path.join(outDir, defaultBlockedFileName);
    const reportPath = path.join(outDir, defaultAutofillReportFileName);
    const templateRows = readJsonLines(templatePath);
    const cache = readJson(cachePath);
    const index = buildCanonicalSupportIndex(cache);
    const mappedRows: JsonRecord[] = [];
    const blockedRows: Array<SupportTemplateRow & JsonRecord> = [];
    const mappedUnits = new Set<string>();
    const blockedUnits = new Set<string>();

    for (const row of templateRows) {
      const result = mapSupportRow(row, index);
      if (result.mapped) {
        mappedRows.push(result.mapped);
        mappedUnits.add(result.unit);
      } else {
        blockedRows.push(result.blocked);
        blockedUnits.add(result.unit);
      }
    }

    writeJsonLines(mappingsPath, mappedRows);
    writeJsonLines(blockedPath, blockedRows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedRows.length ? "completed_with_manual_blocks" : "completed",
      command: "dataset-canonical-support-mappings-autofill",
      remote_write_mode: "read-only",
      counts: {
        template_rows: templateRows.length,
        mapped_rows: mappedRows.length,
        blocked_rows: blockedRows.length,
      },
      mapped_units: [...mappedUnits].sort(),
      blocked_units: [...blockedUnits].sort(),
      files: {
        template: repoRelativePath(templatePath),
        canonical_support_cache: repoRelativePath(cachePath),
        mappings: repoRelativePath(mappingsPath),
        blocked: repoRelativePath(blockedPath),
        report: repoRelativePath(reportPath),
      },
      blockers: blockedRows.slice(0, 20).map((row) => ({
        code: "unit_physical_dimension_not_proven",
        support_type: row.support_type,
        source_support_id: row.source_support_id,
        source_name: row.source_name,
        candidate_units: row.candidate_units,
        required_action:
          "Select a public canonical flowproperty/unitgroup with physical-dimension evidence, or leave affected scopes deferred.",
      })),
    };
    writeJson(reportPath, report);
    return report;
  }

  return { runDatasetSupportCacheRefresh, runDatasetCanonicalSupportMappingsAutofill };
}
