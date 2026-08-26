import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

interface JsonRecord {
  [key: string]: unknown;
}

const fixedNow = "2026-08-26T01:00:00.000Z";

test("support identity cache preserves exact carry-forward, invalidation, discovery and bytes", async () => {
  const files = new Map<string, unknown>([
    [
      "/run/import-ledger/verified-support-identities.jsonl",
      [
        verifiedRow("contact:c1@01.00.000", "contact", "c1", "01.00.000", "local"),
        invalidatedRow("source:s0@01.00.000", "source", "s0", "01.00.000", "local"),
      ],
    ],
    [
      "/prior/import-ledger/verified-support-identities.jsonl",
      [
        verifiedRow("contact:c1@01.00.000", "contact", "c1", "01.00.000", "prior"),
        verifiedRow("source:s1@01.00.000", "source", "s1", "01.00.000", "prior"),
        invalidatedRow("flowproperty:fp1@01.00.000", "flowproperty", "fp1", "01.00.000", "prior"),
      ],
    ],
    [
      "/run/scopes/a/closeout/dataset-post-write-closeout-report.json",
      {
        status: "completed",
        commit_report: "/run/scopes/a/dataset-save-draft/summary.json",
      },
    ],
    [
      "/run/scopes/a/dataset-save-draft/summary.json",
      {
        commit: true,
        status: "completed",
        rows: [
          { status: "executed", table: "unitgroups", id: "ug1", version: "02.00.000" },
          { status: "executed", table: "sources", id: "s2", version: "01.00.000" },
          { status: "failed", table: "contacts", id: "ignored", version: "01.00.000" },
        ],
      },
    ],
    [
      "/prior/scopes/b/closeout/dataset-post-write-closeout-report.json",
      {
        status: "completed",
        commit_report: "/prior/scopes/b/dataset-save-draft/summary.json",
      },
    ],
    [
      "/prior/scopes/b/dataset-save-draft/summary.json",
      {
        commit: true,
        status: "completed",
        rows: [
          { status: "executed", table: "unitgroups", id: "ug1", version: "02.00.000" },
          { status: "executed", table: "sources", id: "s3", version: "01.00.000" },
        ],
      },
    ],
  ]);
  const appended: JsonRecord[] = [];
  const verified = new Set<string>();
  const { createSupportIdentityCacheService } =
    await import("../../scripts/lib/batch-orchestration/support-identity-cache.ts");
  const service = createSupportIdentityCacheService(
    {
      nowIso: () => fixedNow,
      repoRelative: (value: string | null | undefined) => value?.replace(/^\//u, "") ?? "",
      resolveRepoPath: (value: unknown) => (value ? String(value) : null),
      fileExists: (value: string | null | undefined) => Boolean(value && files.has(value)),
      directoryExists: (value: string | null | undefined) =>
        value === "/run/scopes" || value === "/prior/scopes",
      readJson: (value: string) => files.get(value) ?? {},
      readJsonLines: (value: string) => (files.get(value) as JsonRecord[] | undefined) ?? [],
      appendJsonLine: (_value: string, row: unknown) => appended.push(row as JsonRecord),
      findFiles: (root: string, predicate: (value: string) => boolean) =>
        [...files.keys()].filter((value) => value.startsWith(root) && predicate(value)).sort(),
      supportedTypes: () => ["contact", "source", "unitgroup", "flowproperty"],
      path: {
        join: (...parts: string[]) => parts.join("/").replace(/\/{2,}/gu, "/"),
        basename: (value: string) => value.split("/").at(-1) ?? "",
        dirname: (value: string) => value.slice(0, value.lastIndexOf("/")) || "/",
        separator: "/",
      },
    },
    verified,
  );

  const summary = service.prime({
    outDir: "/run",
    cacheFile: "/run/import-ledger/verified-support-identities.jsonl",
    sourceLedgerDirs: ["/prior/import-ledger"],
  });
  assert.deepEqual(summary, {
    cache_file: "run/import-ledger/verified-support-identities.jsonl",
    loaded_from_cache: 1,
    loaded_from_ledger_sources: 1,
    discovered_from_artifacts: 2,
    discovered_from_ledger_source_artifacts: 1,
    verified_support_identities: 5,
  });
  assert.deepEqual(
    [...verified],
    [
      "contact:c1@01.00.000",
      "source:s1@01.00.000",
      "unitgroup:ug1@02.00.000",
      "source:s2@01.00.000",
      "source:s3@01.00.000",
    ],
  );

  const bytes = appended.map((row) => JSON.stringify(row)).join("\n") + "\n";
  assert.equal(appended.length, 5);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedAppendSha256);
  assert.deepEqual(
    appended.map((row) => row.identity_key),
    [
      "source:s1@01.00.000",
      "flowproperty:fp1@01.00.000",
      "unitgroup:ug1@02.00.000",
      "source:s2@01.00.000",
      "source:s3@01.00.000",
    ],
  );
  assert.equal(appended[1]?.status, "invalidated_remote_missing");
  assert.equal(appended[4]?.carried_forward_from, "prior");
});

