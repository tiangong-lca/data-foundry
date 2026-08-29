import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createLibraryDecisionApply,
  type ScopeRewriteResult,
} from "../../scripts/lib/library-orchestration/decision-apply.ts";
import type {
  EntityMaps,
  EntityRow,
  JsonRecord,
  ScopeProjection,
} from "../../scripts/lib/library-orchestration/entity-projection.ts";

const version = "00.00.001";
const generatedAt = "2026-08-26T12:34:56.000Z";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rerunCommand =
  "node scripts/foundry.ts dataset-library-decisions-apply --library-index <library-index> --decisions-dir <decisions-dir> --out-dir <library-resolution>";

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(textValue).find(Boolean) ?? "";
  return asText(record(value)["#text"]);
}

function ensureArray<T>(value: T | readonly T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value as T];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sha256Text(value: unknown): string {
  return createHash("sha256").update(String(value)).digest("hex");
}

function jsonSha256(value: unknown): string {
  return sha256Text(JSON.stringify(value));
}

function ml(text: string): JsonRecord {
  return { "@xml:lang": "en", "#text": text };
}

function canonicalMultilingualDescription(): JsonRecord[] {
  return [ml("Canonical methane"), { "@xml:lang": "zh", "#text": "标准甲烷" }];
}

function flowEntity(id: string, flowType: string): EntityRow {
  return {
    entity_key: `flow:${id}:${version}`,
    dataset_type: "flow",
    dataset_id: id,
    dataset_version: version,
    source_file: `/workspace/tidas/flows/${id}.json`,
    flow_type: flowType,
  };
}

function scope({
  processId,
  productFlowId,
  elementaryFlowId,
  flowPropertyId,
  unitGroupId,
}: {
  processId: string;
  productFlowId: string;
  elementaryFlowId: string;
  flowPropertyId: string;
  unitGroupId: string;
}): ScopeProjection {
  return {
    process_id: processId,
    process_version: version,
    process_entity_key: `process:${processId}:${version}`,
    bundle_id: `bundle-${processId}`,
    bundle_dir: `/workspace/bundles/${processId}`,
    process_file: `/workspace/bundles/${processId}/tidas/processes/${processId}.json`,
    dependency_ids: {
      flows: [
        {
          entity_key: `flow:${productFlowId}:${version}`,
          id: productFlowId,
          version,
          source: "bundle",
        },
        {
          entity_key: `flow:${elementaryFlowId}:${version}`,
          id: elementaryFlowId,
          version,
          source: "exchange",
        },
      ],
      flowproperties: [
        {
          entity_key: `flowproperty:${flowPropertyId}:${version}`,
          id: flowPropertyId,
          version,
          source: "flow",
        },
      ],
      unitgroups: [
        {
          entity_key: `unitgroup:${unitGroupId}:${version}`,
          id: unitGroupId,
          version,
          source: "flowproperty",
        },
      ],
    },
    usage_refs: { process_exchange_flow_refs: [] },
    unresolved_references: [],
  };
}

function processPayload(processId: string, productFlowId: string, elementaryFlowId: string) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: ml(processId === "process-ready" ? "Ready process" : "Blocked process"),
          },
        },
      },
      exchanges: {
        exchange: [
          {
            "@dataSetInternalID": "1",
            exchangeDirection: "Output",
            meanAmount: "1",
            referenceToFlowDataSet: {
              "@type": "flow data set",
              "@refObjectId": productFlowId,
              "@version": version,
              "@uri": `../flows/${productFlowId}.json`,
              "common:shortDescription": ml(
                processId === "process-ready" ? "Ready product" : "Blocked product",
              ),
            },
          },
          {
            "@dataSetInternalID": "2",
            exchangeDirection: "Input",
            meanAmount: "2.5",
            uncertaintyDistributionType: "log-normal",
            relativeStandardDeviation95In: "1.05",
            referenceToFlowDataSet: {
              "@type": "flow data set",
              "@refObjectId": elementaryFlowId,
              "@version": version,
              "@uri": `../flows/${elementaryFlowId}.json`,
              "common:shortDescription": ml(
                processId === "process-ready" ? "Methane" : "Unresolved elementary flow",
              ),
            },
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": version },
      },
    },
  };
}

