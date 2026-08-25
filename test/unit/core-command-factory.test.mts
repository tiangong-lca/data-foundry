import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

type JsonObject = Record<string, unknown>;
type CoreFactory = (dependencies: JsonObject) => {
  acceptanceCheck(): JsonObject;
  buildRoutePlan(options?: JsonObject): JsonObject;
  capabilitiesList(options?: JsonObject): JsonObject;
  doctor(): JsonObject;
  envCheck(): JsonObject;
  initRuntime(): JsonObject;
  storageCheck(): JsonObject;
  surfaceAuditCheck(): JsonObject;
  workspaceMap(): JsonObject;
  workflowCheck(): JsonObject;
  writeRoutePlan(plan: JsonObject, outDir?: string): JsonObject;
};

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/core.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/core.mjs");

async function loadFactory(): Promise<CoreFactory> {
  const implementation = fs.existsSync(typedPath) ? typedPath : legacyPath;
  const module = (await import(pathToFileURL(implementation).href)) as {
    createCoreCommands: CoreFactory;
  };
  return module.createCoreCommands;
}

function withTempRoot(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-core-command-"));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function ensureArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined || value === "" ? [] : [value];
}

function normalizedList(value: unknown): string[] {
  return ensureArray(value)
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function unique(values: unknown[]): unknown[] {
  return [...new Set(values)];
}

function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u);
  return match ? { frontmatter: match[1], body: match[2] } : { frontmatter: "", body: text };
}

function createHarness(root: string, factory: CoreFactory) {
  const resolveRepoPath = (value: unknown): string =>
    path.isAbsolute(String(value)) ? String(value) : path.join(root, String(value));
  const repoRelativePath = (value: unknown): string =>
    path.relative(root, String(value)).split(path.sep).join("/");
  return factory({
    ensureArray,
    fileExists(value: unknown) {
      return typeof value === "string" && fs.existsSync(value);
    },
    isPlaceholderEnvValue(value: unknown) {
      const text = String(value ?? "").trim();
      return !text || /^<[^>]+>$/u.test(text);
    },
    listImportProfiles() {
      return [{ id: "generic" }, { id: "fixture" }];
    },
    normalizedList,
    nowIso() {
      return "2026-08-25T00:00:00.000Z";
    },
    readJson(value: unknown) {
      return JSON.parse(fs.readFileSync(String(value), "utf8")) as JsonObject;
    },
    readText(value: unknown) {
      return fs.readFileSync(String(value), "utf8");
    },
    repoRelativePath,
    repoRoot: root,
    resolveRepoPath,
    splitFrontmatter,
    unique,
    writeJson(value: unknown, report: unknown) {
      fs.mkdirSync(path.dirname(String(value)), { recursive: true });
      fs.writeFileSync(String(value), `${JSON.stringify(report, null, 2)}\n`);
    },
  });
}

