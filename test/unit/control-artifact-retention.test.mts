import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createControlArtifactStore } from "../../scripts/lib/batch-orchestration/control-artifact-store.ts";
import { createScopeControlRetentionService } from "../../scripts/lib/batch-orchestration/scope-control-retention.ts";

type JsonRecord = Record<string, unknown>;

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function filesBelow(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(next);
      else if (entry.isFile()) files.push(next);
    }
  }
  return files.sort();
}

function scopeFixture(root: string, scopeId: string, reportValue = "shared-control") {
  const scopeDir = path.join(root, ".foundry", "run", "batch", "scopes", scopeId);
  const controlReport = path.join(scopeDir, "finalize", "dataset-finalize-report.json");
  const payloadRows = path.join(scopeDir, "finalize", "rows.jsonl");
  writeJson(controlReport, {
    status: "completed",
    marker: reportValue,
  });
  fs.writeFileSync(payloadRows, `${JSON.stringify({ payload: "x".repeat(8_192) })}\n`);
  writeJson(path.join(scopeDir, "scope-run-report.json"), {
    status: "verified",
    files: {
      process_finalize_report: path.relative(root, controlReport),
      final_rows: path.relative(root, payloadRows),
    },
  });
  return { scopeDir, controlReport, payloadRows };
}

function service(root: string, linkFile?: (source: string, destination: string) => void) {
  return createScopeControlRetentionService({
    nowIso: () => "2026-08-29T00:00:00.000Z",
    repoRelative: (filePath) => path.relative(root, filePath).split(path.sep).join("/"),
    resolveRepoPath: (value) =>
      value
        ? path.isAbsolute(String(value))
          ? String(value)
          : path.join(root, String(value))
        : null,
    linkFile,
  });
}

test("two scope receipts deduplicate control bytes and explicitly prune payload locators", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-retention-scope-"));
  const storeDir = path.join(root, ".foundry", "run", "control-artifact-store");
  const first = scopeFixture(root, "scope-a");
  const second = scopeFixture(root, "scope-b");
  try {
    const retention = service(root);
    const receiptA = retention.retainAndPrune({ scopeDir: first.scopeDir, storeDir });
    const receiptB = retention.retainAndPrune({ scopeDir: second.scopeDir, storeDir });
    const receiptARepeated = retention.retainAndPrune({ scopeDir: first.scopeDir, storeDir });
    assert.equal(receiptA.status, "completed");
    assert.equal(receiptB.status, "completed");
    assert.equal(receiptA.counts.dangling_required_references, 0);
    assert.equal(receiptB.counts.dangling_required_references, 0);
    assert.equal(receiptARepeated.receipt_sha256, receiptA.receipt_sha256);
    assert.equal(filesBelow(path.join(storeDir, "sha256")).length, 1);
    assert.equal(fs.existsSync(first.controlReport), false);
    assert.equal(fs.existsSync(first.payloadRows), false);
    const payload = receiptA.artifacts.find(
      (artifact: JsonRecord) => artifact.role === "final_rows",
    );
    assert.equal(payload?.retention, "pruned_payload");
    assert.equal(payload?.store_locator, null);
    assert.equal(retention.verifyReceipt(first.scopeDir).status, "passed");
    assert.equal(retention.verifyReceipt(second.scopeDir).status, "passed");
    if (process.platform !== "win32") {
      const blob = filesBelow(path.join(storeDir, "sha256"))[0];
      assert.equal(fs.statSync(blob).mode & 0o222, 0);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Worldsteel pilots and USLCI resume rounds keep one immutable control blob", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-retention-replay-"));
  const storeDir = path.join(root, "store");
  const report = path.join(root, "same-report.json");
  writeJson(report, { status: "completed", profile: "worldsteel-or-uslci" });
  try {
    const store = createControlArtifactStore({ rootDir: storeDir });
    const facts = [];
    for (let pilot = 0; pilot < 34; pilot += 1) facts.push(store.putFile(report));
    for (let round = 0; round < 6; round += 1) {
      for (let scope = 0; scope < 1_358; scope += 1) facts.push(store.putFile(report));
    }
    assert.equal(new Set(facts.map((fact) => fact.artifact_id)).size, 1);
    assert.equal(filesBelow(path.join(storeDir, "sha256")).length, 1);
    assert.equal(facts.filter((fact) => fact.storage_mode === "reused").length, facts.length - 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("copy fallback remains verifiable when hardlinks are unavailable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-retention-copy-"));
  const report = path.join(root, "report.json");
  writeJson(report, { status: "completed" });
  try {
    const store = createControlArtifactStore({
      rootDir: path.join(root, "store"),
      linkFile: () => {
        const error = new Error("cross device") as NodeJS.ErrnoException;
        error.code = "EXDEV";
        throw error;
      },
    });
    const fact = store.putFile(report);
    assert.equal(fact.storage_mode, "copied");
    assert.equal(store.verify(fact).status, "passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing control evidence and symlinked scratch fail closed without pruning", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-retention-unsafe-"));
  const fixture = scopeFixture(root, "scope-a");
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "keep.txt"), "outside\n");
  try {
    fs.rmSync(fixture.controlReport);
    const retention = service(root);
    const missing = retention.retainAndPrune({
      scopeDir: fixture.scopeDir,
      storeDir: path.join(root, "store"),
    });
    assert.equal(missing.status, "blocked_missing_control_evidence");
    assert.equal(fs.existsSync(fixture.payloadRows), true);

    writeJson(fixture.controlReport, { status: "completed" });
    fs.symlinkSync(outside, path.join(fixture.scopeDir, "unsafe-link"));
    const unsafe = retention.retainAndPrune({
      scopeDir: fixture.scopeDir,
      storeDir: path.join(root, "store"),
    });
    assert.equal(unsafe.status, "blocked_unsafe_scope_entry");
    assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "outside\n");

    fs.rmSync(path.join(fixture.scopeDir, "unsafe-link"));
    const storeLink = path.join(root, "linked-store");
    fs.symlinkSync(outside, storeLink);
    const unsafeStore = retention.retainAndPrune({
      scopeDir: fixture.scopeDir,
      storeDir: storeLink,
    });
    assert.equal(unsafeStore.status, "blocked_unsafe_scope_entry");
    assert.deepEqual(fs.readdirSync(outside), ["keep.txt"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unrecoverable CAS failure writes a blocker and preserves every scratch byte", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-retention-failure-"));
  const fixture = scopeFixture(root, "scope-a");
  try {
    const retention = service(root, () => {
      const error = new Error("device failure") as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    });
    const result = retention.retainAndPrune({
      scopeDir: fixture.scopeDir,
      storeDir: path.join(root, "store"),
    });
    assert.equal(result.status, "blocked_control_retention_error");
    assert.equal(fs.existsSync(fixture.controlReport), true);
    assert.equal(fs.existsSync(fixture.payloadRows), true);
    const report = JSON.parse(
      fs.readFileSync(path.join(fixture.scopeDir, "scope-prune-report.json"), "utf8"),
    );
    assert.equal(report.automatic_prune_performed, false);
    assert.equal(report.findings[0].code, "control_retention_failed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
