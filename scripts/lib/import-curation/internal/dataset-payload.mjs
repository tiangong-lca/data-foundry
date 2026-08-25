import { asText } from "./runtime-io.ts";

export function unwrapDatasetPayload(row, datasetType) {
  if (row && typeof row === "object" && !Array.isArray(row)) {
    const typedKey = datasetType === "lifecyclemodel" ? "lifecyclemodel" : datasetType;
    for (const key of [typedKey, "json_ordered", "jsonOrdered", "json", "payload"]) {
      if (row[key] && typeof row[key] === "object" && !Array.isArray(row[key])) {
        return row[key];
      }
    }
  }
  return row;
}

export function datasetRoot(payload, datasetType) {
  const effectiveDatasetType =
    datasetType === "support" ? detectSupportDatasetType(payload) || datasetType : datasetType;
  const rootKeys = {
    contact: ["contactDataSet"],
    process: ["processDataSet"],
    flow: ["flowDataSet"],
    flowproperty: ["flowPropertyDataSet"],
    lifecyclemodel: ["lifeCycleModelDataSet", "lifecycleModelDataSet", "lifecyclemodelDataSet"],
    source: ["sourceDataSet"],
    unitgroup: ["unitGroupDataSet"],
  };
  for (const key of rootKeys[effectiveDatasetType] ?? []) {
    if (payload?.[key] && typeof payload[key] === "object") return payload[key];
  }
  return {};
}

export function detectSupportDatasetType(value) {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? unwrapDatasetPayload(value, "support")
      : value;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (payload.contactDataSet) return "contact";
  if (payload.sourceDataSet) return "source";
  if (payload.unitGroupDataSet) return "unitgroup";
  if (payload.flowPropertyDataSet) return "flowproperty";
  if (value?.contact) return "contact";
  if (value?.source) return "source";
  if (value?.unitgroup) return "unitgroup";
  if (value?.flowproperty) return "flowproperty";
  return null;
}

export function detectDatasetType(value, fallback = null) {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? unwrapDatasetPayload(value, fallback || "support")
      : value;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }
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

export function dataSetInformation(root, datasetType) {
  const candidates = [
    root?.contactInformation?.dataSetInformation,
    root?.processInformation?.dataSetInformation,
    root?.flowInformation?.dataSetInformation,
    root?.flowPropertiesInformation?.dataSetInformation,
    root?.lifeCycleModelInformation?.dataSetInformation,
    root?.lifecycleModelInformation?.dataSetInformation,
    root?.sourceInformation?.dataSetInformation,
    root?.unitGroupInformation?.dataSetInformation,
    root?.[`${datasetType}Information`]?.dataSetInformation,
    root?.dataSetInformation,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") ?? {};
}

export function datasetIdentity(row, index, datasetType) {
  const payload = unwrapDatasetPayload(row, datasetType);
  const effectiveDatasetType =
    datasetType === "support"
      ? detectSupportDatasetType(row) || detectSupportDatasetType(payload)
      : datasetType;
  const root = datasetRoot(payload, effectiveDatasetType);
  const info = dataSetInformation(root, effectiveDatasetType);
  const publication = root?.administrativeInformation?.publicationAndOwnership ?? {};
  const directId = row?.id ?? row?.[`${datasetType}_id`] ?? row?.dataset_id;
  const id = asText(directId ?? info["common:UUID"]) || `row-${index + 1}`;
  const version = asText(row?.version ?? publication["common:dataSetVersion"]) || "00.00.001";
  return { id, version, payload, dataset_type: effectiveDatasetType };
}

export function curationEntityId(entity) {
  return asText(entity?.entity_id ?? entity?.process_id ?? entity?.id);
}

export function identityKey(identity) {
  return `${identity.id}@@${identity.version}`;
}

export function identityFreshnessIdentityKey({ datasetType, identity }) {
  const id = asText(identity?.id);
  const version = asText(identity?.version) || "00.00.001";
  return id ? `${datasetType}:${id}@@${version}` : null;
}

export function mapRowsByIdentity(rows, datasetType) {
  return new Map(
    rows.map((row, index) => {
      const identity = datasetIdentity(row, index, datasetType);
      return [identityKey(identity), { row, identity, index }];
    }),
  );
}
