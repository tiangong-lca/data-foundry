import path from "node:path";

export interface JsonRecord {
  [key: string]: unknown;
}

export interface DatasetIdentity {
  id: string;
  version: string;
}

export interface EntityReference extends JsonRecord {
  entity_key?: string;
  id?: string;
  version?: string;
  dataset_id?: string;
  dataset_version?: string;
}

export interface EntityRow extends JsonRecord {
  entity_key: string;
  dataset_type: string;
  dataset_id: string;
  dataset_version: string;
  source_kind?: string;
  source_file: string;
  source_files?: string[];
  payload?: JsonRecord;
  flow_type?: string | null;
  flow_property_refs?: EntityReference[];
  reference_unit_group?: EntityReference | null;
  units?: JsonRecord[];
  names?: string[];
  classification_path?: unknown;
  payload_sha256?: string;
  payload_hashes?: unknown[];
}

export interface ScopeProjection extends JsonRecord {
  process_id: string;
  process_version: string;
  process_entity_key: string;
  bundle_id?: string;
  bundle_dir?: string;
  manifest?: string;
  tidas_dir?: string;
  dependency_ids: {
    flows: EntityReference[];
    flowproperties: EntityReference[];
    unitgroups: EntityReference[];
  };
  usage_refs: {
    process_exchange_flow_refs: EntityReference[];
  };
  unresolved_references?: unknown[];
}

export interface BundleEntry extends JsonRecord {
  process_id: string;
  bundle_id: string;
  bundle_dir: string;
  manifest: string;
  tidas_dir: string;
}

export interface ProcessExchangeReference extends EntityReference {
  flow_id: string;
  flow_version: string;
  exchange_index: number;
}

export interface EntityMaps {
  byKey: Map<string, EntityRow>;
  byTypeId: Map<string, EntityRow>;
}

export type IndexedEntityType = "process" | "flow" | "flowproperty" | "unitgroup";

export interface EntitySourceFile {
  type: IndexedEntityType;
  sourceFile: string;
  sourceKind: string;
}

interface ReferenceRow extends JsonRecord {
  path: string;
  type: string;
  id: string;
  version: string;
  short_description: string;
}

interface PayloadFile {
  filePath: string;
  payload: JsonRecord;
}

interface BundlePayloads {
  manifest: JsonRecord;
  payloads: Record<IndexedEntityType, PayloadFile[]>;
}

interface EntityRowInput {
  payload: JsonRecord;
  type: IndexedEntityType;
  sourceFile: string;
  sourceKind: string;
}

interface DependencyReference extends EntityReference {
  id: string;
  version: string;
  source: string;
}

export interface LibraryProjectionFileReader {
  fileExists: (filePath: string | null | undefined) => boolean;
  readJson: (filePath: string) => JsonRecord;
}

export interface LibraryEntityProjectionDependencies {
  asText: (value: unknown) => string;
  bundleClassificationPath: (payload: unknown, datasetType: string) => unknown;
  datasetIdentity: (row: unknown, datasetType: string) => DatasetIdentity;
  ensureArray: <T>(value: T | readonly T[] | null | undefined) => T[];
  flowTypeOfDataSet: (payload: unknown) => string;
  jsonSha256: (value: unknown) => string;
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  sha256Text: (value: unknown) => string;
  textValue: (value: unknown) => string;
  files: LibraryProjectionFileReader;
}

