import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import type { BinaryLike } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const testRunId = process.env.FOUNDRY_FULL_CONTEXT_TEST_RUN_ID || process.pid;

export interface FixtureBlocker {
  code: string;
  [key: string]: unknown;
}

export interface FixtureFoundryReport {
  status: string;
  failure_code: string;
  binding_sha256: string;
  counts: Record<string, number>;
  policy: Record<string, boolean>;
  results: FixtureFoundryReport[];
  blockers?: FixtureBlocker[];
  items?: Array<{ blockers?: FixtureBlocker[] }>;
  evidence?: { scope_blockers?: FixtureBlocker[] };
  scope_blockers?: FixtureBlocker[];
  [key: string]: unknown;
}

export interface FixtureJsonDocument {
  schema: string;
  status: string;
  stage: string;
  error_code: string;
  runtime_cleanup_error_code: string;
  mutation_dispatch_count: number;
  manifest_scope_sha256: string;
  account_mode: string;
  contact_artifact: { sha256: string };
  files: Record<string, string>;
  [key: string]: unknown;
}

export interface FixtureJsonLine extends Record<string, unknown> {
  request_bytes_sha256: string;
  target_sha256: string;
  processDataSet: {
    processInformation: {
      dataSetInformation: Record<string, unknown>;
    };
  };
}

export interface RunFoundryOptions {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

export function testTmpRoot(name: string): string {
  return path.join(repoRoot, "tmp", `${name}-${testRunId}`);
}
export const fakeTidasBin = path.join(repoRoot, "test", "fixtures", "fake-tidas.ts");
export const targetUserId = "00000000-0000-4000-8000-000000000001";
export const fullContextKinds = [
  "schema",
  "methodology_yaml",
  "ruleset",
  "classification_schema",
  "location_schema",
];
export const fullContextPatterns = [
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
export function rel(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

export function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

export function sha256Text(text: BinaryLike): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function readJson(filePath: string): FixtureJsonDocument {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as FixtureJsonDocument;
}

export function readJsonLines(filePath: string): FixtureJsonLine[] {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as FixtureJsonLine) : [];
}

export function runFoundry(
  args: readonly string[],
  options: RunFoundryOptions = {},
): { code: number | null; json: FixtureFoundryReport } {
  const result = spawnSync(process.execPath, ["scripts/foundry.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TIDAS_BIN: fakeTidasBin,
      ...(options.env ?? {}),
    },
    timeout: options.timeout,
  });
  const stdout = result.stdout.trim();
  assert.notEqual(
    stdout,
    "",
    `Expected JSON stdout for ${args.join(" ")}; status=${result.status}; stderr=${result.stderr}`,
  );
  return {
    code: result.status,
    json: JSON.parse(stdout) as FixtureFoundryReport,
  };
}

export function blockerCodes(report: { blockers?: FixtureBlocker[] }): Set<string> {
  return new Set((report.blockers ?? []).map((blocker) => blocker.code));
}

export function itemBlockerCodes(report: {
  items?: Array<{ blockers?: FixtureBlocker[] }>;
}): Set<string> {
  return new Set(
    (report.items ?? []).flatMap((item) => (item.blockers ?? []).map((blocker) => blocker.code)),
  );
}

export function scopeBlockerCodes(report: {
  evidence?: { scope_blockers?: FixtureBlocker[] };
  scope_blockers?: FixtureBlocker[];
}): Set<string> {
  return new Set(
    (report.evidence?.scope_blockers ?? report.scope_blockers ?? []).map((blocker) => blocker.code),
  );
}

export function contextTextByPathSuffix(
  authoringPackage: {
    contract_context_files: Array<{ path?: unknown; text?: string }>;
  },
  suffix: string,
): string {
  return (
    authoringPackage.contract_context_files.find((file) => String(file.path ?? "").endsWith(suffix))
      ?.text ?? ""
  );
}

export function bundledCategorySchemaNames(): string[] {
  return fs
    .readdirSync(resolveInstalledTiangongLcaCliPackage().schemaDir)
    .filter((name) => /^tidas_.*_category\.json$/u.test(name))
    .sort();
}

export { assert, crypto, fs, path, spawnSync };
