import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { runSurfaceAudit } from "../lib/surface-audit.ts";

const capabilityRegistryPath = "specs/automated-lca-capability-registry.json";
const runtimeDirs = [
  ".foundry/logs",
  ".foundry/state",
  ".foundry/workspaces",
  "tasks/inbox",
  "tasks/active",
  "tasks/done",
];

const envExampleAllowedKeys = new Set([
  "TIANGONG_LCA_API_BASE_URL",
  "TIANGONG_LCA_API_KEY",
  "TIANGONG_LCA_REGION",
  "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY",
  "TIANGONG_LCA_SESSION_FILE",
  "TIANGONG_LCA_DISABLE_SESSION_CACHE",
  "TIANGONG_LCA_FORCE_REAUTH",
  "TIANGONG_AI_API_BASE_URL",
  "TIANGONG_AI_APIKEY",
  "TIANGONG_AI_CLI",
  "TIANGONG_AI_CLI_BIN",
  "TIANGONG_LCA_KB_SEARCH_API_BASE_URL",
  "TIANGONG_LCA_KB_SEARCH_API_KEY",
  "TIANGONG_LCA_KB_SEARCH_REGION",
  "TIANGONG_LCA_UNSTRUCTURED_API_BASE_URL",
  "TIANGONG_LCA_UNSTRUCTURED_API_KEY",
  "TIANGONG_LCA_UNSTRUCTURED_PROVIDER",
  "TIANGONG_LCA_UNSTRUCTURED_MODEL",
  "TIANGONG_LCA_UNSTRUCTURED_CHUNK_TYPE",
  "TIANGONG_LCA_UNSTRUCTURED_RETURN_TXT",
  "UNSTRUCTURED_API_BASE_URL",
  "UNSTRUCTURED_AUTH_TOKEN",
  "UNSTRUCTURED_PROVIDER",
  "UNSTRUCTURED_MODEL",
  "TIANGONG_LCA_REVIEW_LLM_BASE_URL",
  "TIANGONG_LCA_REVIEW_LLM_API_KEY",
  "TIANGONG_LCA_REVIEW_LLM_MODEL",
  "TIANGONG_LCA_CLI_BIN",
  "TIANGONG_LCA_SKILLS_ROOT",
  "TIDAS_BIN",
  "TIDAS_CONFIG",
  "TIDAS_MEMORY_BUDGET_MIB",
  "TIDAS_QUEUE_CAPACITY",
]);
const envExampleAllowedPrefixes = ["FOUNDRY_"];
const envExampleForbiddenKeys = new Map([
  ["TIANGONG_LCA_COVERAGE", "CLI test-only toggle; keep it in tiangong-lca-cli."],
  ["SUPABASE_URL", "Legacy generic Supabase env; use TIANGONG_LCA_API_* instead."],
  ["SUPABASE_KEY", "Legacy generic Supabase env; use TIANGONG_LCA_API_* instead."],
  ["GITHUB_TOKEN", "Tracker or GitHub credentials do not belong in the public env example."],
]);

const taskKindRoutes = {
  "external-dataset-curated-import": [
    "import-orchestration",
    "tidas-contract-context",
    "external-lca-package-conversion",
    "schema-gate",
    "qa",
    "dataset-curation",
    "reference-closure",
    "publish-prep",
    "remote-verification",
  ],
  "source-evidence-dataset-development": [
    "import-orchestration",
    "tidas-contract-context",
    "source-document-authoring",
    "source-evidence-review",
    "schema-gate",
    "qa",
    "dataset-curation",
    "reference-closure",
    "publish-prep",
  ],
};

const gateRoutes = {
  orchestration: ["import-orchestration"],
  context: ["tidas-contract-context"],
  contract: ["tidas-contract-context"],
  conversion: ["external-lca-package-conversion"],
  import: ["external-lca-package-conversion"],
  source: ["source-document-authoring", "source-evidence-review"],
  schema: ["schema-gate"],
  qa: ["qa"],
  curation: ["dataset-curation"],
  reference: ["reference-closure"],
  "reference-closure": ["reference-closure"],
  publish: ["publish-prep"],
  remote: ["remote-verification"],
  verification: ["remote-verification"],
};

function envExampleKeyAllowed(key) {
  return (
    envExampleAllowedKeys.has(key) ||
    envExampleAllowedPrefixes.some((prefix) => key.startsWith(prefix))
  );
}

