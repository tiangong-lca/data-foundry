import {
  createIdentityPreflightBinding,
  sha256Text,
  validateIdentityPreflightExecution,
} from "../../scripts/lib/identity-preflight-proof.ts";
import type { AuthIdentityReceipt } from "../../scripts/lib/identity-preflight-proof.ts";
import { createRequire } from "node:module";
import { fs, path, rel, writeJson, writeJsonLines } from "./foundry-core.ts";

const require = createRequire(import.meta.url);
const cliAuthInternals = (
  require("@tiangong-lca/cli/dist/src/lib/auth-identity-receipt.js") as {
    __testInternals: {
      requestFingerprint(projectRef: string): string;
      responseFingerprint(input: {
        projectRef: string;
        userId: string;
        displayEmail: string;
      }): string;
      sha256Json(value: unknown): string;
    };
  }
).__testInternals;

export interface AuthIdentityReceiptFixtureOptions {
  projectRef?: string;
  userId?: string;
  capturedAtUtc?: string;
}

export interface IdentityPreflightExecutionFixtureOptions {
  datasetType: string;
  id: string;
  version?: string;
  requestFile: string;
  reportFile: string;
  executionManifestFile?: string;
}

export interface IdentityPreflightFixtureRow {
  datasetType?: string;
  dataset_type?: string;
  id?: string;
  dataset_id?: string;
  version?: string;
  dataset_version?: string;
  candidates?: unknown[];
  decision?: string;
  target?: unknown;
  name?: string;
  filter?: unknown;
  query?: string;
  status?: string;
  confidence?: string;
  fields?: unknown;
  findings?: unknown[];
  blockers?: unknown[];
  next_action?: string;
  nextAction?: string;
}

export function testAuthIdentityReceipt({
  projectRef = "qgzvkongdjqiiamzbbts",
  userId = "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
  capturedAtUtc = new Date().toISOString(),
}: AuthIdentityReceiptFixtureOptions = {}): AuthIdentityReceipt {
  const displayEmail = "te****@example.com";
  const scope = {
    schema: "tiangong-lca.auth-identity-receipt.v1",
    status: "passed" as const,
    operation: "current-user-read",
    remote_write_mode: "read-only",
    captured_at_utc: capturedAtUtc,
    cli: { package_name: "@tiangong-lca/cli", package_version: "0.1.1" },
    project: {
      project_ref: projectRef,
      project_base_url: `https://${projectRef}.supabase.co`,
    },
    identity: { user_id: userId, display_email: displayEmail },
    session: {
      source: "signin",
      cache_mode: "disabled",
      force_reauth: true,
      expires_at_utc: null,
    },
    bindings: {
      request_sha256: cliAuthInternals.requestFingerprint(projectRef),
      response_sha256: cliAuthInternals.responseFingerprint({
        projectRef,
        userId,
        displayEmail,
      }),
    },
    assertions: {
      mode: "intent-bound",
      requested_count: 2,
      expected_project_ref: projectRef,
      expected_user_id: userId,
      project_ref_passed: true,
      user_id_passed: true,
      passed: true,
    },
  };
  return { ...scope, receipt_scope_sha256: cliAuthInternals.sha256Json(scope) };
}

export function writeIdentityPreflightExecutionFixture({
  datasetType,
  id,
  version = "00.00.001",
  requestFile,
  reportFile,
  executionManifestFile = path.join(
    path.dirname(reportFile),
    "foundry-identity-preflight-execution.json",
  ),
}: IdentityPreflightExecutionFixtureOptions): string {
  const requestText = fs.readFileSync(requestFile, "utf8");
  const reportText = fs.readFileSync(reportFile, "utf8");
  const request = JSON.parse(requestText) as { target: unknown };
  const binding = createIdentityPreflightBinding({
    datasetType,
    datasetId: id,
    datasetVersion: version,
    targetSha256: sha256Text(JSON.stringify(request.target)),
    requestText,
    semanticArgv: [datasetType, "identity-preflight", "--json", "--timeout-ms", "60000"],
    cli: {
      packageName: "@tiangong-lca/cli",
      packageVersion: "0.1.1",
      packageIntegrity: null,
    },
    authReceipt: testAuthIdentityReceipt({ capturedAtUtc: "2026-08-25T00:00:00.000Z" }),
    relevantInputHashes: {},
  });
  const reportMtimeMs = fs.statSync(reportFile).mtimeMs;
  const execution = validateIdentityPreflightExecution({
    binding,
    exitCode: 0,
    stdoutText: reportText,
    diskReportText: reportText,
    startedAtMs: reportMtimeMs - 1,
    diskReportMtimeMs: reportMtimeMs,
    completedAtUtc: "2026-08-25T00:00:00.000Z",
  });
  if (!execution.ok) throw new Error(execution.code);
  writeJson(executionManifestFile, execution.manifest);
  return executionManifestFile;
}

