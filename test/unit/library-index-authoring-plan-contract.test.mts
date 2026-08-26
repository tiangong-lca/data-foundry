import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createLibraryScopeWorkflowCommands } from "../../scripts/commands/library-scope-workflow.ts";
import {
  createLibraryEntityProjection,
  type JsonRecord,
  type LibraryEntityProjection,
} from "../../scripts/lib/library-orchestration/entity-projection.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = path.join(repoRoot, "tmp", "library-index-plan-contract");
const runRoot = path.join(fixtureRoot, "run");
const version = "00.00.001";
const generatedAt = "2026-08-26T12:34:56.000Z";
const ids = {
  process: "11111111-1111-5111-8111-111111111111",
  elementaryFlow: "22222222-2222-5222-8222-222222222222",
  productFlow: "33333333-3333-5333-8333-333333333333",
  flowProperty: "44444444-4444-5444-8444-444444444444",
  unitGroup: "55555555-5555-5555-8555-555555555555",
};

interface ArtifactFact {
  bytes: number;
  sha256: string;
}

interface IndexBuildModule {
  createLibraryIndexBuild: (dependencies: {
    asText: (value: unknown) => string;
    ensureArray: <T>(value: T | readonly T[] | null | undefined) => T[];
    nowIso: () => string;
    repoRelativePath: (filePath: string) => string;
    resolveRepoPath: (filePath: unknown) => string | null;
    projection: Pick<
      LibraryEntityProjection,
      "buildEntityIndex" | "entityMaps" | "projectionForBundle"
    >;
    files: {
      directoryExists: (filePath: string | null | undefined) => boolean;
      fileExists: (filePath: string | null | undefined) => boolean;
      listDirectoryNames: (directory: string) => string[];
      listJsonFiles: (directory: string) => string[];
      readJson: (filePath: string) => JsonRecord;
      writeJson: (filePath: string, value: unknown) => void;
      writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
    };
  }) => {
    run: (input: { sourceDir: string; processBundlesDir: string; outDir: string }) => JsonRecord;
  };
}

interface AuthoringPlanModule {
  createLibraryAuthoringPlan: (dependencies: {
    ensureArray: <T>(value: T | readonly T[] | null | undefined) => T[];
    nowIso: () => string;
    repoRelativePath: (filePath: string) => string;
    files: {
      fileExists: (filePath: string | null | undefined) => boolean;
      readJsonLines: (filePath: string) => JsonRecord[];
      writeJson: (filePath: string, value: unknown) => void;
      writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
    };
  }) => {
    run: (input: { indexDir: string; outDir: string; chunkSize: number }) => JsonRecord;
  };
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(textValue).find(Boolean) ?? "";
  return asText(record(value)["#text"]);
}

function ensureArray<T>(value: T | readonly T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value as T];
}

function sha256(value: unknown): string {
  return createHash("sha256").update(String(value)).digest("hex");
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function readJson(filePath: string): JsonRecord {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonRecord;
}

function readJsonLines(filePath: string): JsonRecord[] {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as JsonRecord) : [];
}

