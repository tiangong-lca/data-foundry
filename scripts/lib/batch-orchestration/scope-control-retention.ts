import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { sha256BatchJson, type BatchJsonValue } from "@tiangong-lca/cli/batch";

import { createControlArtifactStore, type ControlArtifactFact } from "./control-artifact-store.ts";
import { projectScopeControlReferences } from "./control-reference-projection.ts";
import { firstUnsafeScopeEntry, pathIsInside, pruneScopeScratch } from "./scope-safe-prune.ts";

type JsonRecord = Record<string, unknown>;

export const SCOPE_CONTROL_RECEIPT_SCHEMA = "tiangong-foundry.scope-control-receipt.v1" as const;

export interface ScopeControlRetentionAdapter {
  nowIso: () => string;
  repoRelative: (filePath: string) => string;
  resolveRepoPath: (value: unknown) => string | null;
  linkFile?: (source: string, destination: string) => void;
}

export interface ScopeControlArtifactEntry extends JsonRecord {
  role: string;
  roles: string[];
  artifact_id: string | null;
  bytes: number | null;
  sha256: string | null;
  original_locator: string;
  store_locator: string | null;
  storage_mode: string | null;
  retention:
    "external_unmanaged" | "missing_before_retention" | "pruned_payload" | "retained_control";
  required_for_control: boolean;
}

export interface ScopeControlReceiptAuthority extends JsonRecord {
  schema: typeof SCOPE_CONTROL_RECEIPT_SCHEMA;
  generated_at_utc: string;
  status: "completed";
  scope_id: string;
  store_root: string;
  artifacts: ScopeControlArtifactEntry[];
  counts: JsonRecord;
}