function parseEnvAssignments(filePath, { fileExists, readText }) {
  if (!fileExists(filePath)) return [];
  return readText(filePath)
    .split(/\r?\n/u)
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter(({ raw }) => raw && !raw.startsWith("#"))
    .map(({ raw, line }) => ({
      line,
      match: raw.replace(/^export\s+/u, "").match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u),
    }))
    .filter(({ match }) => match)
    .map(({ line, match }) => ({ line, key: match[1], value: match[2] ?? "" }));
}

function qaClassForType(datasetType) {
  if (datasetType === "process") return "process-qa";
  if (datasetType === "flow") return "flow-qa";
  if (datasetType === "lifecyclemodel") return "lifecyclemodel-qa";
  return "qa";
}

function expandRouteClass(className, datasetType) {
  return className === "qa" ? [qaClassForType(datasetType)] : [className];
}

function capabilityMatchesDatasetType(capability, datasetType) {
  if (!datasetType || datasetType === "all") return true;
  const id = String(capability.id ?? "");
  if (datasetType === "process")
    return !id.startsWith("cli.flow.") && !id.startsWith("cli.lifecyclemodel.");
  if (datasetType === "flow")
    return !id.startsWith("cli.process.") && !id.startsWith("cli.lifecyclemodel.");
  if (datasetType === "lifecyclemodel")
    return !id.startsWith("cli.process.") && !id.startsWith("cli.flow.");
  return true;
}