function fileExists(filePath: string | null | undefined): boolean {
  return typeof filePath === "string" && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function directoryExists(filePath: string | null | undefined): boolean {
  return (
    typeof filePath === "string" && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
  );
}

function repoRelativePath(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function resolveRepoPath(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  return path.isAbsolute(text) ? path.normalize(text) : path.resolve(repoRoot, text);
}

function listJsonFiles(directory: string): string[] {
  if (!directoryExists(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function listDirectoryNames(directory: string): string[] {
  if (!directoryExists(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function ml(text: string): JsonRecord {
  return { "@xml:lang": "en", "#text": text };
}

function administrativeInformation(): JsonRecord {
  return {
    administrativeInformation: {
      publicationAndOwnership: { "common:dataSetVersion": version },
    },
  };
}

function processPayload(): JsonRecord {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": ids.process,
          name: { baseName: ml("Plan process") },
        },
      },
      exchanges: {
        exchange: [
          {
            exchangeDirection: "Input",
            meanAmount: "2",
            referenceToFlowDataSet: {
              "@refObjectId": ids.elementaryFlow,
              "@version": version,
              "common:shortDescription": ml("Methane"),
            },
          },
          {
            exchangeDirection: "Output",
            meanAmount: "1",
            referenceToFlowDataSet: {
              "@refObjectId": ids.productFlow,
              "@version": version,
              "common:shortDescription": ml("Co-product"),
            },
          },
        ],
      },
      ...administrativeInformation(),
    },
  };
}

function flowPayload(id: string, name: string, typeOfDataSet: string): JsonRecord {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: { baseName: ml(name) },
          ...(typeOfDataSet === "Elementary flow"
            ? {
                classificationInformation: {
                  "common:elementaryFlowCategorization": {
                    "common:category": [
                      { "@level": "0", "#text": "Emissions" },
                      { "@level": "1", "#text": "Air" },
                    ],
                  },
                },
              }
            : {}),
        },
      },
      modellingAndValidation: { LCIMethod: { typeOfDataSet } },
      flowProperties: {
        flowProperty: {
          "@dataSetInternalID": "1",
          meanValue: "1",
          referenceToFlowPropertyDataSet: {
            "@refObjectId": ids.flowProperty,
            "@version": version,
            "common:shortDescription": ml("Mass"),
          },
        },
      },
      ...administrativeInformation(),
    },
  };
}

function flowPropertyPayload(): JsonRecord {
  return {
    flowPropertyDataSet: {
      flowPropertiesInformation: {
        dataSetInformation: {
          "common:UUID": ids.flowProperty,
          "common:name": ml("Mass"),
        },
        quantitativeReference: {
          referenceToReferenceUnitGroup: {
            "@refObjectId": ids.unitGroup,
            "@version": version,
            "common:shortDescription": ml("Units of mass"),
          },
        },
      },
      ...administrativeInformation(),
    },
  };
}

function unitGroupPayload(): JsonRecord {
  return {
    unitGroupDataSet: {
      unitGroupInformation: {
        dataSetInformation: {
          "common:UUID": ids.unitGroup,
          "common:name": ml("Units of mass"),
        },
      },
      units: { unit: { "@dataSetInternalID": "1", name: ml("kg"), meanValue: "1" } },
      ...administrativeInformation(),
    },
  };
}

function writeBundle(
  name: string,
  payloads: {
    process: JsonRecord;
    elementaryFlow: JsonRecord;
    productFlow: JsonRecord;
    flowProperty: JsonRecord;
    unitGroup: JsonRecord;
  },
): void {
  const bundleDir = path.join(fixtureRoot, "process-bundles", name);
  writeJson(path.join(bundleDir, `tidas/processes/${ids.process}.json`), payloads.process);
  writeJson(path.join(bundleDir, `tidas/flows/${ids.productFlow}.json`), payloads.productFlow);
  writeJson(
    path.join(bundleDir, `tidas/flows/${ids.elementaryFlow}.json`),
    payloads.elementaryFlow,
  );
  writeJson(
    path.join(bundleDir, `tidas/flowproperties/${ids.flowProperty}.json`),
    payloads.flowProperty,
  );
  writeJson(path.join(bundleDir, `tidas/unitgroups/${ids.unitGroup}.json`), payloads.unitGroup);
  writeJson(path.join(bundleDir, "manifest.json"), {
    schema_version: 1,
    process_id: ids.process,
    files: {
      contacts: [],
      sources: [],
      unitgroups: [`tidas/unitgroups/${ids.unitGroup}.json`],
      flowproperties: [`tidas/flowproperties/${ids.flowProperty}.json`],
      flows: [`tidas/flows/${ids.productFlow}.json`, `tidas/flows/${ids.elementaryFlow}.json`],
      processes: [`tidas/processes/${ids.process}.json`],
    },
    unresolved_references: [],
  });
}

