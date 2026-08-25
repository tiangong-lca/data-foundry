import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPostAuthoringFinalizeUtils } from "../../scripts/lib/post-authoring-finalize-utils.mjs";

// Minimal dependency stubs: preseedResolutionReuseDecisions only uses
// asText / resolveRepoPath / fileExists / readRowsFile (plus node fs/path).
function makeUtils() {
  const dependencies = {
    asText: (value: unknown) => (value == null ? "" : String(value)).trim(),
    fileExists: (filePath: unknown) => typeof filePath === "string" && fs.existsSync(filePath),
    readRowsFile: (filePath: string) =>
      fs
        .readFileSync(filePath, "utf8")
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown),
    resolveRepoPath: (filePath: unknown) => (filePath ? path.resolve(String(filePath)) : null),
  } as unknown as Parameters<typeof createPostAuthoringFinalizeUtils>[0];
  return createPostAuthoringFinalizeUtils(dependencies);
}

function writeJsonl(file: string, rows: readonly unknown[]): void {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function withReuseMapEnv<T>(value: string | null, fn: () => T): T {
  const prior = process.env.IDENTITY_PREFLIGHT_REUSE_MAP;
  if (value === null) {
    delete process.env.IDENTITY_PREFLIGHT_REUSE_MAP;
  } else {
    process.env.IDENTITY_PREFLIGHT_REUSE_MAP = value;
  }
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env.IDENTITY_PREFLIGHT_REUSE_MAP;
    else process.env.IDENTITY_PREFLIGHT_REUSE_MAP = prior;
  }
}

test("preseedResolutionReuseDecisions refuses unbound synthetic execution evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-reuse-seed-"));
  try {
    const reuseMap = path.join(dir, "exchange-reference-rewrites.jsonl");
    writeJsonl(reuseMap, [
      {
        source_flow_id: "flow-reused",
        canonical_flow_id: "canon-1",
        canonical_flow_version: "03.00.004",
      },
      // duplicate source row must be ignored (first wins)
      { source_flow_id: "flow-reused", canonical_flow_id: "canon-DUP" },
    ]);

    const reusedReport = path.join(dir, "reports", "flow-reused.json");
    const mintedReport = path.join(dir, "reports", "flow-new.json");
    const existingReport = path.join(dir, "reports", "flow-existing.json");
    fs.mkdirSync(path.dirname(existingReport), { recursive: true });
    fs.writeFileSync(existingReport, JSON.stringify({ status: "blocked", decision: "real" }));

    const index = path.join(dir, "index.jsonl");
    writeJsonl(index, [
      {
        dataset_type: "flow",
        dataset_id: "flow-reused",
        dataset_version: "20.25.001",
        expected_report_file: reusedReport,
      },
      // a flow in the map that already has a decision file → must NOT be clobbered
      {
        dataset_type: "flow",
        dataset_id: "flow-existing",
        dataset_version: "20.25.001",
        expected_report_file: existingReport,
      },
      // a flow with NO map entry → left pending (searched normally)
      {
        dataset_type: "flow",
        dataset_id: "flow-new",
        dataset_version: "20.25.001",
        expected_report_file: mintedReport,
      },
      // a non-flow row → ignored
      { dataset_type: "process", dataset_id: "proc-1", expected_report_file: reusedReport },
    ]);

    const utils = makeUtils();
    const result = withReuseMapEnv(reuseMap, () =>
      utils.preseedResolutionReuseDecisions({ index }),
    );

    assert.deepEqual(result, {
      enabled: false,
      seeded: 0,
      reason: "bound_library_resolution_seed_manifest_required",
    });
    assert.equal(fs.existsSync(reusedReport), false);

    // The existing decision was preserved (not clobbered).
    assert.equal(JSON.parse(fs.readFileSync(existingReport, "utf8")).decision, "real");
    // The unmatched flow was left pending (no file written).
    assert.equal(fs.existsSync(mintedReport), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("preseedResolutionReuseDecisions is a no-op when the reuse-map env is unset", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-reuse-noop-"));
  try {
    const index = path.join(dir, "index.jsonl");
    writeJsonl(index, [{ dataset_type: "flow", dataset_id: "f1" }]);
    const utils = makeUtils();
    const result = withReuseMapEnv(null, () => utils.preseedResolutionReuseDecisions({ index }));
    assert.deepEqual(result, { enabled: false, seeded: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