function fixture() {
  const entities = [
    flowEntity("product-ready", "Product flow"),
    flowEntity("elementary-ready", "Elementary flow"),
    flowEntity("product-blocked", "Product flow"),
    flowEntity("elementary-blocked", "Elementary flow"),
  ];
  const maps: EntityMaps = {
    byKey: new Map(entities.map((row) => [row.entity_key, row])),
    byTypeId: new Map(
      entities.flatMap((row) => [
        [`${row.dataset_type}:${row.dataset_id}`, row] as const,
        [`${row.dataset_type}:${row.dataset_id}:${row.dataset_version}`, row] as const,
      ]),
    ),
  };
  const scopes = [
    scope({
      processId: "process-ready",
      productFlowId: "product-ready",
      elementaryFlowId: "elementary-ready",
      flowPropertyId: "flow-property-ready",
      unitGroupId: "unit-group-ready",
    }),
    scope({
      processId: "process-blocked",
      productFlowId: "product-blocked",
      elementaryFlowId: "elementary-blocked",
      flowPropertyId: "flow-property-blocked",
      unitGroupId: "unit-group-blocked",
    }),
  ];
  const identityRows: JsonRecord[] = [
    {
      source_dataset_id: "elementary-ready",
      source_dataset_version: version,
      decision: "block_unresolved",
    },
    {
      source_dataset_id: "elementary-ready",
      source_dataset_version: version,
      decision: "reuse_existing_reference",
      canonical_target: {
        id: "canonical-elementary",
        version: "03.00.004",
        uri: "../flows/canonical-elementary.json",
      },
      canonical_short_description: canonicalMultilingualDescription(),
    },
    {
      source_dataset_id: "elementary-blocked",
      source_dataset_version: version,
      decision: "block_unresolved",
    },
  ];
  const classificationRows: JsonRecord[] = [
    {
      category_type: "process",
      dataset_id: "process-ready",
      dataset_version: version,
      selected_code: "0111",
      classification_decision_level: "leaf",
    },
    {
      category_type: "flow-product",
      dataset_id: "product-ready",
      dataset_version: version,
      selected_code: "0121",
      classification_decision_level: "leaf",
    },
    {
      category_type: "process",
      dataset_id: "process-blocked",
      dataset_version: version,
      selected_code: "D",
      classification_decision_level: "broad_section",
    },
    {
      category_type: "flow-product",
      dataset_id: "product-blocked",
      dataset_version: version,
      selected_code: "12",
      classification_decision_level: "broad_section",
    },
  ];
  const supportRows: JsonRecord[] = [
    {
      support_type: "flowproperty",
      source_support_id: "flow-property-ready",
      source_support_version: version,
      target: { id: "canonical-flow-property", version: "03.00.004" },
    },
    {
      support_type: "unitgroup",
      source_support_id: "unit-group-ready",
      source_support_version: version,
      target: { id: "canonical-unit-group", version: "03.00.004" },
    },
  ];
  return { maps, scopes, identityRows, classificationRows, supportRows };
}