function createFixture(): void {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const payloads = {
    process: processPayload(),
    elementaryFlow: flowPayload(ids.elementaryFlow, "Methane", "Elementary flow"),
    productFlow: flowPayload(ids.productFlow, "Co-product", "Product flow"),
    flowProperty: flowPropertyPayload(),
    unitGroup: unitGroupPayload(),
  };
  writeJson(path.join(fixtureRoot, `tidas/processes/${ids.process}.json`), payloads.process);
  writeJson(
    path.join(fixtureRoot, `tidas/flows/a-${ids.elementaryFlow}.json`),
    payloads.elementaryFlow,
  );
  writeJson(path.join(fixtureRoot, `tidas/flows/m-${ids.productFlow}.json`), payloads.productFlow);
  writeJson(
    path.join(fixtureRoot, `tidas/flows/z-${ids.elementaryFlow}-copy.json`),
    payloads.elementaryFlow,
  );
  writeJson(
    path.join(fixtureRoot, `tidas/flowproperties/${ids.flowProperty}.json`),
    payloads.flowProperty,
  );
  writeJson(path.join(fixtureRoot, `tidas/unitgroups/${ids.unitGroup}.json`), payloads.unitGroup);
  writeBundle("z-bundle", payloads);
  writeBundle("a-bundle", payloads);
  writeJson(path.join(fixtureRoot, "process-bundles/index.json"), {
    schema_version: 1,
    bundles: [
      {
        process_id: ids.process,
        bundle_id: "z-bundle",
        manifest: "z-bundle/manifest.json",
        tidas_dir: "z-bundle/tidas",
      },
      {
        process_id: ids.process,
        bundle_id: "a-bundle",
        manifest: "a-bundle/manifest.json",
        tidas_dir: "a-bundle/tidas",
      },
    ],
  });
}

function datasetRoot(payload: JsonRecord, type: string): JsonRecord {
  const keys: Record<string, string> = {
    process: "processDataSet",
    flow: "flowDataSet",
    flowproperty: "flowPropertyDataSet",
    unitgroup: "unitGroupDataSet",
  };
  return record(payload[keys[type] ?? ""]);
}

function datasetInformation(payload: JsonRecord, type: string): JsonRecord {
  const root = datasetRoot(payload, type);
  if (type === "process") return record(record(root.processInformation).dataSetInformation);
  if (type === "flow") return record(record(root.flowInformation).dataSetInformation);
  if (type === "flowproperty") {
    return record(record(root.flowPropertiesInformation).dataSetInformation);
  }
  return record(record(root.unitGroupInformation).dataSetInformation);
}

function datasetIdentity(value: unknown, type: string): { id: string; version: string } {
  const payload = record(value);
  const root = datasetRoot(payload, type);
  return {
    id: asText(datasetInformation(payload, type)["common:UUID"]),
    version:
      asText(
        record(record(root.administrativeInformation).publicationAndOwnership)[
          "common:dataSetVersion"
        ],
      ) || version,
  };
}

function flowTypeOfDataSet(payload: unknown): string {
  return asText(
    record(record(record(record(payload).flowDataSet).modellingAndValidation).LCIMethod)
      .typeOfDataSet,
  );
}

function physicalFiles() {
  return {
    directoryExists,
    fileExists,
    listDirectoryNames,
    listJsonFiles,
    readJson,
    readJsonLines,
    writeJson,
    writeJsonLines,
  };
}

function projection(): LibraryEntityProjection {
  return createLibraryEntityProjection({
    asText,
    bundleClassificationPath: () => "",
    datasetIdentity,
    ensureArray,
    flowTypeOfDataSet,
    jsonSha256: (value) => sha256(JSON.stringify(value)),
    repoRelativeMaybe: (filePath) => (filePath ? repoRelativePath(filePath) : null),
    repoRelativePath,
    sha256Text: sha256,
    textValue,
    files: { fileExists, readJson },
  });
}

