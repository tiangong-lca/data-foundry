import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defaultCanonicalFlowPropertyMappings } from "../lib/canonical-support-mappings.ts";

const defaultCanonicalSupportCacheFile = "specs/canonical-support/flow-properties-unit-groups.json";
const defaultMappingsFileName = "canonical-support-mappings.jsonl";
const defaultBlockedFileName = "canonical-support-blocked.manual-review.jsonl";
const defaultAutofillReportFileName = "canonical-support-mappings-report.json";

export function createSupportCacheCommands({
  asText,
  ensureArray,
  fileExists,
  nowIso,
  readJson,
  repoRelativePath,
  resolveRepoPath,
  supportText,
  writeJson,
}) {
  function readJsonLines(filePath) {
    const text = fs.readFileSync(filePath, "utf8").trim();
    return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line)) : [];
  }

  function writeJsonLines(filePath, rows) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    );
  }

  function deriveSupabaseProjectBaseUrl(apiBaseUrl) {
    const normalized = asText(apiBaseUrl).replace(/\/+$/u, "");
    if (normalized.endsWith("/functions/v1")) return normalized.replace(/\/functions\/v1$/u, "");
    if (normalized.endsWith("/rest/v1")) return normalized.replace(/\/rest\/v1$/u, "");
    if (/^https?:\/\/[^/]+$/u.test(normalized)) return normalized;
    throw new Error("Cannot derive Supabase project URL from TIANGONG_LCA_API_BASE_URL.");
  }

  function decodeUserApiKey(userApiKey) {
    try {
      const decoded = JSON.parse(Buffer.from(asText(userApiKey), "base64").toString("utf8"));
      const email = asText(decoded.email);
      const password = asText(decoded.password);
      if (!email || !password) throw new Error("missing email/password");
      return { email, password };
    } catch (error) {
      throw new Error(`Invalid TIANGONG_LCA_API_KEY user credentials: ${error}`);
    }
  }

  async function supabaseJsonRequest(url, init) {
    const response = await fetch(url, init);
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new Error(
          `Supabase request returned non-JSON ${response.status} ${response.statusText}: ${text.slice(
            0,
            300,
          )}`,
        );
      }
    }
    if (!response.ok) {
      throw new Error(`Supabase request failed ${response.status} ${response.statusText}: ${text}`);
    }
    return { response, payload };
  }

  async function signInSupabaseUser({ projectUrl, publishableKey, credentials }) {
    const { payload } = await supabaseJsonRequest(
      `${projectUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: publishableKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
        }),
      },
    );
    const accessToken = asText(payload?.access_token);
    const userId = asText(payload?.user?.id);
    if (!accessToken || !userId) {
      throw new Error("Supabase auth did not return access_token and user.id.");
    }
    return { accessToken, userId, email: credentials.email };
  }

  function supabaseRestHeaders({ publishableKey, accessToken, prefer = null }) {
    return {
      apikey: publishableKey,
      authorization: `Bearer ${accessToken}`,
      ...(prefer ? { prefer } : {}),
    };
  }

  async function fetchSupportCacheRows({
    projectUrl,
    publishableKey,
    accessToken,
    table,
    stateCode,
  }) {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const url = new URL(`${projectUrl}/rest/v1/${table}`);
      url.searchParams.set("select", "id,version,state_code,json");
      url.searchParams.set("state_code", `eq.${stateCode}`);
      url.searchParams.set("order", "id.asc,version.asc");
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(offset));
      const { payload } = await supabaseJsonRequest(url, {
        headers: supabaseRestHeaders({ publishableKey, accessToken }),
      });
      if (!Array.isArray(payload)) {
        throw new Error(`List rows failed for ${table}: response is not an array.`);
      }
      rows.push(...payload);
      if (payload.length < pageSize) break;
    }
    return rows;
  }

  function summarizeFlowPropertySupportRow(row) {
    const root = row?.json?.flowPropertyDataSet ?? {};
    const info = root.flowPropertiesInformation ?? {};
    const data = info.dataSetInformation ?? {};
    const referenceUnitGroup = info.quantitativeReference?.referenceToReferenceUnitGroup ?? {};
    return {
      id: asText(row?.id),
      version: asText(row?.version),
      state_code: typeof row?.state_code === "number" ? row.state_code : null,
      name: supportText(data["common:name"] ?? data["common:shortName"]),
      short_description: supportText(data["common:shortName"] ?? data["common:name"]),
      classification: supportText(
        data.classificationInformation?.["common:classification"]?.["common:class"],
      ),
      reference_unit_group: {
        id: asText(referenceUnitGroup["@refObjectId"]),
        version: asText(referenceUnitGroup["@version"]),
        short_description: supportText(referenceUnitGroup["common:shortDescription"]),
      },
    };
  }

  function summarizeUnitGroupSupportRow(row) {
    const root = row?.json?.unitGroupDataSet ?? {};
    const info = root.unitGroupInformation ?? {};
    const data = info.dataSetInformation ?? {};
    const units = ensureArray(root.units?.unit).map((unit) => ({
      internal_id: asText(unit?.["@dataSetInternalID"]),
      name: supportText(unit?.name ?? unit?.["common:name"]),
      mean_value: asText(unit?.meanValue),
    }));
    return {
      id: asText(row?.id),
      version: asText(row?.version),
      state_code: typeof row?.state_code === "number" ? row.state_code : null,
      name: supportText(data["common:name"] ?? data["common:shortName"]),
      short_description: supportText(data["common:shortName"] ?? data["common:name"]),
      classification: supportText(
        data.classificationInformation?.["common:classification"]?.["common:class"],
      ),
      reference_unit: info.quantitativeReference?.referenceToReferenceUnit ?? null,
      units,
    };
  }

  function normalizeSupportUnit(value) {
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

  function supportUnitCandidates(row) {
    const candidates = [];
    for (const unit of ensureArray(row?.source_units)) {
      candidates.push(unit?.name, unit?.short_description, unit);
    }
    candidates.push(row?.source_name, row?.source_reference_unit_group?.short_description);
    return [...new Set(candidates.map(extractSupportUnit).filter(Boolean))];
  }

  function extractSupportUnit(value) {
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

  function buildCanonicalSupportIndex(cache) {
    const flowPropertyById = new Map();
    const unitGroupById = new Map();
    const flowPropertyMappingByUnit = new Map();
    for (const row of ensureArray(cache?.flow_properties)) {
      const id = asText(row?.id);
      if (id) flowPropertyById.set(id, row);
    }
    for (const row of ensureArray(cache?.unit_groups)) {
      const id = asText(row?.id);
      if (id) unitGroupById.set(id, row);
    }
    for (const mapping of ensureArray(cache?.flow_property_mappings)) {
      const canonicalId = asText(mapping?.canonical_flow_property_id);
      if (!canonicalId) continue;
      for (const unit of ensureArray(mapping?.source_units)) {
        const key = normalizeSupportUnit(unit);
        if (key) flowPropertyMappingByUnit.set(key, { ...mapping, canonicalId });
      }
    }
    return { flowPropertyById, flowPropertyMappingByUnit, unitGroupById };
  }

  function supportShortDescription(row) {
    return supportText(row?.short_description ?? row?.name ?? row?.id);
  }

  function canonicalReferenceUnitGroup(flowProperty, index) {
    const reference = flowProperty?.reference_unit_group ?? {};
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

  function supportMappingEvidence({ row, unit, canonical, supportType, mapping }) {
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

  function mapSupportRow(row, index) {
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

  async function runDatasetSupportCacheRefresh(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-support-cache-refresh",
        usage: [
          "node scripts/foundry.mjs dataset-support-cache-refresh --out specs/canonical-support/flow-properties-unit-groups.json",
        ],
        purpose:
          "Refresh the small canonical Flow Properties and Unit Groups cache used to select existing database support rows instead of creating account-local support rows.",
        remote_write_mode: "read-only",
      };
    }

    const projectUrl = deriveSupabaseProjectBaseUrl(process.env.TIANGONG_LCA_API_BASE_URL);
    const publishableKey = asText(process.env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY);
    const credentials = decodeUserApiKey(process.env.TIANGONG_LCA_API_KEY);
    if (!publishableKey) {
      throw new Error("TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY is required.");
    }
    const session = await signInSupabaseUser({
      projectUrl,
      publishableKey,
      credentials,
    });
    const stateCode = Number(options.stateCode ?? 100);
    const outPath = resolveRepoPath(
      options.out || options.output || options.cacheFile || defaultCanonicalSupportCacheFile,
    );
    const existing = fileExists(outPath) ? readJson(outPath) : {};
    const [flowPropertyRows, unitGroupRows] = await Promise.all([
      fetchSupportCacheRows({
        projectUrl,
        publishableKey,
        accessToken: session.accessToken,
        table: "flowproperties",
        stateCode,
      }),
      fetchSupportCacheRows({
        projectUrl,
        publishableKey,
        accessToken: session.accessToken,
        table: "unitgroups",
        stateCode,
      }),
    ]);
    const cache = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      source: {
        table_state_code: stateCode,
        policy:
          "Flow Properties and Unit Groups are read-only support choices for Foundry imports; import rows must reference existing canonical DB rows instead of creating My Data support rows.",
      },
      flow_properties: flowPropertyRows.map(summarizeFlowPropertySupportRow),
      unit_groups: unitGroupRows.map(summarizeUnitGroupSupportRow),
      flow_property_mappings:
        ensureArray(existing.flow_property_mappings).length > 0
          ? existing.flow_property_mappings
          : defaultCanonicalFlowPropertyMappings(),
    };
    writeJson(outPath, cache);
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

  function runDatasetCanonicalSupportMappingsAutofill(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-canonical-support-mappings-autofill",
        usage: [
          "node scripts/foundry.mjs dataset-canonical-support-mappings-autofill --template <canonical-support-mappings.template.jsonl> --out-dir <decisions-dir>",
          "node scripts/foundry.mjs dataset-canonical-support-mappings-autofill --authoring-plan <authoring-plan-dir> --out-dir <decisions-dir>",
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
    const outDir = resolveRepoPath(options.outDir || options.out || path.dirname(templatePath));
    const mappingsPath = path.join(outDir, defaultMappingsFileName);
    const blockedPath = path.join(outDir, defaultBlockedFileName);
    const reportPath = path.join(outDir, defaultAutofillReportFileName);
    const templateRows = readJsonLines(templatePath);
    const cache = readJson(cachePath);
    const index = buildCanonicalSupportIndex(cache);
    const mappedRows = [];
    const blockedRows = [];
    const mappedUnits = new Set();
    const blockedUnits = new Set();

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
