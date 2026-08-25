import fs from "node:fs";
import path from "node:path";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface BundleRowTypeConfig {
  plural: string;
}

interface DatasetIdentity {
  id: string | null;
  version: string | null;
}

interface LocationQualityDependencies {
  asText: (value: unknown) => string;
  bundleRowTypes: Record<string, BundleRowTypeConfig>;
  datasetIdentity: (payload: unknown, type: string) => DatasetIdentity;
  directoryExists: (directory: string) => boolean;
  ensureArray: (value: unknown) => unknown[];
  fileExists: (filePath: string) => boolean;
  pathExpression: (parts: Array<string | number>) => string;
  readJson: (filePath: string) => unknown;
  repoRelativeMaybe: (filePath: string | null) => string | null;
  repoRelativePath: (filePath: string) => string;
  shellQuote: (value: unknown) => string;
}

interface ClassificationCommandOptions {
  cliBin: string | string[];
  outDir: string;
  rowsDir: string;
  type: string;
  rowType?: string;
}

interface LocationCommandOptions {
  cliBin: string | string[];
  outDir: string;
  rowsDir: string;
  type: string;
}

interface LocationTarget {
  path: string;
  parent_path: string;
  value: string;
}

interface LocationTargetValue {
  parent: JsonRecord | null;
  key: string | null;
  path_suffix: string[];
  value: string;
}

interface LocationStats {
  location_code_targets: number;
  location_code_valid: number;
  location_code_blockers: number;
}