test("support identity parsing and stale selection preserve profile types and blocker order", async () => {
  const { createSupportIdentityCacheService } =
    await import("../../scripts/lib/batch-orchestration/support-identity-cache.ts");
  const service = createSupportIdentityCacheService(minimalAdapter(), new Set<string>());
  assert.deepEqual(service.splitIdentityKey("flowproperty:fp@01.00.000"), {
    dataset_type: "flowproperty",
    dataset_id: "fp",
    dataset_version: "01.00.000",
  });
  assert.equal(service.splitIdentityKey("flow:x@01.00.000"), null);
  assert.equal(
    service.identityKeyFromCacheRow({ table: "unitgroups", id: "ug" }),
    "unitgroup:ug@00.00.001",
  );
  assert.deepEqual(
    service.staleReusedKeys(
      {
        blockers: [
          { code: "missing_dataset", table: "sources", reference_id: "s", version: "v1" },
          {
            code: "reference_closure_unproven",
            table: "flowproperties",
            id: "fp",
            reference_version: "v2",
          },
          { code: "other", table: "contacts", id: "ignored" },
        ],
      },
      ["flowproperty:fp@v2", "source:s@v1"],
    ),
    ["source:s@v1", "flowproperty:fp@v2"],
  );
});

function verifiedRow(
  identity_key: string,
  dataset_type: string,
  dataset_id: string,
  dataset_version: string,
  source: string,
): JsonRecord {
  return {
    schema_version: 1,
    identity_key,
    dataset_type,
    dataset_id,
    dataset_version,
    status: "verified",
    source,
  };
}

function invalidatedRow(
  identity_key: string,
  dataset_type: string,
  dataset_id: string,
  dataset_version: string,
  source: string,
): JsonRecord {
  return {
    schema_version: 1,
    identity_key,
    dataset_type,
    dataset_id,
    dataset_version,
    status: "invalidated_remote_missing",
    source,
  };
}

function minimalAdapter() {
  return {
    nowIso: () => fixedNow,
    repoRelative: (value: string | null | undefined) => value ?? "",
    resolveRepoPath: (value: unknown) => (value ? String(value) : null),
    fileExists: () => false,
    directoryExists: () => false,
    readJson: () => ({}),
    readJsonLines: () => [],
    appendJsonLine: () => undefined,
    findFiles: () => [],
    supportedTypes: () => ["contact", "source", "unitgroup", "flowproperty"],
    path: {
      join: (...parts: string[]) => parts.join("/"),
      basename: (value: string) => value.split("/").at(-1) ?? "",
      dirname: (value: string) => value.slice(0, value.lastIndexOf("/")) || "/",
      separator: "/",
    },
  };
}

// Filled from the characterized append sequence; changing it requires an explicit behavior task.
const expectedAppendSha256 = "ea63b972884fc284cdc33fb200ce44e97bdb174ac8df94b42c19bd3e655ea94d";