export function writeCompletedIdentityPreflightIndex(
  root: string,
  rows: readonly IdentityPreflightFixtureRow[],
): string {
  const requestsRoot = path.join(root, "identity-preflight-requests");
  const outputsRoot = path.join(root, "identity-preflight");
  const indexRows = rows.map((row) => {
    const datasetType = (row.datasetType || row.dataset_type) as string;
    const id = (row.id || row.dataset_id) as string;
    const version = row.version || row.dataset_version || "00.00.001";
    const plural = datasetType === "flow" ? "flows" : "processes";
    const requestFile = path.join(requestsRoot, plural, `${id}.json`);
    const reportFile = path.join(outputsRoot, plural, id, "outputs", "identity-decision.json");
    const candidates = Array.isArray(row.candidates) ? row.candidates : [];
    const decision = row.decision || "create_new";
    const blocked = decision === "block_duplicate";
    const request = {
      schema_version: 1,
      target: row.target || { id, version, name_en: row.name || "Fixture" },
      remote_candidate_search: {
        enabled: true,
        data_source: "tg",
        limit: 20,
        ...(row.filter ? { filter: row.filter } : {}),
        query: row.query || `${datasetType} name: ${row.name || "Fixture"}`,
      },
    };
    writeJson(requestFile, request);
    const report = {
      schema_version: 1,
      kind: datasetType,
      status: row.status || (blocked ? "blocked" : "passed"),
      decision,
      confidence: row.confidence || (blocked ? "high" : "medium"),
      target: {
        id,
        version,
        names: [row.name || "Fixture"],
        fields: row.fields || {},
        exchange_signature: [],
        schema_validation: { status: "passed", issue_count: 0, issues: [] },
      },
      candidates,
      candidate_sources: [
        {
          kind: "remote_search",
          endpoint: datasetType === "flow" ? "flow_hybrid_search" : "process_hybrid_search",
          query: row.query || `${datasetType} name: ${row.name || "Fixture"}`,
          ...(row.filter ? { filter: row.filter } : {}),
          row_count: candidates.length,
          scanned_files: [],
        },
      ],
      findings:
        row.findings ||
        (blocked
          ? [
              {
                code: "flow_duplicate_candidate",
                severity: "blocker",
                message: "duplicate",
              },
            ]
          : []),
      blockers:
        row.blockers ||
        (blocked
          ? [
              {
                code: "flow_duplicate_candidate",
                severity: "blocker",
                message: "duplicate",
              },
            ]
          : []),
      next_action:
        row.next_action ||
        row.nextAction ||
        (blocked ? "stop_duplicate" : "materialize_new_payload"),
      files: {},
    };
    writeJson(reportFile, report);
    const executionManifestFile = writeIdentityPreflightExecutionFixture({
      datasetType,
      id,
      version,
      requestFile,
      reportFile,
    });
    return {
      dataset_type: datasetType,
      dataset_id: id,
      dataset_version: version,
      request_file: rel(requestFile),
      output_dir: rel(path.dirname(path.dirname(reportFile))),
      expected_report_file: rel(reportFile),
      execution_manifest_file: rel(executionManifestFile),
      command: `tiangong-lca ${datasetType} identity-preflight --input ${path.basename(requestFile)}`,
      remote_search: {
        data_source: "tg",
        limit: 20,
        ...(row.filter ? { filter: row.filter } : {}),
        query: row.query || `${datasetType} name: ${row.name || "Fixture"}`,
      },
    };
  });
  const indexFile = path.join(requestsRoot, "identity-preflight-requests.jsonl");
  writeJsonLines(indexFile, indexRows);
  return indexFile;
}
