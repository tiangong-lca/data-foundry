import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createImportCompletionCommands } from "../../scripts/commands/import-completion.ts";
import { createTaskCommands } from "../../scripts/commands/tasks.ts";

type JsonObject = Record<string, unknown>;

interface CompletionReport extends JsonObject {
  status: string;
  dataset_types: string[];
  required_types: string[];
  closeouts: JsonObject[];
  counts: Record<string, number>;
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const fixedNow = "2026-08-25T10:00:00.000Z";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function withTempRoot(name: string, run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `foundry-${name}-`));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveFrom(root: string, value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text);
}

function repoRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function taskMeta(filePath: string): {
  body: string;
  frontmatter: string;
  meta: Record<string, string>;
} {
  const text = fs.readFileSync(filePath, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(text);
  if (!match) return { body: text, frontmatter: "", meta: {} };
  const frontmatter = match[1];
  const meta: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator > 0) meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { body: match[2], frontmatter, meta };
}

function replaceFrontmatterField(frontmatter: string, key: string, value: string): string {
  const lines = frontmatter.split(/\r?\n/u);
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index >= 0) lines[index] = `${key}: ${value}`;
  else lines.push(`${key}: ${value}`);
  return lines.join("\n");
}

function taskHarness(root: string) {
  const fullContextCalls: unknown[] = [];
  const resolveRepoPath = (value: unknown) => resolveFrom(root, value);
  const commands = createTaskCommands({
    asText,
    booleanOption(value: unknown) {
      return value === true || value === "true" || value === "1";
    },
    completionFullContextBlockers(input: unknown) {
      fullContextCalls.push(input);
      return [];
    },
    directoryExists(filePath: string) {
      return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
    },
    ensureArray,
    fileExists(filePath: string | null) {
      return Boolean(filePath && fs.existsSync(filePath));
    },
    nowIso: () => fixedNow,
    readJsonArtifactOption(value: unknown) {
      const artifactPath = resolveRepoPath(value);
      if (!artifactPath || !fs.existsSync(artifactPath)) return null;
      return { path: artifactPath, value: JSON.parse(fs.readFileSync(artifactPath, "utf8")) };
    },
    replaceFrontmatterField,
    repoRelativePath(filePath: string) {
      return repoRelative(root, filePath);
    },
    repoRoot: root,
    resolveRepoPath,
    taskMetaFromFile: taskMeta,
    writeText(filePath: string, text: string) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, text);
    },
  });
  return { commands, fullContextCalls };
}

test("task factory preserves queue/file order, duplicate checks, and exact body previews", () => {
  withTempRoot("task-list", (root) => {
    fs.mkdirSync(path.join(root, "tasks/inbox"), { recursive: true });
    fs.mkdirSync(path.join(root, "tasks/active"), { recursive: true });
    fs.mkdirSync(path.join(root, "tasks/done"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "tasks/inbox/zeta.md"),
      "---\nid: duplicate\ntitle: Zeta\nstate: Inbox\nkind: import\n---\nline 1\nline 2\nline 3\nline 4\nline 5\n",
    );
    fs.writeFileSync(
      path.join(root, "tasks/inbox/alpha.md"),
      "---\nid: alpha\ntitle: Alpha\nstate: Inbox\nkind: import\n---\nalpha body\n",
    );
    fs.writeFileSync(
      path.join(root, "tasks/active/beta.md"),
      "---\nid: duplicate\ntitle: Beta\nstate: Active\nkind: import\n---\nbeta body\n",
    );
    const { commands } = taskHarness(root);

    const tasks = commands.tasksList();
    assert.deepEqual(
      tasks.map((entry: JsonObject) => [entry.queue, entry.path]),
      [
        ["inbox", "tasks/inbox/alpha.md"],
        ["inbox", "tasks/inbox/zeta.md"],
        ["active", "tasks/active/beta.md"],
      ],
    );
    assert.equal(tasks[1].body_preview, "line 1\nline 2\nline 3\nline 4");
    assert.deepEqual(commands.tasksCheck(), {
      task_count: 3,
      errors: ["tasks/active/beta.md: duplicate id duplicate"],
      ok: false,
    });
  });
});

