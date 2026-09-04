import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseFreshIntentBoundAuthReceipt,
  sha256Json,
  sha256Text,
} from "./identity-preflight-proof.ts";

type RecordValue = Record<string, unknown>;
export type SupportExportRow = { id: string; version: string; state_code: 100; json: RecordValue };
export type CliSupportExport = {
  projectRef: string;
  cliVersion: string;
  flowproperties: SupportExportRow[];
  unitgroups: SupportExportRow[];
};
type CliCommand = { command: string; args: string[]; package_version: string | null };
type SpawnResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout?: unknown;
  stderr?: unknown;
  error?: Error;
};
type Spawn = (command: string, args: string[], options: SpawnSyncOptions) => SpawnResult;

const allowedEnvironment = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "XDG_STATE_HOME",
  "TIANGONG_LCA_API_BASE_URL",
  "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY",
  "TIANGONG_LCA_OAUTH_CLIENT_ID",
  "TIANGONG_LCA_OAUTH_REDIRECT_URI",
  "TIANGONG_LCA_SESSION_FILE",
  "TIANGONG_LCA_REGION",
  "TIANGONG_LCA_DATA_API_PROFILE",
] as const;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CLI support export contract is invalid.");
  return value as RecordValue;
}

function readArtifact(root: string, value: unknown, name: string): string {
  const expected = path.join(root, name);
  if (typeof value !== "string" || path.resolve(value) !== expected)
    throw new Error("CLI support export artifact path is invalid.");
  const stat = fs.lstatSync(expected);
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(expected));
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > (name.endsWith(".jsonl") ? 64 : 1) * 1024 * 1024 ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  )
    throw new Error("CLI support export artifact is unsafe.");
  return fs.readFileSync(expected, "utf8");
}

export function readCliSupportExport(options: {
  cli: CliCommand;
  env: NodeJS.ProcessEnv;
  nowMs?: number;
  spawnSyncImpl?: Spawn;
}): CliSupportExport {
  const project = options.env.FOUNDRY_EXPECTED_PROJECT_REF?.trim();
  const user = options.env.FOUNDRY_EXPECTED_USER_ID?.trim();
  if (!project || !user)
    throw new Error(
      "Support cache refresh requires explicit project/user intent through account:run.",
    );
  if (!options.cli.package_version)
    throw new Error("Support cache refresh requires a verified installed CLI version.");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-support-export-"));
  const out = path.join(temp, "export");
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowedEnvironment)
    if (options.env[key] !== undefined) env[key] = options.env[key];
  env.TIANGONG_LCA_AUTH_MODE = "oauth";
  env.TIANGONG_LCA_DISABLE_SESSION_CACHE = "false";
  env.TIANGONG_LCA_FORCE_REAUTH = "false";
  try {
    const run =
      options.spawnSyncImpl ?? ((command, args, settings) => spawnSync(command, args, settings));
    const result = run(
      options.cli.command,
      [
        ...options.cli.args,
        "dataset",
        "support-cache",
        "export",
        "--out-dir",
        out,
        "--state-code",
        "100",
        "--expected-project-ref",
        project,
        "--expected-user-id",
        user,
        "--json",
      ],
      {
        cwd: temp,
        env,
        shell: false,
        encoding: "utf8",
        timeout: 150_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    if (
      result.error ||
      result.status !== 0 ||
      result.signal !== null ||
      typeof result.stdout !== "string"
    )
      throw new Error("CLI support export failed.");
    let report: RecordValue;
    try {
      report = record(JSON.parse(result.stdout));
    } catch {
      throw new Error("CLI support export contract is invalid.");
    }
    const account = record(report.account);
    const snapshot = record(report.snapshot);
    const filters = record(report.filters);
    if (
      report.schema_version !== 1 ||
      report.command !== "dataset support-cache export" ||
      report.status !== "completed" ||
      report.remote_write_mode !== "read-only" ||
      report.project_ref !== project ||
      account.user_id !== user ||
      snapshot.status !== "observed-stable" ||
      snapshot.transactional_snapshot !== false ||
      snapshot.observations !== 2 ||
      JSON.stringify(filters.state_codes) !== "[100]"
    )
      throw new Error("CLI support export scope is invalid.");
    const tempStat = fs.lstatSync(temp);
    const exportStat = fs.lstatSync(out);
    if (
      !tempStat.isDirectory() ||
      tempStat.isSymbolicLink() ||
      !exportStat.isDirectory() ||
      exportStat.isSymbolicLink() ||
      path.dirname(fs.realpathSync(out)) !== fs.realpathSync(temp)
    )
      throw new Error("CLI support export directory is unsafe.");
    if (!Array.isArray(report.completeness) || report.completeness.length !== 2)
      throw new Error("CLI support export completeness is missing.");
    for (const observation of report.completeness) {
      const proof = record(observation);
      const counts = record(proof.entity_counts);
      if (proof.complete !== true || proof.status !== "complete")
        throw new Error("CLI support export is incomplete.");
      for (const table of ["flowproperties", "unitgroups"]) {
        if (counts[table] !== record(record(report.tables)[table]).rows)
          throw new Error("CLI support export observation counts disagree.");
      }
    }
    const artifacts = record(report.artifacts);
    const tables = record(report.tables);
    const persisted = record(JSON.parse(readArtifact(out, artifacts.report, "export-report.json")));
    if (sha256Json(report) !== sha256Json(persisted))
      throw new Error("CLI support export completion marker differs from stdout.");
    const identity = parseFreshIntentBoundAuthReceipt(
      JSON.parse(readArtifact(out, artifacts.identity, "identity-receipt.json")),
      {
        nowMs: options.nowMs ?? Date.now(),
        maxAgeMs: 180_000,
        expectedProjectRef: project,
        expectedUserId: user,
      },
    );
    if (identity.cli.package_version !== options.cli.package_version)
      throw new Error("CLI support export package identity differs from the installed runtime.");
    const readRows = (table: "flowproperties" | "unitgroups"): SupportExportRow[] => {
      const text = readArtifact(out, artifacts[table], `${table}.jsonl`);
      const metadata = record(tables[table]);
      if (sha256Text(text) !== metadata.sha256)
        throw new Error("CLI support export row integrity is invalid.");
      const rows = text
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => record(JSON.parse(line)));
      if (rows.length !== metadata.rows || rows.length > 100_000)
        throw new Error("CLI support export row count is invalid.");
      for (const row of rows) {
        if (
          typeof row.id !== "string" ||
          !row.id ||
          typeof row.version !== "string" ||
          !row.version ||
          row.state_code !== 100
        )
          throw new Error("CLI support export row scope is invalid.");
        record(row.json);
      }
      return rows as SupportExportRow[];
    };
    return {
      projectRef: project,
      cliVersion: identity.cli.package_version,
      flowproperties: readRows("flowproperties"),
      unitgroups: readRows("unitgroups"),
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