interface LocationFindingOptions {
  payload: unknown;
  type: string;
  sourceFile: string;
  blockers: JsonRecord[];
  stats: LocationStats;
  locationQueueRows: JsonRecord[];
  locationCodeMap: Map<string, string>;
  locationCommands: JsonRecord;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cliCommandPrefix(cliBin: string | string[]): string[] {
  return Array.isArray(cliBin) ? cliBin : [cliBin];
}

export function createLocationQualityUtils({
  asText,
  bundleRowTypes,
  datasetIdentity,
  directoryExists,
  ensureArray,
  fileExists,
  pathExpression,
  readJson,
  repoRelativeMaybe,
  repoRelativePath,
  shellQuote,
}: LocationQualityDependencies) {
  function classificationAuthoringCommands({
    cliBin,
    outDir,
    rowsDir,
    type,
    rowType = type,
  }: ClassificationCommandOptions) {
    const decisionsFile = path.join(outDir, `${type}-classification-decisions.jsonl`);
    const inputFile = path.join(rowsDir, `${bundleRowTypes[rowType].plural}.jsonl`);
    const outputFile = path.join(rowsDir, `${bundleRowTypes[rowType].plural}.classified.jsonl`);
    return {
      children_root: [
        ...cliCommandPrefix(cliBin),
        "dataset",
        "classification",
        "children",
        "--type",
        type,
        "--out-dir",
        path.join(outDir, "classification", type),
        "--json",
      ]
        .map(shellQuote)
        .join(" "),
      children_next_template: `${[
        ...cliCommandPrefix(cliBin),
        "dataset",
        "classification",
        "children",
        "--type",
        type,
        "--parent",
      ]
        .map(shellQuote)
        .join(
          " ",
        )} <parent-code> ${["--out-dir", path.join(outDir, "classification", type), "--json"].map(shellQuote).join(" ")}`,
      path_template: `${[
        ...cliCommandPrefix(cliBin),
        "dataset",
        "classification",
        "path",
        "--type",
        type,
        "--code",
      ]
        .map(shellQuote)
        .join(
          " ",
        )} <selected-code> ${["--out-dir", path.join(outDir, "classification", type), "--json"].map(shellQuote).join(" ")}`,
      apply: [
        ...cliCommandPrefix(cliBin),
        "dataset",
        "classification",
        "apply",
        "--input",
        inputFile,
        "--decisions",
        decisionsFile,
        "--out",
        outputFile,
        "--type",
        type,
        "--out-dir",
        path.join(outDir, "classification", type),
        "--json",
      ]
        .map(shellQuote)
        .join(" "),
      decision_file: repoRelativePath(decisionsFile),
      input_rows: repoRelativePath(inputFile),
      output_rows: repoRelativePath(outputFile),
    };
  }

  function locationAuthoringCommands({ cliBin, outDir, rowsDir, type }: LocationCommandOptions) {
    const decisionsFile = path.join(outDir, `${type}-location-decisions.jsonl`);
    const inputFile = path.join(rowsDir, `${bundleRowTypes[type].plural}.jsonl`);
    const outputFile = path.join(rowsDir, `${bundleRowTypes[type].plural}.located.jsonl`);
    return {
      audit: [
        ...cliCommandPrefix(cliBin),
        "dataset",
        "classification",
        "audit",
        "--type",
        "location",
        "--input",
        inputFile,
        "--out-dir",
        path.join(outDir, "classification", "location", type),
        "--json",
      ]
        .map(shellQuote)
        .join(" "),
      children_root: [
        ...cliCommandPrefix(cliBin),
        "dataset",
        "classification",
        "children",
        "--type",
        "location",
        "--out-dir",
        path.join(outDir, "classification", "location", type),
        "--json",
      ]
        .map(shellQuote)
        .join(" "),
      path_template: `${[
        ...cliCommandPrefix(cliBin),
        "dataset",
        "classification",
        "path",
        "--type",
        "location",
        "--code",
      ]
        .map(shellQuote)
        .join(
          " ",
        )} <selected-location-code> ${["--out-dir", path.join(outDir, "classification", "location", type), "--json"].map(shellQuote).join(" ")}`,
      apply: [
        ...cliCommandPrefix(cliBin),
        "dataset",
        "classification",
        "apply",
        "--input",
        inputFile,
        "--decisions",
        decisionsFile,
        "--out",
        outputFile,
        "--type",
        "location",
        "--out-dir",
        path.join(outDir, "classification", "location", type),
        "--json",
      ]
        .map(shellQuote)
        .join(" "),
      decision_file: repoRelativePath(decisionsFile),
      input_rows: repoRelativePath(inputFile),
      output_rows: repoRelativePath(outputFile),
    };
  }

  function loadTidasLocationCodeMap(): Map<string, string> {
    const schemaPath = path.join(
      resolveInstalledTiangongLcaCliPackage().schemaDir,
      "tidas_locations_category.json",
    );
    if (!fileExists(schemaPath)) return new Map();
    const schema = readJson(schemaPath);
    const entries = isRecord(schema) ? schema.oneOf : undefined;
    return new Map(
      ensureArray(entries)
        .map((value) => {
          const entry = isRecord(value) ? value : {};
          return [asText(entry.const), asText(entry.description)] as const;
        })
        .filter((entry): entry is readonly [string, string] => Boolean(entry[0])),
    );
  }

  const fallbackLocationTargetKeys = new Set([
    "@location",
    "@subLocation",
    "impactLocation",
    "impactSubLocation",
    "interventionLocation",
    "interventionSubLocation",
    "intervensionSubLocation",
    "location",
    "locationOfSupply",
    "subLocation",
  ]);
  let cachedLocationTargetKeys: Set<string> | null = null;

  function tidasSchemaDirs(): string[] {
    return [resolveInstalledTiangongLcaCliPackage().schemaDir].filter(directoryExists);
  }

  function lastSchemaPropertyName(schemaPathSegments: string[]): string | null {
    let propertyName: string | null = null;
    for (let index = 0; index < schemaPathSegments.length - 1; index += 1) {
      if (schemaPathSegments[index] === "properties") {
        propertyName = schemaPathSegments[index + 1] ?? propertyName;
      }
    }
    return propertyName;
  }

  function collectLocationRefKeysFromSchema(
    value: unknown,
    schemaPathSegments: string[],
    keys: Set<string>,
  ): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        collectLocationRefKeysFromSchema(item, [...schemaPathSegments, String(index)], keys),
      );
      return;
    }
    if (!isRecord(value)) return;
    if (value.$ref === "tidas_locations_category.json") {
      const propertyName = lastSchemaPropertyName(schemaPathSegments);
      if (propertyName) keys.add(propertyName);
    }
    for (const [key, child] of Object.entries(value)) {
      collectLocationRefKeysFromSchema(child, [...schemaPathSegments, key], keys);
    }
  }

  function loadTidasLocationTargetKeys(): Set<string> {
    if (cachedLocationTargetKeys) return cachedLocationTargetKeys;
    const keys = new Set(fallbackLocationTargetKeys);
    for (const schemaDir of tidasSchemaDirs()) {
      for (const fileName of fs.readdirSync(schemaDir)) {
        if (!fileName.endsWith(".json")) continue;
        collectLocationRefKeysFromSchema(readJson(path.join(schemaDir, fileName)), [], keys);
      }
    }
    cachedLocationTargetKeys = keys;
    return cachedLocationTargetKeys;
  }

  function isLocationTargetKey(key: string): boolean {
    return loadTidasLocationTargetKeys().has(key);
  }

  function locationTargetStringValue(value: unknown): LocationTargetValue | null {
    if (typeof value === "string") {
      return {
        parent: null,
        key: null,
        path_suffix: [],
        value: value.trim(),
      };
    }
    if (isRecord(value)) {
      const text = value["#text"];
      if (typeof text === "string") {
        return {
          parent: value,
          key: "#text",
          path_suffix: ["#text"],
          value: text.trim(),
        };
      }
    }
    return null;
  }

  function collectLocationTargets(
    value: unknown,
    pathSegments: Array<string | number> = [],
    targets: LocationTarget[] = [],
  ): LocationTarget[] {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        collectLocationTargets(item, [...pathSegments, index], targets),
      );
      return targets;
    }
    if (!isRecord(value)) return targets;
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...pathSegments, key];
      if (isLocationTargetKey(key)) {
        const targetValue = locationTargetStringValue(child);
        if (targetValue) {
          const pathSuffix = targetValue.path_suffix ?? [];
          const leafPath = [...childPath, ...pathSuffix];
          const parentPath = pathSuffix.length > 0 ? childPath : pathSegments;
          targets.push({
            path: pathExpression(leafPath),
            parent_path: pathExpression(parentPath),
            value: targetValue.value,
          });
        }
      }
      collectLocationTargets(child, childPath, targets);
    }
    return targets;
  }

  function collectLocationQualityFindings({
    payload,
    type,
    sourceFile,
    blockers,
    stats,
    locationQueueRows,
    locationCodeMap,
    locationCommands,
  }: LocationFindingOptions): void {
    const identity = datasetIdentity(payload, type);
    for (const target of collectLocationTargets(payload)) {
      stats.location_code_targets += 1;
      if (locationCodeMap.has(target.value)) {
        stats.location_code_valid += 1;
        continue;
      }
      stats.location_code_blockers += 1;
      const queueRow = {
        dataset_type: type,
        dataset_id: identity.id,
        dataset_version: identity.version,
        source_file: repoRelativeMaybe(sourceFile),
        code: "location_code_requires_authoring",
        path: target.path,
        current_location: target.value,
        location_workflow: {
          schema_type: "location",
          commands: locationCommands,
          decision_contract: {
            required_selector: "row_index or dataset_id",
            required_location: "code from tidas_locations_category.json",
            required_target_path:
              "target_path is required when a row contains more than one location field",
            optional_fields: ["basis", "evidence"],
          },
        },
        required_resolution:
          "Choose a valid TIDAS location code from tidas_locations_category.json, write a location decision, apply it through the CLI, then rerun validation before remote write.",
      };
      locationQueueRows.push(queueRow);
      blockers.push({
        code: "location_code_requires_authoring",
        message:
          "Location value is not present in tidas_locations_category.json and must be resolved before commit.",
        dataset_type: type,
        dataset_id: identity.id,
        dataset_version: identity.version,
        source_file: repoRelativeMaybe(sourceFile),
        path: target.path,
        current_location: target.value,
        queue: "location-authoring-queue.jsonl",
      });
    }
  }

  return {
    classificationAuthoringCommands,
    collectLocationQualityFindings,
    loadTidasLocationCodeMap,
    locationAuthoringCommands,
  };
}