export function createCoreCommands({
  ensureArray,
  fileExists,
  isPlaceholderEnvValue,
  listImportProfiles,
  normalizedList,
  nowIso,
  readJson,
  readText,
  repoRelativePath,
  repoRoot,
  resolveRepoPath,
  splitFrontmatter,
  unique,
  writeJson,
}) {
  const workflowPath = path.join(repoRoot, "WORKFLOW.md");

  function parseEnv(filePath) {
    return parseEnvAssignments(filePath, { fileExists, readText });
  }

  function envExampleSurfaceCheck() {
    const envExamplePath = path.join(repoRoot, ".env.example");
    const errors = [];
    const warnings = [];
    const seen = new Map();
    if (!fileExists(envExamplePath)) {
      errors.push(".env.example is missing.");
    }
    for (const row of parseEnv(envExamplePath)) {
      if (seen.has(row.key)) {
        errors.push(
          `.env.example:${row.line}: duplicate variable ${row.key}; first declared on line ${seen.get(row.key)}.`,
        );
      }
      seen.set(row.key, row.line);
      if (envExampleForbiddenKeys.has(row.key)) {
        errors.push(
          `.env.example:${row.line}: ${row.key} is forbidden. ${envExampleForbiddenKeys.get(row.key)}`,
        );
      } else if (!envExampleKeyAllowed(row.key)) {
        errors.push(
          `.env.example:${row.line}: ${row.key} is not in the Foundry env surface allowlist.`,
        );
      }
      const secretLike = /(?:API_KEY|APIKEY|TOKEN|PASSWORD|SECRET|JWT)$/u.test(row.key);
      const allowedPublicKey = row.key === "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY";
      if (secretLike && !allowedPublicKey && !isPlaceholderEnvValue(row.value)) {
        errors.push(
          `.env.example:${row.line}: ${row.key} looks secret-bearing and must not contain an example value.`,
        );
      }
    }
    return {
      file: ".env.example",
      variable_count: parseEnv(envExamplePath).length,
      allowed_prefixes: envExampleAllowedPrefixes,
      forbidden_keys: [...envExampleForbiddenKeys.keys()],
      errors,
      warnings,
      ok: errors.length === 0,
    };
  }

  function initRuntime() {
    for (const dir of runtimeDirs) fs.mkdirSync(path.join(repoRoot, dir), { recursive: true });
    return { repo_root: repoRoot, created_or_verified: runtimeDirs };
  }

  function workflowCheck() {
    const text = readText(workflowPath);
    const { frontmatter, body } = splitFrontmatter(text);
    const missing = ["tracker:", "workspace:", "policy:"].filter(
      (fragment) => !frontmatter.includes(fragment),
    );
    return {
      workflow: "WORKFLOW.md",
      has_frontmatter: Boolean(frontmatter),
      has_prompt_body: body.trim().length > 0,
      missing_required_fragments: missing,
      ok: missing.length === 0 && body.trim().length > 0,
    };
  }

  function storageCheck() {
    const registryPath = path.join(repoRoot, "docs/file-location-registry.json");
    const allowedRootMarkdown = new Set(["AGENTS.md", "README.md", "WORKFLOW.md"]);
    const errors = [];
    const warnings = [];
    const registry = fileExists(registryPath) ? readJson(registryPath) : null;
    if (!registry) errors.push("docs/file-location-registry.json is missing or invalid.");
    const entries = Array.isArray(registry?.entries) ? registry.entries : [];
    const ids = new Set();
    for (const entry of entries) {
      if (!entry?.id) {
        errors.push("file-location registry entry is missing id");
        continue;
      }
      if (ids.has(entry.id)) errors.push(`duplicate file-location registry id: ${entry.id}`);
      ids.add(entry.id);
      if (entry.status !== "retired" && !fileExists(resolveRepoPath(entry.current_path))) {
        errors.push(`${entry.id}: current_path does not exist: ${entry.current_path}`);
      }
      for (const ref of entry.referenced_by ?? []) {
        if (!fileExists(resolveRepoPath(ref)))
          warnings.push(`${entry.id}: referenced_by path does not exist: ${ref}`);
      }
    }
    for (const name of fs.readdirSync(repoRoot).sort()) {
      if (name.endsWith(".md") && !allowedRootMarkdown.has(name)) {
        errors.push(`root markdown file is not an allowed entrypoint: ${name}`);
      }
    }
    return {
      registry: "docs/file-location-registry.json",
      entry_count: entries.length,
      errors,
      warnings,
      ok: errors.length === 0,
    };
  }

  function acceptanceCheck() {
    const workflow = workflowCheck();
    const storage = storageCheck();
    const envSurface = envExampleSurfaceCheck();
    const surfaceAudit = surfaceAuditCheck();
    const checks = [
      { name: "workflow", ok: workflow.ok, report: workflow },
      { name: "storage", ok: storage.ok, report: storage },
      { name: "env_example_surface", ok: envSurface.ok, report: envSurface },
      { name: "surface_audit", ok: surfaceAudit.status === "passed", report: surfaceAudit },
    ];
    const result = {
      schema_version: 2,
      generated_at_utc: nowIso(),
      status: checks.every((check) => check.ok) ? "passed" : "failed",
      checks,
    };
    writeJson(path.join(repoRoot, ".foundry/state/acceptance/latest.json"), result);
    return result;
  }

  function doctor() {
    const surfaceAudit = surfaceAuditCheck();
    return {
      repo_root: repoRoot,
      node: process.version,
      workflow_check: workflowCheck(),
      storage_check: storageCheck(),
      env_example_surface: envExampleSurfaceCheck(),
      surface_audit: surfaceAudit,
      runtime_dirs: Object.fromEntries(
        runtimeDirs.map((dir) => [dir, fs.existsSync(path.join(repoRoot, dir))]),
      ),
      import_profiles: listImportProfiles({ repoRoot }),
    };
  }

  function surfaceAuditCheck() {
    return runSurfaceAudit({ repoRoot, nowIso });
  }

  function envCheck() {
    const requiredForRemoteWrites = [
      "TIANGONG_LCA_API_BASE_URL",
      "TIANGONG_LCA_API_KEY",
      "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY",
    ];
    return {
      generated_at_utc: nowIso(),
      repo_env_exists: fileExists(path.join(repoRoot, ".env")),
      env_example_surface: envExampleSurfaceCheck(),
      dry_run_allowed: true,
      remote_write_policy: {
        enabled: process.env.FOUNDRY_ENABLE_REMOTE_COMMIT === "true",
        single_record: process.env.FOUNDRY_SINGLE_RECORD_COMMIT === "true",
        limit: Number(process.env.FOUNDRY_REMOTE_COMMIT_LIMIT ?? 1),
      },
      required_remote_env: Object.fromEntries(
        requiredForRemoteWrites.map((key) => [
          key,
          process.env[key] !== undefined && !isPlaceholderEnvValue(process.env[key]),
        ]),
      ),
    };
  }

  function workspaceRoot() {
    const configured = process.env.FOUNDRY_LCA_WORKSPACE_ROOT;
    if (configured) return configured;
    const parent = path.dirname(repoRoot);
    return fs.existsSync(path.join(parent, ".gitmodules")) ? parent : repoRoot;
  }

  function workspaceMap() {
    const root = workspaceRoot();
    const candidates = {
      cli: path.join(root, "tiangong-lca-cli"),
      skills: path.join(root, "tiangong-lca-skills"),
      foundry: repoRoot,
    };
    return {
      generated_at_utc: nowIso(),
      repo_root: repoRoot,
      workspace_root: root,
      projects: Object.fromEntries(
        Object.entries(candidates).map(([name, projectPath]) => [
          name,
          {
            path: projectPath,
            exists: fs.existsSync(projectPath),
          },
        ]),
      ),
      native_tools: {
        tidas: {
          executable: process.env.TIDAS_BIN || "tidas",
          source: process.env.TIDAS_BIN ? "TIDAS_BIN" : "PATH",
          compatible_version: "0.2.x",
          config_source: process.env.TIDAS_CONFIG ? "TIDAS_CONFIG" : "none",
        },
      },
      import_lanes: ["external-dataset-curated-import", "source-evidence-dataset-development"],
    };
  }

  function readCapabilityRegistry() {
    return readJson(path.join(repoRoot, capabilityRegistryPath));
  }

  function buildRoutePlan(options = {}) {
    const registry = readCapabilityRegistry();
    const kind = String(options.kind || options.taskKind || "external-dataset-curated-import");
    const datasetType = String(options.datasetType || options.type || "all")
      .trim()
      .toLowerCase();
    const requiredGateClasses = normalizedList(options.requiredGates)
      .flatMap((gate) => gateRoutes[gate] ?? [gate])
      .flatMap((className) => expandRouteClass(className, datasetType));
    const defaultClasses = (taskKindRoutes[kind] ?? []).flatMap((className) =>
      expandRouteClass(className, datasetType),
    );
    const requestedClasses = normalizedList(options.classes || options.capabilityClasses).flatMap(
      (className) => expandRouteClass(className, datasetType),
    );
    const requiredClasses = unique([
      ...defaultClasses,
      ...requiredGateClasses,
      ...requestedClasses,
    ]);
    const capabilities = ensureArray(registry.capabilities)
      .filter((capability) => requiredClasses.includes(capability.class))
      .filter((capability) => capabilityMatchesDatasetType(capability, datasetType));
    const byClass = new Map();
    for (const capability of capabilities) {
      if (!byClass.has(capability.class)) byClass.set(capability.class, []);
      byClass.get(capability.class).push(capability);
    }
    const routes = requiredClasses.map((className) => ({
      class: className,
      status: (byClass.get(className) ?? []).length > 0 ? "routed" : "missing_capability",
      capability_ids: (byClass.get(className) ?? []).map((capability) => capability.id),
      owner_projects: unique(
        (byClass.get(className) ?? []).map((capability) => capability.owner_project),
      ),
    }));
    const missing = routes.filter((route) => route.status === "missing_capability");
    return {
      schema_version: 2,
      generated_at_utc: nowIso(),
      task: {
        id: String(options.taskId || options.id || `route-${kind}`),
        kind,
        dataset_type: datasetType,
        required_gates: normalizedList(options.requiredGates),
      },
      status: missing.length > 0 ? "missing_capabilities" : "routed",
      capability_registry: capabilityRegistryPath,
      required_classes: requiredClasses,
      routes,
      selected_capabilities: capabilities,
      missing_capabilities: missing,
      next_action:
        missing.length > 0
          ? "Create or route missing reusable capabilities in the owning project."
          : "Run the selected adapters and store their outputs in the task workspace.",
    };
  }

  function writeRoutePlan(plan, outDir) {
    if (!outDir) return plan;
    const resolvedOutDir = resolveRepoPath(outDir);
    writeJson(path.join(resolvedOutDir, "capability-route-plan.json"), plan);
    return {
      ...plan,
      files: {
        capability_route_plan: repoRelativePath(
          path.join(resolvedOutDir, "capability-route-plan.json"),
        ),
      },
    };
  }

  function capabilitiesList(options = {}) {
    const registry = readCapabilityRegistry();
    const classFilter = options.class ? String(options.class) : null;
    const ownerFilter = options.owner ? String(options.owner) : null;
    const capabilities = ensureArray(registry.capabilities)
      .filter((capability) => !classFilter || capability.class === classFilter)
      .filter((capability) => !ownerFilter || capability.owner_project === ownerFilter);
    return {
      schema_version: registry.schema_version ?? 1,
      generated_at_utc: nowIso(),
      registry: capabilityRegistryPath,
      capability_count: capabilities.length,
      capabilities,
    };
  }

  return {
    acceptanceCheck,
    buildRoutePlan,
    capabilitiesList,
    doctor,
    envCheck,
    initRuntime,
    storageCheck,
    surfaceAuditCheck,
    workspaceMap,
    workflowCheck,
    writeRoutePlan,
  };
}
