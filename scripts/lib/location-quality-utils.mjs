import fs from "node:fs";
import path from "node:path";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";

function cliCommandPrefix(cliBin) {
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
}) {
  function classificationAuthoringCommands({ cliBin, outDir, rowsDir, type, rowType = type }) {
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

  function locationAuthoringCommands({ cliBin, outDir, rowsDir, type }) {
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

  function loadTidasLocationCodeMap() {
    const schemaPath = path.join(
      resolveInstalledTiangongLcaCliPackage().schemaDir,
      "tidas_locations_category.json",
    );
    if (!fileExists(schemaPath)) return new Map();
    const schema = readJson(schemaPath);
    return new Map(
      ensureArray(schema.oneOf)
        .map((entry) => [asText(entry?.const), asText(entry?.description)])
        .filter(([code]) => code),
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
  let cachedLocationTargetKeys = null;

  function tidasSchemaDirs() {
    return [resolveInstalledTiangongLcaCliPackage().schemaDir].filter(directoryExists);
  }

  function lastSchemaPropertyName(schemaPathSegments) {
    let propertyName = null;
    for (let index = 0; index < schemaPathSegments.length - 1; index += 1) {
      if (schemaPathSegments[index] === "properties") {
        propertyName = schemaPathSegments[index + 1] ?? propertyName;
      }
    }
    return propertyName;
  }

  function collectLocationRefKeysFromSchema(value, schemaPathSegments, keys) {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        collectLocationRefKeysFromSchema(item, [...schemaPathSegments, String(index)], keys),
      );
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.$ref === "tidas_locations_category.json") {
      const propertyName = lastSchemaPropertyName(schemaPathSegments);
      if (propertyName) keys.add(propertyName);
    }
    for (const [key, child] of Object.entries(value)) {
      collectLocationRefKeysFromSchema(child, [...schemaPathSegments, key], keys);
    }
  }

  function loadTidasLocationTargetKeys() {
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

  function isLocationTargetKey(key) {
    return loadTidasLocationTargetKeys().has(key);
  }

  function locationTargetStringValue(value) {
    if (typeof value === "string") {
      return {
        parent: null,
        key: null,
        path_suffix: [],
        value: value.trim(),
      };
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
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

  function collectLocationTargets(value, pathSegments = [], targets = []) {
    if (!value || typeof value !== "object") return targets;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        collectLocationTargets(item, [...pathSegments, index], targets),
      );
      return targets;
    }
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
  }) {
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