function artifactPaths(): string[] {
  const indexDir = path.join(runRoot, "library-index");
  const planDir = path.join(runRoot, "authoring-plan");
  return [
    path.join(indexDir, "library-entity-index.jsonl"),
    path.join(indexDir, "scope-projection.jsonl"),
    path.join(indexDir, "dataset-library-index-build-report.json"),
    path.join(planDir, "identity-decisions.template.jsonl"),
    path.join(planDir, "classification-decisions.template.jsonl"),
    path.join(planDir, "canonical-support-mappings.template.jsonl"),
    path.join(planDir, "chunks/identity-decisions.chunk-0001.jsonl"),
    path.join(planDir, "chunks/classification-decisions.chunk-0001.jsonl"),
    path.join(planDir, "chunks/canonical-support-mappings.chunk-0001.jsonl"),
    path.join(planDir, "dataset-library-authoring-plan-report.json"),
  ];
}

const expectedFacts: Record<string, ArtifactFact> = {
  "library-index/library-entity-index.jsonl": {
    bytes: 5463,
    sha256: "d9720bd5b091f8c4e8e27739c703481552a186fdb74ac8b68bc9c8be2185db90",
  },
  "library-index/scope-projection.jsonl": {
    bytes: 3802,
    sha256: "458beae8a77243403f234967ad53024b3fc91c14a4505ac9e281795151b01ffd",
  },
  "library-index/dataset-library-index-build-report.json": {
    bytes: 955,
    sha256: "e34593b8deda6104cd44a6ae59ca266332b8df3724f231d63232658de2a07d9d",
  },
  "authoring-plan/identity-decisions.template.jsonl": {
    bytes: 593,
    sha256: "1e79c12e5cd31b6f3dab5d05a8aed6b5c7a0db47f25462a6027ee49a17f14af0",
  },
  "authoring-plan/classification-decisions.template.jsonl": {
    bytes: 1089,
    sha256: "42756481292d5e6f164c95213548f31152262d0e487b3bf7807b6c1ec31185eb",
  },
  "authoring-plan/canonical-support-mappings.template.jsonl": {
    bytes: 1590,
    sha256: "4312a6e38ecc7d4a6183ab2d6f965c6608fbdd1ad0369412329afaa80010774b",
  },
  "authoring-plan/chunks/identity-decisions.chunk-0001.jsonl": {
    bytes: 593,
    sha256: "1e79c12e5cd31b6f3dab5d05a8aed6b5c7a0db47f25462a6027ee49a17f14af0",
  },
  "authoring-plan/chunks/classification-decisions.chunk-0001.jsonl": {
    bytes: 1089,
    sha256: "42756481292d5e6f164c95213548f31152262d0e487b3bf7807b6c1ec31185eb",
  },
  "authoring-plan/chunks/canonical-support-mappings.chunk-0001.jsonl": {
    bytes: 1590,
    sha256: "4312a6e38ecc7d4a6183ab2d6f965c6608fbdd1ad0369412329afaa80010774b",
  },
  "authoring-plan/dataset-library-authoring-plan-report.json": {
    bytes: 1288,
    sha256: "ad4a725273ce13b06b6e76d8299cbc8b2c067492cadeeaf24581903bbded58d3",
  },
};

function assertArtifactFacts(paths: readonly string[]): Map<string, string> {
  const bytesByPath = new Map<string, string>();
  const actualFacts: Record<string, ArtifactFact> = {};
  for (const filePath of paths) {
    const key = repoRelativePath(filePath).replace("tmp/library-index-plan-contract/run/", "");
    const bytes = fs.readFileSync(filePath, "utf8");
    actualFacts[key] = {
      bytes: Buffer.byteLength(bytes),
      sha256: sha256(bytes),
    };
    bytesByPath.set(key, bytes);
  }
  assert.deepEqual(actualFacts, expectedFacts);
  return bytesByPath;
}