const application = createLibraryDecisionApply({
  asText,
  cloneJson,
  ensureArray,
  jsonSha256,
  nowIso: () => generatedAt,
  repoRelativeMaybe: (filePath) => (filePath ? filePath.replace(/^\/workspace\//u, "") : null),
  repoRelativePath: (filePath) => filePath.replace(/^\/workspace\//u, ""),
  rootEntityForRef: (maps, type, id, datasetVersion = version) =>
    maps.byKey.get(`${type}:${id}:${datasetVersion}`) ??
    maps.byTypeId.get(`${type}:${id}:${datasetVersion}`) ??
    maps.byTypeId.get(`${type}:${id}`) ??
    null,
  textValue,
});

test("library decision apply remains a bounded semantic leaf with owner-injected I/O", () => {
  const modulePath = path.join(repoRoot, "scripts/lib/library-orchestration/decision-apply.ts");
  const source = fs.readFileSync(modulePath, "utf8");
  assert.ok(source.split(/\r?\n/u).length <= 800, "semantic stage must remain within 800 LOC");
  assert.doesNotMatch(source, /from\s+["']node:(?:child_process|fs|os|path)["']/u);
  assert.doesNotMatch(source, /\b(?:process|spawnSync)\./u);
  assert.doesNotMatch(source, /\b(?:readJson|readJsonLines|writeJson|writeJsonLines)\b/u);
  assert.doesNotMatch(source, /\bresolveRepoPath\b/u);

  const owner = fs.readFileSync(
    path.join(repoRoot, "scripts/commands/library-scope-workflow.ts"),
    "utf8",
  );
  assert.match(owner, /createLibraryDecisionApply/u);
  assert.match(owner, /decisionApply\.projectDecisionApplication/u);
  assert.match(owner, /writeJson\(rewrittenFile, rewrite\.payload\)/u);
});

test("library decision apply preserves last-write indexes, canonical rewrite bytes and exchange hashes", () => {
  const { maps, scopes, identityRows, classificationRows, supportRows } = fixture();
  const indexes = application.decisionIndexes({
    identityRows,
    classificationRows,
    supportRows,
  });
  assert.deepEqual(
    [...indexes.identityByKey.keys()],
    [`flow:elementary-ready:${version}`, `flow:elementary-blocked:${version}`],
  );
  assert.equal(
    indexes.identityByKey.get(`flow:elementary-ready:${version}`)?.decision,
    "reuse_existing_reference",
  );
  assert.deepEqual(
    [...indexes.classificationByKey.keys()],
    [
      `process:process-ready:${version}`,
      `flow:product-ready:${version}`,
      `process:process-blocked:${version}`,
      `flow:product-blocked:${version}`,
    ],
  );
  assert.deepEqual(
    [...indexes.supportByKey.keys()],
    [`flowproperty:flow-property-ready:${version}`, `unitgroup:unit-group-ready:${version}`],
  );

  const original = processPayload("process-ready", "product-ready", "elementary-ready");
  const rewritten = application.rewriteProcessExchangeReferences({
    scope: scopes[0],
    payload: original,
    identityByKey: indexes.identityByKey,
    maps,
  });
  assert.equal(
    rewritten.payload,
    original,
    "move-only projection retains in-place payload semantics",
  );
  assert.equal(rewritten.changed, true);
  const rewrittenBytes = `${JSON.stringify(rewritten.payload, null, 2)}\n`;
  assert.equal(
    sha256Text(rewrittenBytes),
    "bc8b2099176fe7c778ec2268d3b1984ca35be79a19a17ad96fd7158b7d9d176e",
  );
  assert.deepEqual(rewritten.rewrite_rows, [
    {
      schema_version: 1,
      process_id: "process-ready",
      process_version: version,
      exchange_index: 1,
      source_flow_id: "elementary-ready",
      source_flow_version: version,
      canonical_flow_id: "canonical-elementary",
      canonical_flow_version: "03.00.004",
      canonical_short_description: canonicalMultilingualDescription(),
      changed_path: "referenceToFlowDataSet",
      preserved_exchange_fields: true,
      before_preservation_hash: "d89d0d0c59d50593e105f7a78457996d43a8975f0d64ba8e55e19f75f8a364e2",
      after_preservation_hash: "d89d0d0c59d50593e105f7a78457996d43a8975f0d64ba8e55e19f75f8a364e2",
    },
  ]);
  const rewriteLedgerBytes = `${rewritten.rewrite_rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  assert.equal(
    sha256Text(rewriteLedgerBytes),
    "1b3d3bb53866948ae293812c509cbf12ef7990cd883391dd224c238e17dca9fd",
  );
  assert.deepEqual(Object.keys(record(record(rewritten.payload).processDataSet)), [
    "processInformation",
    "exchanges",
    "administrativeInformation",
  ]);
});

test("library decision apply keeps scalar descriptions scalar", () => {
  const { maps, scopes, identityRows, classificationRows, supportRows } = fixture();
  identityRows[1] = { ...identityRows[1], canonical_short_description: "Canonical methane" };
  const indexes = application.decisionIndexes({ identityRows, classificationRows, supportRows });
  const rewritten = application.rewriteProcessExchangeReferences({
    scope: scopes[0],
    payload: processPayload("process-ready", "product-ready", "elementary-ready"),
    identityByKey: indexes.identityByKey,
    maps,
  });

  assert.equal(rewritten.rewrite_rows[0]?.canonical_short_description, "Canonical methane");
  const exchange = ensureArray(
    record(record(record(rewritten.payload).processDataSet).exchanges).exchange,
  )[1];
  const reference = record(record(exchange).referenceToFlowDataSet);
  assert.equal(reference["common:shortDescription"], "Canonical methane");
});

test("library decision apply rejects non-JSON canonical descriptions before payload mutation", () => {
  const { maps, scopes, identityRows, classificationRows, supportRows } = fixture();
  const circular: JsonRecord = {};
  circular.self = circular;
  const sparse = new Array(1);
  const accessor: JsonRecord = {};
  Object.defineProperty(accessor, "#text", {
    enumerable: true,
    get: () => "computed text",
  });

  for (const invalidDescription of [() => "not-json", 1n, circular, sparse, accessor]) {
    const currentRows = [...identityRows];
    currentRows[1] = {
      ...currentRows[1],
      canonical_short_description: invalidDescription,
    };
    const indexes = application.decisionIndexes({
      identityRows: currentRows,
      classificationRows,
      supportRows,
    });
    const payload = processPayload("process-ready", "product-ready", "elementary-ready");
    const before = cloneJson(payload);

    assert.throws(
      () =>
        application.rewriteProcessExchangeReferences({
          scope: scopes[0],
          payload,
          identityByKey: indexes.identityByKey,
          maps,
        }),
      TypeError,
    );
    assert.deepEqual(payload, before);
  }
});

test("library decision apply preserves blocker order, deferred projection and exact report contracts", () => {
  const { maps, scopes, identityRows, classificationRows, supportRows } = fixture();
  const indexes = application.decisionIndexes({
    identityRows,
    classificationRows,
    supportRows,
  });
  const payloads = new Map<string, JsonRecord>([
    ["process-ready", processPayload("process-ready", "product-ready", "elementary-ready")],
    ["process-blocked", processPayload("process-blocked", "product-blocked", "elementary-blocked")],
  ]);
  const rewrittenPayloads = new Map<string, JsonRecord>();
  const rewriteScope = (
    currentScope: ScopeProjection,
    identityByKey: Map<string, JsonRecord>,
  ): ScopeRewriteResult => {
    const payload = payloads.get(currentScope.process_id);
    assert.ok(payload);
    const result = application.rewriteProcessExchangeReferences({
      scope: currentScope,
      payload,
      identityByKey,
      maps,
    });
    rewrittenPayloads.set(currentScope.process_id, result.payload);
    return {
      rewritten_process_file: result.changed
        ? `out/rewritten-processes/${currentScope.process_id}.json`
        : null,
      rewrite_rows: result.rewrite_rows,
    };
  };

  const projection = application.projectDecisionApplication({
    scopeRows: scopes,
    maps,
    indexes,
    allowAccountLocalSupportAndElementary: false,
    rewriteScope,
  });
  assert.deepEqual(projection.checkpoints, [
    {
      schema_version: 1,
      process_id: "process-ready",
      process_version: version,
      state: "ready",
      blocker_count: 0,
      bundle_dir: "/workspace/bundles/process-ready",
      rewritten_process_file: "out/rewritten-processes/process-ready.json",
      dependency_counts: { flows: 2, flowproperties: 1, unitgroups: 1 },
    },
    {
      schema_version: 1,
      process_id: "process-blocked",
      process_version: version,
      state: "blocked_deferred",
      blocker_count: 5,
      bundle_dir: "/workspace/bundles/process-blocked",
      rewritten_process_file: null,
      dependency_counts: { flows: 2, flowproperties: 1, unitgroups: 1 },
    },
  ]);
  assert.deepEqual(
    projection.blockedLedger.map((row) => row.reason),
    [
      "process_classification_requires_leaf_authoring",
      "flow_classification_requires_authoring",
      "elementary_flow_reference_unresolved",
      "canonical_flow_property_reference_unresolved",
      "canonical_unit_group_reference_unresolved",
    ],
  );
  assert.deepEqual(
    projection.blockedLedger.map((row) => record(row.blocking_dependency).dataset_type),
    ["process", "flow", "flow", "flowproperty", "unitgroup"],
  );
  assert.equal(projection.readyScopes.length, 1);
  assert.deepEqual(Object.keys(projection.readyScopes[0]), [
    "process_id",
    "process_version",
    "process_entity_key",
    "bundle_id",
    "bundle_dir",
    "process_file",
    "dependency_ids",
    "usage_refs",
    "unresolved_references",
    "closure_status",
    "checkpoint",
  ]);
  assert.equal(projection.rewriteRows.length, 1);
  assert.equal(
    rewrittenPayloads.size,
    2,
    "blocked scopes retain the existing rewrite evaluation order",
  );

  const blockedLedgerPath = "/workspace/out/blocked-scope-ledger.jsonl";
  const blockedReportPath = "/workspace/out/blocked-scope-report.json";
  const blockedReport = application.buildBlockedScopeReport({
    command: "dataset-library-decisions-apply",
    blockedRows: projection.blockedLedger,
    blockedLedgerPath,
    reportPath: blockedReportPath,
  });
  assert.deepEqual(Object.keys(blockedReport), [
    "schema_version",
    "generated_at_utc",
    "status",
    "command",
    "counts",
    "reason_summary",
    "scope_summary",
    "files",
    "ledger_semantics",
  ]);
  assert.deepEqual(blockedReport.counts, {
    blocked_ledger_rows: 5,
    blocked_scopes: 1,
    blocker_reasons: 5,
    blocking_dependency_types: { flow: 2, flowproperty: 1, process: 1, unitgroup: 1 },
  });
  assert.deepEqual(
    ensureArray(blockedReport.reason_summary).map((row) => record(row).reason),
    [
      "canonical_flow_property_reference_unresolved",
      "canonical_unit_group_reference_unresolved",
      "elementary_flow_reference_unresolved",
      "flow_classification_requires_authoring",
      "process_classification_requires_leaf_authoring",
    ],
  );
  assert.deepEqual(record(ensureArray(blockedReport.scope_summary)[0]).reasons, {
    canonical_flow_property_reference_unresolved: 1,
    canonical_unit_group_reference_unresolved: 1,
    elementary_flow_reference_unresolved: 1,
    flow_classification_requires_authoring: 1,
    process_classification_requires_leaf_authoring: 1,
  });
  assert.deepEqual(record(ensureArray(blockedReport.scope_summary)[0]).rerun_commands, [
    rerunCommand,
  ]);
  assert.equal(
    jsonSha256(blockedReport),
    "ed4c582a35599a1a3a90ec703b6e59d4a5b4c8660fbbb150daa6799736650e7c",
  );

  const resolution = application.buildLibraryResolution({
    indexDir: "/workspace/index",
    decisionsDir: "/workspace/decisions",
    resolutionPath: "/workspace/out/library-resolution.json",
    checkpointPath: "/workspace/out/scope-checkpoints.jsonl",
    blockedPath: blockedLedgerPath,
    blockedReportPath,
    readyPath: "/workspace/out/ready-scopes.jsonl",
    rewritePath: "/workspace/out/exchange-reference-rewrites.jsonl",
    projection,
    decisionCounts: {
      identity_decisions: identityRows.length,
      classification_decisions: classificationRows.length,
      canonical_support_mappings: supportRows.length,
    },
  });
  assert.deepEqual(Object.keys(resolution), [
    "schema_version",
    "generated_at_utc",
    "status",
    "command",
    "library_index",
    "decisions_dir",
    "counts",
    "ready_scope_ids",
    "blocked_scope_ids",
    "files",
    "policy",
    "blockers",
  ]);
  assert.deepEqual(resolution.counts, {
    process_scopes: 2,
    ready_scopes: 1,
    blocked_scopes: 1,
    blocked_scope_ledger_rows: 5,
    identity_decisions: 3,
    classification_decisions: 4,
    canonical_support_mappings: 2,
    exchange_reference_rewrites: 1,
  });
  assert.deepEqual(resolution.ready_scope_ids, ["process-ready"]);
  assert.deepEqual(resolution.blocked_scope_ids, ["process-blocked"]);
  assert.equal(
    jsonSha256(resolution),
    "9cc04fae137d110d0205ff553aeaf5d8447aa773713ae40075913bfcce24c8ea",
  );
});