test("task completion dry-run is non-mutating and completed execution moves exact frontmatter", () => {
  withTempRoot("task-complete", (root) => {
    const activePath = path.join(root, "tasks/active/import-42.md");
    fs.mkdirSync(path.dirname(activePath), { recursive: true });
    fs.writeFileSync(
      activePath,
      "---\nid: import-42\ntitle: Import 42\nstate: Active\nkind: import\n---\nBody stays byte-stable.\n",
    );
    writeJson(path.join(root, "completion.json"), {
      status: "completed",
      task_id: "import-42",
      closeouts: [{ dataset_type: "process" }],
      blockers: [],
    });
    const { commands, fullContextCalls } = taskHarness(root);
    assert.deepEqual(commands.runTaskComplete({ help: true }), {
      schema_version: 1,
      status: "help",
      command: "task-complete",
      usage: [
        "node scripts/foundry.mjs task-complete --task <task-id|tasks/active/file.md> --completion-report <dataset-import-completion-report.json>",
      ],
      purpose:
        "Move one filesystem task from tasks/active to tasks/done only when the task-level import completion report is completed.",
      remote_write_mode: "read-only",
    });

    const ready = commands.runTaskComplete({
      task: "import-42",
      completionReport: "completion.json",
      dryRun: true,
    });
    assert.equal(ready.status, "ready");
    assert.equal(fs.existsSync(activePath), true);
    assert.equal(fs.existsSync(path.join(root, "tasks/done/import-42.md")), false);

    const completed = commands.runTaskComplete({
      task: "import-42",
      completionReport: "completion.json",
    });
    assert.equal(completed.status, "completed");
    assert.equal(fs.existsSync(activePath), false);
    assert.equal(
      fs.readFileSync(path.join(root, "tasks/done/import-42.md"), "utf8"),
      "---\nid: import-42\ntitle: Import 42\nstate: Done\nkind: import\ncompletion_report: completion.json\ncompleted_at: 2026-08-25T10:00:00.000Z\n---\nBody stays byte-stable.\n",
    );
    assert.equal(fullContextCalls.length, 2);
  });
});

function completionHarness(root: string) {
  const fullContextCalls: unknown[] = [];
  const resolveRepoPath = (value: unknown) => resolveFrom(root, value);
  const countRows = (filePath: string) => {
    const text = fs.readFileSync(filePath, "utf8").trim();
    return text ? text.split(/\r?\n/u).length : 0;
  };
  const commands = createImportCompletionCommands({
    asText,
    countJsonLinesFile: countRows,
    countRowsFile: countRows,
    fileExists(filePath: string | null) {
      return Boolean(filePath && fs.existsSync(filePath));
    },
    findFilesByName(start: string, name: string) {
      const found: string[] = [];
      const visit = (dir: string) => {
        for (const entry of fs
          .readdirSync(dir, { withFileTypes: true })
          .sort((a, b) => a.name.localeCompare(b.name))) {
          const candidate = path.join(dir, entry.name);
          if (entry.isDirectory()) visit(candidate);
          else if (entry.name === name) found.push(candidate);
        }
      };
      if (fs.existsSync(start)) visit(start);
      return found;
    },
    fullContextProofCheck(input: unknown) {
      fullContextCalls.push(input);
      return { required: true, blockers: [] };
    },
    normalizedList(value: unknown) {
      return ensureArray(value).flatMap((entry) =>
        typeof entry === "string"
          ? entry
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean)
          : [],
      );
    },
    nowIso: () => fixedNow,
    readJson(filePath: string) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    },
    readJsonArtifactOption(value: unknown) {
      const artifactPath = resolveRepoPath(value);
      if (!artifactPath || !fs.existsSync(artifactPath)) return null;
      return { path: artifactPath, value: JSON.parse(fs.readFileSync(artifactPath, "utf8")) };
    },
    repoRelativeMaybe(filePath: string | null) {
      return filePath ? repoRelative(root, filePath) : null;
    },
    repoRelativePath(filePath: string) {
      return repoRelative(root, filePath);
    },
    resolveRepoPath,
    sameResolvedPath(left: string, right: string) {
      return path.resolve(left) === path.resolve(right);
    },
    unique<T>(values: T[]) {
      return [...new Set(values)];
    },
    writeJson,
  });
  return { commands, fullContextCalls };
}

