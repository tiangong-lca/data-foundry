import test from "node:test";
import { identityPreflightRunFixtureRoot } from "../fixtures/fixture-roots.mjs";
import {
  assert,
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  writeJson,
  writeJsonLines,
  writeText,
} from "../fixtures/foundry-core.mjs";
import { testAuthIdentityReceipt } from "../fixtures/identity-fixtures.mjs";

test("identity preflight batch runner records timed-out CLI rows without hanging", () => {
  fs.rmSync(identityPreflightRunFixtureRoot, { recursive: true, force: true });
  const flowId = "12345678-2222-4333-8444-555555555555";
  const requestFile = path.join(
    identityPreflightRunFixtureRoot,
    "requests",
    "flows",
    `${flowId}.json`,
  );
  const outputDir = path.join(
    identityPreflightRunFixtureRoot,
    "identity-preflight",
    "flows",
    flowId,
  );
  const reportFile = path.join(outputDir, "outputs", "identity-decision.json");
  const indexFile = path.join(
    identityPreflightRunFixtureRoot,
    "identity-preflight-requests",
    "identity-preflight-requests.jsonl",
  );
  const fakeCli = path.join(identityPreflightRunFixtureRoot, "bin", "fake-cli.js");
  const authReceiptFile = path.join(identityPreflightRunFixtureRoot, "auth-receipt.json");
  writeText(fakeCli, ["#!/usr/bin/env node", "setTimeout(() => {}, 10_000);", ""].join("\n"));
  fs.chmodSync(fakeCli, 0o755);
  writeJson(authReceiptFile, testAuthIdentityReceipt());
  writeJson(requestFile, {
    schema_version: 1,
    target: {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:UUID": flowId,
            "common:shortName": [{ "@xml:lang": "en", "#text": "Mercury" }],
          },
        },
      },
    },
    remote_candidate_search: {
      enabled: true,
      data_source: "tg",
      query: "flow name: Mercury",
    },
  });
  writeJsonLines(indexFile, [
    {
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: "00.00.001",
      request_file: rel(requestFile),
      output_dir: rel(outputDir),
      expected_report_file: rel(reportFile),
    },
  ]);

  try {
    const result = runFoundry(
      [
        "dataset-identity-preflight-run",
        "--index",
        rel(indexFile),
        "--out-dir",
        rel(path.join(identityPreflightRunFixtureRoot, "run")),
        "--timeout-ms",
        "20",
        "--auth-receipt",
        rel(authReceiptFile),
        "--expected-project-ref",
        "qgzvkongdjqiiamzbbts",
        "--expected-user-id",
        "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
      ],
      {
        env: {
          TIANGONG_LCA_CLI_BIN: fakeCli,
        },
        timeout: 5_000,
      },
    );
    assert.equal(result.code, 1);
    assert.equal(result.json.status, "failed");
    assert.equal(result.json.runtime_options.timeout_ms, 20);
    assert.ok(result.json.runtime_options.spawn_timeout_ms >= 270);
    assert.equal(result.json.counts.failed, 1);
    assert.equal(result.json.results[0].failure_code, "identity_preflight_timeout");
    assert.equal(result.json.results[0].status, "failed");
    assert.equal(result.json.results[0].report_status, null);
    assert.equal(result.json.results[0].decision, null);
    assert.ok(fs.existsSync(path.join(repoRoot, result.json.results[0].stdout_log)));
    assert.ok(fs.existsSync(path.join(repoRoot, result.json.results[0].stderr_log)));
  } finally {
    fs.rmSync(identityPreflightRunFixtureRoot, { recursive: true, force: true });
  }
});

