import fs from "node:fs";
import path from "node:path";
import {
  authoringPackageEntriesFromGate,
  buildDatasetAuthoringTaskFromPackage,
  writeAuthoringTaskBatchManifest,
} from "./internal/authoring-task-workflow.ts";
import { sha256Text } from "./internal/hash-utils.ts";
import {
  asText,
  fileExists,
  nowIso,
  readJson,
  readText,
  repoRelativePath,
  resolveRepoPath,
  sanitizeFileName,
} from "./internal/runtime-io.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface AuthoringTaskBuildOptions extends JsonRecord {
  help?: unknown;
  curationGateReport?: string | null;
  gateReport?: string | null;
  report?: string | null;
  outDir?: string | null;
  sharedContextCacheDir?: string | null;
  contextCacheDir?: string | null;
  includeReady?: boolean | string;
  authoringPackage?: string | null;
  package?: string | null;
  input?: string | null;
  patchFile?: string;
  patch?: string;
  patchedRows?: string;
  out?: string;
  applyDir?: string;
}

interface AuthoringTaskBuildArgs {
  repoRoot?: string;
  options?: AuthoringTaskBuildOptions;
}

interface AuthoringPackageEntry extends JsonRecord {
  entity: unknown;
  package_ref: unknown;
  package_path: string | null;
  task_dir_name: string;
}

function snapshotAuthoringPackage(
  repoRoot: string | undefined,
  packagePath: string,
  snapshotDir: string,
): string {
  void repoRoot;
  const text = readText(packagePath);
  const sha256 = sha256Text(text);
  const parsed = path.parse(path.basename(packagePath));
  const snapshotPath = path.join(
    snapshotDir,
    `${parsed.name}.${sha256}.snapshot${parsed.ext || ".json"}`,
  );
  fs.mkdirSync(snapshotDir, { recursive: true });
  if (!fileExists(snapshotPath)) {
    fs.copyFileSync(packagePath, snapshotPath);
  }
  return snapshotPath;
}

export function runDatasetAuthoringTaskBuild({
  repoRoot,
  options = {},
}: AuthoringTaskBuildArgs = {}): JsonRecord {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-authoring-task-build",
      usage: [
        "node scripts/foundry.mjs dataset-authoring-task-build --authoring-package <package.json> --out-dir <task-dir>",
        "node scripts/foundry.mjs dataset-authoring-task-build --curation-gate-report <dataset-curation-gate-report.json> --out-dir <tasks-dir> [--shared-context-cache-dir <cache-dir>]",
        "node scripts/foundry.mjs dataset-authoring-task-build --package ./curation-gate/ai-authoring-packages/process-<uuid>.authoring-package.json --out-dir ./authoring-task",
      ],
      purpose:
        "Build Codex/skill-facing authoring tasks and strict patch templates from Foundry AI authoring packages. This command is local-only and never writes the database.",
    };
  }

  const curationGateReportInput =
    options.curationGateReport ?? options.gateReport ?? options.report;
  const curationGateReportPath = resolveRepoPath(repoRoot!, curationGateReportInput);
  if (curationGateReportPath) {
    if (!fileExists(curationGateReportPath)) {
      throw new Error("--curation-gate-report must point to dataset-curation-gate-report.json.");
    }
    const outDir = resolveRepoPath(
      repoRoot!,
      options.outDir || ".foundry/workspaces/dataset-authoring-tasks",
    );
    const sharedContextCacheDir = resolveRepoPath(
      repoRoot!,
      options.sharedContextCacheDir || options.contextCacheDir,
    );
    const includeReady = options.includeReady === true || options.includeReady === "true";
    const entries = authoringPackageEntriesFromGate(
      repoRoot!,
      curationGateReportPath,
      includeReady,
    ) as AuthoringPackageEntry[];
    const missingPackages = entries.filter(
      (entry) => !entry.package_path || !fileExists(entry.package_path),
    );
    if (missingPackages.length > 0) {
      return {
        schema_version: 1,
        generated_at_utc: nowIso(),
        status: "blocked_missing_authoring_packages",
        curation_gate_report: repoRelativePath(repoRoot!, curationGateReportPath),
        missing_packages: missingPackages.map((entry) => ({
          entity: entry.entity,
          authoring_package: entry.package_ref,
        })),
      };
    }
    const snapshotDir = path.join(outDir!, "authoring-package-snapshots");
    const snapshottedEntries = entries.map((entry) => ({
      ...entry,
      live_package_ref: entry.package_ref,
      live_package_path: entry.package_path,
      package_path: snapshotAuthoringPackage(repoRoot, entry.package_path!, snapshotDir),
    }));
    const tasks = snapshottedEntries.map((entry) =>
      buildDatasetAuthoringTaskFromPackage({
        repoRoot: repoRoot!,
        packagePath: entry.package_path,
        outDir: path.join(outDir!, entry.task_dir_name),
        options: {},
      }),
    );
    return writeAuthoringTaskBatchManifest(
      repoRoot!,
      outDir!,
      tasks,
      {
        curation_gate_report: repoRelativePath(repoRoot!, curationGateReportPath),
        include_ready: includeReady,
      },
      {
        sharedContextCacheDir,
      },
    );
  }

  const authoringPackageInput = options.authoringPackage ?? options.package ?? options.input;
  const packagePath = resolveRepoPath(repoRoot!, authoringPackageInput);
  const packagePayload =
    packagePath && fileExists(packagePath) ? readJson<JsonRecord>(packagePath) : null;
  const datasetType = asText(packagePayload?.dataset_type);
  const entityId = asText(packagePayload?.entity_id ?? packagePayload?.process_id);
  const defaultOut = `.foundry/workspaces/dataset-authoring-task/${datasetType || "dataset"}-${sanitizeFileName(entityId || "entity")}`;
  const outDir = resolveRepoPath(repoRoot!, options.outDir || defaultOut);
  const snapshotPath = packagePath
    ? snapshotAuthoringPackage(
        repoRoot,
        packagePath,
        path.join(outDir!, "authoring-package-snapshots"),
      )
    : packagePath;
  return buildDatasetAuthoringTaskFromPackage({
    repoRoot: repoRoot!,
    packagePath: snapshotPath!,
    outDir: outDir!,
    options,
  });
}
