import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { sha256BatchJson, type BatchJsonValue } from "@tiangong-lca/cli/batch";

import type { ScopeControlReceipt } from "./control-receipt-contract.ts";

export interface ControlReceiptVerificationAdapter {
  resolveRepoPath: (value: unknown) => string | null;
}

function batchJson(value: unknown): BatchJsonValue {
  return JSON.parse(JSON.stringify(value)) as BatchJsonValue;
}

function fileFact(filePath: string): { bytes: number; sha256: string } {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Stored control blob is unsafe.");
  const bytes = fs.readFileSync(filePath);
  return {
    bytes: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

export function verifyScopeControlReceipt(
  scopeDir: string,
  adapter: ControlReceiptVerificationAdapter,
) {
  const receiptPath = path.join(scopeDir, "scope-control-receipt.json");
  if (!fs.existsSync(receiptPath)) {
    return { status: "failed", dangling_required_references: 1, findings: ["receipt_missing"] };
  }
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as ScopeControlReceipt;
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
    dangling_required_references: findings.filter((finding) => finding.startsWith("required_blob_"))
      .length,
    findings,
  };
}