test("library index and authoring plan modules preserve exact realistic bundle artifacts", async (t) => {
  createFixture();
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const indexDir = path.join(runRoot, "library-index");
  const planDir = path.join(runRoot, "authoring-plan");
  const owner = createLibraryScopeWorkflowCommands({
    asText,
    booleanOption: (value, fallback = false) =>
      value === undefined ? fallback : value === true || value === "true",
    profileFor: () => ({}),
    repoRoot,
    bundleClassificationPath: () => "",
    cloneJson: (value) => JSON.parse(JSON.stringify(value)) as typeof value,
    datasetIdentity,
    directoryExists,
    ensureArray,
    fileExists,
    flowTypeOfDataSet,
    jsonSha256: (value) => sha256(JSON.stringify(value)),
    nowIso: () => generatedAt,
    positiveIntegerOption: (value, fallback) => {
      const parsed = Number.parseInt(asText(value), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    },
    readJson,
    readJsonLines,
    repoRelativeMaybe: (filePath) => (filePath ? repoRelativePath(filePath) : null),
    repoRelativePath,
    resolveRepoPath,
    sha256Text: sha256,
    textValue,
    writeJson,
    writeJsonLines,
  });
  const baselineIndexReport = owner.runDatasetLibraryIndexBuild({
    sourceDir: fixtureRoot,
    processBundlesDir: path.join(fixtureRoot, "process-bundles"),
    outDir: indexDir,
  });
  const baselinePlanReport = owner.runDatasetLibraryAuthoringPlan({
    libraryIndex: indexDir,
    outDir: planDir,
  });
  assert.equal(baselineIndexReport.status, "completed");
  assert.equal(baselinePlanReport.status, "ready_for_ai_library_decisions");

  const paths = artifactPaths();
  const baselineBytes = assertArtifactFacts(paths);
  const entityRows = readJsonLines(paths[0]);
  const scopeRows = readJsonLines(paths[1]);
  const identityTasks = readJsonLines(paths[3]);
  const classificationTasks = readJsonLines(paths[4]);
  const supportTasks = readJsonLines(paths[5]);
  assert.deepEqual(
    entityRows.map((row) => row.entity_key),
    [
      `flow:${ids.elementaryFlow}:${version}`,
      `flow:${ids.productFlow}:${version}`,
      `flowproperty:${ids.flowProperty}:${version}`,
      `process:${ids.process}:${version}`,
      `unitgroup:${ids.unitGroup}:${version}`,
    ],
  );
  assert.deepEqual(entityRows[0].source_files, [
    repoRelativePath(path.join(fixtureRoot, `tidas/flows/a-${ids.elementaryFlow}.json`)),
    repoRelativePath(path.join(fixtureRoot, `tidas/flows/z-${ids.elementaryFlow}-copy.json`)),
  ]);
  assert.equal(entityRows[0].duplicate_source_file_count, 2);
  assert.deepEqual(
    scopeRows.map((row) => row.bundle_dir),
    [
      repoRelativePath(path.join(fixtureRoot, "process-bundles/z-bundle")),
      repoRelativePath(path.join(fixtureRoot, "process-bundles/a-bundle")),
    ],
  );
  assert.deepEqual(Object.keys(entityRows[0]), [
    "schema_version",
    "entity_key",
    "dataset_type",
    "dataset_id",
    "dataset_version",
    "source_kind",
    "source_file",
    "payload_sha256",
    "semantic_key",
    "semantic_hash",
    "name",
    "classification_path",
    "flow_type",
    "reference_only",
    "references",
    "flow_property_refs",
    "source_files",
    "duplicate_source_file_count",
    "payload_hashes",
  ]);
  assert.deepEqual(Object.keys(scopeRows[0]), [
    "schema_version",
    "process_id",
    "process_version",
    "process_entity_key",
    "process_file",
    "bundle_dir",
    "manifest",
    "tidas_dir",
    "dependency_ids",
    "usage_refs",
    "estimated_weight",
    "closure_status",
    "unresolved_references",
  ]);
  assert.deepEqual(Object.keys(identityTasks[0]), [
    "schema_version",
    "decision",
    "dataset_type",
    "source_dataset_id",
    "source_dataset_version",
    "source_entity_key",
    "source_name",
    "flow_type",
    "classification_path",
    "required_resolution",
  ]);
  assert.deepEqual(Object.keys(classificationTasks[0]), [
    "schema_version",
    "dataset_type",
    "dataset_id",
    "dataset_version",
    "entity_key",
    "category_type",
    "selected_code",
    "basis",
    "confidence",
    "source_name",
    "converted_classification_reference",
    "required_resolution",
  ]);
  assert.deepEqual(Object.keys(supportTasks[0]), [
    "schema_version",
    "support_type",
    "source_support_id",
    "source_support_version",
    "source_entity_key",
    "source_name",
    "source_units",
    "source_reference_unit_group",
    "canonical_support_id",
    "canonical_support_version",
    "physical_dimension_evidence",
    "required_resolution",
  ]);
  assert.deepEqual(baselinePlanReport.counts, {
    identity_decisions: 1,
    classification_decisions: 2,
    canonical_support_mappings: 2,
    action_items: 5,
    chunks: 3,
  });
  assert.deepEqual(ensureArray(record(baselinePlanReport.files).chunks), [
    repoRelativePath(path.join(planDir, "chunks/identity-decisions.chunk-0001.jsonl")),
    repoRelativePath(path.join(planDir, "chunks/classification-decisions.chunk-0001.jsonl")),
    repoRelativePath(path.join(planDir, "chunks/canonical-support-mappings.chunk-0001.jsonl")),
  ]);
  assert.equal(
    baselineBytes.get("authoring-plan/identity-decisions.template.jsonl"),
    baselineBytes.get("authoring-plan/chunks/identity-decisions.chunk-0001.jsonl"),
  );
  assert.equal(
    baselineBytes.get("authoring-plan/classification-decisions.template.jsonl"),
    baselineBytes.get("authoring-plan/chunks/classification-decisions.chunk-0001.jsonl"),
  );
  assert.equal(
    baselineBytes.get("authoring-plan/canonical-support-mappings.template.jsonl"),
    baselineBytes.get("authoring-plan/chunks/canonical-support-mappings.chunk-0001.jsonl"),
  );

  fs.rmSync(runRoot, { recursive: true, force: true });
  const indexModule = (await import(
    new URL("../../scripts/lib/library-orchestration/index-build.ts", import.meta.url).href
  )) as IndexBuildModule;
  const authoringModule = (await import(
    new URL("../../scripts/lib/library-orchestration/authoring-plan.ts", import.meta.url).href
  )) as AuthoringPlanModule;
  const indexBuild = indexModule.createLibraryIndexBuild({
    asText,
    ensureArray,
    nowIso: () => generatedAt,
    repoRelativePath,
    resolveRepoPath,
    projection: projection(),
    files: physicalFiles(),
  });
  const authoringPlan = authoringModule.createLibraryAuthoringPlan({
    ensureArray,
    nowIso: () => generatedAt,
    repoRelativePath,
    files: physicalFiles(),
  });
  assert.deepEqual(
    indexBuild.run({
      sourceDir: fixtureRoot,
      processBundlesDir: path.join(fixtureRoot, "process-bundles"),
      outDir: indexDir,
    }),
    baselineIndexReport,
  );
  assert.deepEqual(
    authoringPlan.run({ indexDir, outDir: planDir, chunkSize: 200 }),
    baselinePlanReport,
  );
  for (const filePath of paths) {
    const key = repoRelativePath(filePath).replace("tmp/library-index-plan-contract/run/", "");
    assert.equal(fs.readFileSync(filePath, "utf8"), baselineBytes.get(key), key);
  }
});
