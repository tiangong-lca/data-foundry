import { asText } from "./runtime-io.ts";

type JsonRecord = Record<string, unknown>;

interface ClassificationValues extends JsonRecord {
  "common:class"?: JsonRecord | JsonRecord[];
  "common:category"?: JsonRecord | JsonRecord[];
  class?: JsonRecord | JsonRecord[];
  category?: JsonRecord | JsonRecord[];
}

interface ClassificationInformation extends JsonRecord {
  "common:classification"?: ClassificationValues;
  classification?: ClassificationValues;
  "common:elementaryFlowCategorization"?: ClassificationValues;
  elementaryFlowCategorization?: ClassificationValues;
}

export interface DatasetInformationRecord extends JsonRecord {
  name?: JsonRecord;
  classificationInformation?: ClassificationInformation;
}

interface InformationContainer extends JsonRecord {
  dataSetInformation?: DatasetInformationRecord;
  geography?: JsonRecord;
}

interface ModellingAndValidation extends JsonRecord {
  LCIMethod?: JsonRecord;
  LCIMethodAndAllocation?: JsonRecord;
  dataSourcesTreatmentAndRepresentativeness?: JsonRecord;
}

export interface DatasetRootRecord extends JsonRecord {
  contactInformation?: InformationContainer;
  processInformation?: InformationContainer;
  flowInformation?: InformationContainer;
  flowPropertiesInformation?: InformationContainer;
  lifeCycleModelInformation?: InformationContainer;
  lifecycleModelInformation?: InformationContainer;
  sourceInformation?: InformationContainer;
  unitGroupInformation?: InformationContainer;
  modellingAndValidation?: ModellingAndValidation;
  exchanges?: JsonRecord & { exchange?: unknown };
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nestedRecord(value: unknown, ...keys: string[]): JsonRecord | null {
  let current: unknown = value;
  for (const key of keys) {
    if (!isJsonRecord(current)) return null;
    current = current[key];
  }
  return isJsonRecord(current) ? current : null;
}

export type DatasetIdentity = {
  id: string;
  version: string;
  payload: unknown;
  dataset_type: string | null;
};

export function unwrapDatasetPayload(row: unknown, datasetType: string): unknown {
  if (isJsonRecord(row)) {
    const typedKey = datasetType === "lifecyclemodel" ? "lifecyclemodel" : datasetType;
    for (const key of [typedKey, "json_ordered", "jsonOrdered", "json", "payload"]) {
      const candidate = row[key];
      if (isJsonRecord(candidate)) return candidate;
    }
  }
  return row;
}

export function datasetRoot(payload: unknown, datasetType: string | null): DatasetRootRecord {
  const effectiveDatasetType =
    datasetType === "support" ? detectSupportDatasetType(payload) || datasetType : datasetType;
  const rootKeys: Record<string, string[]> = {
    contact: ["contactDataSet"],
    process: ["processDataSet"],
    flow: ["flowDataSet"],
    flowproperty: ["flowPropertyDataSet"],
    lifecyclemodel: ["lifeCycleModelDataSet", "lifecycleModelDataSet", "lifecyclemodelDataSet"],
    source: ["sourceDataSet"],
    unitgroup: ["unitGroupDataSet"],
  };
  if (!isJsonRecord(payload)) return {};
  for (const key of rootKeys[effectiveDatasetType as string] ?? []) {
    const root = payload[key];
    if (isJsonRecord(root)) return root;
  }
  return {};
}

export function detectSupportDatasetType(value: unknown): string | null {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? unwrapDatasetPayload(value, "support")
      : value;
  if (!isJsonRecord(payload)) return null;
  if (payload.contactDataSet) return "contact";
  if (payload.sourceDataSet) return "source";
  if (payload.unitGroupDataSet) return "unitgroup";
  if (payload.flowPropertyDataSet) return "flowproperty";
  if (isJsonRecord(value) && value.contact) return "contact";
  if (isJsonRecord(value) && value.source) return "source";
  if (isJsonRecord(value) && value.unitgroup) return "unitgroup";
  if (isJsonRecord(value) && value.flowproperty) return "flowproperty";
  return null;
}

export function detectDatasetType(value: unknown, fallback: string | null = null): string | null {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? unwrapDatasetPayload(value, fallback || "support")
      : value;
  if (!isJsonRecord(payload)) return fallback;
  if (payload.flowDataSet) return "flow";
  if (payload.processDataSet) return "process";
  if (payload.contactDataSet) return "contact";
  if (payload.sourceDataSet) return "source";
  if (payload.unitGroupDataSet) return "unitgroup";
  if (payload.flowPropertyDataSet) return "flowproperty";
  if (
    payload.lifeCycleModelDataSet ||
    payload.lifecycleModelDataSet ||
    payload.lifecyclemodelDataSet
  ) {
    return "lifecyclemodel";
  }
  return fallback;
}

export function dataSetInformation(
  root: unknown,
  datasetType: string | null,
): DatasetInformationRecord {
  const candidates = [
    nestedRecord(root, "contactInformation", "dataSetInformation"),
    nestedRecord(root, "processInformation", "dataSetInformation"),
    nestedRecord(root, "flowInformation", "dataSetInformation"),
    nestedRecord(root, "flowPropertiesInformation", "dataSetInformation"),
    nestedRecord(root, "lifeCycleModelInformation", "dataSetInformation"),
    nestedRecord(root, "lifecycleModelInformation", "dataSetInformation"),
    nestedRecord(root, "sourceInformation", "dataSetInformation"),
    nestedRecord(root, "unitGroupInformation", "dataSetInformation"),
    nestedRecord(root, `${datasetType}Information`, "dataSetInformation"),
    nestedRecord(root, "dataSetInformation"),
  ];
  return candidates.find((candidate): candidate is JsonRecord => Boolean(candidate)) ?? {};
}

export function datasetIdentity(row: unknown, index: number, datasetType: string): DatasetIdentity {
  const payload = unwrapDatasetPayload(row, datasetType);
  const effectiveDatasetType =
    datasetType === "support"
      ? detectSupportDatasetType(row) || detectSupportDatasetType(payload)
      : datasetType;
  const root = datasetRoot(payload, effectiveDatasetType);
  const info = dataSetInformation(root, effectiveDatasetType);
  const publication =
    nestedRecord(root, "administrativeInformation", "publicationAndOwnership") ?? {};
  const rowRecord = isJsonRecord(row) ? row : {};
  const directId = rowRecord.id ?? rowRecord[`${datasetType}_id`] ?? rowRecord.dataset_id;
  const id = asText(directId ?? info["common:UUID"]) || `row-${index + 1}`;
  const version = asText(rowRecord.version ?? publication["common:dataSetVersion"]) || "00.00.001";
  return { id, version, payload, dataset_type: effectiveDatasetType };
}

export function curationEntityId(entity: unknown): string {
  if (!isJsonRecord(entity)) return "";
  return asText(entity.entity_id ?? entity.process_id ?? entity.id);
}

export function identityKey(identity: { id: unknown; version: unknown }): string {
  return `${identity.id}@@${identity.version}`;
}

export function identityFreshnessIdentityKey({
  datasetType,
  identity,
}: {
  datasetType: string;
  identity: { id?: unknown; version?: unknown };
}): string | null {
  const id = asText(identity?.id);
  const version = asText(identity?.version) || "00.00.001";
  return id ? `${datasetType}:${id}@@${version}` : null;
}

export function mapRowsByIdentity(
  rows: unknown[],
  datasetType: string,
): Map<string, { row: unknown; identity: DatasetIdentity; index: number }> {
  return new Map(
    rows.map((row, index) => {
      const identity = datasetIdentity(row, index, datasetType);
      return [identityKey(identity), { row, identity, index }];
    }),
  );
}
