import fs from "node:fs";
import path from "node:path";
import { resolveInstalledTiangongLcaCliPackage } from "../../foundry-runtime-utils.mjs";
import { sha256Text } from "./hash-utils.mjs";
import {
  asText,
  directoryExists,
  ensureArray,
  fileExists,
  readJson,
  readText,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.mjs";

export const tidasSchemaSearchRoots = ["@tiangong-lca/cli@0.1.1/assets/tidas-schemas"];

export function tidasSchemaPath(repoRoot, schemaFile) {
  void repoRoot;
  const candidate = path.join(resolveInstalledTiangongLcaCliPackage().schemaDir, schemaFile);
  return fileExists(candidate) ? candidate : null;
}

export function loadTidasSchema(repoRoot, schemaFile) {
  const schemaPath = tidasSchemaPath(repoRoot, schemaFile);
  return schemaPath ? readJson(schemaPath) : null;
}

export function collectExplicitContextFiles(options) {
  return [
    ["contract_context", options.contractContext ?? options.contextFile],
    ["schema", options.schemaFile],
    ["methodology_yaml", options.yamlFile],
    ["ruleset", options.rulesetFile],
    ["contract", options.contractFile],
  ].filter(([, filePath]) => Boolean(filePath));
}

export function collectContextDirFiles(repoRoot, contextDir) {
  const resolvedDir = resolveRepoPath(repoRoot, contextDir);
  if (!directoryExists(resolvedDir)) return [];
  return fs
    .readdirSync(resolvedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(json|ya?ml|md|txt)$/iu.test(name))
    .sort()
    .map((name) => ["context_dir_file", path.join(resolvedDir, name)]);
}

export function firstTidasSchemaDir(repoRoot) {
  void repoRoot;
  const schemaDir = resolveInstalledTiangongLcaCliPackage().schemaDir;
  return directoryExists(schemaDir) ? schemaDir : null;
}

export function bundledCategorySchemaFileNames(repoRoot) {
  const schemaDir = firstTidasSchemaDir(repoRoot);
  if (!schemaDir) return [];
  return fs
    .readdirSync(schemaDir)
    .filter((name) => /^tidas_.*_category\.json$/u.test(name))
    .sort();
}

export function collectBundledSchemaContextFiles(repoRoot) {
  const schemaDir = firstTidasSchemaDir(repoRoot);
  if (!schemaDir) return [];
  const entries = [];
  for (const name of bundledCategorySchemaFileNames(repoRoot)) {
    if (name === "tidas_locations_category.json") continue;
    entries.push(["classification_schema", path.join(schemaDir, name)]);
  }
  entries.push(["location_schema", path.join(schemaDir, "tidas_locations_category.json")]);
  return entries;
}

export function readContextFiles(repoRoot, entries) {
  const files = [];
  const missing = [];
  const seen = new Set();
  for (const [kind, filePath] of entries) {
    const resolved = resolveRepoPath(repoRoot, filePath);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    if (!fileExists(resolved)) {
      missing.push({
        kind,
        path: path.isAbsolute(filePath) ? filePath : filePath,
      });
      continue;
    }
    files.push({
      kind,
      path: repoRelativePath(repoRoot, resolved),
      text: readText(resolved),
    });
  }
  return { files, missing };
}

export function normalizeFullContextAiCompletion(value) {
  const config = value && typeof value === "object" ? value : {};
  return {
    required: Boolean(config.required ?? config.require ?? false),
    datasetTypes: ensureArray(config.dataset_types ?? config.datasetTypes)
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean),
    requiredContextKinds: ensureArray(config.required_context_kinds ?? config.requiredContextKinds)
      .map((item) => String(item).trim())
      .filter(Boolean),
    requiredContextFilePatterns: ensureArray(
      config.required_context_file_patterns ?? config.requiredContextFilePatterns,
    )
      .map((item) => String(item).trim())
      .filter(Boolean),
    proof:
      asText(config.proof) ||
      "dataset-authoring-patch-collect plus dataset-patch-apply with authoring package closure",
  };
}

export function fullContextAiCompletionRequirement(profile, datasetType, repoRoot) {
  const requirement = profile?.fullContextAiCompletion ?? normalizeFullContextAiCompletion(null);
  if (!requirement.required) return null;
  if (requirement.datasetTypes.length > 0 && !requirement.datasetTypes.includes(datasetType)) {
    return null;
  }
  const fallbackFilePatterns = [
    "schema.json",
    "methodology.yaml",
    "runtime-ruleset.json",
    "tidas_contacts_category.json",
    "tidas_flowproperties_category.json",
    "tidas_flows_elementary_category.json",
    "tidas_flows_product_category.json",
    "tidas_lciamethods_category.json",
    "tidas_processes_category.json",
    "tidas_sources_category.json",
    "tidas_unitgroups_category.json",
    "tidas_locations_category.json",
  ];
  const categorySchemaFileNames = repoRoot ? bundledCategorySchemaFileNames(repoRoot) : [];

  return {
    ...requirement,
    requiredContextKinds:
      requirement.requiredContextKinds.length > 0
        ? requirement.requiredContextKinds
        : ["schema", "methodology_yaml", "ruleset", "classification_schema", "location_schema"],
    requiredContextFilePatterns: [
      ...new Set([
        ...(requirement.requiredContextFilePatterns.length > 0
          ? requirement.requiredContextFilePatterns
          : fallbackFilePatterns),
        ...categorySchemaFileNames,
      ]),
    ],
  };
}

export function contextFileDetails(files) {
  return ensureArray(files).map((file) => ({
    kind: asText(file?.kind) || "context",
    path: asText(file?.path) || null,
    sha256: sha256Text(file?.text ?? ""),
    bytes: Buffer.byteLength(String(file?.text ?? ""), "utf8"),
  }));
}

export function contextHasFilePattern(files, pattern) {
  const needle = String(pattern).toLowerCase();
  return ensureArray(files).some((file) =>
    String(file?.path ?? "")
      .toLowerCase()
      .includes(needle),
  );
}

export function fullContextGateItems({ contractContext, requirement }) {
  if (!requirement) return [];
  const kinds = new Set(contractContext.files.map((file) => asText(file.kind)).filter(Boolean));
  const items = [];
  for (const kind of requirement.requiredContextKinds) {
    if (!kinds.has(kind)) {
      items.push({
        source: "full_context",
        code: "full_context_required_kind_missing",
        path: null,
        message: `Full-context AI authoring requires contract context kind '${kind}'.`,
        action_kind: "context_pack_required",
        required_owner: "foundry_context_pack",
        ai_required: false,
        required_kind: kind,
        instruction:
          "Regenerate the SDK/CLI dataset context pack and pass it to dataset-curation-gate before AI authoring or remote write planning.",
      });
    }
  }
  for (const pattern of requirement.requiredContextFilePatterns) {
    if (!contextHasFilePattern(contractContext.files, pattern)) {
      items.push({
        source: "full_context",
        code: "full_context_required_file_missing",
        path: null,
        message: `Full-context AI authoring requires a context file matching '${pattern}'.`,
        action_kind: "context_pack_required",
        required_owner: "foundry_context_pack",
        ai_required: false,
        required_file_pattern: pattern,
        instruction:
          "Regenerate the SDK/CLI dataset context pack and pass it to dataset-curation-gate before AI authoring or remote write planning.",
      });
    }
  }
  return items;
}
