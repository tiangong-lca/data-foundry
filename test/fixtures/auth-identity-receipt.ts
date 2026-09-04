import { createHash } from "node:crypto";

import type {
  AuthIdentityReceipt,
  AuthIdentityReceiptScope,
} from "@tiangong-lca/cli/auth-identity-receipt";

type JsonRecord = Record<string, unknown>;

export interface TestAuthIdentityReceiptOptions {
  projectRef?: string;
  userId?: string;
  capturedAtUtc?: string;
  packageVersion?: string;
  displayEmail?: string;
  scopeOverrides?: Readonly<JsonRecord>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}

export function testCanonicalJsonSha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableJsonValue(value)))
    .digest("hex");
}

function requestFingerprint(projectRef: string): string {
  return testCanonicalJsonSha256({
    method: "GET",
    path: "/auth/v1/user",
    project_ref: projectRef,
    redirect: "error",
    header_names: ["accept", "apikey", "authorization"],
  });
}

function responseFingerprint(options: {
  projectRef: string;
  userId: string;
  displayEmail: string;
}): string {
  return testCanonicalJsonSha256({
    project_ref: options.projectRef,
    user_id: options.userId,
    display_email: options.displayEmail,
  });
}

export function testAuthIdentityReceipt({
  projectRef = "qgzvkongdjqiiamzbbts",
  userId = "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
  capturedAtUtc = new Date().toISOString(),
  packageVersion = "0.1.8",
  displayEmail = "te****@example.com",
  scopeOverrides = {},
}: TestAuthIdentityReceiptOptions = {}): AuthIdentityReceipt {
  const baseScope: AuthIdentityReceiptScope = {
    schema: "tiangong-lca.auth-identity-receipt.v1",
    status: "passed",
    operation: "current-user-read",
    remote_write_mode: "read-only",
    captured_at_utc: capturedAtUtc,
    cli: { package_name: "@tiangong-lca/cli", package_version: packageVersion },
    project: {
      project_ref: projectRef,
      project_base_url: `https://${projectRef}.supabase.co`,
    },
    identity: { user_id: userId, display_email: displayEmail },
    session: {
      source: "cache",
      cache_mode: "custom-file",
      force_reauth: false,
      expires_at_utc: new Date(Date.parse(capturedAtUtc) + 3_600_000).toISOString(),
    },
    bindings: {
      request_sha256: requestFingerprint(projectRef),
      response_sha256: responseFingerprint({ projectRef, userId, displayEmail }),
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
  const scope = { ...baseScope, ...scopeOverrides } as AuthIdentityReceiptScope;
  return { ...scope, receipt_scope_sha256: testCanonicalJsonSha256(scope) };
}