export interface LibraryEntityProjection {
  buildEntityIndex: (files: readonly EntitySourceFile[]) => EntityRow[];
  entityMaps: (entityRows: EntityRow[]) => EntityMaps;
  rootEntityForRef: (
    maps: EntityMaps,
    type: string,
    id: string,
    version?: string,
  ) => EntityRow | null;
  projectionForBundle: (bundle: BundleEntry, maps: EntityMaps) => ScopeProjection;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

export function createLibraryEntityProjection({
  asText,
  bundleClassificationPath,
  datasetIdentity,
  ensureArray,
  flowTypeOfDataSet,
  jsonSha256,
  repoRelativeMaybe,
  repoRelativePath,
  sha256Text,
  textValue,
  files,
}: LibraryEntityProjectionDependencies): LibraryEntityProjection {
  const indexedEntityTypes: readonly IndexedEntityType[] = [
    "process",
    "flow",
    "flowproperty",
    "unitgroup",
  ];
  const typePlural: Record<IndexedEntityType, string> = {
    process: "processes",
    flow: "flows",
    flowproperty: "flowproperties",
    unitgroup: "unitgroups",
  };

  function normalizedText(value: unknown): string {
    return String(value ?? "")
      .trim()
      .replace(/\s+/gu, " ")
      .toLowerCase();
  }

  function datasetDataSetInformation(payload: JsonRecord, type: string): JsonRecord {
    if (type === "flow") {
      return jsonRecord(
        jsonRecord(jsonRecord(payload.flowDataSet).flowInformation).dataSetInformation,
      );
    }
    if (type === "process") {
      return jsonRecord(
        jsonRecord(jsonRecord(payload.processDataSet).processInformation).dataSetInformation,
      );
    }
    if (type === "flowproperty") {
      return jsonRecord(
        jsonRecord(jsonRecord(payload.flowPropertyDataSet).flowPropertiesInformation)
          .dataSetInformation,
      );
    }
    if (type === "unitgroup") {
      return jsonRecord(
        jsonRecord(jsonRecord(payload.unitGroupDataSet).unitGroupInformation).dataSetInformation,
      );
    }
    return {};
  }

  function datasetName(payload: JsonRecord, type: string): string {
    const info = datasetDataSetInformation(payload, type);
    if (type === "flow" || type === "process") {
      const name = jsonRecord(info.name);
      return [
        textValue(name.baseName),
        textValue(name.treatmentStandardsRoutes),
        textValue(name.mixAndLocationTypes),
        textValue(name.functionalUnitFlowProperties),
        textValue(info["common:shortName"]),
      ]
        .filter(Boolean)
        .join("; ");
    }
    return textValue(info["common:name"] ?? info["common:shortName"]);
  }

  function referenceRows(
    value: unknown,
    pathSegments: Array<string | number> = [],
  ): ReferenceRow[] {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => referenceRows(item, [...pathSegments, index]));
    }
    const record = jsonRecord(value);
    const rows: ReferenceRow[] = [];
    if (record["@refObjectId"]) {
      rows.push({
        path: pathSegments.join("."),
        type: asText(record["@type"]),
        id: asText(record["@refObjectId"]),
        version: asText(record["@version"]) || "00.00.001",
        short_description: textValue(record["common:shortDescription"]),
      });
    }
    for (const [key, child] of Object.entries(record)) {
      rows.push(...referenceRows(child, [...pathSegments, key]));
    }
    return rows;
  }

  function classificationPath(payload: JsonRecord, type: string): unknown {
    if (type === "flow") {
      const info = datasetDataSetInformation(payload, type);
      const categories = jsonRecord(
        jsonRecord(info.classificationInformation)["common:elementaryFlowCategorization"],
      )["common:category"];
      const elementaryPath = ensureArray(categories)
        .map((entry) => textValue(entry))
        .filter(Boolean)
        .join(" > ");
      if (elementaryPath) return elementaryPath;
    }
    return bundleClassificationPath(payload, type);
  }

  function unitGroupUnits(payload: JsonRecord): JsonRecord[] {
    const units = jsonRecord(jsonRecord(payload.unitGroupDataSet).units).unit;
    return ensureArray(units)
      .map((value) => jsonRecord(value))
      .map((unit) => ({
        internal_id: asText(unit["@dataSetInternalID"]),
        name: textValue(unit.name ?? unit["common:name"]),
        mean_value: asText(unit.meanValue),
      }))
      .filter((unit) => unit.name || unit.internal_id);
  }

  function flowPropertyReferenceUnitGroup(payload: JsonRecord): EntityReference {
    const flowPropertiesInformation = jsonRecord(
      jsonRecord(payload.flowPropertyDataSet).flowPropertiesInformation,
    );
    const ref = jsonRecord(
      jsonRecord(flowPropertiesInformation.quantitativeReference).referenceToReferenceUnitGroup,
    );
    return {
      id: asText(ref["@refObjectId"]),
      version: asText(ref["@version"]) || "00.00.001",
      short_description: textValue(ref["common:shortDescription"]),
    };
  }

  function flowPropertyRefs(payload: JsonRecord): EntityReference[] {
    const properties = jsonRecord(jsonRecord(payload.flowDataSet).flowProperties).flowProperty;
    return ensureArray(properties)
      .map((value) => jsonRecord(value))
      .map((property) => {
        const ref = jsonRecord(property.referenceToFlowPropertyDataSet);
        return {
          id: asText(ref["@refObjectId"]),
          version: asText(ref["@version"]) || "00.00.001",
          short_description: textValue(ref["common:shortDescription"]),
          internal_id: asText(property["@dataSetInternalID"]),
          mean_value: asText(property.meanValue),
        };
      })
      .filter((ref) => ref.id);
  }

  function processExchangeRefs(payload: JsonRecord): ProcessExchangeReference[] {
    const exchanges = jsonRecord(jsonRecord(payload.processDataSet).exchanges).exchange;
    return ensureArray(exchanges)
      .map((value) => jsonRecord(value))
      .map((exchange, index) => {
        const ref = jsonRecord(exchange.referenceToFlowDataSet);
        return {
          exchange_index: index,
          flow_id: asText(ref["@refObjectId"]),
          flow_version: asText(ref["@version"]) || "00.00.001",
          direction: asText(exchange.exchangeDirection),
          amount: asText(exchange.meanAmount ?? exchange.resultingAmount),
          short_description: textValue(ref["common:shortDescription"]),
        };
      })
      .filter((ref) => ref.flow_id);
  }

  function entitySemanticKey(payload: JsonRecord, type: string): string {
    const info = datasetDataSetInformation(payload, type);
    const parts = [
      type,
      datasetName(payload, type),
      type === "flow" ? flowTypeOfDataSet(payload) : "",
      type === "flow" ? asText(info.CASNumber) : "",
      classificationPath(payload, type),
      type === "flowproperty" ? flowPropertyReferenceUnitGroup(payload).short_description : "",
      type === "unitgroup"
        ? unitGroupUnits(payload)
            .map((unit) => unit.name)
            .join(",")
        : "",
    ].map(normalizedText);
    return parts.filter(Boolean).join("|");
  }

  function entityRowFromPayload({
    payload,
    type,
    sourceFile,
    sourceKind,
  }: EntityRowInput): EntityRow {
    const identity = datasetIdentity(payload, type);
    const id = identity.id || path.basename(sourceFile, ".json");
    const version = identity.version || "00.00.001";
    const flowType = type === "flow" ? flowTypeOfDataSet(payload) : null;
    const row: EntityRow = {
      schema_version: 1,
      entity_key: `${type}:${id}:${version}`,
      dataset_type: type,
      dataset_id: id,
      dataset_version: version,
      source_kind: sourceKind,
      source_file: repoRelativePath(sourceFile),
      payload_sha256: jsonSha256(payload),
      semantic_key: entitySemanticKey(payload, type),
      semantic_hash: sha256Text(entitySemanticKey(payload, type)),
      name: datasetName(payload, type),
      classification_path: classificationPath(payload, type),
      flow_type: flowType,
      reference_only:
        type === "unitgroup" ||
        type === "flowproperty" ||
        (type === "flow" && /^elementary flow$/iu.test(flowType ?? "")),
      references: referenceRows(payload),
    };
    if (type === "flow") row.flow_property_refs = flowPropertyRefs(payload);
    if (type === "flowproperty") {
      row.reference_unit_group = flowPropertyReferenceUnitGroup(payload);
    }
    if (type === "unitgroup") row.units = unitGroupUnits(payload);
    return row;
  }

  function addEntityRow(rowMap: Map<string, EntityRow>, row: EntityRow): void {
    const existing = rowMap.get(row.entity_key);
    if (!existing) {
      rowMap.set(row.entity_key, { ...row, source_files: [row.source_file] });
      return;
    }
    existing.source_files ??= [];
    existing.source_files.push(row.source_file ?? "");
    existing.duplicate_source_file_count = existing.source_files.length;
    existing.payload_hashes = [
      ...new Set([...(existing.payload_hashes ?? [existing.payload_sha256]), row.payload_sha256]),
    ];
  }

  function buildEntityIndex(sourceFiles: readonly EntitySourceFile[]): EntityRow[] {
    const rowMap = new Map<string, EntityRow>();
    for (const source of sourceFiles) {
      addEntityRow(
        rowMap,
        entityRowFromPayload({
          payload: files.readJson(source.sourceFile),
          type: source.type,
          sourceFile: source.sourceFile,
          sourceKind: source.sourceKind,
        }),
      );
    }
    return [...rowMap.values()].sort((left, right) =>
      left.entity_key.localeCompare(right.entity_key),
    );
  }

  function entityMaps(entityRows: EntityRow[]): EntityMaps {
    const byKey = new Map(entityRows.map((row) => [row.entity_key, row]));
    const byTypeId = new Map<string, EntityRow>();
    for (const row of entityRows) {
      byTypeId.set(`${row.dataset_type}:${row.dataset_id}`, row);
      byTypeId.set(`${row.dataset_type}:${row.dataset_id}:${row.dataset_version}`, row);
    }
    return { byKey, byTypeId };
  }

  function bundlePayloadsFromManifest(bundle: BundleEntry): BundlePayloads {
    const manifest = files.fileExists(bundle.manifest) ? files.readJson(bundle.manifest) : {};
    const payloads: Record<IndexedEntityType, PayloadFile[]> = {
      process: [],
      flow: [],
      flowproperty: [],
      unitgroup: [],
    };
    for (const type of indexedEntityTypes) {
      const plural = typePlural[type];
      for (const relativeFile of ensureArray(jsonRecord(manifest.files)[plural]).map(asText)) {
        const filePath = path.join(bundle.bundle_dir, relativeFile);
        if (!files.fileExists(filePath)) continue;
        payloads[type].push({ filePath, payload: files.readJson(filePath) });
      }
    }
    return { manifest, payloads };
  }

  function entityKeyForRef(type: string, id: string, version = "00.00.001"): string {
    return `${type}:${id}:${version || "00.00.001"}`;
  }

  function rootEntityForRef(
    maps: EntityMaps,
    type: string,
    id: string,
    version = "00.00.001",
  ): EntityRow | null {
    return (
      maps.byKey.get(entityKeyForRef(type, id, version)) ||
      maps.byTypeId.get(`${type}:${id}:${version}`) ||
      maps.byTypeId.get(`${type}:${id}`) ||
      null
    );
  }

  function projectionForBundle(bundle: BundleEntry, maps: EntityMaps): ScopeProjection {
    const { manifest, payloads } = bundlePayloadsFromManifest(bundle);
    const fallbackProcessFile = path.join(
      bundle.tidas_dir,
      "processes",
      `${bundle.process_id}.json`,
    );
    const processPayload =
      payloads.process[0]?.payload ||
      (files.fileExists(fallbackProcessFile) ? files.readJson(fallbackProcessFile) : null);
    const processIdentity = processPayload
      ? datasetIdentity(processPayload, "process")
      : { id: bundle.process_id, version: "00.00.001" };
    const processId = processIdentity.id || bundle.process_id;
    const processVersion = processIdentity.version || "00.00.001";
    const processEntity =
      rootEntityForRef(maps, "process", processId, processVersion) ||
      (processPayload
        ? entityRowFromPayload({
            payload: processPayload,
            type: "process",
            sourceFile: payloads.process[0]?.filePath || bundle.manifest,
            sourceKind: "bundle_fallback",
          })
        : null);
    const flowDeps = new Map<string, DependencyReference>();
    const flowPropertyDeps = new Map<string, DependencyReference>();
    const unitGroupDeps = new Map<string, DependencyReference>();
    const exchangeRefs = processPayload ? processExchangeRefs(processPayload) : [];

    for (const flow of payloads.flow) {
      const identity = datasetIdentity(flow.payload, "flow");
      if (identity.id) {
        flowDeps.set(identity.id, {
          id: identity.id,
          version: identity.version || "00.00.001",
          source: "bundle_manifest",
        });
      }
    }
    for (const ref of exchangeRefs) {
      flowDeps.set(ref.flow_id, {
        id: ref.flow_id,
        version: ref.flow_version,
        source: "process_exchange",
        exchange_index: ref.exchange_index,
      });
    }

    for (const dependency of flowDeps.values()) {
      const rootFlow = rootEntityForRef(maps, "flow", dependency.id, dependency.version);
      for (const flowProperty of ensureArray(rootFlow?.flow_property_refs)) {
        if (!flowProperty.id) continue;
        flowPropertyDeps.set(flowProperty.id, {
          id: flowProperty.id,
          version: flowProperty.version || "00.00.001",
          source: "flow_property_ref",
          parent_flow_id: dependency.id,
        });
      }
    }
    for (const flowProperty of payloads.flowproperty) {
      const identity = datasetIdentity(flowProperty.payload, "flowproperty");
      if (identity.id) {
        flowPropertyDeps.set(identity.id, {
          id: identity.id,
          version: identity.version || "00.00.001",
          source: "bundle_manifest",
        });
      }
    }
    for (const dependency of flowPropertyDeps.values()) {
      const rootFlowProperty = rootEntityForRef(
        maps,
        "flowproperty",
        dependency.id,
        dependency.version,
      );
      const unitGroup = rootFlowProperty?.reference_unit_group;
      if (unitGroup?.id) {
        unitGroupDeps.set(unitGroup.id, {
          id: unitGroup.id,
          version: unitGroup.version || "00.00.001",
          source: "flowproperty_reference_unit_group",
          parent_flow_property_id: dependency.id,
        });
      }
    }
    for (const unitGroup of payloads.unitgroup) {
      const identity = datasetIdentity(unitGroup.payload, "unitgroup");
      if (identity.id) {
        unitGroupDeps.set(identity.id, {
          id: identity.id,
          version: identity.version || "00.00.001",
          source: "bundle_manifest",
        });
      }
    }

    const flowDependencyRows = [...flowDeps.values()].map((dependency) => {
      const entity = rootEntityForRef(maps, "flow", dependency.id, dependency.version);
      return {
        ...dependency,
        entity_key:
          entity?.entity_key ?? entityKeyForRef("flow", dependency.id, dependency.version),
        flow_type: entity?.flow_type ?? null,
        reference_only: Boolean(entity?.reference_only),
      };
    });
    const flowPropertyDependencyRows = [...flowPropertyDeps.values()].map((dependency) => {
      const entity = rootEntityForRef(maps, "flowproperty", dependency.id, dependency.version);
      return {
        ...dependency,
        entity_key:
          entity?.entity_key ?? entityKeyForRef("flowproperty", dependency.id, dependency.version),
        reference_only: true,
      };
    });
    const unitGroupDependencyRows = [...unitGroupDeps.values()].map((dependency) => {
      const entity = rootEntityForRef(maps, "unitgroup", dependency.id, dependency.version);
      return {
        ...dependency,
        entity_key:
          entity?.entity_key ?? entityKeyForRef("unitgroup", dependency.id, dependency.version),
        reference_only: true,
      };
    });

    return {
      schema_version: 1,
      process_id: processId,
      process_version: processVersion,
      process_entity_key:
        processEntity?.entity_key ?? entityKeyForRef("process", processId, processVersion),
      process_file: repoRelativeMaybe(payloads.process[0]?.filePath),
      bundle_dir: repoRelativePath(bundle.bundle_dir),
      manifest: repoRelativePath(bundle.manifest),
      tidas_dir: repoRelativePath(bundle.tidas_dir),
      dependency_ids: {
        flows: flowDependencyRows,
        flowproperties: flowPropertyDependencyRows,
        unitgroups: unitGroupDependencyRows,
      },
      usage_refs: {
        process_exchange_flow_refs: exchangeRefs,
      },
      estimated_weight:
        1 +
        flowDependencyRows.length +
        flowPropertyDependencyRows.length +
        unitGroupDependencyRows.length +
        exchangeRefs.length,
      closure_status: "planned",
      unresolved_references: ensureArray(manifest.unresolved_references),
    };
  }

  return { buildEntityIndex, entityMaps, rootEntityForRef, projectionForBundle };
}
