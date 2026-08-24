import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readOnlyStageContract } from "../lib/stage-contract.ts";

const libraryScopeStageContract = readOnlyStageContract([
  {
    stage: "library_index",
    phase: "prepare",
    purpose:
      "Build one root TIDAS entity index so bundle-local copies do not multiply authoring or identity work.",
    inputs: [
      "root tidas/processes",
      "root tidas/flows",
      "root tidas/flowproperties",
      "root tidas/unitgroups",
    ],
    outputs: ["library-entity-index.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
  {
    stage: "scope_projection",
    phase: "rewrite_cleanup",
    purpose:
      "Project unique library decisions back to process-bundle scopes with dependency closure evidence.",
    inputs: ["process-bundles/index.json", "bundle manifest.json files"],
    outputs: ["scope-projection.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
  {
    stage: "decision_resolution",
    phase: "gate_validate",
    purpose:
      "Merge AI identity/classification decisions and canonical support mappings into ready or blocked process scopes.",
    inputs: [
      "identity-decisions.jsonl",
      "classification-decisions.jsonl",
      "canonical-support-mappings.jsonl",
    ],
    outputs: ["library-resolution.json", "scope-checkpoints.jsonl", "blocked-scope-ledger.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
  {
    stage: "scope_run",
    phase: "report",
    purpose:
      "Run only dependency-closed scopes through the local scope runner and keep blocked scopes out of write queues.",
    inputs: ["library-resolution.json", "scope file"],
    outputs: ["scope-checkpoints.jsonl", "blocked-scope-ledger.jsonl"],
    side_effects: ["writes local Foundry artifacts"],
  },
]);

const indexedEntityTypes = ["process", "flow", "flowproperty", "unitgroup"];

export function createLibraryScopeWorkflowCommands({
  asText,
  booleanOption,
  profileFor,
  repoRoot,
  bundleClassificationPath,
  cloneJson,
  datasetIdentity,
  directoryExists,
  ensureArray,
  fileExists,
  flowTypeOfDataSet,
  jsonSha256,
  nowIso,
  positiveIntegerOption,
  readJson,
  readJsonLines,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  sha256Text,
  textValue,
  writeJson,
  writeJsonLines,
}) {
  const typePlural = {
    process: "processes",
    flow: "flows",
    flowproperty: "flowproperties",
    unitgroup: "unitgroups",
  };

  function help(command, purpose, usage) {
    return {
      schema_version: 1,
      status: "help",
      command,
      purpose,
      usage,
      remote_write_mode: "read-only",
      ...libraryScopeStageContract,
    };
  }

  function normalizedText(value) {
    return String(value ?? "")
      .trim()
      .replace(/\s+/gu, " ")
      .toLowerCase();
  }

  function listJsonFiles(dir) {
    if (!directoryExists(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  }

  function sourceDirOption(options) {
    return resolveRepoPath(options.sourceDir || options.input || options.root);
  }

  function processBundlesDirOption(options, sourceDir = null) {
    return resolveRepoPath(
      options.processBundlesDir ||
        options.bundlesDir ||
        (sourceDir ? path.join(sourceDir, "process-bundles") : null),
    );
  }

  function libraryIndexDirOption(options) {
    const resolved = resolveRepoPath(options.libraryIndex || options.indexDir);
    if (!resolved) return null;
    return fileExists(resolved) ? path.dirname(resolved) : resolved;
  }

  function datasetDataSetInformation(payload, type) {
    if (type === "flow") {
      return payload?.flowDataSet?.flowInformation?.dataSetInformation ?? {};
    }
    if (type === "process") {
      return payload?.processDataSet?.processInformation?.dataSetInformation ?? {};
    }
    if (type === "flowproperty") {
      return payload?.flowPropertyDataSet?.flowPropertiesInformation?.dataSetInformation ?? {};
    }
    if (type === "unitgroup") {
      return payload?.unitGroupDataSet?.unitGroupInformation?.dataSetInformation ?? {};
    }
    return {};
  }

  function datasetName(payload, type) {
    const info = datasetDataSetInformation(payload, type);
    if (type === "flow" || type === "process") {
      const name = info.name ?? {};
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

  function referenceRows(value, pathSegments = []) {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => referenceRows(item, [...pathSegments, index]));
    }
    const rows = [];
    if (value["@refObjectId"]) {
      rows.push({
        path: pathSegments.join("."),
        type: asText(value["@type"]),
        id: asText(value["@refObjectId"]),
        version: asText(value["@version"]) || "00.00.001",
        short_description: textValue(value["common:shortDescription"]),
      });
    }
    for (const [key, child] of Object.entries(value)) {
      rows.push(...referenceRows(child, [...pathSegments, key]));
    }
    return rows;
  }

  function classificationPath(payload, type) {
    if (type === "flow") {
      const info = datasetDataSetInformation(payload, type);
      const categories =
        info.classificationInformation?.["common:elementaryFlowCategorization"]?.[
          "common:category"
        ];
      const elementaryPath = ensureArray(categories)
        .map((entry) => textValue(entry))
        .filter(Boolean)
        .join(" > ");
      if (elementaryPath) return elementaryPath;
    }
    return bundleClassificationPath(payload, type);
  }

  function unitGroupUnits(payload) {
    return ensureArray(payload?.unitGroupDataSet?.units?.unit)
      .map((unit) => ({
        internal_id: asText(unit?.["@dataSetInternalID"]),
        name: textValue(unit?.name ?? unit?.["common:name"]),
        mean_value: asText(unit?.meanValue),
      }))
      .filter((unit) => unit.name || unit.internal_id);
  }

  function flowPropertyReferenceUnitGroup(payload) {
    const ref =
      payload?.flowPropertyDataSet?.flowPropertiesInformation?.quantitativeReference
        ?.referenceToReferenceUnitGroup ?? {};
    return {
      id: asText(ref["@refObjectId"]),
      version: asText(ref["@version"]) || "00.00.001",
      short_description: textValue(ref["common:shortDescription"]),
    };
  }

  function flowPropertyRefs(payload) {
    return ensureArray(payload?.flowDataSet?.flowProperties?.flowProperty)
      .map((property) => {
        const ref = property?.referenceToFlowPropertyDataSet ?? {};
        return {
          id: asText(ref["@refObjectId"]),
          version: asText(ref["@version"]) || "00.00.001",
          short_description: textValue(ref["common:shortDescription"]),
          internal_id: asText(property?.["@dataSetInternalID"]),
          mean_value: asText(property?.meanValue),
        };
      })
      .filter((ref) => ref.id);
  }

  function processExchangeRefs(payload) {
    return ensureArray(payload?.processDataSet?.exchanges?.exchange)
      .map((exchange, index) => {
        const ref = exchange?.referenceToFlowDataSet ?? {};
        return {
          exchange_index: index,
          flow_id: asText(ref["@refObjectId"]),
          flow_version: asText(ref["@version"]) || "00.00.001",
          direction: asText(exchange?.exchangeDirection),
          amount: asText(exchange?.meanAmount ?? exchange?.resultingAmount),
          short_description: textValue(ref["common:shortDescription"]),
        };
      })
      .filter((ref) => ref.flow_id);
  }

  function entitySemanticKey(payload, type) {
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
            .map((u) => u.name)
            .join(",")
        : "",
    ].map(normalizedText);
    return parts.filter(Boolean).join("|");
  }

  function entityRowFromPayload({ payload, type, sourceFile, sourceKind }) {
    const identity = datasetIdentity(payload, type);
    const id = identity.id || path.basename(sourceFile, ".json");
    const version = identity.version || "00.00.001";
    const flowType = type === "flow" ? flowTypeOfDataSet(payload) : null;
    const row = {
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
        (type === "flow" && /^elementary flow$/iu.test(flowType)),
      references: referenceRows(payload),
    };
    if (type === "flow") {
      row.flow_property_refs = flowPropertyRefs(payload);
    }
    if (type === "flowproperty") {
      row.reference_unit_group = flowPropertyReferenceUnitGroup(payload);
    }
    if (type === "unitgroup") {
      row.units = unitGroupUnits(payload);
    }
    return row;
  }

  function addEntityRow(rowMap, row) {
    const existing = rowMap.get(row.entity_key);
    if (!existing) {
      rowMap.set(row.entity_key, { ...row, source_files: [row.source_file] });
      return;
    }
    existing.source_files.push(row.source_file);
    existing.duplicate_source_file_count = existing.source_files.length;
    existing.payload_hashes = [
      ...new Set([...(existing.payload_hashes ?? [existing.payload_sha256]), row.payload_sha256]),
    ];
  }

  function buildEntityIndex(sourceDir) {
    const rowMap = new Map();
    for (const type of indexedEntityTypes) {
      const dir = path.join(sourceDir, "tidas", typePlural[type]);
      for (const filePath of listJsonFiles(dir)) {
        const payload = readJson(filePath);
        addEntityRow(
          rowMap,
          entityRowFromPayload({
            payload,
            type,
            sourceFile: filePath,
            sourceKind: "root_tidas",
          }),
        );
      }
    }
    return [...rowMap.values()].sort((left, right) =>
      left.entity_key.localeCompare(right.entity_key),
    );
  }

  function entityMaps(entityRows) {
    const byKey = new Map(entityRows.map((row) => [row.entity_key, row]));
    const byTypeId = new Map();
    for (const row of entityRows) {
      byTypeId.set(`${row.dataset_type}:${row.dataset_id}`, row);
      byTypeId.set(`${row.dataset_type}:${row.dataset_id}:${row.dataset_version}`, row);
    }
    return { byKey, byTypeId };
  }

  function processBundleEntries(processBundlesDir) {
    function resolveBundlePath(value, expectedKind) {
      if (!value) return null;
      if (path.isAbsolute(value)) return value;
      const fromBundleRoot = path.join(processBundlesDir, value);
      if (
        (expectedKind === "file" && fileExists(fromBundleRoot)) ||
        (expectedKind === "dir" && directoryExists(fromBundleRoot))
      ) {
        return fromBundleRoot;
      }
      return resolveRepoPath(value);
    }
    const indexFile = path.join(processBundlesDir, "index.json");
    if (fileExists(indexFile)) {
      const index = readJson(indexFile);
      return ensureArray(index.bundles).map((bundle) => {
        const manifest = resolveBundlePath(bundle.manifest, "file");
        const tidasDir = resolveBundlePath(bundle.tidas_dir, "dir");
        const bundleDir = manifest
          ? path.dirname(manifest)
          : tidasDir
            ? path.dirname(tidasDir)
            : path.join(processBundlesDir, asText(bundle.process_id));
        return {
          process_id: asText(bundle.process_id),
          bundle_dir: bundleDir,
          manifest: manifest || path.join(bundleDir, "manifest.json"),
          tidas_dir: tidasDir || path.join(bundleDir, "tidas"),
          index_row: bundle,
        };
      });
    }
    if (!directoryExists(processBundlesDir)) return [];
    return fs
      .readdirSync(processBundlesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const bundleDir = path.join(processBundlesDir, entry.name);
        return {
          process_id: entry.name,
          bundle_dir: bundleDir,
          manifest: path.join(bundleDir, "manifest.json"),
          tidas_dir: path.join(bundleDir, "tidas"),
          index_row: null,
        };
      })
      .filter((entry) => fileExists(entry.manifest))
      .sort((left, right) => left.process_id.localeCompare(right.process_id));
  }

  function bundlePayloadsFromManifest(bundle) {
    const manifest = fileExists(bundle.manifest) ? readJson(bundle.manifest) : {};
    const payloads = Object.fromEntries(indexedEntityTypes.map((type) => [type, []]));
    for (const type of indexedEntityTypes) {
      const plural = typePlural[type];
      for (const relativeFile of ensureArray(manifest.files?.[plural])) {
        const filePath = path.join(bundle.bundle_dir, relativeFile);
        if (!fileExists(filePath)) continue;
        payloads[type].push({ filePath, payload: readJson(filePath) });
      }
    }
    return { manifest, payloads };
  }

  function entityKeyForRef(type, id, version = "00.00.001") {
    return `${type}:${id}:${version || "00.00.001"}`;
  }

  function rootEntityForRef(maps, type, id, version = "00.00.001") {
    return (
      maps.byKey.get(entityKeyForRef(type, id, version)) ||
      maps.byTypeId.get(`${type}:${id}:${version}`) ||
      maps.byTypeId.get(`${type}:${id}`) ||
      null
    );
  }

  function projectionForBundle(bundle, maps) {
    const { manifest, payloads } = bundlePayloadsFromManifest(bundle);
    const processPayload =
      payloads.process[0]?.payload ||
      (fileExists(path.join(bundle.tidas_dir, "processes", `${bundle.process_id}.json`))
        ? readJson(path.join(bundle.tidas_dir, "processes", `${bundle.process_id}.json`))
        : null);
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
    const flowDeps = new Map();
    const flowPropertyDeps = new Map();
    const unitGroupDeps = new Map();
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

    for (const dep of flowDeps.values()) {
      const rootFlow = rootEntityForRef(maps, "flow", dep.id, dep.version);
      for (const fp of ensureArray(rootFlow?.flow_property_refs)) {
        flowPropertyDeps.set(fp.id, {
          id: fp.id,
          version: fp.version || "00.00.001",
          source: "flow_property_ref",
          parent_flow_id: dep.id,
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
    for (const dep of flowPropertyDeps.values()) {
      const rootFlowProperty = rootEntityForRef(maps, "flowproperty", dep.id, dep.version);
      const unitGroup = rootFlowProperty?.reference_unit_group;
      if (unitGroup?.id) {
        unitGroupDeps.set(unitGroup.id, {
          id: unitGroup.id,
          version: unitGroup.version || "00.00.001",
          source: "flowproperty_reference_unit_group",
          parent_flow_property_id: dep.id,
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

    const flowDependencyRows = [...flowDeps.values()].map((dep) => {
      const entity = rootEntityForRef(maps, "flow", dep.id, dep.version);
      return {
        ...dep,
        entity_key: entity?.entity_key ?? entityKeyForRef("flow", dep.id, dep.version),
        flow_type: entity?.flow_type ?? null,
        reference_only: Boolean(entity?.reference_only),
      };
    });
    const flowPropertyDependencyRows = [...flowPropertyDeps.values()].map((dep) => {
      const entity = rootEntityForRef(maps, "flowproperty", dep.id, dep.version);
      return {
        ...dep,
        entity_key: entity?.entity_key ?? entityKeyForRef("flowproperty", dep.id, dep.version),
        reference_only: true,
      };
    });
    const unitGroupDependencyRows = [...unitGroupDeps.values()].map((dep) => {
      const entity = rootEntityForRef(maps, "unitgroup", dep.id, dep.version);
      return {
        ...dep,
        entity_key: entity?.entity_key ?? entityKeyForRef("unitgroup", dep.id, dep.version),
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

  function runDatasetLibraryIndexBuild(options) {
    if (options.help) {
      return help(
        "dataset-library-index-build",
        "Build root TIDAS unique entity index and process-scope projection for a process-bundled source library.",
        [
          "node scripts/foundry.mjs dataset-library-index-build --source-dir <BAFU-root> --process-bundles-dir <BAFU-root>/process-bundles --out-dir <run-dir>/library-index",
        ],
      );
    }
    const sourceDir = sourceDirOption(options);
    if (!sourceDir || !directoryExists(sourceDir)) {
      throw new Error("--source-dir is required and must point to a source library root.");
    }
    const processBundlesDir = processBundlesDirOption(options, sourceDir);
    if (!processBundlesDir || !directoryExists(processBundlesDir)) {
      throw new Error("--process-bundles-dir is required and must point to process-bundles.");
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(sourceDir, ".foundry", "library-index"),
    );
    const entityRows = buildEntityIndex(sourceDir);
    const maps = entityMaps(entityRows);
    const projectionRows = processBundleEntries(processBundlesDir).map((bundle) =>
      projectionForBundle(bundle, maps),
    );
    const entityIndexPath = path.join(outDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(outDir, "scope-projection.jsonl");
    const reportPath = path.join(outDir, "dataset-library-index-build-report.json");
    writeJsonLines(entityIndexPath, entityRows);
    writeJsonLines(scopeProjectionPath, projectionRows);
    const countsByType = Object.fromEntries(
      indexedEntityTypes.map((type) => [
        type,
        entityRows.filter((row) => row.dataset_type === type).length,
      ]),
    );
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: "completed",
      command: "dataset-library-index-build",
      source_dir: repoRelativePath(sourceDir),
      process_bundles_dir: repoRelativePath(processBundlesDir),
      counts: {
        unique_entities: entityRows.length,
        process_scopes: projectionRows.length,
        ...countsByType,
        elementary_flows: entityRows.filter(
          (row) => row.dataset_type === "flow" && /^elementary flow$/iu.test(row.flow_type),
        ).length,
        reference_only_support: entityRows.filter((row) =>
          ["flowproperty", "unitgroup"].includes(row.dataset_type),
        ).length,
      },
      files: {
        report: repoRelativePath(reportPath),
        library_entity_index: repoRelativePath(entityIndexPath),
        scope_projection: repoRelativePath(scopeProjectionPath),
      },
      policy: {
        root_tidas_is_unique_entity_source: true,
        process_bundles_index_is_scope_projection_source: true,
      },
      blockers: [],
    };
    writeJson(reportPath, report);
    return report;
  }

  function chunkRows(rows, chunkSize) {
    const chunks = [];
    for (let index = 0; index < rows.length; index += chunkSize) {
      chunks.push(rows.slice(index, index + chunkSize));
    }
    return chunks;
  }

  function writeChunkFiles(outDir, stem, rows, chunkSize) {
    const chunksDir = path.join(outDir, "chunks");
    return chunkRows(rows, chunkSize).map((chunk, index) => {
      const filePath = path.join(
        chunksDir,
        `${stem}.chunk-${String(index + 1).padStart(4, "0")}.jsonl`,
      );
      writeJsonLines(filePath, chunk);
      return repoRelativePath(filePath);
    });
  }

  function runDatasetLibraryAuthoringPlan(options) {
    if (options.help) {
      return help(
        "dataset-library-authoring-plan",
        "Create deduplicated AI authoring templates for library-level identity, classification, and canonical support decisions.",
        [
          "node scripts/foundry.mjs dataset-library-authoring-plan --library-index <run-dir>/library-index --out-dir <run-dir>/authoring-plan",
        ],
      );
    }
    const indexDir = libraryIndexDirOption(options);
    if (!indexDir) throw new Error("--library-index is required.");
    const entityIndexPath = path.join(indexDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(indexDir, "scope-projection.jsonl");
    if (!fileExists(entityIndexPath) || !fileExists(scopeProjectionPath)) {
      throw new Error(
        "--library-index must contain library-entity-index.jsonl and scope-projection.jsonl.",
      );
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(indexDir), "authoring-plan"),
    );
    const chunkSize = positiveIntegerOption(options.chunkSize, 200);
    const entityRows = readJsonLines(entityIndexPath);
    const projectionRows = readJsonLines(scopeProjectionPath);
    const usedEntityKeys = new Set(
      projectionRows.flatMap((scope) => [
        scope.process_entity_key,
        ...ensureArray(scope.dependency_ids?.flows).map((dep) => dep.entity_key),
        ...ensureArray(scope.dependency_ids?.flowproperties).map((dep) => dep.entity_key),
        ...ensureArray(scope.dependency_ids?.unitgroups).map((dep) => dep.entity_key),
      ]),
    );
    const identityTemplateRows = entityRows
      .filter(
        (row) =>
          row.dataset_type === "flow" &&
          /^elementary flow$/iu.test(row.flow_type) &&
          usedEntityKeys.has(row.entity_key),
      )
      .map((row) => ({
        schema_version: 1,
        decision: "__AI_DECIDE_REUSE_EXISTING_REFERENCE_OR_BLOCK__",
        dataset_type: "flow",
        source_dataset_id: row.dataset_id,
        source_dataset_version: row.dataset_version,
        source_entity_key: row.entity_key,
        source_name: row.name,
        flow_type: row.flow_type,
        classification_path: row.classification_path,
        required_resolution:
          "If physically identity-equivalent to an existing TianGong elementary flow, return reuse_existing_reference with canonical_flow_id/version and evidence. Otherwise return manual_review/block_unresolved.",
      }));
    const classificationTemplateRows = entityRows
      .filter(
        (row) =>
          usedEntityKeys.has(row.entity_key) &&
          (row.dataset_type === "process" ||
            (row.dataset_type === "flow" && !/^elementary flow$/iu.test(row.flow_type))),
      )
      .map((row) => ({
        schema_version: 1,
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        entity_key: row.entity_key,
        category_type: row.dataset_type === "process" ? "process" : "flow-product",
        selected_code: "__AI_SELECT_CLASSIFICATION_CODE__",
        basis: "__AI_WRITE_MEANING_BASED_BASIS__",
        confidence: "__AI_CONFIDENCE__",
        source_name: row.name,
        converted_classification_reference: row.classification_path,
        required_resolution:
          "Classify from the real meaning of the process/flow. Converter classification is weak reference only.",
      }));
    const supportTemplateRows = entityRows
      .filter(
        (row) =>
          usedEntityKeys.has(row.entity_key) &&
          ["flowproperty", "unitgroup"].includes(row.dataset_type),
      )
      .map((row) => ({
        schema_version: 1,
        support_type: row.dataset_type,
        source_support_id: row.dataset_id,
        source_support_version: row.dataset_version,
        source_entity_key: row.entity_key,
        source_name: row.name,
        source_units: row.units ?? null,
        source_reference_unit_group: row.reference_unit_group ?? null,
        canonical_support_id: "__AI_OR_HUMAN_SELECT_CANONICAL_SUPPORT_ID__",
        canonical_support_version: "__AI_OR_HUMAN_SELECT_CANONICAL_SUPPORT_VERSION__",
        physical_dimension_evidence: "__REQUIRED_FOR_AUTOMATIC_MAPPING_OR_LEAVE_BLOCKED__",
        required_resolution:
          "Map generated support to public canonical support only when unit/physical dimension equivalence is proven; otherwise leave blocked for human support authoring.",
      }));

    const identityPath = path.join(outDir, "identity-decisions.template.jsonl");
    const classificationPathOut = path.join(outDir, "classification-decisions.template.jsonl");
    const supportPath = path.join(outDir, "canonical-support-mappings.template.jsonl");
    writeJsonLines(identityPath, identityTemplateRows);
    writeJsonLines(classificationPathOut, classificationTemplateRows);
    writeJsonLines(supportPath, supportTemplateRows);
    const chunkFiles = [
      ...writeChunkFiles(outDir, "identity-decisions", identityTemplateRows, chunkSize),
      ...writeChunkFiles(outDir, "classification-decisions", classificationTemplateRows, chunkSize),
      ...writeChunkFiles(outDir, "canonical-support-mappings", supportTemplateRows, chunkSize),
    ];
    const reportPath = path.join(outDir, "dataset-library-authoring-plan-report.json");
    const actionItems =
      identityTemplateRows.length + classificationTemplateRows.length + supportTemplateRows.length;
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: actionItems > 0 ? "ready_for_ai_library_decisions" : "ready_no_action_items",
      command: "dataset-library-authoring-plan",
      library_index: repoRelativePath(indexDir),
      counts: {
        identity_decisions: identityTemplateRows.length,
        classification_decisions: classificationTemplateRows.length,
        canonical_support_mappings: supportTemplateRows.length,
        action_items: actionItems,
        chunks: chunkFiles.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        identity_decisions_template: repoRelativePath(identityPath),
        classification_decisions_template: repoRelativePath(classificationPathOut),
        canonical_support_mappings_template: repoRelativePath(supportPath),
        chunks: chunkFiles,
      },
      blockers: [],
    };
    writeJson(reportPath, report);
    return report;
  }

  function readDecisionRows(decisionsDir, fileName, optionValue) {
    const explicit = resolveRepoPath(optionValue);
    const filePath = explicit || path.join(decisionsDir, fileName);
    return fileExists(filePath) ? readJsonLines(filePath) : [];
  }

  function identityDecisionKey(row) {
    return [
      "flow",
      asText(row.source_dataset_id || row.dataset_id || row.source_flow_id || row.id),
      asText(row.source_dataset_version || row.dataset_version || row.version) || "00.00.001",
    ].join(":");
  }

  function classificationDecisionDatasetType(row) {
    const explicitType = asText(row.dataset_type || row.type);
    if (explicitType) {
      return explicitType;
    }
    const categoryType = asText(row.category_type || row.schema_type);
    if (categoryType === "process") {
      return "process";
    }
    if (categoryType === "flow-product" || categoryType === "flow-elementary") {
      return "flow";
    }
    return categoryType;
  }

  function classificationDecisionKey(row) {
    return [
      classificationDecisionDatasetType(row),
      asText(row.dataset_id || row.id),
      asText(row.dataset_version || row.version) || "00.00.001",
    ].join(":");
  }

  function supportDecisionKey(row) {
    return [
      asText(row.support_type || row.dataset_type || row.type),
      asText(row.source_support_id || row.dataset_id || row.id),
      asText(row.source_support_version || row.dataset_version || row.version) || "00.00.001",
    ].join(":");
  }

  function canonicalTarget(row, type) {
    const source = row ?? {};
    const target = source.canonical_target || source.target || {};
    return {
      id: asText(
        source.canonical_flow_id ||
          source.canonical_support_id ||
          source.canonical_id ||
          source.target_dataset_id ||
          target.id,
      ),
      version:
        asText(
          source.canonical_flow_version ||
            source.canonical_support_version ||
            source.canonical_version ||
            source.target_dataset_version ||
            target.version,
        ) || "00.00.001",
      uri: asText(source.canonical_uri || target.uri),
      short_description: textValue(
        source.canonical_short_description || source.short_description || target.short_description,
      ),
      type,
    };
  }

  function classificationDecisionCode(row) {
    const source = row ?? {};
    return asText(
      source.selected_code || source.code || source.leaf_code || source.class_id || source.cat_id,
    );
  }

  function decisionIsCompleteClassification(row, { datasetType = null } = {}) {
    const code = classificationDecisionCode(row);
    if (!code) return false;
    const categoryType = asText(row?.category_type ?? row?.categoryType);
    if (datasetType === "process" || categoryType === "process") {
      const level = asText(row?.classification_decision_level ?? row?.classificationDecisionLevel);
      if (level === "broad_section") return false;
      if (/^[A-Z]$/u.test(code) || /^\d{1,3}$/u.test(code)) return false;
    }
    if (categoryType === "flow-product") {
      const level = asText(row?.classification_decision_level ?? row?.classificationDecisionLevel);
      if (level === "broad_section") return false;
      if (/^\d{1,3}$/u.test(code)) return false;
    }
    return true;
  }

  function exchangePreservationHash(exchange) {
    const clone = cloneJson(exchange);
    delete clone.referenceToFlowDataSet;
    return jsonSha256(clone);
  }

  function rewriteProcessExchangeReferences(scope, identityByKey, maps, outDir) {
    const processFile = resolveRepoPath(scope.process_file);
    if (!processFile || !fileExists(processFile)) {
      return { rewritten_process_file: null, rewrite_rows: [] };
    }
    const payload = readJson(processFile);
    const exchanges = ensureArray(payload?.processDataSet?.exchanges?.exchange);
    const rewriteRows = [];
    exchanges.forEach((exchange, index) => {
      const ref = exchange?.referenceToFlowDataSet;
      const flowId = asText(ref?.["@refObjectId"]);
      const flowVersion = asText(ref?.["@version"]) || "00.00.001";
      const rootFlow = rootEntityForRef(maps, "flow", flowId, flowVersion);
      if (!rootFlow) return;
      // Reuse-by-reference is gated by an explicit reuse_existing_reference decision, NOT
      // by flow type. BAFU/USLCI only mint product flows (no reuse decision -> not rewritten
      // here), but a reference import like worldsteel can carry CANONICAL product/waste flows
      // (e.g. Hydrogen, treated water, scrap) that exist under the same UUID and must be
      // referenced, not minted as account-local duplicates. The decision check below is the
      // authoritative gate, so this stays a no-op for any flow without a reuse decision.
      const decision = identityByKey.get(`flow:${flowId}:${flowVersion}`);
      if (asText(decision?.decision) !== "reuse_existing_reference") return;
      const target = canonicalTarget(decision, "flow data set");
      if (!target.id) return;
      const beforePreservationHash = exchangePreservationHash(exchange);
      const previousReference = cloneJson(ref);
      exchange.referenceToFlowDataSet = {
        "@type": previousReference?.["@type"] || "flow data set",
        "@refObjectId": target.id,
        "@version": target.version,
        "@uri": target.uri || `../flows/${target.id}.json`,
        "common:shortDescription":
          decision.canonical_short_description ||
          previousReference?.["common:shortDescription"] ||
          target.short_description ||
          undefined,
      };
      const afterPreservationHash = exchangePreservationHash(exchange);
      rewriteRows.push({
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        exchange_index: index,
        source_flow_id: flowId,
        source_flow_version: flowVersion,
        canonical_flow_id: target.id,
        canonical_flow_version: target.version,
        // Carry the canonical flow's display name so downstream consumers (e.g. the
        // batch runner's deterministic identity apply) can set referenceToFlowDataSet
        // common:shortDescription to the real name instead of falling back to the UUID.
        canonical_short_description:
          asText(decision.canonical_short_description) || target.short_description || null,
        changed_path: "referenceToFlowDataSet",
        preserved_exchange_fields: beforePreservationHash === afterPreservationHash,
        before_preservation_hash: beforePreservationHash,
        after_preservation_hash: afterPreservationHash,
      });
    });
    if (rewriteRows.length === 0) {
      return { rewritten_process_file: null, rewrite_rows: [] };
    }
    const rewrittenFile = path.join(outDir, "rewritten-processes", `${scope.process_id}.json`);
    writeJson(rewrittenFile, payload);
    return {
      rewritten_process_file: repoRelativePath(rewrittenFile),
      rewrite_rows: rewriteRows,
    };
  }

  function blockRow(scope, dependency, code, message, requiredHumanAction) {
    return {
      schema_version: 1,
      blocked_process_id: scope.process_id,
      blocked_process_version: scope.process_version,
      blocking_dependency: dependency,
      reason: code,
      message,
      required_human_action: requiredHumanAction,
      rerun_command:
        "node scripts/foundry.mjs dataset-library-decisions-apply --library-index <library-index> --decisions-dir <decisions-dir> --out-dir <library-resolution>",
    };
  }

  function identityPreflightReportPath(row) {
    const explicit =
      row.expected_report_file ||
      row.identity_decision_file ||
      row.identityDecisionFile ||
      row.report_file ||
      row.reportFile;
    if (explicit) return resolveRepoPath(explicit);
    const outputDir = row.output_dir || row.outputDir;
    return outputDir
      ? path.join(resolveRepoPath(outputDir), "outputs", "identity-decision.json")
      : null;
  }

  function identityPreflightCandidatePath(row) {
    const explicit = row.expected_candidates_file || row.candidates_file || row.candidatesFile;
    if (explicit) return resolveRepoPath(explicit);
    const outputDir = row.output_dir || row.outputDir;
    return outputDir
      ? path.join(resolveRepoPath(outputDir), "outputs", "identity-candidates.jsonl")
      : null;
  }

  function identityPreflightKey(row) {
    return [
      asText(row.dataset_type || row.type || "flow"),
      asText(row.dataset_id || row.source_dataset_id || row.entity_id || row.id),
      asText(row.dataset_version || row.source_dataset_version || row.version) || "00.00.001",
    ].join(":");
  }

  function compactIdentityText(value) {
    return normalizedText(value)
      .replace(/[^a-z0-9]+/gu, "")
      .trim();
  }

  function identityTokens(value) {
    return normalizedText(value)
      .replace(/[^a-z0-9]+/gu, " ")
      .split(/\s+/u)
      .filter((token) => token.length >= 2 && !["the", "and", "with"].includes(token));
  }

  function normalizedCas(value) {
    // BAFU/ecoinvent zero-pads CAS numbers ("000124-38-9"); the remote library stores the
    // canonical unpadded form ("124-38-9"). Compare without leading zeros.
    return String(value ?? "")
      .trim()
      .replace(/[^0-9-]+/gu, "")
      .replace(/^0+(?=\d)/u, "");
  }

  function flowPropertyDimension(value) {
    const normalized = normalizedText(value);
    if (/\bkg\b|mass/u.test(normalized)) return "mass";
    if (/\b(kwh|mj)\b|energy|calorific/u.test(normalized)) return "energy";
    if (/\b(k?bq)\b|radioactiv/u.test(normalized)) return "radioactivity";
    if (/\b(n?m3|m\^?3)\b|volume/u.test(normalized)) return "volume";
    if (/\bm2a\b|area.*time|occupation/u.test(normalized)) return "area_time";
    if (/\b(ha|m2|m\^?2)\b|area/u.test(normalized)) return "area";
    if (/\b(tkm|personkm)\b|transport/u.test(normalized)) return "transport";
    if (/\b(km|m)\b|length|distance/u.test(normalized)) return "length";
    if (/\b(unit|p|person|item)\b/u.test(normalized)) return "count";
    return normalized || "unknown";
  }

  function categoryKind(categories) {
    const text = normalizedText(ensureArray(categories).join(" > "));
    if (!text) return null;
    if (/resource|resources|from ground|in ground|water resource|biotic|land/u.test(text)) {
      if (/occupation/u.test(text)) return "land_occupation";
      if (/transformation/u.test(text)) return "land_transformation";
      return "resource";
    }
    if (/emission|emissions/u.test(text)) {
      if (/air/u.test(text)) return "emission_air";
      if (/water|river|lake|sea|ocean/u.test(text)) return "emission_water";
      if (/soil/u.test(text)) return "emission_soil";
      return "emission";
    }
    return null;
  }

  function targetUsageStats(projectionRows) {
    const byFlow = new Map();
    for (const scope of projectionRows) {
      for (const ref of ensureArray(scope.usage_refs?.process_exchange_flow_refs)) {
        const key = `flow:${ref.flow_id}:${ref.flow_version || "00.00.001"}`;
        const stats = byFlow.get(key) ?? {
          input: 0,
          output: 0,
          other: 0,
          process_ids: new Set(),
        };
        const direction = normalizedText(ref.direction);
        if (direction === "input") stats.input += 1;
        else if (direction === "output") stats.output += 1;
        else stats.other += 1;
        if (scope.process_id) stats.process_ids.add(scope.process_id);
        byFlow.set(key, stats);
      }
    }
    return new Map(
      [...byFlow.entries()].map(([key, value]) => [
        key,
        { ...value, process_ids: [...value.process_ids].sort() },
      ]),
    );
  }

  function inferTargetCategoryKind({ targetNames, targetCategories, usage }) {
    const nameText = normalizedText(targetNames.join(" "));
    if (
      /^energy\b|energy from|crude oil|natural gas|coal|lignite|peat|uranium|ore|resource/u.test(
        nameText,
      )
    ) {
      return "resource";
    }
    if (/^occupation\b|land occupation/u.test(nameText)) return "land_occupation";
    if (/^transformation\b|land transformation/u.test(nameText)) return "land_transformation";
    if (/^water\b|water river|water lake|water ocean|groundwater/u.test(nameText)) {
      if ((usage?.input ?? 0) >= (usage?.output ?? 0)) return "resource";
    }
    const convertedKind = categoryKind(targetCategories);
    if (convertedKind) return convertedKind;
    if ((usage?.input ?? 0) > 0 && (usage?.output ?? 0) === 0) return "resource";
    if ((usage?.output ?? 0) > 0 && (usage?.input ?? 0) === 0) return "emission";
    return null;
  }

  function categoryCompatible(inferredKind, candidateKind) {
    if (!inferredKind || !candidateKind) return true;
    if (inferredKind === candidateKind) return true;
    if (inferredKind === "emission" && candidateKind.startsWith("emission")) return true;
    if (inferredKind.startsWith("emission") && candidateKind === "emission") return true;
    if (inferredKind === "resource" && candidateKind.startsWith("land_")) return true;
    return false;
  }

  function hasLongTermCategory(categories) {
    return /\blong\s*term\b|long-term/u.test(normalizedText(ensureArray(categories).join(" ")));
  }

  function overlapScore(leftNames, rightNames) {
    let best = 0;
    for (const left of leftNames) {
      const leftNormalized = normalizedText(left);
      const leftCompact = compactIdentityText(left);
      if (!leftCompact) continue;
      const leftTokens = new Set(identityTokens(left));
      for (const right of rightNames) {
        const rightNormalized = normalizedText(right);
        const rightCompact = compactIdentityText(right);
        if (!rightCompact) continue;
        if (leftCompact === rightCompact || leftNormalized === rightNormalized) {
          best = Math.max(best, 45);
          continue;
        }
        if (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact)) {
          best = Math.max(best, 32);
        }
        const rightTokens = new Set(identityTokens(right));
        const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
        const denominator = Math.max(1, Math.min(leftTokens.size, rightTokens.size));
        best = Math.max(best, Math.round((overlap / denominator) * 24));
      }
    }
    return best;
  }

  function candidateShortDescription(candidate) {
    return ensureArray(candidate?.names).find(Boolean) || candidate?.id || "";
  }

  const sourceClassificationCache = new Map();

  function entitySourceClassification(entity) {
    // The BAFU→TIDAS conversion writes a uniform default elementaryFlowCategorization
    // ("Emissions to air, unspecified") on every elementary flow, but preserves the real
    // ecoinvent compartment in tidasimport:sourceTrace.payload.sourceClassification.
    const sourceFile = asText(entity?.source_file) || ensureArray(entity?.source_files)[0];
    if (!sourceFile) return null;
    if (sourceClassificationCache.has(sourceFile)) return sourceClassificationCache.get(sourceFile);
    let result = null;
    const resolved = resolveRepoPath(sourceFile);
    if (resolved && fileExists(resolved)) {
      try {
        const payload = readJson(resolved);
        const tracePayload =
          payload?.flowDataSet?.flowInformation?.dataSetInformation?.["common:other"]?.[
            "tidasimport:sourceTrace"
          ]?.payload ?? null;
        const trace = tracePayload?.sourceClassification ?? null;
        if (trace && typeof trace === "object") {
          const category = normalizedText(trace.category || trace.localCategory);
          const subCategory = normalizedText(trace.subCategory || trace.localSubCategory);
          if (category) result = { category, subCategory };
        }
        // openLCA JSON-LD lane: the converter writes the same uniform "air, unspecified"
        // default as the BAFU lane and preserves the real FEDEFL compartment only in the
        // entity trace ("Elementary flows/emission/air/troposphere/rural"). Recover it.
        if (!result && normalizedText(tracePayload?.format) === "openlca-jsonld") {
          result = openLcaCompartmentClassification(tracePayload?.payload?.entity?.category);
        }
      } catch {
        result = null;
      }
    }
    sourceClassificationCache.set(sourceFile, result);
    return result;
  }

  function openLcaCompartmentClassification(categoryPath) {
    // Translate the FEDEFL "/"-delimited compartment path into the ecoinvent-style
    // {category, subCategory} shape that traceCompartment already maps onto remote ILCD
    // category patterns, so the openLCA lane reuses the BAFU-tested compartment tiering.
    const segments = String(categoryPath ?? "")
      .split("/")
      .map((segment) => normalizedText(segment))
      .filter((segment) => segment && segment !== "elementary flows" && segment !== "non-fedefl");
    if (segments.length === 0) return null;
    const direction = segments[0];
    const compartment = segments[1] ?? "";
    const subText = segments.slice(2).join(" ");
    if (direction === "resource") {
      return { category: `resource, ${compartment || "unspecified"}`, subCategory: "" };
    }
    if (direction !== "emission") return null;
    if (compartment === "air") {
      let subCategory = "";
      if (/indoor/u.test(subText)) subCategory = "indoor";
      else if (/stratosphere/u.test(subText)) subCategory = "stratosphere";
      else if (/urban/u.test(subText)) subCategory = "high. pop.";
      else if (/rural|troposphere|high/u.test(subText)) subCategory = "low. pop.";
      return { category: "emissions to air", subCategory };
    }
    if (compartment === "water") {
      let subCategory = "";
      if (/saline|ocean|sea/u.test(subText)) subCategory = "ocean";
      else if (/subterranean|ground/u.test(subText)) subCategory = "ground water";
      else if (/fresh|river|lake/u.test(subText)) subCategory = "river";
      return { category: "emissions to water", subCategory };
    }
    if (compartment === "ground") {
      let subCategory = "";
      if (/agricultur/u.test(subText)) subCategory = "agricultural";
      else if (/industri/u.test(subText)) subCategory = "industrial";
      else if (/forest/u.test(subText)) subCategory = "forest";
      return { category: "emissions to soil", subCategory };
    }
    return null;
  }

  function traceCompartment(sourceClassification) {
    if (!sourceClassification) return null;
    const { category, subCategory } = sourceClassification;
    let kind = null;
    if (/emissions? to air/u.test(category)) kind = "emission_air";
    else if (/emissions? to water/u.test(category)) kind = "emission_water";
    else if (/emissions? to soil/u.test(category)) kind = "emission_soil";
    else if (/resource/u.test(category)) kind = "resource";
    if (!kind) return null;
    const longTerm = /long[\s-]*term/u.test(subCategory);
    const base = subCategory.replace(/,?\s*long[\s-]*term/u, "").trim();
    // ecoinvent sub-compartment → remote (ILCD-style) third-level category pattern
    let pattern = null;
    if (kind === "emission_air") {
      if (/^low\.? ?pop\.?$/u.test(base)) pattern = /non-urban air|from high stacks/u;
      else if (/^high\.? ?pop\.?$/u.test(base)) pattern = /urban air close to ground/u;
      else if (/stratosphere/u.test(base)) pattern = /stratosphere/u;
      else if (/indoor/u.test(base)) pattern = /indoor/u;
      else if (!base || /unspecified/u.test(base)) pattern = /air, unspecified$/u;
    } else if (kind === "emission_water") {
      if (/^(river|lake)$/u.test(base)) pattern = /fresh water/u;
      else if (/ocean|sea/u.test(base)) pattern = /sea water/u;
      else if (/ground ?water/u.test(base))
        pattern = /ground water|fresh water|water, unspecified/u;
      else if (!base || /unspecified/u.test(base)) pattern = /water, unspecified$/u;
    } else if (kind === "emission_soil") {
      if (/agricultur/u.test(base)) pattern = /to agricultural soil/u;
      else if (/industri/u.test(base)) pattern = /industrial soil/u;
      else if (/forest/u.test(base)) pattern = /non-agricultural soil|soil, unspecified/u;
      else if (!base || /unspecified/u.test(base)) pattern = /soil, unspecified$/u;
    }
    // When the mapped sub-compartment has no remote candidate, the standard fallback is the
    // compartment's "unspecified" variant (long-term form when the source is long-term).
    const compartmentWord =
      kind === "emission_air" ? "air" : kind === "emission_water" ? "water" : "soil";
    const fallbackPattern =
      kind === "resource"
        ? null
        : longTerm
          ? new RegExp(`${compartmentWord}, unspecified \\(long-term\\)$`, "u")
          : new RegExp(`${compartmentWord}, unspecified$`, "u");
    return { kind, longTerm, subCategory: base, pattern, fallbackPattern };
  }

  function evaluateElementaryIdentityDecision({ entity, report, usage }) {
    const target = report?.target ?? {};
    const targetFields = target.fields ?? {};
    const targetNames = [
      ...ensureArray(target.names),
      entity.name,
      targetFields.name,
      target.identity_key,
    ].filter(Boolean);
    const targetCas = normalizedCas(targetFields.cas);
    const targetDimension = flowPropertyDimension(
      targetFields.flow_property || entity.flow_property_refs?.[0]?.short_description,
    );
    const targetCategories = ensureArray(targetFields.categories);
    const trace = traceCompartment(entitySourceClassification(entity));
    const inferredKind =
      trace?.kind ??
      inferTargetCategoryKind({
        targetNames,
        targetCategories,
        usage,
      });
    const targetHasLongTerm = trace ? trace.longTerm : hasLongTermCategory(targetCategories);
    const rawCandidates = ensureArray(report?.candidates);

    if (!report || typeof report !== "object") {
      return {
        decision: "block_unresolved",
        reason: "identity_preflight_report_missing_or_invalid",
        evidence: { target_dimension: targetDimension, inferred_category_kind: inferredKind },
      };
    }
    // A preflight "create_new" is a candidate suggestion, not an authoritative decision;
    // elementary flows may still match an existing remote flow, so evaluate candidates anyway.
    const preflightSuggestedCreateNew = report.decision === "create_new";

    const targetCompacts = targetNames.map((name) => compactIdentityText(name)).filter(Boolean);
    const BAFU_DEFAULT_ELEMENTARY_PATH =
      "emissions > emissions to air > emissions to air, unspecified";
    const targetCategoryText = normalizedText(targetCategories.join(" > "));
    // The converter writes this exact path as a default on most elementary flows; only treat
    // converted categories as evidence when they differ from the default.
    const targetCategoriesReliable =
      Boolean(targetCategoryText) && targetCategoryText !== BAFU_DEFAULT_ELEMENTARY_PATH;
    const scoredCandidates = rawCandidates.map((candidate, index) => {
      const fields = candidate?.fields ?? {};
      const candidateType = normalizedText(fields.type_of_dataset);
      const candidateNames = ensureArray(candidate?.names);
      const candidateCas = normalizedCas(fields.cas);
      const candidateDimension = flowPropertyDimension(fields.flow_property);
      const candidateCategories = ensureArray(fields.categories);
      const candidateCategoryText = normalizedText(candidateCategories.join(" > "));
      const candidateKind = categoryKind(candidateCategories);
      const nameScore = overlapScore(targetNames, candidateNames);
      const candidateCompacts = candidateNames
        .map((name) => compactIdentityText(name))
        .filter(Boolean);
      // Token-set equality covers word-order variants ("Heat, waste" ↔ "waste heat").
      const targetTokenSets = targetNames
        .map((name) => new Set(identityTokens(name)))
        .filter((tokens) => tokens.size >= 2);
      const tokenSetEqual = candidateNames.some((name) => {
        const candidateTokens = new Set(identityTokens(name));
        return (
          candidateTokens.size >= 2 &&
          targetTokenSets.some(
            (targetTokens) =>
              targetTokens.size === candidateTokens.size &&
              [...targetTokens].every((token) => candidateTokens.has(token)),
          )
        );
      });
      // Chemical-name inversion ("Ethane, 1,1,2,2-tetrachloro-" ↔ "1,1,2,2-tetrachloroethane"):
      // after separating digit locants, some permutation of the target's word tokens
      // concatenates to the candidate's word part and the digit multisets agree.
      const digitsOf = (value) =>
        Array.from(String(value).replace(/[^0-9]+/gu, ""))
          .sort()
          .join("");
      const wordPartOf = (value) => String(value).replace(/[0-9]+/gu, "");
      const permutationCompactEqual = candidateCompacts.some((cn) => {
        const candidateWord = wordPartOf(cn);
        if (candidateWord.length < 6) return false;
        const candidateDigits = digitsOf(cn);
        return targetNames.some((name) => {
          if (typeof name !== "string" || name.includes("|")) return false;
          if (digitsOf(compactIdentityText(name)) !== candidateDigits) return false;
          const tokens = identityTokens(name)
            .map((token) => wordPartOf(token))
            .filter((token) => token.length >= 2);
          if (tokens.length < 2 || tokens.length > 4) return false;
          if (tokens.join("").length !== candidateWord.length) return false;
          const permute = (rest, acc) => {
            if (rest.length === 0) return acc === candidateWord;
            if (!candidateWord.startsWith(acc)) return false;
            return rest.some((token, i) =>
              permute([...rest.slice(0, i), ...rest.slice(i + 1)], acc + token),
            );
          };
          return permute(tokens, "");
        });
      });
      // Minimum lengths guard against degenerate compacts (e.g. a non-Latin name whose
      // compact collapses to a single character) producing false equality/containment.
      const exactName =
        candidateCompacts.some((cn) => cn.length >= 3 && targetCompacts.includes(cn)) ||
        tokenSetEqual ||
        permutationCompactEqual;
      // Direction matters for containment: a candidate that extends the target name
      // ("ethane" → "1,2-dibromoethane") names a different substance. A candidate whose
      // tokens form a contiguous prefix or suffix run of the target name is the same
      // substance minus a qualifier/abbreviation ("CFC-12" suffix of "Methane,
      // dichlorodifluoro-, CFC-12"; "ammonium" prefix of "Ammonium, ion"; "chemical
      // oxygen demand" suffix of "COD, Chemical Oxygen Demand"), while mid-name runs
      // ("dump site" inside "Occupation, dump site, benthos") stay manual.
      const targetTokenLists = targetNames
        .filter((name) => typeof name === "string" && !name.includes("|"))
        .map((name) => identityTokens(name))
        .filter((tokens) => tokens.length >= 1);
      const candidateInTarget = candidateNames.some((name) => {
        const candidateTokens = identityTokens(name);
        if (candidateTokens.length < 1) return false;
        const candidateCompact = compactIdentityText(name);
        if (candidateCompact.length < 4) return false;
        const candidateDigits = digitsOf(candidateCompact);
        const joined = candidateTokens.join(" ");
        return targetTokenLists.some((targetTokens) => {
          if (targetTokens.length < candidateTokens.length) return false;
          // Digit locants are substance identity ("1-Butanol" ≠ "2-butanol"): a digit-
          // bearing candidate must carry the same digits; a digit-free candidate is the
          // generic form and may stand for the locant-specified target.
          if (candidateDigits && candidateDigits !== digitsOf(targetTokens.join(""))) {
            return false;
          }
          const prefix = targetTokens.slice(0, candidateTokens.length).join(" ");
          const suffix = targetTokens.slice(-candidateTokens.length).join(" ");
          return prefix === joined || suffix === joined;
        });
      });
      const nameTier = exactName ? 3 : candidateInTarget ? 2 : nameScore >= 24 ? 1 : 0;
      // Tier evidence (exact/permuted equality, prefix/suffix runs) earns at least the
      // corresponding overlap score even when raw compact/token overlap misses it.
      const effectiveNameScore =
        nameTier === 3
          ? Math.max(nameScore, 45)
          : nameTier === 2
            ? Math.max(nameScore, 32)
            : nameScore;
      const sameCas = Boolean(targetCas && candidateCas && targetCas === candidateCas);
      const casConflict = Boolean(targetCas && candidateCas && targetCas !== candidateCas);
      const exactCompartmentMatched = Boolean(trace?.pattern?.test(candidateCategoryText));
      const fallbackCompartmentMatched = Boolean(
        trace?.fallbackPattern?.test(candidateCategoryText),
      );
      const compartmentFamilyMatched = exactCompartmentMatched || fallbackCompartmentMatched;
      const categoryOk = categoryCompatible(inferredKind, candidateKind);
      let dimensionCompatible =
        targetDimension === "unknown" ||
        candidateDimension === "unknown" ||
        targetDimension === candidateDimension;
      let dimensionLabelOverridden = false;
      // The candidate category naming the target's dimension family ("Renewable energy
      // resources …" for an energy target) contradicts the conflicting property label and
      // marks the label as unreliable for that row.
      const categoryIndicatesTargetDimension =
        (targetDimension === "energy" && /energy resources/u.test(candidateCategoryText)) ||
        (targetDimension === "mass" &&
          /(?:material|element) resources/u.test(candidateCategoryText));
      if (
        !dimensionCompatible &&
        !casConflict &&
        ((exactName && compartmentFamilyMatched) ||
          (nameTier >= 2 && categoryOk && categoryIndicatesTargetDimension))
      ) {
        // The remote search response carries the flow-property *label* text, which is
        // mislabeled on some remote rows (verified: ILCD "waste heat" references
        // 93a60a56-a3c8-11da-a746-0800200c9a66 = Net calorific value, but its embedded
        // shortDescription reads "Radioactivity"). With an exact name and matching
        // compartment — or a near-exact name whose category names the target dimension —
        // treat the label conflict as extraction noise instead of a veto.
        dimensionCompatible = true;
        dimensionLabelOverridden = true;
      }
      const candidateLongTerm = hasLongTermCategory(candidateCategories);
      const longTermPenalty = targetHasLongTerm
        ? candidateLongTerm
          ? 0
          : 8
        : candidateLongTerm
          ? 8
          : 0;
      const sameCategoryPath = targetCategoriesReliable
        ? candidateCategoryText === targetCategoryText
        : false;
      const legacyAirUnspecifiedBonus =
        !trace &&
        inferredKind === "emission_air" &&
        /emissions to air.*unspecified/u.test(candidateCategoryText)
          ? 14
          : 0;
      const baseScore =
        (sameCas ? 50 : 0) +
        effectiveNameScore +
        (dimensionCompatible ? 20 : -40) +
        (categoryOk ? 20 : -35) +
        (sameCategoryPath ? 14 : 0) +
        legacyAirUnspecifiedBonus -
        longTermPenalty;
      const blockerCodes = [];
      if (candidateType !== "elementary flow") blockerCodes.push("candidate_not_elementary_flow");
      if (casConflict) blockerCodes.push("cas_conflict");
      if (!dimensionCompatible) blockerCodes.push("flow_property_dimension_conflict");
      if (!categoryOk) blockerCodes.push("category_or_compartment_conflict");
      if (!sameCas && effectiveNameScore < 24)
        blockerCodes.push("insufficient_name_or_cas_overlap");
      // Without a CAS anchor, a candidate whose name merely extends or loosely overlaps
      // the target is not auto-acceptable evidence of the same substance.
      if (!sameCas && nameTier < 2) blockerCodes.push("name_tier_insufficient_without_cas");
      return {
        candidate,
        index,
        fields,
        candidateNames,
        candidateCas,
        candidateCategories,
        nameScore,
        nameTier,
        exactCompartmentMatched,
        fallbackCompartmentMatched,
        compartmentMatched: false,
        dimensionLabelOverridden,
        sameCas,
        score: baseScore,
        blockerCodes,
      };
    });
    const passingCandidates = scoredCandidates.filter(
      (candidate) => candidate.blockerCodes.length === 0,
    );
    // Decide the sub-compartment tier from candidates that actually pass the guardrails so a
    // cas-conflicted other substance with the mapped sub-compartment cannot mask the fallback.
    const useExactCompartment = passingCandidates.some(
      (candidate) => candidate.exactCompartmentMatched,
    );
    for (const candidate of passingCandidates) {
      candidate.compartmentMatched = trace
        ? useExactCompartment
          ? candidate.exactCompartmentMatched
          : candidate.fallbackCompartmentMatched
        : false;
      if (trace && candidate.compartmentMatched) candidate.score += 14;
    }
    const candidates = passingCandidates.sort(
      (left, right) =>
        right.score - left.score ||
        right.nameTier - left.nameTier ||
        right.nameScore - left.nameScore ||
        left.index - right.index,
    );

    if (candidates.length === 0) {
      return {
        decision: "block_unresolved",
        reason:
          rawCandidates.length === 0
            ? preflightSuggestedCreateNew
              ? "elementary_flow_create_new_forbidden"
              : "no_candidates"
            : preflightSuggestedCreateNew
              ? "elementary_flow_create_new_forbidden"
              : "no_candidate_passed_guardrails",
        evidence: {
          preflight_status: report.status ?? null,
          preflight_decision: report.decision ?? null,
          target_dimension: targetDimension,
          inferred_category_kind: inferredKind,
          source_trace_compartment: trace
            ? { kind: trace.kind, sub_category: trace.subCategory, long_term: trace.longTerm }
            : null,
          candidate_count: rawCandidates.length,
          rejected_candidate_examples: scoredCandidates.slice(0, 8).map((scored) => ({
            index: scored.index,
            id: scored.candidate?.id ?? null,
            version: scored.candidate?.version ?? null,
            names: scored.candidateNames.slice(0, 3),
            fields: scored.candidate?.fields ?? null,
            blocker_codes: scored.blockerCodes,
            name_tier: scored.nameTier,
            same_cas: scored.sameCas,
            score: scored.score,
          })),
        },
      };
    }

    const bestTier = Math.max(...candidates.map((candidate) => candidate.nameTier));
    const tieredCandidates =
      bestTier >= 2
        ? candidates.filter((candidate) => candidate.nameTier >= 2 || candidate.sameCas)
        : candidates;
    const top = tieredCandidates[0];
    const competing = tieredCandidates.slice(1).filter(
      (candidate) =>
        top.score - candidate.score < 10 &&
        normalizedText(candidate.candidateCategories.join(" > ")) !==
          normalizedText(top.candidateCategories.join(" > ")) &&
        // A candidate that misses the source-trace compartment pattern does not compete
        // with one that hits it (e.g. "(long-term)" variants against a non-long-term target).
        !(top.compartmentMatched && !candidate.compartmentMatched),
    );
    if (top.score < 72 || competing.length > 0) {
      return {
        decision: "block_unresolved",
        reason: competing.length > 0 ? "multiple_plausible_candidates" : "candidate_score_too_low",
        evidence: {
          preflight_status: report.status ?? null,
          preflight_decision: report.decision ?? null,
          target_dimension: targetDimension,
          inferred_category_kind: inferredKind,
          source_trace_compartment: trace
            ? { kind: trace.kind, sub_category: trace.subCategory, long_term: trace.longTerm }
            : null,
          best_score: top.score,
          best_candidate: {
            id: top.candidate.id,
            version: top.candidate.version,
            names: top.candidateNames,
            categories: top.candidateCategories,
            flow_property: top.fields.flow_property ?? null,
          },
          competing_candidates: competing.slice(0, 5).map((candidate) => ({
            id: candidate.candidate.id,
            version: candidate.candidate.version,
            names: candidate.candidateNames,
            categories: candidate.candidateCategories,
            score: candidate.score,
          })),
        },
      };
    }

    return {
      decision: "reuse_existing_reference",
      reason: "single_candidate_passed_physical_guardrails",
      candidate: top.candidate,
      evidence: {
        preflight_status: report.status ?? null,
        preflight_decision: report.decision ?? null,
        target_names: targetNames.slice(0, 6),
        target_cas: targetCas || null,
        target_dimension: targetDimension,
        target_categories: targetCategories,
        inferred_category_kind: inferredKind,
        source_trace_compartment: trace
          ? { kind: trace.kind, sub_category: trace.subCategory, long_term: trace.longTerm }
          : null,
        preflight_suggested_create_new: preflightSuggestedCreateNew || undefined,
        usage: usage
          ? {
              input: usage.input,
              output: usage.output,
              other: usage.other,
              process_count: usage.process_ids.length,
            }
          : null,
        selected_candidate: {
          id: top.candidate.id,
          version: top.candidate.version,
          names: top.candidateNames,
          cas: top.candidateCas || null,
          flow_property: top.fields.flow_property ?? null,
          categories: top.candidateCategories,
          score: top.score,
          name_tier: top.nameTier,
          compartment_matched: top.compartmentMatched,
          flow_property_label_overridden: top.dimensionLabelOverridden || undefined,
        },
        guardrails: [
          "same elementary flow type",
          "compatible flow property dimension",
          "compatible compartment/resource meaning",
          top.sameCas ? "same CAS" : "sufficient name/synonym overlap",
        ],
      },
    };
  }

  function runDatasetLibraryIdentityDecisionsFromPreflight(options) {
    if (options.help) {
      return help(
        "dataset-library-identity-decisions-from-preflight",
        "Aggregate elementary-flow identity preflight reports into library-level reuse decisions and manual-review ledgers.",
        [
          "node scripts/foundry.mjs dataset-library-identity-decisions-from-preflight --library-index <run-dir>/library-index --identity-preflight-index <identity-preflight-requests.jsonl> --out-dir <run-dir>/decisions",
        ],
      );
    }
    const indexDir = libraryIndexDirOption(options);
    if (!indexDir || !directoryExists(indexDir)) {
      throw new Error("--library-index is required.");
    }
    const entityIndexPath = path.join(indexDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(indexDir, "scope-projection.jsonl");
    if (!fileExists(entityIndexPath) || !fileExists(scopeProjectionPath)) {
      throw new Error(
        "--library-index must contain library-entity-index.jsonl and scope-projection.jsonl.",
      );
    }
    const preflightIndexPath = resolveRepoPath(
      options.identityPreflightIndex || options.preflightIndex || options.index,
    );
    if (!preflightIndexPath || !fileExists(preflightIndexPath)) {
      throw new Error("--identity-preflight-index is required.");
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(indexDir), "decisions"),
    );
    const entityRows = readJsonLines(entityIndexPath);
    const projectionRows = readJsonLines(scopeProjectionPath);
    const usedEntityKeys = new Set(
      projectionRows.flatMap((scope) =>
        ensureArray(scope.dependency_ids?.flows).map((dep) => dep.entity_key),
      ),
    );
    const usageByFlow = targetUsageStats(projectionRows);
    const preflightRows = readJsonLines(preflightIndexPath);
    const preflightByKey = new Map(preflightRows.map((row) => [identityPreflightKey(row), row]));
    const elementaryRows = entityRows.filter(
      (row) =>
        row.dataset_type === "flow" &&
        /^elementary flow$/iu.test(row.flow_type) &&
        usedEntityKeys.has(row.entity_key),
    );

    const decisions = [];
    const manualReviewRows = [];
    const reasonCounts = new Map();
    for (const entity of elementaryRows) {
      const key = `flow:${entity.dataset_id}:${entity.dataset_version || "00.00.001"}`;
      const preflightRow = preflightByKey.get(key);
      const reportPath = preflightRow ? identityPreflightReportPath(preflightRow) : null;
      const candidatesPath = preflightRow ? identityPreflightCandidatePath(preflightRow) : null;
      let report = null;
      if (reportPath && fileExists(reportPath)) {
        try {
          report = readJson(reportPath);
        } catch {
          report = null;
        }
      }
      const evaluation = evaluateElementaryIdentityDecision({
        entity,
        report,
        usage: usageByFlow.get(key),
      });
      increment(reasonCounts, evaluation.reason);
      if (evaluation.decision === "reuse_existing_reference") {
        const candidate = evaluation.candidate;
        decisions.push({
          schema_version: 1,
          dataset_type: "flow",
          source_dataset_id: entity.dataset_id,
          source_dataset_version: entity.dataset_version || "00.00.001",
          dataset_id: entity.dataset_id,
          dataset_version: entity.dataset_version || "00.00.001",
          source_entity_key: entity.entity_key,
          decision: "reuse_existing_reference",
          identity_decision: "reuse_existing_reference",
          decision_status: "completed",
          canonical_flow_id: candidate.id,
          canonical_flow_version: candidate.version || "00.00.001",
          canonical_short_description: candidateShortDescription(candidate),
          canonical: {
            table: "flows",
            ref_object_id: candidate.id,
            version: candidate.version || "00.00.001",
            short_description: candidateShortDescription(candidate),
          },
          basis:
            "Selected from identity-preflight candidates because exactly one existing elementary flow passed physical-equivalence guardrails.",
          confidence: evaluation.evidence?.selected_candidate?.score >= 95 ? "high" : "medium",
          used_context_kinds: ["library_index", "scope_projection", "identity_preflight"],
          closes_action_items: ["elementary_flow_identity_manual_review"],
          physical_equivalence_evidence: evaluation.reason,
          evidence: {
            ...evaluation.evidence,
            identity_preflight_report: repoRelativeMaybe(reportPath),
            identity_preflight_candidates: repoRelativeMaybe(candidatesPath),
          },
        });
      } else {
        manualReviewRows.push({
          schema_version: 1,
          dataset_type: "flow",
          source_dataset_id: entity.dataset_id,
          source_dataset_version: entity.dataset_version || "00.00.001",
          dataset_id: entity.dataset_id,
          dataset_version: entity.dataset_version || "00.00.001",
          source_entity_key: entity.entity_key,
          source_name: entity.name,
          decision: "block_unresolved",
          identity_decision: "block_unresolved",
          decision_status: "blocked_manual_review",
          reason: evaluation.reason,
          required_human_action:
            "Review identity-preflight candidates and provide reuse_existing_reference only when physical equivalence is proven; otherwise keep dependent process scopes deferred.",
          evidence: {
            ...evaluation.evidence,
            identity_preflight_report: repoRelativeMaybe(reportPath),
            identity_preflight_candidates: repoRelativeMaybe(candidatesPath),
          },
        });
      }
    }

    const decisionPath = path.join(outDir, "identity-decisions.jsonl");
    const manualReviewPath = path.join(outDir, "identity-decisions.manual-review.jsonl");
    const reportPath = path.join(
      outDir,
      "dataset-library-identity-decisions-from-preflight-report.json",
    );
    writeJsonLines(decisionPath, decisions);
    writeJsonLines(manualReviewPath, manualReviewRows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: manualReviewRows.length > 0 ? "completed_with_manual_review" : "completed",
      command: "dataset-library-identity-decisions-from-preflight",
      library_index: repoRelativePath(indexDir),
      identity_preflight_index: repoRelativePath(preflightIndexPath),
      counts: {
        elementary_flows: elementaryRows.length,
        reuse_existing_reference: decisions.length,
        manual_review: manualReviewRows.length,
        preflight_rows: preflightRows.length,
      },
      reason_counts: sortedCountObject(reasonCounts),
      files: {
        report: repoRelativePath(reportPath),
        identity_decisions: repoRelativePath(decisionPath),
        manual_review: repoRelativePath(manualReviewPath),
      },
      policy: {
        elementary_flows_reference_only: true,
        create_new_for_elementary_flows: "forbidden",
        automatic_reuse_requires_physical_equivalence: true,
      },
      blockers: manualReviewRows.slice(0, 25).map((row) => ({
        code: row.reason,
        dataset_id: row.source_dataset_id,
        dataset_version: row.source_dataset_version,
        message:
          "Elementary flow identity requires human review before dependent process scopes can write.",
      })),
    };
    writeJson(reportPath, report);
    return report;
  }

  function increment(map, key, count = 1) {
    const normalizedKey = asText(key) || "unknown";
    map.set(normalizedKey, (map.get(normalizedKey) ?? 0) + count);
  }

  function sortedCountObject(map) {
    return Object.fromEntries(
      [...map.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  function compactBlockingDependency(row) {
    const dependency = row.blocking_dependency ?? {};
    return {
      dataset_type: asText(dependency.dataset_type || dependency.type) || "unknown",
      id: asText(dependency.id || dependency.dataset_id),
      version: asText(dependency.version || dependency.dataset_version) || "00.00.001",
      reason: asText(row.reason) || "unknown",
      message: asText(row.message),
      required_human_action: asText(row.required_human_action),
    };
  }

  function blockerScopeKey(row) {
    return [
      asText(row.blocked_process_id || row.process_id),
      asText(row.blocked_process_version || row.process_version) || "00.00.001",
    ].join(":");
  }

  function buildBlockedScopeReport({ command, blockedRows, blockedLedgerPath, reportPath }) {
    const sampleLimit = 20;
    const reasonMap = new Map();
    const scopeMap = new Map();
    const dependencyTypeCounts = new Map();
    for (const row of blockedRows) {
      const reason = asText(row.reason) || "unknown";
      const dependency = compactBlockingDependency(row);
      increment(dependencyTypeCounts, dependency.dataset_type);

      if (!reasonMap.has(reason)) {
        reasonMap.set(reason, {
          reason,
          blocked_ledger_rows: 0,
          blocked_scope_ids: new Set(),
          blocking_dependency_types: new Map(),
          messages: new Set(),
          required_human_actions: new Set(),
          sample_blocking_dependencies: [],
        });
      }
      const reasonEntry = reasonMap.get(reason);
      reasonEntry.blocked_ledger_rows += 1;
      reasonEntry.blocked_scope_ids.add(asText(row.blocked_process_id));
      increment(reasonEntry.blocking_dependency_types, dependency.dataset_type);
      if (row.message) reasonEntry.messages.add(asText(row.message));
      if (row.required_human_action) {
        reasonEntry.required_human_actions.add(asText(row.required_human_action));
      }
      if (reasonEntry.sample_blocking_dependencies.length < sampleLimit) {
        reasonEntry.sample_blocking_dependencies.push({
          process_id: asText(row.blocked_process_id),
          process_version: asText(row.blocked_process_version) || "00.00.001",
          ...dependency,
        });
      }

      const scopeKey = blockerScopeKey(row);
      if (!scopeMap.has(scopeKey)) {
        scopeMap.set(scopeKey, {
          process_id: asText(row.blocked_process_id),
          process_version: asText(row.blocked_process_version) || "00.00.001",
          blocker_count: 0,
          reasons: new Map(),
          sample_blocking_dependencies: [],
          rerun_commands: new Set(),
        });
      }
      const scopeEntry = scopeMap.get(scopeKey);
      scopeEntry.blocker_count += 1;
      increment(scopeEntry.reasons, reason);
      if (row.rerun_command) scopeEntry.rerun_commands.add(asText(row.rerun_command));
      if (scopeEntry.sample_blocking_dependencies.length < sampleLimit) {
        scopeEntry.sample_blocking_dependencies.push(dependency);
      }
    }

    const reasonSummary = [...reasonMap.values()]
      .sort((left, right) => left.reason.localeCompare(right.reason))
      .map((entry) => ({
        reason: entry.reason,
        blocked_ledger_rows: entry.blocked_ledger_rows,
        blocked_scope_count: entry.blocked_scope_ids.size,
        blocking_dependency_types: sortedCountObject(entry.blocking_dependency_types),
        messages: [...entry.messages].sort(),
        required_human_actions: [...entry.required_human_actions].sort(),
        sample_blocking_dependencies: entry.sample_blocking_dependencies,
      }));
    const scopeSummary = [...scopeMap.values()]
      .sort((left, right) => left.process_id.localeCompare(right.process_id))
      .map((entry) => ({
        process_id: entry.process_id,
        process_version: entry.process_version,
        blocker_count: entry.blocker_count,
        reasons: sortedCountObject(entry.reasons),
        sample_blocking_dependencies: entry.sample_blocking_dependencies,
        sample_limit: sampleLimit,
        full_details_file: repoRelativePath(blockedLedgerPath),
        rerun_commands: [...entry.rerun_commands].sort(),
      }));
    return {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedRows.length > 0 ? "blocked_scopes_present" : "no_blocked_scopes",
      command,
      counts: {
        blocked_ledger_rows: blockedRows.length,
        blocked_scopes: scopeMap.size,
        blocker_reasons: reasonMap.size,
        blocking_dependency_types: sortedCountObject(dependencyTypeCounts),
      },
      reason_summary: reasonSummary,
      scope_summary: scopeSummary,
      files: {
        blocked_scope_report: repoRelativePath(reportPath),
        blocked_scope_ledger: repoRelativePath(blockedLedgerPath),
      },
      ledger_semantics:
        "blocked-scope-ledger.jsonl is the complete row-level blocker source of truth; this report is the per-run reader-facing summary.",
    };
  }

  function runDatasetLibraryDecisionsApply(options) {
    if (options.help) {
      return help(
        "dataset-library-decisions-apply",
        "Apply library-level decisions to process scopes and defer only scopes with unresolved closure.",
        [
          "node scripts/foundry.mjs dataset-library-decisions-apply --library-index <run-dir>/library-index --decisions-dir <run-dir>/decisions --out-dir <run-dir>/library-resolution",
        ],
      );
    }
    const allowAccountLocalSupportAndElementary =
      typeof profileFor === "function"
        ? Boolean(
            profileFor(
              repoRoot,
              asText(options.profile || "generic")
                .trim()
                .toLowerCase(),
              options,
            )?.allowAccountLocalSupportAndElementary,
          )
        : false;
    const indexDir = libraryIndexDirOption(options);
    if (!indexDir) throw new Error("--library-index is required.");
    const entityIndexPath = path.join(indexDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(indexDir, "scope-projection.jsonl");
    if (!fileExists(entityIndexPath) || !fileExists(scopeProjectionPath)) {
      throw new Error(
        "--library-index must contain library-entity-index.jsonl and scope-projection.jsonl.",
      );
    }
    const decisionsDir = resolveRepoPath(options.decisionsDir || options.decisions) || indexDir;
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(indexDir), "library-resolution"),
    );
    const entityRows = readJsonLines(entityIndexPath);
    const scopeRows = readJsonLines(scopeProjectionPath);
    const maps = entityMaps(entityRows);
    const identityRows = readDecisionRows(
      decisionsDir,
      "identity-decisions.jsonl",
      options.identityDecisions,
    );
    const classificationRows = readDecisionRows(
      decisionsDir,
      "classification-decisions.jsonl",
      options.classificationDecisions,
    );
    const supportRows = readDecisionRows(
      decisionsDir,
      "canonical-support-mappings.jsonl",
      options.canonicalSupportMappings,
    );
    const identityByKey = new Map(identityRows.map((row) => [identityDecisionKey(row), row]));
    const classificationByKey = new Map(
      classificationRows.map((row) => [classificationDecisionKey(row), row]),
    );
    const supportByKey = new Map(supportRows.map((row) => [supportDecisionKey(row), row]));
    const checkpoints = [];
    const blockedLedger = [];
    const readyScopes = [];
    const rewriteRows = [];

    for (const scope of scopeRows) {
      const blockers = [];
      const processClassification = classificationByKey.get(
        `process:${scope.process_id}:${scope.process_version || "00.00.001"}`,
      );
      if (!decisionIsCompleteClassification(processClassification, { datasetType: "process" })) {
        blockers.push(
          blockRow(
            scope,
            { dataset_type: "process", id: scope.process_id, version: scope.process_version },
            processClassification
              ? "process_classification_requires_leaf_authoring"
              : "process_classification_requires_authoring",
            processClassification
              ? "Process classification decision is only a broad section; BAFU import requires a full-context leaf classification before this scope can write."
              : "Process classification must be authored from full process meaning before this scope can write.",
            "Run semantic classification authoring and provide leaf classification-decisions.jsonl.",
          ),
        );
      }

      for (const dep of ensureArray(scope.dependency_ids?.flows)) {
        const entity = maps.byKey.get(dep.entity_key);
        if (entity && /^elementary flow$/iu.test(entity.flow_type)) {
          const decision = identityByKey.get(`flow:${dep.id}:${dep.version || "00.00.001"}`);
          const target = canonicalTarget(decision, "flow data set");
          if (
            !allowAccountLocalSupportAndElementary &&
            (asText(decision?.decision) !== "reuse_existing_reference" || !target.id)
          ) {
            blockers.push(
              blockRow(
                scope,
                { dataset_type: "flow", id: dep.id, version: dep.version },
                decision
                  ? "elementary_flow_reference_unresolved"
                  : "elementary_flow_requires_existing_database_match",
                "Elementary flow is reference-only for BAFU and must reuse an existing canonical TianGong flow when physically equivalent.",
                "Provide identity-decisions.jsonl with reuse_existing_reference and physical-equivalence evidence, or leave this scope deferred for human review.",
              ),
            );
          }
        } else {
          const classification = classificationByKey.get(
            `flow:${dep.id}:${dep.version || "00.00.001"}`,
          );
          if (!decisionIsCompleteClassification(classification)) {
            blockers.push(
              blockRow(
                scope,
                { dataset_type: "flow", id: dep.id, version: dep.version },
                "flow_classification_requires_authoring",
                "Product flow classification must be authored from full flow meaning before this scope can write.",
                "Run semantic classification authoring and provide classification-decisions.jsonl.",
              ),
            );
          }
        }
      }
      for (const dep of ensureArray(scope.dependency_ids?.flowproperties)) {
        const mapping = supportByKey.get(`flowproperty:${dep.id}:${dep.version || "00.00.001"}`);
        const target = canonicalTarget(mapping, "flow property data set");
        if (!target.id && !allowAccountLocalSupportAndElementary) {
          blockers.push(
            blockRow(
              scope,
              { dataset_type: "flowproperty", id: dep.id, version: dep.version },
              "canonical_flow_property_reference_unresolved",
              "Generated Flow Property support is reference-only and must map to public canonical support before this scope can write.",
              "Add canonical-support-mappings.jsonl with physical-dimension evidence or manually add canonical support to the database and rerun.",
            ),
          );
        }
      }
      for (const dep of ensureArray(scope.dependency_ids?.unitgroups)) {
        const mapping = supportByKey.get(`unitgroup:${dep.id}:${dep.version || "00.00.001"}`);
        const target = canonicalTarget(mapping, "unit group data set");
        if (!target.id && !allowAccountLocalSupportAndElementary) {
          blockers.push(
            blockRow(
              scope,
              { dataset_type: "unitgroup", id: dep.id, version: dep.version },
              "canonical_unit_group_reference_unresolved",
              "Generated Unit Group support is reference-only and must map to public canonical support before this scope can write.",
              "Add canonical-support-mappings.jsonl with unit evidence or manually add canonical support to the database and rerun.",
            ),
          );
        }
      }
      const rewrite = rewriteProcessExchangeReferences(scope, identityByKey, maps, outDir);
      rewriteRows.push(...rewrite.rewrite_rows);
      const state = blockers.length > 0 ? "blocked_deferred" : "ready";
      const checkpoint = {
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        state,
        blocker_count: blockers.length,
        bundle_dir: scope.bundle_dir,
        rewritten_process_file: rewrite.rewritten_process_file,
        dependency_counts: {
          flows: ensureArray(scope.dependency_ids?.flows).length,
          flowproperties: ensureArray(scope.dependency_ids?.flowproperties).length,
          unitgroups: ensureArray(scope.dependency_ids?.unitgroups).length,
        },
      };
      checkpoints.push(checkpoint);
      if (blockers.length > 0) {
        blockedLedger.push(...blockers);
      } else {
        readyScopes.push({ ...scope, closure_status: "ready", checkpoint });
      }
    }

    const checkpointPath = path.join(outDir, "scope-checkpoints.jsonl");
    const blockedPath = path.join(outDir, "blocked-scope-ledger.jsonl");
    const blockedReportPath = path.join(outDir, "blocked-scope-report.json");
    const readyPath = path.join(outDir, "ready-scopes.jsonl");
    const rewritePath = path.join(outDir, "exchange-reference-rewrites.jsonl");
    const resolutionPath = path.join(outDir, "library-resolution.json");
    writeJsonLines(checkpointPath, checkpoints);
    writeJsonLines(blockedPath, blockedLedger);
    const blockedReport = buildBlockedScopeReport({
      command: "dataset-library-decisions-apply",
      blockedRows: blockedLedger,
      blockedLedgerPath: blockedPath,
      reportPath: blockedReportPath,
    });
    writeJson(blockedReportPath, blockedReport);
    writeJsonLines(readyPath, readyScopes);
    writeJsonLines(rewritePath, rewriteRows);
    const resolution = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockedLedger.length > 0 ? "completed_with_deferred_scopes" : "completed",
      command: "dataset-library-decisions-apply",
      library_index: repoRelativePath(indexDir),
      decisions_dir: repoRelativeMaybe(decisionsDir),
      counts: {
        process_scopes: scopeRows.length,
        ready_scopes: readyScopes.length,
        blocked_scopes: checkpoints.filter((row) => row.state === "blocked_deferred").length,
        blocked_scope_ledger_rows: blockedLedger.length,
        identity_decisions: identityRows.length,
        classification_decisions: classificationRows.length,
        canonical_support_mappings: supportRows.length,
        exchange_reference_rewrites: rewriteRows.length,
      },
      ready_scope_ids: readyScopes.map((scope) => scope.process_id),
      blocked_scope_ids: checkpoints
        .filter((row) => row.state === "blocked_deferred")
        .map((row) => row.process_id),
      files: {
        library_resolution: repoRelativePath(resolutionPath),
        scope_checkpoints: repoRelativePath(checkpointPath),
        blocked_scope_ledger: repoRelativePath(blockedPath),
        blocked_scope_report: repoRelativePath(blockedReportPath),
        ready_scopes: repoRelativePath(readyPath),
        exchange_reference_rewrites: repoRelativePath(rewritePath),
      },
      policy: {
        process_scope_atomic_write: true,
        ready_scopes_do_not_wait_for_blocked_scopes: true,
        elementary_flows_reference_only: true,
        flowproperty_unitgroup_reference_only: true,
      },
      blockers: [],
    };
    writeJson(resolutionPath, resolution);
    return resolution;
  }

  function scopeRowsFromFile(scopeFile) {
    if (!scopeFile || !fileExists(scopeFile)) return [];
    if (scopeFile.toLowerCase().endsWith(".jsonl")) return readJsonLines(scopeFile);
    const value = readJson(scopeFile);
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.rows)) return value.rows;
    if (Array.isArray(value.scopes)) return value.scopes;
    return [value];
  }

  function commandArrayFromScope(scope, key) {
    const value =
      scope?.[key] ||
      scope?.checkpoint?.[key] ||
      scope?.handoff?.[key] ||
      scope?.commit_handoff?.[key];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return [];
  }

  function runScopeHandoffCommand(argv, { cwd, logDir, token, stage }) {
    if (!Array.isArray(argv) || argv.length === 0) return null;
    const stdoutLog = path.join(logDir, `${token}.${stage}.stdout.log`);
    const stderrLog = path.join(logDir, `${token}.${stage}.stderr.log`);
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd,
      env: process.env,
      encoding: "utf8",
    });
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(stdoutLog, result.stdout || "");
    fs.writeFileSync(stderrLog, result.stderr || "");
    const exitCode = typeof result.status === "number" ? result.status : 1;
    if (result.error) {
      return {
        stage,
        command: argv,
        exit_code: exitCode,
        error: String(result.error?.message || result.error),
        stdout_log: repoRelativePath(stdoutLog),
        stderr_log: repoRelativePath(stderrLog),
      };
    }
    return {
      stage,
      command: argv,
      exit_code: exitCode,
      stdout_log: repoRelativePath(stdoutLog),
      stderr_log: repoRelativePath(stderrLog),
    };
  }

  function runDatasetProcessScopeRun(options) {
    if (options.help) {
      return help(
        "dataset-process-scope-run",
        "Run only ready process scopes through a scope-locked dry-run or commit handoff queue.",
        [
          "node scripts/foundry.mjs dataset-process-scope-run --process-bundles-dir <.../process-bundles> --library-resolution <.../library-resolution.json> --scope-file <ready-scopes.jsonl> --parallel 5 --dry-run",
          "node scripts/foundry.mjs dataset-process-scope-run --process-bundles-dir <.../process-bundles> --library-resolution <.../library-resolution.json> --scope-file <ready-scopes.jsonl> --parallel 5 --commit",
        ],
      );
    }
    const processBundlesDir = resolveRepoPath(options.processBundlesDir || options.bundlesDir);
    if (!processBundlesDir || !directoryExists(processBundlesDir)) {
      throw new Error("--process-bundles-dir is required.");
    }
    const libraryResolutionPath = resolveRepoPath(options.libraryResolution || options.resolution);
    if (!libraryResolutionPath || !fileExists(libraryResolutionPath)) {
      throw new Error("--library-resolution is required.");
    }
    const resolution = readJson(libraryResolutionPath);
    const scopeFile = resolveRepoPath(options.scopeFile || resolution.files?.ready_scopes);
    const scopeRows = scopeRowsFromFile(scopeFile);
    const readyIds = new Set(ensureArray(resolution.ready_scope_ids));
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(libraryResolutionPath), "process-scope-run"),
    );
    const parallel = positiveIntegerOption(
      options.parallel,
      Math.min(12, Math.max(1, os.cpus().length - 1)),
    );
    const commit = booleanOption(options.commit);
    const dryRun = booleanOption(options.dryRun) || !commit;
    const checkpoints = [];
    const blocked = [];
    const selectedScopes = scopeRows.map((scope) => ({
      process_id: asText(scope.process_id || scope.id),
      process_version: asText(scope.process_version || scope.version) || "00.00.001",
      state: asText(scope.state || scope.closure_status || scope.checkpoint?.state),
      bundle_dir: scope.bundle_dir,
      rewritten_process_file:
        scope.rewritten_process_file || scope.checkpoint?.rewritten_process_file,
      commit_command: commandArrayFromScope(scope, "commit_command"),
      verify_command: commandArrayFromScope(scope, "verify_command"),
    }));
    const logDir = path.join(outDir, "logs");
    for (const scope of selectedScopes) {
      const isReady =
        readyIds.has(scope.process_id) || scope.state === "ready" || scope.state === "";
      if (!isReady) {
        const row = blockRow(
          scope,
          { dataset_type: "process", id: scope.process_id, version: scope.process_version },
          "scope_not_ready",
          "Only dependency-closed ready scopes can enter dry-run/write/verify queues.",
          "Resolve this scope in dataset-library-decisions-apply and rerun with the ready scope file.",
        );
        blocked.push(row);
        checkpoints.push({
          schema_version: 1,
          process_id: scope.process_id,
          process_version: scope.process_version,
          state: "blocked_deferred",
          reason: "scope_not_ready",
        });
        continue;
      }
      const commandStages = [];
      let state = dryRun ? "dry_run_planned" : "commit_handoff_planned";
      if (commit && scope.commit_command.length > 0) {
        const token = `${scope.process_id}-${scope.process_version}`.replace(
          /[^A-Za-z0-9_.-]+/gu,
          "-",
        );
        const commitStage = runScopeHandoffCommand(scope.commit_command, {
          cwd: process.cwd(),
          logDir,
          token,
          stage: "commit",
        });
        commandStages.push(commitStage);
        if (commitStage?.exit_code === 0 && scope.verify_command.length > 0) {
          const verifyStage = runScopeHandoffCommand(scope.verify_command, {
            cwd: process.cwd(),
            logDir,
            token,
            stage: "verify",
          });
          commandStages.push(verifyStage);
          state = verifyStage?.exit_code === 0 ? "verified" : "verify_failed";
        } else {
          state = commitStage?.exit_code === 0 ? "committed" : "commit_failed";
        }
      }
      checkpoints.push({
        schema_version: 1,
        process_id: scope.process_id,
        process_version: scope.process_version,
        state,
        scope_lock: `process:${scope.process_id}:${scope.process_version}`,
        parallel,
        bundle_dir: scope.bundle_dir,
        rewritten_process_file: scope.rewritten_process_file,
        remote_write_mode: commit ? "commit_handoff_required" : "read-only",
        command_stages: commandStages.filter(Boolean),
      });
    }
    const checkpointPath = path.join(outDir, "scope-checkpoints.jsonl");
    const blockedPath = path.join(outDir, "blocked-scope-ledger.jsonl");
    const blockedReportPath = path.join(outDir, "blocked-scope-report.json");
    const reportPath = path.join(outDir, "dataset-process-scope-run-report.json");
    writeJsonLines(checkpointPath, checkpoints);
    writeJsonLines(blockedPath, blocked);
    const blockedReport = buildBlockedScopeReport({
      command: "dataset-process-scope-run",
      blockedRows: blocked,
      blockedLedgerPath: blockedPath,
      reportPath: blockedReportPath,
    });
    writeJson(blockedReportPath, blockedReport);
    const commandFailures = checkpoints.filter((row) =>
      ["commit_failed", "verify_failed"].includes(row.state),
    );
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status:
        commandFailures.length > 0
          ? "failed"
          : blocked.length > 0
            ? "completed_with_deferred_scopes"
            : "completed",
      command: "dataset-process-scope-run",
      process_bundles_dir: repoRelativePath(processBundlesDir),
      library_resolution: repoRelativePath(libraryResolutionPath),
      scope_file: repoRelativeMaybe(scopeFile),
      mode: commit ? "commit" : "dry-run",
      parallel,
      counts: {
        selected_scopes: selectedScopes.length,
        ready_scopes_planned: checkpoints.filter((row) =>
          ["dry_run_planned", "commit_handoff_planned"].includes(row.state),
        ).length,
        committed: checkpoints.filter((row) => row.state === "committed").length,
        verified: checkpoints.filter((row) => row.state === "verified").length,
        command_failures: commandFailures.length,
        blocked_scopes_deferred: blocked.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        scope_checkpoints: repoRelativePath(checkpointPath),
        blocked_scope_ledger: repoRelativePath(blockedPath),
        blocked_scope_report: repoRelativePath(blockedReportPath),
      },
      policy: {
        ready_only_commit: true,
        blocked_scopes_do_not_enter_write_queue: true,
        process_scope_locking: true,
        commit_mode_requires_existing_finalize_mutation_handoff_verify_chain:
          "This command executes scope-provided commit/verify handoff commands only after the existing finalize/mutation-manifest/commit-handoff/post-write-verify chain has produced them. Without handoff commands, it creates scope-locked commit_handoff_planned checkpoints.",
      },
      blockers: commandFailures.map((row) => ({
        code: row.state,
        message: "Scope handoff command failed; inspect command stage logs.",
        process_id: row.process_id,
        process_version: row.process_version,
        command_stages: row.command_stages,
      })),
    };
    writeJson(reportPath, report);
    return report;
  }

  return {
    runDatasetLibraryIndexBuild,
    runDatasetLibraryAuthoringPlan,
    runDatasetLibraryIdentityDecisionsFromPreflight,
    runDatasetLibraryDecisionsApply,
    runDatasetProcessScopeRun,
    libraryScopeWorkflowTestHooks: {
      evaluateElementaryIdentityDecision,
      traceCompartment,
      entitySourceClassification,
      openLcaCompartmentClassification,
    },
  };
}
