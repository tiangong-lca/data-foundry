import path from "node:path";

import type {
  BundleEntry,
  EntityRow,
  IndexedEntityType,
  JsonRecord,
  LibraryEntityProjection,
} from "./entity-projection.ts";

export interface LibraryIndexBuildInput {
  sourceDir: string;
  processBundlesDir: string;
  outDir: string;
}

export interface LibraryIndexBuildFileAdapters {
  directoryExists: (filePath: string | null | undefined) => boolean;
  fileExists: (filePath: string | null | undefined) => boolean;
  listDirectoryNames: (directory: string) => string[];
  listJsonFiles: (directory: string) => string[];
  readJson: (filePath: string) => JsonRecord;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

export interface LibraryIndexBuildDependencies {
  asText: (value: unknown) => string;
  ensureArray: <T>(value: T | readonly T[] | null | undefined) => T[];
  nowIso: () => string;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  projection: Pick<
    LibraryEntityProjection,
    "buildEntityIndex" | "entityMaps" | "projectionForBundle"
  >;
  files: LibraryIndexBuildFileAdapters;
}

export interface LibraryIndexBuild {
  buildEntityIndex: (sourceDir: string) => EntityRow[];
  processBundleEntries: (processBundlesDir: string) => BundleEntry[];
  run: (input: LibraryIndexBuildInput) => JsonRecord;
}

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

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

export function createLibraryIndexBuild({
  asText,
  ensureArray,
  nowIso,
  repoRelativePath,
  resolveRepoPath,
  projection,
  files,
}: LibraryIndexBuildDependencies): LibraryIndexBuild {
  function buildEntityIndex(sourceDir: string): EntityRow[] {
    const sourceFiles = indexedEntityTypes.flatMap((type) =>
      files.listJsonFiles(path.join(sourceDir, "tidas", typePlural[type])).map((sourceFile) => ({
        type,
        sourceFile,
        sourceKind: "root_tidas",
      })),
    );
    return projection.buildEntityIndex(sourceFiles);
  }

  function processBundleEntries(processBundlesDir: string): BundleEntry[] {
    function resolveBundlePath(value: unknown, expectedKind: "file" | "dir"): string | null {
      if (!value) return null;
      const text = asText(value);
      if (path.isAbsolute(text)) return text;
      const fromBundleRoot = path.join(processBundlesDir, text);
      if (
        (expectedKind === "file" && files.fileExists(fromBundleRoot)) ||
        (expectedKind === "dir" && files.directoryExists(fromBundleRoot))
      ) {
        return fromBundleRoot;
      }
      return resolveRepoPath(text);
    }

    const indexFile = path.join(processBundlesDir, "index.json");
    if (files.fileExists(indexFile)) {
      const index = files.readJson(indexFile);
      return ensureArray(index.bundles).map((value) => {
        const bundle = jsonRecord(value);
        const manifest = resolveBundlePath(bundle.manifest, "file");
        const tidasDir = resolveBundlePath(bundle.tidas_dir, "dir");
        const bundleDir = manifest
          ? path.dirname(manifest)
          : tidasDir
            ? path.dirname(tidasDir)
            : path.join(processBundlesDir, asText(bundle.process_id));
        return {
          process_id: asText(bundle.process_id),
          bundle_id: asText(bundle.bundle_id ?? bundle.process_id),
          bundle_dir: bundleDir,
          manifest: manifest || path.join(bundleDir, "manifest.json"),
          tidas_dir: tidasDir || path.join(bundleDir, "tidas"),
          index_row: bundle,
        };
      });
    }
    if (!files.directoryExists(processBundlesDir)) return [];
    return files
      .listDirectoryNames(processBundlesDir)
      .map((directoryName) => {
        const bundleDir = path.join(processBundlesDir, directoryName);
        return {
          process_id: directoryName,
          bundle_id: directoryName,
          bundle_dir: bundleDir,
          manifest: path.join(bundleDir, "manifest.json"),
          tidas_dir: path.join(bundleDir, "tidas"),
          index_row: null,
        };
      })
      .filter((entry) => files.fileExists(entry.manifest))
      .sort((left, right) => left.process_id.localeCompare(right.process_id));
  }

  function run({ sourceDir, processBundlesDir, outDir }: LibraryIndexBuildInput): JsonRecord {
    const entityRows = buildEntityIndex(sourceDir);
    const maps = projection.entityMaps(entityRows);
    const projectionRows = processBundleEntries(processBundlesDir).map((bundle) =>
      projection.projectionForBundle(bundle, maps),
    );
    const entityIndexPath = path.join(outDir, "library-entity-index.jsonl");
    const scopeProjectionPath = path.join(outDir, "scope-projection.jsonl");
    const reportPath = path.join(outDir, "dataset-library-index-build-report.json");
    files.writeJsonLines(entityIndexPath, entityRows);
    files.writeJsonLines(scopeProjectionPath, projectionRows);
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
          (row) => row.dataset_type === "flow" && /^elementary flow$/iu.test(row.flow_type ?? ""),
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
    files.writeJson(reportPath, report);
    return report;
  }

  return { buildEntityIndex, processBundleEntries, run };
}