function writeFixtureRepository(root: string): void {
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "WORKFLOW.md"),
    ["---", "tracker:", "workspace:", "policy:", "---", "Run the fixture workflow.", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, ".env.example"),
    ["FOUNDRY_ENABLE_REMOTE_COMMIT=false", "TIANGONG_LCA_API_KEY=", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "docs/file-location-registry.json"),
    `${JSON.stringify(
      {
        entries: [
          {
            id: "workflow",
            status: "active",
            current_path: "WORKFLOW.md",
            referenced_by: ["missing-advisory.md"],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  fs.mkdirSync(path.join(root, "specs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "specs/automated-lca-capability-registry.json"),
    `${JSON.stringify(
      {
        schema_version: 7,
        capabilities: [
          { id: "context", class: "tidas-contract-context", owner_project: "cli" },
          { id: "process-qa", class: "process-qa", owner_project: "cli" },
          { id: "flow-only", class: "dataset-curation", owner_project: "flow-owner" },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

function withEnvironment(values: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("core runtime, workflow, storage, environment, and route artifacts preserve order and bytes", async () => {
  const factory = await loadFactory();
  withTempRoot((root) => {
    writeFixtureRepository(root);
    const commands = createHarness(root, factory);
    assert.deepEqual(commands.initRuntime(), {
      repo_root: root,
      created_or_verified: [
        ".foundry/logs",
        ".foundry/state",
        ".foundry/workspaces",
        "tasks/inbox",
        "tasks/active",
        "tasks/done",
      ],
    });
    assert.deepEqual(commands.workflowCheck(), {
      workflow: "WORKFLOW.md",
      has_frontmatter: true,
      has_prompt_body: true,
      missing_required_fragments: [],
      ok: true,
    });
    assert.deepEqual(commands.storageCheck(), {
      registry: "docs/file-location-registry.json",
      entry_count: 1,
      errors: [],
      warnings: ["workflow: referenced_by path does not exist: missing-advisory.md"],
      ok: true,
    });
    withEnvironment(
      {
        FOUNDRY_ENABLE_REMOTE_COMMIT: "true",
        FOUNDRY_SINGLE_RECORD_COMMIT: "false",
        FOUNDRY_REMOTE_COMMIT_LIMIT: "3",
        TIANGONG_LCA_API_BASE_URL: undefined,
        TIANGONG_LCA_API_KEY: undefined,
        TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: undefined,
      },
      () => {
        const env = commands.envCheck();
        assert.deepEqual(env.remote_write_policy, {
          enabled: true,
          single_record: false,
          limit: 3,
        });
        assert.deepEqual(env.required_remote_env, {
          TIANGONG_LCA_API_BASE_URL: false,
          TIANGONG_LCA_API_KEY: false,
          TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: false,
        });
        assert.equal(env.repo_env_exists, false);
        assert.equal(env.dry_run_allowed, true);
      },
    );

    const plan = commands.buildRoutePlan({
      taskId: "fixture-task",
      kind: "external-dataset-curated-import",
      datasetType: "process",
      requiredGates: "context,qa",
      classes: "dataset-curation",
    });
    assert.deepEqual(plan.required_classes, [
      "import-orchestration",
      "tidas-contract-context",
      "external-lca-package-conversion",
      "schema-gate",
      "process-qa",
      "dataset-curation",
      "reference-closure",
      "publish-prep",
      "remote-verification",
    ]);
    assert.equal(plan.status, "missing_capabilities");
    const written = commands.writeRoutePlan(plan, "route-output");
    assert.deepEqual(written.files, {
      capability_route_plan: "route-output/capability-route-plan.json",
    });
    assert.equal(
      fs.readFileSync(path.join(root, "route-output/capability-route-plan.json"), "utf8"),
      `${JSON.stringify(plan, null, 2)}\n`,
    );
  });
});

test("core diagnostics retain surface/doctor envelopes and native filesystem or JSON errors", async () => {
  const factory = await loadFactory();
  const commands = createHarness(repoRoot, factory);
  const surface = commands.surfaceAuditCheck();
  assert.equal(surface.schema_version, 1);
  assert.equal(surface.status, "passed");
  assert.deepEqual(
    (surface.checks as JsonObject[]).map((check) => check.name),
    ["legacy_aliases", "metadata_categories", "orphan_docs", "inbound_modules"],
  );
  const doctor = commands.doctor();
  assert.deepEqual(Object.keys(doctor), [
    "repo_root",
    "node",
    "workflow_check",
    "storage_check",
    "env_example_surface",
    "surface_audit",
    "runtime_dirs",
    "import_profiles",
  ]);
  assert.equal(doctor.node, process.version);
  assert.deepEqual(doctor.import_profiles, [{ id: "generic" }, { id: "fixture" }]);

  withTempRoot((root) => {
    const missingWorkflow = createHarness(root, factory);
    assert.throws(
      () => missingWorkflow.workflowCheck(),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    writeFixtureRepository(root);
    fs.writeFileSync(path.join(root, "specs/automated-lca-capability-registry.json"), "{\n");
    assert.throws(() => createHarness(root, factory).capabilitiesList(), SyntaxError);
  });
});

test("core migration preserves exact Foundry help bytes", () => {
  const result = spawnSync(process.execPath, ["scripts/foundry.mjs", "help"], {
    cwd: repoRoot,
    encoding: null,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr.length, 0);
  assert.equal(result.stdout.length, 4961);
  assert.equal(
    createHash("sha256").update(result.stdout).digest("hex"),
    "502efaffe1f2b5b549eae7e5534744398567a79f72d99ab179245f4a314f59e0",
  );
});

test("core command owner exists only as zero-escape native TypeScript", () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["createCoreCommands"],
  );
});

test("core command consumers and metadata target the typed owner", () => {
  for (const consumer of [
    "scripts/foundry.mjs",
    "scripts/lib/foundry-command-metadata.ts",
    "test/unit/core-command-factory.test.mts",
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, consumer), "utf8");
    assert.match(source, /(?:commands\/|scripts\/commands\/)core\.ts/u, consumer);
    assert.doesNotMatch(source, /(?:commands\/|scripts\/commands\/)core\.mjs/u, consumer);
  }
});
