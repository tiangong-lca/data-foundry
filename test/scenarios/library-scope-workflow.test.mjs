import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createFoundryRuntimeUtils,
  resolveInstalledTiangongLcaCliPackage,
} from "../../scripts/lib/foundry-runtime-utils.ts";
import {
  firstTidasSchemaDir,
  tidasSchemaPath,
} from "../../scripts/lib/import-curation/internal/context-inputs.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = path.join(repoRoot, "tmp", "library-scope-workflow-test");

const ids = {
  p1: "11111111-1111-5111-8111-111111111111",
  p2: "22222222-2222-5222-8222-222222222222",
  ef1: "33333333-3333-5333-8333-333333333333",
  ef2: "44444444-4444-5444-8444-444444444444",
  pf1: "55555555-5555-5555-8555-555555555555",
  fp1: "66666666-6666-5666-8666-666666666666",
  fp2: "77777777-7777-5777-8777-777777777777",
  ug1: "88888888-8888-5888-8888-888888888888",
  ug2: "99999999-9999-5999-8999-999999999999",
};

function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function ml(text) {
  return { "@xml:lang": "en", "#text": text };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonLines(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  return text.split(/\r?\n/u).map((line) => JSON.parse(line));
}

function runFoundry(args, expectedStatus = 0, env = {}) {
  const result = spawnSync(process.execPath, ["scripts/foundry.mjs", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function unitGroupPayload(id, name, unitName) {
  return {
    unitGroupDataSet: {
      unitGroupInformation: {
        dataSetInformation: {
          "common:UUID": id,
          "common:name": ml(name),
        },
      },
      units: {
        unit: {
          "@dataSetInternalID": "1",
          name: ml(unitName),
          meanValue: 1,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}

function flowPropertyPayload(id, unitGroupId, name) {
  return {
    flowPropertyDataSet: {
      flowPropertiesInformation: {
        dataSetInformation: {
          "common:UUID": id,
          "common:name": ml(name),
        },
        quantitativeReference: {
          referenceToReferenceUnitGroup: {
            "@type": "unit group data set",
            "@refObjectId": unitGroupId,
            "@version": "00.00.001",
            "@uri": `../unitgroups/${unitGroupId}.json`,
            "common:shortDescription": ml("Reference unit group"),
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}

function flowPayload({ id, name, flowPropertyId, flowType, category }) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: { baseName: ml(name) },
          classificationInformation: category
            ? {
                "common:elementaryFlowCategorization": {
                  "common:category": category.map((text, index) => ({
                    "@level": String(index),
                    "#text": text,
                  })),
                },
              }
            : undefined,
        },
      },
      modellingAndValidation: {
        LCIMethod: {
          typeOfDataSet: flowType,
        },
      },
      flowProperties: {
        flowProperty: {
          "@dataSetInternalID": "1",
          referenceToFlowPropertyDataSet: {
            "@type": "flow property data set",
            "@refObjectId": flowPropertyId,
            "@version": "00.00.001",
            "@uri": `../flowproperties/${flowPropertyId}.json`,
            "common:shortDescription": ml("Flow property"),
          },
          meanValue: 1,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}

function processPayload({ id, name, exchanges }) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: { baseName: ml(name) },
        },
      },
      exchanges: {
        exchange: exchanges.map((exchange, index) => ({
          "@dataSetInternalID": String(index + 1),
          exchangeDirection: exchange.direction,
          meanAmount: exchange.amount,
          referenceToFlowDataSet: {
            "@type": "flow data set",
            "@refObjectId": exchange.flowId,
            "@version": "00.00.001",
            "@uri": `../flows/${exchange.flowId}.json`,
            "common:shortDescription": ml(exchange.shortDescription),
          },
        })),
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}

function writeTidasPayload(root, typePlural, id, payload) {
  writeJson(path.join(root, "tidas", typePlural, `${id}.json`), payload);
}

function writeBundle(root, processId, payloads) {
  const bundleDir = path.join(root, "process-bundles", processId);
  for (const [plural, rows] of Object.entries(payloads)) {
    for (const [id, payload] of Object.entries(rows)) {
      writeJson(path.join(bundleDir, "tidas", plural, `${id}.json`), payload);
    }
  }
  const files = {
    contacts: [],
    sources: [],
    unitgroups: Object.keys(payloads.unitgroups ?? {}).map((id) => `tidas/unitgroups/${id}.json`),
    flowproperties: Object.keys(payloads.flowproperties ?? {}).map(
      (id) => `tidas/flowproperties/${id}.json`,
    ),
    flows: Object.keys(payloads.flows ?? {}).map((id) => `tidas/flows/${id}.json`),
    processes: [`tidas/processes/${processId}.json`],
  };
  writeJson(path.join(bundleDir, "manifest.json"), {
    schema_version: 1,
    process_id: processId,
    files,
    unresolved_references: [],
  });
  return bundleDir;
}

function createLibraryFixture() {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const ug1 = unitGroupPayload(ids.ug1, "Units of kg", "kg");
  const ug2 = unitGroupPayload(ids.ug2, "Units of m3y", "m3y");
  const fp1 = flowPropertyPayload(ids.fp1, ids.ug1, "Amount in kg");
  const fp2 = flowPropertyPayload(ids.fp2, ids.ug2, "Amount in m3y");
  const ef1 = flowPayload({
    id: ids.ef1,
    name: "Methane",
    flowPropertyId: ids.fp1,
    flowType: "Elementary flow",
    category: ["Emissions", "Emissions to air"],
  });
  const ef2 = flowPayload({
    id: ids.ef2,
    name: "Generated water occupation flow",
    flowPropertyId: ids.fp2,
    flowType: "Elementary flow",
    category: ["Resources", "Water"],
  });
  const pf1 = flowPayload({
    id: ids.pf1,
    name: "Fixture product flow",
    flowPropertyId: ids.fp1,
    flowType: "Product flow",
  });
  const p1 = processPayload({
    id: ids.p1,
    name: "Ready process",
    exchanges: [
      {
        direction: "Output",
        amount: "1",
        flowId: ids.pf1,
        shortDescription: "Fixture product flow",
      },
      {
        direction: "Input",
        amount: "2.5",
        flowId: ids.ef1,
        shortDescription: "Methane",
      },
    ],
  });
  const p2 = processPayload({
    id: ids.p2,
    name: "Blocked process",
    exchanges: [
      {
        direction: "Input",
        amount: "4",
        flowId: ids.ef2,
        shortDescription: "Generated water occupation flow",
      },
    ],
  });
  for (const [plural, rows] of Object.entries({
    unitgroups: { [ids.ug1]: ug1, [ids.ug2]: ug2 },
    flowproperties: { [ids.fp1]: fp1, [ids.fp2]: fp2 },
    flows: { [ids.ef1]: ef1, [ids.ef2]: ef2, [ids.pf1]: pf1 },
    processes: { [ids.p1]: p1, [ids.p2]: p2 },
  })) {
    for (const [id, payload] of Object.entries(rows)) {
      writeTidasPayload(fixtureRoot, plural, id, payload);
    }
  }
  const p1Bundle = writeBundle(fixtureRoot, ids.p1, {
    unitgroups: { [ids.ug1]: ug1 },
    flowproperties: { [ids.fp1]: fp1 },
    flows: { [ids.ef1]: ef1, [ids.pf1]: pf1 },
    processes: { [ids.p1]: p1 },
  });
  const p2Bundle = writeBundle(fixtureRoot, ids.p2, {
    unitgroups: { [ids.ug2]: ug2 },
    flowproperties: { [ids.fp2]: fp2 },
    flows: { [ids.ef2]: ef2 },
    processes: { [ids.p2]: p2 },
  });
  writeJson(path.join(fixtureRoot, "process-bundles", "index.json"), {
    schema_version: 1,
    source_tidas_dir: path.join(fixtureRoot, "tidas"),
    process_count: 2,
    bundles: [
      {
        process_id: ids.p1,
        manifest: `${ids.p1}/manifest.json`,
        tidas_dir: `${ids.p1}/tidas`,
      },
      {
        process_id: ids.p2,
        manifest: `${ids.p2}/manifest.json`,
        tidas_dir: `${ids.p2}/tidas`,
      },
    ],
    unresolved_references: [],
  });
  return {
    sourceDir: fixtureRoot,
    processBundlesDir: path.join(fixtureRoot, "process-bundles"),
  };
}

function buildIndex() {
  const { sourceDir, processBundlesDir } = createLibraryFixture();
  const outDir = path.join(fixtureRoot, "run", "library-index");
  const report = runFoundry([
    "dataset-library-index-build",
    "--source-dir",
    sourceDir,
    "--process-bundles-dir",
    processBundlesDir,
    "--out-dir",
    outDir,
  ]);
  return { report, outDir, sourceDir, processBundlesDir };
}

test("library index deduplicates root TIDAS entities and projects shared dependencies to process scopes", () => {
  const { report, outDir } = buildIndex();
  assert.equal(report.status, "completed");
  assert.equal(report.counts.flow, 3);
  assert.equal(report.counts.process_scopes, 2);

  const entities = readJsonLines(path.join(outDir, "library-entity-index.jsonl"));
  const scopeProjection = readJsonLines(path.join(outDir, "scope-projection.jsonl"));
  assert.equal(entities.filter((row) => row.dataset_type === "flow").length, 3);
  assert.equal(scopeProjection.length, 2);
  assert.equal(
    scopeProjection
      .find((row) => row.process_id === ids.p1)
      .dependency_ids.flows.some((dep) => dep.id === ids.ef1),
    true,
  );
});

test("library authoring plan emits deduplicated semantic decision templates", () => {
  const { outDir } = buildIndex();
  const planDir = path.join(fixtureRoot, "run", "authoring-plan");
  const report = runFoundry([
    "dataset-library-authoring-plan",
    "--library-index",
    outDir,
    "--out-dir",
    planDir,
    "--chunk-size",
    "2",
  ]);
  assert.equal(report.status, "ready_for_ai_library_decisions");
  assert.equal(report.counts.identity_decisions, 2);
  assert.equal(report.counts.classification_decisions, 3);
  assert.equal(report.counts.canonical_support_mappings, 4);
  assert.ok(report.files.chunks.length > 0);
});

test("library identity decisions from preflight emits reuse decisions and manual review rows", () => {
  const { outDir } = buildIndex();
  const preflightDir = path.join(fixtureRoot, "run", "identity-preflight");
  const reportFile = path.join(preflightDir, "flows", ids.ef1, "outputs", "identity-decision.json");
  const candidatesFile = path.join(
    preflightDir,
    "flows",
    ids.ef1,
    "outputs",
    "identity-candidates.jsonl",
  );
  writeJson(reportFile, {
    schema_version: 1,
    kind: "flow",
    status: "needs_review",
    decision: "manual_review",
    target: {
      id: ids.ef1,
      version: "00.00.001",
      names: ["Methane"],
      fields: {
        type_of_dataset: "Elementary flow",
        cas: "74-82-8",
        flow_property: "Amount in kg",
        categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
      },
    },
    candidates: [
      {
        id: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
        version: "03.00.004",
        names: ["methane"],
        fields: {
          type_of_dataset: "Elementary flow",
          cas: "74-82-8",
          flow_property: "Mass",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
    ],
  });
  writeJsonLines(candidatesFile, []);
  const preflightIndex = path.join(preflightDir, "identity-preflight-requests.jsonl");
  writeJsonLines(preflightIndex, [
    {
      dataset_type: "flow",
      dataset_id: ids.ef1,
      dataset_version: "00.00.001",
      expected_report_file: rel(reportFile),
      expected_candidates_file: rel(candidatesFile),
    },
  ]);

  const decisionsDir = path.join(fixtureRoot, "run", "decisions-from-preflight");
  const report = runFoundry([
    "dataset-library-identity-decisions-from-preflight",
    "--library-index",
    outDir,
    "--identity-preflight-index",
    preflightIndex,
    "--out-dir",
    decisionsDir,
  ]);

  assert.equal(report.status, "completed_with_manual_review");
  assert.equal(report.counts.elementary_flows, 2);
  assert.equal(report.counts.reuse_existing_reference, 1);
  assert.equal(report.counts.manual_review, 1);

  const decisions = readJsonLines(path.join(decisionsDir, "identity-decisions.jsonl"));
  const manualReview = readJsonLines(
    path.join(decisionsDir, "identity-decisions.manual-review.jsonl"),
  );
  assert.equal(decisions[0].decision, "reuse_existing_reference");
  assert.equal(decisions[0].canonical_flow_id, "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(decisions[0].canonical.ref_object_id, "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(manualReview[0].decision, "block_unresolved");
  assert.equal(manualReview[0].source_dataset_id, ids.ef2);
});

test("library decisions apply rewrites only elementary flow references and defers unresolved scopes", () => {
  const { outDir } = buildIndex();
  const decisionsDir = path.join(fixtureRoot, "run", "decisions");
  writeJsonLines(path.join(decisionsDir, "identity-decisions.jsonl"), [
    {
      decision: "reuse_existing_reference",
      source_dataset_id: ids.ef1,
      source_dataset_version: "00.00.001",
      canonical_flow_id: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
      canonical_flow_version: "03.00.003",
      canonical_short_description: ml("Canonical methane"),
      physical_equivalence_evidence: "Same CAS/name/category meaning.",
    },
  ]);
  writeJsonLines(path.join(decisionsDir, "classification-decisions.jsonl"), [
    {
      category_type: "process",
      dataset_id: ids.p1,
      dataset_version: "00.00.001",
      code: "process-ready",
      confidence: "high",
    },
    {
      category_type: "process",
      dataset_id: ids.p2,
      dataset_version: "00.00.001",
      code: "process-blocked",
      confidence: "high",
    },
    {
      category_type: "flow-product",
      dataset_id: ids.pf1,
      dataset_version: "00.00.001",
      code: "flow-product",
      confidence: "high",
    },
  ]);
  writeJsonLines(path.join(decisionsDir, "canonical-support-mappings.jsonl"), [
    {
      support_type: "flowproperty",
      source_support_id: ids.fp1,
      source_support_version: "00.00.001",
      canonical_support_id: "bbbbbbbb-bbbb-5bbb-8bbb-bbbbbbbbbbbb",
      canonical_support_version: "03.00.003",
      physical_dimension_evidence: "Mass in kg maps to canonical mass.",
    },
    {
      support_type: "unitgroup",
      source_support_id: ids.ug1,
      source_support_version: "00.00.001",
      canonical_support_id: "cccccccc-cccc-5ccc-8ccc-cccccccccccc",
      canonical_support_version: "03.00.003",
      physical_dimension_evidence: "kg unit group maps to canonical units of mass.",
    },
  ]);
  const resolutionDir = path.join(fixtureRoot, "run", "library-resolution");
  const report = runFoundry([
    "dataset-library-decisions-apply",
    "--library-index",
    outDir,
    "--decisions-dir",
    decisionsDir,
    "--out-dir",
    resolutionDir,
  ]);
  assert.equal(report.status, "completed_with_deferred_scopes");
  assert.equal(report.counts.ready_scopes, 1);
  assert.equal(report.counts.blocked_scopes, 1);
  assert.equal(report.counts.exchange_reference_rewrites, 1);

  const blocked = readJsonLines(path.join(resolutionDir, "blocked-scope-ledger.jsonl"));
  assert.equal(
    blocked.some((row) => row.reason === "elementary_flow_requires_existing_database_match"),
    true,
  );
  assert.equal(
    blocked.some((row) => row.reason === "canonical_flow_property_reference_unresolved"),
    true,
  );
  const blockedReport = readJson(path.join(resolutionDir, "blocked-scope-report.json"));
  assert.equal(
    report.files.blocked_scope_report,
    rel(path.join(resolutionDir, "blocked-scope-report.json")),
  );
  assert.equal(blockedReport.counts.blocked_scopes, 1);
  assert.equal(
    blockedReport.reason_summary.some(
      (row) =>
        row.reason === "elementary_flow_requires_existing_database_match" &&
        row.messages.some((message) => message.includes("reference-only")),
    ),
    true,
  );
  assert.equal(
    blockedReport.scope_summary[0].sample_blocking_dependencies.some(
      (dependency) => dependency.dataset_type === "flowproperty",
    ),
    true,
  );

  const rewritten = readJson(path.join(resolutionDir, "rewritten-processes", `${ids.p1}.json`));
  const rewrittenExchange = rewritten.processDataSet.exchanges.exchange[1];
  assert.equal(rewrittenExchange.exchangeDirection, "Input");
  assert.equal(rewrittenExchange.meanAmount, "2.5");
  assert.equal(
    rewrittenExchange.referenceToFlowDataSet["@refObjectId"],
    "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
  );
  const rewriteRows = readJsonLines(path.join(resolutionDir, "exchange-reference-rewrites.jsonl"));
  assert.equal(rewriteRows[0].preserved_exchange_fields, true);
});

test("library decisions apply blocks broad process section classifications", () => {
  const { outDir } = buildIndex();
  const decisionsDir = path.join(fixtureRoot, "run", "broad-process-classification-decisions");
  writeJsonLines(path.join(decisionsDir, "identity-decisions.jsonl"), [
    {
      decision: "reuse_existing_reference",
      source_dataset_id: ids.ef1,
      source_dataset_version: "00.00.001",
      canonical_flow_id: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
      canonical_flow_version: "03.00.003",
    },
  ]);
  writeJsonLines(path.join(decisionsDir, "classification-decisions.jsonl"), [
    {
      category_type: "process",
      dataset_id: ids.p1,
      dataset_version: "00.00.001",
      code: "D",
      classification_decision_level: "broad_section",
      confidence: "high",
    },
    {
      category_type: "process",
      dataset_id: ids.p2,
      dataset_version: "00.00.001",
      code: "3511",
      confidence: "high",
    },
    {
      category_type: "flow-product",
      dataset_id: ids.pf1,
      dataset_version: "00.00.001",
      code: "flow-product",
      confidence: "high",
    },
  ]);
  writeJsonLines(path.join(decisionsDir, "canonical-support-mappings.jsonl"), [
    {
      support_type: "flowproperty",
      source_support_id: ids.fp1,
      source_support_version: "00.00.001",
      canonical_support_id: "bbbbbbbb-bbbb-5bbb-8bbb-bbbbbbbbbbbb",
    },
    {
      support_type: "unitgroup",
      source_support_id: ids.ug1,
      source_support_version: "00.00.001",
      canonical_support_id: "cccccccc-cccc-5ccc-8ccc-cccccccccccc",
    },
  ]);

  const resolutionDir = path.join(fixtureRoot, "run", "broad-process-resolution");
  const report = runFoundry([
    "dataset-library-decisions-apply",
    "--library-index",
    outDir,
    "--decisions-dir",
    decisionsDir,
    "--out-dir",
    resolutionDir,
  ]);

  assert.equal(report.status, "completed_with_deferred_scopes");
  assert.equal(report.counts.ready_scopes, 0);
  const blocked = readJsonLines(path.join(resolutionDir, "blocked-scope-ledger.jsonl"));
  assert.equal(
    blocked.some((row) => row.reason === "process_classification_requires_leaf_authoring"),
    true,
  );
});

test("process scope runner plans only ready scopes and keeps blocked scopes out of the queue", () => {
  const { outDir, processBundlesDir } = buildIndex();
  const decisionsDir = path.join(fixtureRoot, "run", "runner-decisions");
  writeJsonLines(path.join(decisionsDir, "identity-decisions.jsonl"), [
    {
      decision: "reuse_existing_reference",
      source_dataset_id: ids.ef1,
      canonical_flow_id: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
      canonical_flow_version: "03.00.003",
    },
  ]);
  writeJsonLines(path.join(decisionsDir, "classification-decisions.jsonl"), [
    { category_type: "process", dataset_id: ids.p1, code: "process-ready" },
    { category_type: "process", dataset_id: ids.p2, code: "process-blocked" },
    { category_type: "flow-product", dataset_id: ids.pf1, code: "flow-product" },
  ]);
  writeJsonLines(path.join(decisionsDir, "canonical-support-mappings.jsonl"), [
    {
      support_type: "flowproperty",
      source_support_id: ids.fp1,
      canonical_support_id: "bbbbbbbb-bbbb-5bbb-8bbb-bbbbbbbbbbbb",
    },
    {
      support_type: "unitgroup",
      source_support_id: ids.ug1,
      canonical_support_id: "cccccccc-cccc-5ccc-8ccc-cccccccccccc",
    },
  ]);
  const resolutionDir = path.join(fixtureRoot, "run", "runner-resolution");
  const resolution = runFoundry([
    "dataset-library-decisions-apply",
    "--library-index",
    outDir,
    "--decisions-dir",
    decisionsDir,
    "--out-dir",
    resolutionDir,
  ]);
  const runDir = path.join(fixtureRoot, "run", "scope-run");
  const report = runFoundry([
    "dataset-process-scope-run",
    "--process-bundles-dir",
    processBundlesDir,
    "--library-resolution",
    path.join(repoRoot, resolution.files.library_resolution),
    "--scope-file",
    path.join(resolutionDir, "scope-checkpoints.jsonl"),
    "--parallel",
    "5",
    "--dry-run",
    "--out-dir",
    runDir,
  ]);
  assert.equal(report.status, "completed_with_deferred_scopes");
  assert.equal(report.parallel, 5);
  assert.equal(report.counts.ready_scopes_planned, 1);
  assert.equal(report.counts.blocked_scopes_deferred, 1);
  assert.equal(
    report.files.blocked_scope_report,
    rel(path.join(runDir, "blocked-scope-report.json")),
  );
  const blockedReport = readJson(path.join(runDir, "blocked-scope-report.json"));
  assert.equal(blockedReport.counts.blocked_scopes, 1);
  assert.equal(blockedReport.reason_summary[0].reason, "scope_not_ready");
  const checkpoints = readJsonLines(path.join(runDir, "scope-checkpoints.jsonl"));
  assert.deepEqual(checkpoints.map((row) => row.state).sort(), [
    "blocked_deferred",
    "dry_run_planned",
  ]);
});

test("process scope runner executes scope-provided handoff commands in commit mode", () => {
  const { processBundlesDir } = createLibraryFixture();
  const runRoot = path.join(fixtureRoot, "run", "scope-commit");
  const resolutionPath = path.join(runRoot, "library-resolution.json");
  const scopeFile = path.join(runRoot, "ready-scope-with-commands.jsonl");
  writeJson(resolutionPath, {
    schema_version: 1,
    status: "completed",
    ready_scope_ids: [ids.p1],
    files: {},
  });
  writeJsonLines(scopeFile, [
    {
      process_id: ids.p1,
      process_version: "00.00.001",
      state: "ready",
      commit_command: [process.execPath, "-e", "console.log('commit ok')"],
      verify_command: [process.execPath, "-e", "console.log('verify ok')"],
    },
  ]);
  const report = runFoundry([
    "dataset-process-scope-run",
    "--process-bundles-dir",
    processBundlesDir,
    "--library-resolution",
    resolutionPath,
    "--scope-file",
    scopeFile,
    "--commit",
    "--out-dir",
    runRoot,
  ]);
  assert.equal(report.status, "completed");
  assert.equal(report.counts.verified, 1);
  const checkpoints = readJsonLines(path.join(runRoot, "scope-checkpoints.jsonl"));
  assert.equal(checkpoints[0].state, "verified");
  assert.equal(checkpoints[0].command_stages.length, 2);
  assert.equal(
    fs.existsSync(path.join(repoRoot, checkpoints[0].command_stages[0].stdout_log)),
    true,
  );
});

test("identity preflight retry dry-run selects only failed rows and records published CLI command", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const requestDir = path.join(fixtureRoot, "identity-requests");
  const requestFile1 = path.join(requestDir, "flow-1.json");
  const requestFile2 = path.join(requestDir, "flow-2.json");
  writeJson(requestFile1, { target: { id: ids.ef1 } });
  writeJson(requestFile2, { target: { id: ids.ef2 } });
  const indexFile = path.join(requestDir, "identity-preflight-requests.jsonl");
  writeJsonLines(indexFile, [
    {
      dataset_type: "flow",
      dataset_id: ids.ef1,
      dataset_version: "00.00.001",
      request_file: rel(requestFile1),
      output_dir: rel(path.join(fixtureRoot, "identity-output", ids.ef1)),
    },
    {
      dataset_type: "flow",
      dataset_id: ids.ef2,
      dataset_version: "00.00.001",
      request_file: rel(requestFile2),
      output_dir: rel(path.join(fixtureRoot, "identity-output", ids.ef2)),
    },
  ]);
  const previousReport = path.join(fixtureRoot, "previous-report.json");
  writeJson(previousReport, {
    results: [
      {
        dataset_type: "flow",
        dataset_id: ids.ef1,
        dataset_version: "00.00.001",
        status: "completed",
      },
      {
        dataset_type: "flow",
        dataset_id: ids.ef2,
        dataset_version: "00.00.001",
        status: "failed",
        failure_code: "identity_preflight_timeout",
      },
    ],
  });
  const report = runFoundry([
    "dataset-identity-preflight-run",
    "--index",
    rel(indexFile),
    "--retry-failed",
    rel(previousReport),
    "--max-attempts",
    "3",
    "--dry-run",
    "--out-dir",
    rel(path.join(fixtureRoot, "identity-retry-run")),
  ]);
  assert.equal(report.status, "planned");
  assert.equal(report.counts.initially_selected_rows, 2);
  assert.equal(report.counts.retry_failed_input_rows, 1);
  assert.equal(report.counts.selected_rows, 1);
  assert.equal(report.results[0].dataset_id, ids.ef2);
  assert.match(
    report.results[0].command.replaceAll("\\", "/"),
    /node_modules\/@tiangong-lca\/cli\/bin\/tiangong-lca\.js/u,
  );
});

test("published CLI resolver binds the installed 0.1.1 package bin through Node", () => {
  const previous = process.env.TIANGONG_LCA_CLI_BIN;
  delete process.env.TIANGONG_LCA_CLI_BIN;
  try {
    const { resolveTiangongLcaCliCommand } = createFoundryRuntimeUtils({
      parseScalar: (value) => value,
      repoRoot,
    });
    const cli = resolveTiangongLcaCliCommand();
    const installed = resolveInstalledTiangongLcaCliPackage();
    assert.equal(cli.command, process.execPath);
    assert.deepEqual(cli.args, [installed.binPath]);
    assert.equal(cli.package, "@tiangong-lca/cli@0.1.1");
    assert.equal(cli.package_version, "0.1.1");
    assert.equal(cli.bin_path, installed.binPath);
    assert.match(
      cli.display.replaceAll("\\", "/"),
      /node_modules\/@tiangong-lca\/cli\/bin\/tiangong-lca\.js/u,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.TIANGONG_LCA_CLI_BIN;
    } else {
      process.env.TIANGONG_LCA_CLI_BIN = previous;
    }
  }
});

test("installed CLI schemas resolve independently of cwd and sibling worktrees", () => {
  const installed = resolveInstalledTiangongLcaCliPackage();
  const arbitraryWorktree = path.join(fixtureRoot, "arbitrary-worktree-without-siblings");
  fs.rmSync(arbitraryWorktree, { recursive: true, force: true });
  fs.mkdirSync(arbitraryWorktree, { recursive: true });

  assert.equal(firstTidasSchemaDir(arbitraryWorktree), installed.schemaDir);
  assert.equal(
    tidasSchemaPath(arbitraryWorktree, "tidas_locations_category.json"),
    path.join(installed.schemaDir, "tidas_locations_category.json"),
  );
  assert.equal(fs.existsSync(path.join(arbitraryWorktree, "..", "tiangong-lca-cli")), false);

  const version = spawnSync(process.execPath, [installed.binPath, "--version"], {
    cwd: arbitraryWorktree,
    encoding: "utf8",
  });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), "0.1.1");
});