export interface ScopeControlReceipt extends ScopeControlReceiptAuthority {
  receipt_sha256: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(filePath: string): JsonRecord {
  const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(value)) throw new Error(`Expected a JSON object: ${filePath}`);
  return value;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function fileFact(filePath: string): { bytes: number; sha256: string } {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Retention evidence must be a regular non-symlink file: ${filePath}`);
  }
  const bytes = fs.readFileSync(filePath);
  return {
    bytes: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function batchJson(value: unknown): BatchJsonValue {
  return JSON.parse(JSON.stringify(value)) as BatchJsonValue;
}

function receiptAuthority(receipt: ScopeControlReceiptAuthority): JsonRecord {
  return { ...receipt };
}

function blockedResult(
  scopeDir: string,
  adapter: ScopeControlRetentionAdapter,
  status: "blocked_missing_control_evidence" | "blocked_unsafe_scope_entry",
  findings: JsonRecord[],
) {
  const report = {
    schema: "tiangong-foundry.scope-prune-report.v1",
    generated_at_utc: adapter.nowIso(),
    status,
    scope_id: path.basename(scopeDir),
    counts: { findings: findings.length, pruned_entries: 0, pruned_bytes: 0 },
    findings,
    automatic_prune_performed: false,
  };
  writeJson(path.join(scopeDir, "scope-prune-report.json"), report);
  return { ...report, artifacts: [] as ScopeControlArtifactEntry[] };
}

export function createScopeControlRetentionService(adapter: ScopeControlRetentionAdapter) {
  function verifyReceipt(scopeDir: string) {
    const receiptPath = path.join(scopeDir, "scope-control-receipt.json");
    if (!fs.existsSync(receiptPath)) {
      return { status: "failed", dangling_required_references: 1, findings: ["receipt_missing"] };
    }
    const receipt = readJson(receiptPath) as ScopeControlReceipt;
    const { receipt_sha256: observedReceiptSha, ...authority } = receipt;
    const findings: string[] = [];
    if (sha256BatchJson(batchJson(authority)) !== observedReceiptSha) {
      findings.push("receipt_sha256_mismatch");
    }
    for (const artifact of receipt.artifacts) {
      if (!artifact.required_for_control) continue;
      const stored = adapter.resolveRepoPath(artifact.store_locator);
      if (!stored || !fs.existsSync(stored)) {
        findings.push(`required_blob_missing:${artifact.original_locator}`);
        continue;
      }
      const observed = fileFact(stored);
      if (observed.bytes !== artifact.bytes || observed.sha256 !== artifact.sha256) {
        findings.push(`required_blob_drift:${artifact.original_locator}`);
      }
    }
    return {
      status: findings.length === 0 ? "passed" : "failed",
      dangling_required_references: findings.filter((finding) =>
        finding.startsWith("required_blob_"),
      ).length,
      findings,
    };
  }

  function retainAndPrune({ scopeDir, storeDir }: { scopeDir: string; storeDir: string }) {
    const absoluteScope = path.resolve(scopeDir);
    const absoluteStore = path.resolve(storeDir);
    const repoRoot = adapter.resolveRepoPath(".");
    const unsafe =
      !repoRoot ||
      !pathIsInside(repoRoot, absoluteScope) ||
      !pathIsInside(repoRoot, absoluteStore) ||
      pathIsInside(absoluteScope, absoluteStore) ||
      firstUnsafeScopeEntry(absoluteScope);
    if (unsafe) {
      return blockedResult(absoluteScope, adapter, "blocked_unsafe_scope_entry", [
        { code: "unsafe_scope_or_store_path", path: String(unsafe || absoluteStore) },
      ]);
    }
    const reportPath = path.join(absoluteScope, "scope-run-report.json");
    const report = readJson(reportPath);
    const references = projectScopeControlReferences({
      scopeDir: absoluteScope,
      report,
      adapter,
    });
    const missingControl = references.filter(
      (reference) => reference.required_for_control && !reference.exists,
    );
    if (missingControl.length > 0) {
      return blockedResult(
        absoluteScope,
        adapter,
        "blocked_missing_control_evidence",
        missingControl.map((reference) => ({
          code: "required_control_reference_missing",
          role: reference.role,
          locator: reference.original_locator,
        })),
      );
    }
    const store = createControlArtifactStore({
      rootDir: absoluteStore,
      linkFile: adapter.linkFile,
    });
    const artifacts: ScopeControlArtifactEntry[] = references.map((reference) => {
      if (!reference.inside_scope) {
        return {
          role: reference.role,
          roles: reference.roles,
          artifact_id: null,
          bytes: null,
          sha256: null,
          original_locator: reference.original_locator,
          store_locator: null,
          storage_mode: null,
          retention: "external_unmanaged",
          required_for_control: false,
        };
      }
      if (!reference.exists) {
        return {
          role: reference.role,
          roles: reference.roles,
          artifact_id: null,
          bytes: null,
          sha256: null,
          original_locator: reference.original_locator,
          store_locator: null,
          storage_mode: null,
          retention: "missing_before_retention",
          required_for_control: false,
        };
      }
      if (reference.reference_kind === "control") {
        const fact = store.putFile(reference.absolute_path);
        return {
          role: reference.role,
          roles: reference.roles,
          artifact_id: fact.artifact_id,
          bytes: fact.bytes,
          sha256: fact.sha256,
          original_locator: reference.original_locator,
          store_locator: adapter.repoRelative(fact.store_path),
          storage_mode: fact.storage_mode,
          retention: "retained_control",
          required_for_control: true,
        };
      }
      const fact = fileFact(reference.absolute_path);
      return {
        role: reference.role,
        roles: reference.roles,
        artifact_id: `sha256:${fact.sha256}`,
        bytes: fact.bytes,
        sha256: fact.sha256,
        original_locator: reference.original_locator,
        store_locator: null,
        storage_mode: null,
        retention: "pruned_payload",
        required_for_control: false,
      };
    });
    const authority: ScopeControlReceiptAuthority = {
      schema: SCOPE_CONTROL_RECEIPT_SCHEMA,
      generated_at_utc: adapter.nowIso(),
      status: "completed",
      scope_id: path.basename(absoluteScope),
      store_root: adapter.repoRelative(absoluteStore),
      artifacts,
      counts: {
        references: artifacts.length,
        retained_control: artifacts.filter((artifact) => artifact.retention === "retained_control")
          .length,
        pruned_payload: artifacts.filter((artifact) => artifact.retention === "pruned_payload")
          .length,
        external_unmanaged: artifacts.filter(
          (artifact) => artifact.retention === "external_unmanaged",
        ).length,
        missing_noncontrol: artifacts.filter(
          (artifact) => artifact.retention === "missing_before_retention",
        ).length,
        dangling_required_references: 0,
      },
    };
    const receipt: ScopeControlReceipt = {
      ...authority,
      receipt_sha256: sha256BatchJson(batchJson(receiptAuthority(authority))),
    };
    const receiptPath = path.join(absoluteScope, "scope-control-receipt.json");
    writeJson(receiptPath, receipt);
    const reportFiles = isRecord(report.files) ? report.files : {};
    writeJson(reportPath, {
      ...report,
      control_evidence: {
        schema: receipt.schema,
        receipt: adapter.repoRelative(receiptPath),
        receipt_sha256: receipt.receipt_sha256,
        counts: receipt.counts,
      },
      files: { ...reportFiles, control_receipt: adapter.repoRelative(receiptPath) },
    });
    const prune = pruneScopeScratch(absoluteScope);
    const verification = verifyReceipt(absoluteScope);
    writeJson(path.join(absoluteScope, "scope-prune-report.json"), {
      schema: "tiangong-foundry.scope-prune-report.v1",
      generated_at_utc: adapter.nowIso(),
      status:
        verification.status === "passed" && prune.failed_entries.length === 0
          ? "completed"
          : "completed_with_findings",
      scope_id: receipt.scope_id,
      receipt: adapter.repoRelative(receiptPath),
      receipt_sha256: receipt.receipt_sha256,
      counts: {
        pruned_entries: prune.removed_entries.length,
        pruned_bytes: prune.removed_bytes,
        prune_failures: prune.failed_entries.length,
        dangling_required_references: verification.dangling_required_references,
      },
      removed_entries: prune.removed_entries,
      failed_entries: prune.failed_entries,
      verification,
      automatic_prune_performed: true,
    });
    return receipt;
  }

  return Object.freeze({ retainAndPrune, verifyReceipt });
}

export type { ControlArtifactFact };