function writeCloseoutFixture(root: string, name: string, datasetType: string): string {
  const fixtureDir = path.join(root, name);
  const rowsPath = path.join(fixtureDir, "rows.jsonl");
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(rowsPath, `${JSON.stringify({ [`${datasetType}DataSet`]: { id: name } })}\n`);
  writeJson(path.join(fixtureDir, "finalize.json"), {
    status: "ready_for_remote_write",
    files: { final_rows: repoRelative(root, rowsPath) },
  });
  writeJson(path.join(fixtureDir, "mutation.json"), {
    status: "ready_for_remote_write",
    rows_file: repoRelative(root, rowsPath),
    profile: "generic",
    target_user_id: "owner-1",
    counts: {},
  });
  const closeoutPath = path.join(fixtureDir, "dataset-post-write-closeout-report.json");
  writeJson(closeoutPath, {
    status: "completed",
    dataset_type: datasetType,
    profile: "generic",
    final_rows_file: repoRelative(root, rowsPath),
    finalize_report: repoRelative(root, path.join(fixtureDir, "finalize.json")),
    mutation_manifest: repoRelative(root, path.join(fixtureDir, "mutation.json")),
    target_user_id: "owner-1",
    expected_state_code: "0",
    counts: { blockers: 0, root_payload_mismatches: 0, root_readback_checks: 1 },
    files: { trace_queues: {} },
  });
  return repoRelative(root, closeoutPath);
}

test("completion report preserves explicit order, dedupe, aggregate counts, and exact report bytes", () => {
  withTempRoot("import-completion", (root) => {
    const processCloseout = writeCloseoutFixture(root, "process-scope", "process");
    const supportCloseout = writeCloseoutFixture(root, "support-scope", "support");
    const { commands, fullContextCalls } = completionHarness(root);
    const report = commands.runDatasetImportCompletionReport({
      closeoutReport: [processCloseout, supportCloseout, processCloseout],
      requireType: ["support", "process"],
      expectedCloseouts: "2",
      taskId: "case-42",
      outDir: "completion",
    }) as CompletionReport;

    assert.equal(report.status, "completed");
    assert.deepEqual(report.dataset_types, ["process", "support"]);
    assert.deepEqual(
      report.closeouts.map((entry: JsonObject) => entry.dataset_type),
      ["process", "support"],
    );
    assert.deepEqual(report.required_types, ["support", "process"]);
    assert.deepEqual(
      {
        closeout_reports: report.counts.closeout_reports,
        final_rows: report.counts.final_rows,
        dataset_types: report.counts.dataset_types,
        unique_write_scopes: report.counts.unique_write_scopes,
        full_context_scopes: report.counts.full_context_scopes,
        blockers: report.counts.blockers,
      },
      {
        closeout_reports: 2,
        final_rows: 2,
        dataset_types: 2,
        unique_write_scopes: 2,
        full_context_scopes: 2,
        blockers: 0,
      },
    );
    assert.equal(fullContextCalls.length, 2);
    assert.equal(
      fs.readFileSync(path.join(root, "completion/dataset-import-completion-report.json"), "utf8"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  });
});

test("completion factory preserves native JSON parse errors", () => {
  withTempRoot("import-completion-errors", (root) => {
    fs.writeFileSync(path.join(root, "malformed.json"), "{ malformed\n");
    const { commands } = completionHarness(root);
    assert.throws(
      () =>
        commands.runDatasetImportCompletionReport({
          closeoutReport: "malformed.json",
          outDir: "out",
        }),
      SyntaxError,
    );
  });
});

test("task and completion factories exist only as zero-escape native TypeScript", () => {
  for (const moduleName of ["tasks", "import-completion"]) {
    const typedPath = path.join(repoRoot, `scripts/commands/${moduleName}.ts`);
    assert.equal(fs.existsSync(typedPath), true);
    assert.equal(fs.existsSync(typedPath.replace(/\.ts$/u, ".mjs")), false);
    const source = fs.readFileSync(typedPath, "utf8");
    assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
    assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
  }
});

test("task and completion consumers target the typed command factories", () => {
  for (const [moduleName, ownerExport] of [
    ["tasks", "createTaskCommands"],
    ["import-completion", "createImportCompletionCommands"],
  ] as const) {
    for (const consumer of [
      "scripts/foundry.mjs",
      "scripts/lib/foundry-command-metadata.ts",
      "test/unit/task-completion-command-factories.test.mts",
    ]) {
      const source = readRepoFile(consumer);
      assert.match(source, new RegExp(`(?:commands/|scripts/commands/)${moduleName}\\.ts`, "u"));
      assert.doesNotMatch(
        source,
        new RegExp(`(?:commands/|scripts/commands/)${moduleName}\\.mjs`, "u"),
      );
    }
    assert.match(readRepoFile(`scripts/commands/${moduleName}.ts`), new RegExp(ownerExport, "u"));
  }
});