test("identity preflight index merge preserves dependency rows while refreshing current scope", () => {
  const root = path.join(repoRoot, "tmp", "identity-preflight-index-merge-test");
  fs.rmSync(root, { recursive: true, force: true });
  const baseIndex = path.join(root, "base", "identity-preflight-requests.jsonl");
  const updateIndex = path.join(root, "fresh", "identity-preflight-requests.jsonl");
  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000501";
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000502";
  writeJsonLines(baseIndex, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      target_sha256: "old-process-sha",
      request_file: "base/process.json",
      report_file: "base/process-report.json",
    },
    {
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: "00.00.001",
      target_sha256: "dependency-flow-sha",
      request_file: "base/flow.json",
      report_file: "base/flow-report.json",
    },
  ]);
  writeJsonLines(updateIndex, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      target_sha256: "fresh-process-sha",
      request_file: "fresh/process.json",
      report_file: "fresh/process-report.json",
    },
  ]);

  try {
    const merge = runFoundry([
      "dataset-identity-preflight-index-merge",
      "--base-index",
      rel(baseIndex),
      "--update-index",
      rel(updateIndex),
      "--out-dir",
      rel(path.join(root, "merged")),
    ]);
    assert.equal(merge.code, 0, JSON.stringify(merge.json, null, 2));
    assert.equal(merge.json.status, "ready");
    assert.equal(merge.json.counts.base_rows, 2);
    assert.equal(merge.json.counts.update_rows, 1);
    assert.equal(merge.json.counts.replaced_rows, 1);
    assert.equal(merge.json.counts.added_rows, 0);
    assert.equal(merge.json.counts.output_rows, 2);

    const mergedRows = readJsonLines(path.join(repoRoot, merge.json.files.merged_index));
    assert.equal(mergedRows.length, 2);
    const processRow = mergedRows.find((row) => row.dataset_type === "process");
    const flowRow = mergedRows.find((row) => row.dataset_type === "flow");
    assert.equal(processRow.target_sha256, "fresh-process-sha");
    assert.equal(processRow.request_file, "fresh/process.json");
    assert.equal(processRow.merge_source, "update");
    assert.equal(flowRow.target_sha256, "dependency-flow-sha");
    assert.equal(flowRow.request_file, "base/flow.json");
    assert.equal(flowRow.merge_source, "base");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("identity preflight request refresh inherits source trace context from source index", () => {
  const root = path.join(repoRoot, "tmp", "identity-preflight-source-index-test");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000601";
  const processRow = {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Fixture process from patched row",
            },
          },
        },
        quantitativeReference: {
          functionalUnitOrOther: {
            "@xml:lang": "en",
            "#text": "1 fixture product",
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
  const sourcePayload = JSON.parse(JSON.stringify(processRow));
  sourcePayload.processDataSet.processInformation.dataSetInformation["common:other"] = {
    "tidasimport:sourceTrace": {
      payload: {
        sourceClassification: {
          category: "source energy supply",
          subCategory: "source natural gas transport",
        },
        attributes: [
          { name: "localName", value: "Quellprozess lokaler Name" },
          { name: "location", value: "CH" },
          { name: "text", value: "Source technology route from package" },
          {
            name: "includedProcesses",
            value: "Source system boundary from package",
          },
        ],
      },
    },
  };

  const rowsFile = path.join(root, "rows", "processes.patched.jsonl");
  const sourceFile = path.join(root, "source", "process.original.json");
  const sourceIndex = path.join(root, "base", "identity-preflight-requests.jsonl");
  writeJsonLines(rowsFile, [processRow]);
  writeJson(sourceFile, sourcePayload);
  writeJsonLines(sourceIndex, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      source_file: rel(sourceFile),
      request_file: "base/process.json",
    },
  ]);

  try {
    const build = runFoundry([
      "dataset-identity-preflight-requests-build",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--source-index",
      rel(sourceIndex),
      "--out-dir",
      rel(path.join(root, "refresh")),
    ]);
    assert.equal(build.code, 0, JSON.stringify(build.json, null, 2));
    assert.equal(build.json.status, "ready");
    assert.equal(build.json.counts.source_index_files, 1);
    assert.equal(build.json.counts.source_context_matches, 1);
    assert.equal(build.json.counts.source_context_missing_matches, 0);

    const indexRows = readJsonLines(
      path.join(repoRoot, build.json.files.identity_preflight_requests),
    );
    assert.equal(indexRows.length, 1);
    assert.equal(indexRows[0].source_file, rel(sourceFile));
    const request = readJson(path.join(repoRoot, indexRows[0].request_file));
    const query = request.remote_candidate_search.query;
    assert.match(query, /Quellprozess lokaler Name/u);
    assert.match(query, /source energy supply/u);
    assert.match(query, /source natural gas transport/u);
    assert.match(query, /Source technology route from package/u);
    assert.match(query, /Source system boundary from package/u);
    assert.match(query, /geography: CH/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
