export type DatasetType =
  | "contact"
  | "flow"
  | "flowproperty"
  | "lifecyclemodel"
  | "process"
  | "source"
  | "support"
  | "unitgroup";

export type DatasetTypeOptions = {
  type?: unknown;
  datasetType?: unknown;
  kind?: unknown;
};

export const supportedDatasetTypes = new Set<string>([
  "contact",
  "flow",
  "flowproperty",
  "lifecyclemodel",
  "process",
  "source",
  "support",
  "unitgroup",
]);

export const supportDatasetTypes = new Set<string>(["contact", "source"]);

export const referenceOnlySupportDatasetTypes = new Set<string>(["unitgroup", "flowproperty"]);

export const datasetTypePlural: Record<DatasetType, string> = {
  contact: "contacts",
  process: "processes",
  flow: "flows",
  flowproperty: "flowproperties",
  lifecyclemodel: "lifecyclemodels",
  source: "sources",
  support: "support",
  unitgroup: "unitgroups",
};

export const defaultProfilesFile = "specs/import-profiles.json";

export const fallbackProfiles = {
  schema_version: 1,
  default_profile: "generic",
  profiles: {
    generic: {
      id: "generic",
      description: "Default profile with no dataset-specific waivers.",
      docs: [],
      waived_qa_codes_by_type: {},
      waiver_reasons: {},
    },
  },
};

export function datasetTypeFromOptions(
  options: DatasetTypeOptions,
  forcedType: unknown = null,
): DatasetType {
  const datasetType = String(
    forcedType ?? options.type ?? options.datasetType ?? options.kind ?? "process",
  )
    .trim()
    .toLowerCase();
  if (!supportedDatasetTypes.has(datasetType)) {
    throw new Error(
      `Unsupported dataset type: ${datasetType}. Expected contact, source, unitgroup, flowproperty, support, flow, process, or lifecyclemodel.`,
    );
  }
  return datasetType as DatasetType;
}
