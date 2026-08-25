import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const testRunId = process.env.FOUNDRY_FULL_CONTEXT_TEST_RUN_ID || process.pid;

export function testTmpRoot(name) {
  return path.join(repoRoot, "tmp", `${name}-${testRunId}`);
}
export const fakeTidasBin = path.join(repoRoot, "test", "fixtures", "fake-tidas.mjs");
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
export function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

export function writeJsonLines(filePath, rows) {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

export function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readJsonLines(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line)) : [];
}

export function runFoundry(args, options = {}) {
  const result = spawnSync(process.execPath, ["scripts/foundry.ts", ...args], {
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
    json: JSON.parse(stdout),
  };
}

export function blockerCodes(report) {
  return new Set((report.blockers ?? []).map((blocker) => blocker.code));
}

export function itemBlockerCodes(report) {
  return new Set(
    (report.items ?? []).flatMap((item) => (item.blockers ?? []).map((blocker) => blocker.code)),
  );
}

export function scopeBlockerCodes(report) {
  return new Set(
    (report.evidence?.scope_blockers ?? report.scope_blockers ?? []).map((blocker) => blocker.code),
  );
}

export function contextTextByPathSuffix(authoringPackage, suffix) {
  return (
    authoringPackage.contract_context_files.find((file) => String(file.path ?? "").endsWith(suffix))
      ?.text ?? ""
  );
}

export function bundledCategorySchemaNames() {
  return fs
    .readdirSync(resolveInstalledTiangongLcaCliPackage().schemaDir)
    .filter((name) => /^tidas_.*_category\.json$/u.test(name))
    .sort();
}

export { assert, crypto, fs, path, spawnSync };
