import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { CLI_RUNTIME_EXPECTATION_SCHEMA, describeCliRuntime } from "@tiangong-lca/cli/runtime";
import { createFoundryFacade, runFoundryPublicCommand } from "../../scripts/public-api.ts";
import { FOUNDRY_TIDAS_EXPECTATION_SCHEMA } from "../../scripts/lib/foundry-runtime-qualification.ts";
import { flowRow, sourceRow } from "../fixtures/row-builders.ts";
import { datasetIdentity } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import { bundleRowTypes, type BundleRowType } from "../../scripts/lib/bundle-row-types.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";
import { canonicalPayloadSha256 } from "../../scripts/lib/post-write-root-proof.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { readRows } from "../../scripts/lib/import-curation/internal/runtime-io.ts";
import { unwrapDatasetPayload } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import {
  supportUnitGroupRow,
  supportFlowPropertyRow,
  supportFixtureReferences,
} from "../fixtures/support-row-builders.ts";

export const digestFile = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function workflowFixture(
  t: TestContext,
  importFails = false,
  validationFails: boolean | "missing-name" | "decisions" = false,
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-public-workflow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "项目 workspace");
  const binary = path.join(root, "native owner fixture.ts");
  fs.copyFileSync(path.resolve(import.meta.dirname, "../fixtures/fake-tidas.ts"), binary);
  if (!importFails) {
    const before = fs.readFileSync(binary, "utf8");
    const marker = 'fs.writeFileSync(path.join(output, "issues.jsonl"), "");';
    assert.ok(before.includes(marker));
    fs.writeFileSync(
      binary,
      before
        .replace(
          marker,
          `${marker}
    const primary = path.join(output, "tidas", "processes", "sample.json");
    fs.writeFileSync(primary, JSON.stringify({ processDataSet: { processInformation: { dataSetInformation: { "common:UUID": "33333333-3333-4333-8333-333333333333" } } } }));
    const bundled = path.join(output, "process-bundles", "sample", "tidas", "processes");
    fs.mkdirSync(bundled, { recursive: true });
    fs.copyFileSync(primary, path.join(bundled, "sample.json"));
    `,
        )
        .replace("object_counts: { processes: 0 }", "object_counts: { processes: 1 }"),
    );
  }
  if (importFails) {
    const before = fs.readFileSync(binary, "utf8");
    const declaration =
      "const requestedExit = process.env.FAKE_TIDAS_EXIT_CLASS as ExitClass | undefined;";
    assert.ok(before.includes(declaration));
    fs.writeFileSync(
      binary,
      before.replace(
        declaration,
        'const requestedExit: ExitClass = command === "import" ? "data-issues" : "success";',
      ),
    );
  }
  fs.chmodSync(binary, 0o755);
  if (validationFails) {
    const before = fs.readFileSync(binary, "utf8");
    assert.ok(before.includes('process.env.FAKE_TIDAS_INVALID === "1"'));
    fs.writeFileSync(
      binary,
      before
        .replace(
          'process.env.FAKE_TIDAS_INVALID === "1"',
          validationFails === "missing-name"
            ? '!JSON.parse(fs.readFileSync(path.join(args[1], manifest[0].relative_path), "utf8")).flowDataSet?.flowInformation?.dataSetInformation?.name'
            : validationFails === "decisions"
              ? "false"
              : "true",
        )
        .replace('process.env.FAKE_TIDAS_BATCH_DATA_ISSUES === "1"', "true"),
    );
  }
  if (validationFails === "decisions") {
    const before = fs.readFileSync(binary, "utf8");
    const marker = "    const final = {";
    assert.ok(before.includes(marker));
    fs.writeFileSync(
      binary,
      before.replace(
        marker,
        `
    const payload = JSON.parse(fs.readFileSync(path.join(args[1], manifest[0].relative_path), "utf8"));
    const info = payload.processDataSet.processInformation;
    const failures = [
      [info.dataSetInformation.classificationInformation["common:classification"]["common:class"][0]["@classId"] === "INVALID",
        "/processDataSet/processInformation/dataSetInformation/classificationInformation"],
      [info.geography.locationOfOperationSupplyOrProduction["@location"] === "Invalid region",
        "/processDataSet/processInformation/geography/locationOfOperationSupplyOrProduction/@location"],
    ];
    for (const [invalid, location] of failures) {
      if (!invalid) continue;
      events.push({ type: "issue", schema_version: "tidas.validation-issue-event.v1",
        protocol: "document-validation-batch.v1", profile: "tidas-document-conformance.v1",
        document_key: manifest[0].document_key, document_ordinal: 0, issue_ordinal: events.length,
        identity: manifest[0].identity, issue: { issue_code: "fixture_invalid", severity: "error",
          category: manifest[0].category, file_path: manifest[0].relative_path, location,
          message: "Controlled invalid code", context: {} },
      });
    }
${marker}`,
      ),
    );
  }
  const cli = describeCliRuntime();
  const facadeOptions = {
    workspace,
    cacheBase: path.join(root, "cache"),
    runtimeSelection: {
      cliExpectation: {
        schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
        package_version: cli.package.version,
        platform: cli.platform,
        content_sha256: cli.content_sha256,
        node_version: cli.node.version,
        node_sha256: cli.node.sha256,
      },
      tidasExecutable: binary,
      tidasExpectation: {
        schema: FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
        platform: cli.platform,
        binary_version: "0.2.7",
        executable: {
          bytes: fs.statSync(binary).size,
          sha256: createHash("sha256").update(fs.readFileSync(binary)).digest("hex"),
        },
        validation: {
          schema_version: "tidas.validation-describe.v1",
          asset_fingerprint: "1".repeat(64),
          protocols: ["document-validation-batch.v1"],
          event_schema_versions: [
            "tidas.validation-final-event.v1",
            "tidas.validation-issue-event.v1",
          ],
        },
      },
    },
  };
  const facade = createFoundryFacade(facadeOptions);
  assert.equal(facade.initialize().status, "ready");
  assert.equal(facade.doctor().status, "ready");
  return { root, workspace, facade, runtimeSelection: facadeOptions.runtimeSelection };
}

export const publicIdentityCases = [
  ["create_new", "final_rows", false, false],
  ["reuse_existing_reference", "final_rows", false, false],
  ["create_new", "current_rows", false, false],
  ["create_new", "current_rows", true, false],
  ["create_new", "final_rows", false, true],
  ["create_new", "final_rows", true, false, "ordinary", "trace_hash"],
  ["create_new", "final_rows", true, false, "production-test", "trace_hash"],
  ["create_new", "final_rows", true, false, "ordinary", "other_field"],
] as const;

export type PublicIdentityCase = (typeof publicIdentityCases)[number];

export function publicIdentityTitle(scenario: PublicIdentityCase): string {
  const [identityDecision, approvalKind, trace, mixed, explicitMode, remoteDifference] = scenario;
  return `public identity preflight and ${identityDecision} ${approvalKind}${trace ? " with_trace" : ""}${mixed ? " mixed_reuse" : ""}${remoteDifference ? ` ${explicitMode} ${remoteDifference}` : ""} submission preserve current scope and evidence`;
}

export async function verifyPublicIdentityWorkflow(
  t: TestContext,
  scenario: PublicIdentityCase,
  nativeInsert = false,
  nativeResponse: "normal" | "lost" | "missing" | "unknown" = "normal",
  referenceInput = false,
) {
  const [identityDecision, approvalKind, trace, mixed, explicitMode, remoteDifference] = scenario;
  const accountMode = explicitMode ?? "ordinary";
  const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
  const id = "77777777-7777-4777-8777-777777777777";
  const basic = flowRow(id);
  const payload = {
    flowDataSet: {
      ...basic.flowDataSet,
      flowInformation: {
        dataSetInformation: {
          ...basic.flowDataSet.flowInformation.dataSetInformation,
          name: {
            ...basic.flowDataSet.flowInformation.dataSetInformation.name,
            mixAndLocationTypes: { "@xml:lang": "en", "#text": "Swiss market" },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "06", "#text": "Crude petroleum and natural gas" },
              ],
            },
          },
        },
      },
      modellingAndValidation: { LCIMethod: { typeOfDataSet: "Product flow" } },
      flowProperties: {
        flowProperty: [
          {
            "@dataSetInternalID": "0",
            referenceToFlowPropertyDataSet: {
              "@refObjectId": "93a60a56-a3c8-11da-a746-0800200b9a66",
              "@version": "03.00.003",
              "common:shortDescription": { "@xml:lang": "en", "#text": "Mass" },
            },
            meanValue: "1",
          },
        ],
      },
    },
  };
  if (trace)
    Object.assign(payload.flowDataSet.flowInformation.dataSetInformation, {
      "common:other": {
        "@xmlns:tidasimport": "https://example.invalid/tidas-import",
        "tidasimport:sourceTrace": {
          payload: {
            attributes: [
              { name: "name", value: "Natural gas" },
              { name: "location", value: "CH" },
            ],
          },
        },
      },
    });
  const seed = path.join(root, "identity-seed.json"),
    specFile = path.join(root, "identity-request.json");
  const account = {
    project_ref: "qgzvkongdjqiiamzbbts",
    user_id: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    session_reference: null,
    ...(explicitMode ? { account_mode: explicitMode } : {}),
  };
  const reusedId = "88888888-8888-4888-8888-888888888888";
  const reusedPayload = structuredClone(payload);
  reusedPayload.flowDataSet.flowInformation.dataSetInformation["common:UUID"] = reusedId;
  const seedRows = [
    { id, version: "00.00.001", json: payload },
    ...(mixed ? [{ id: reusedId, version: "00.00.001", json: reusedPayload }] : []),
  ];
  fs.writeFileSync(seed, JSON.stringify({ rows: seedRows }));
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "identity-cycle",
      actor_id: "identity-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: account,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId: "identity-actor" };
  for (let step = 0; step < 3; step++) await facade.resume(invocation);
  const previous = await facade.status(invocation);
  assert.equal(previous.status, "ready", JSON.stringify(previous));
  const assessment = previous.artifacts.findLast((item) => item.role === "foundry-assessment.json");
  assert.ok(assessment?.kind === "file");
  const ambient = {
    TIANGONG_LCA_CLI_BIN: "/must-not-run",
    TIANGONG_LCA_ACCESS_TOKEN: "ambient-test-secret",
    BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE: path.join(root, "ambient-cache"),
    NODE_OPTIONS: "--invalid-test-option",
  };
  const saved = Object.fromEntries(Object.keys(ambient).map((key) => [key, process.env[key]]));
  Object.assign(process.env, ambient);
  const restoreEnvironment = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const originalSpawn = childProcess.spawnSync;
  let authCalls = 0,
    preflightCalls = 0,
    failRead = true;
  let finalizing = false;
  let referenceQueries = 0;
  let referenceResponse: "missing" | "duplicate" | "outdated" | "wrong_target" | "passed" =
    "missing";
  let writes = 0,
    exactReadback = approvalKind !== "current_rows";
  let childFailure: unknown;
  let getCalls = 0,
    restoreExactPayload = false;
  const remotePayloads = new Map<string, typeof payload>();
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    try {
      const argv = args[1],
        options = args[2];
      if (Array.isArray(argv) && argv[1] === "flow" && argv[2] === "get") {
        getCalls++;
        assert.equal(args[0], process.execPath);
        assert.equal(argv[0], resolveInstalledTiangongLcaCliPackage().binPath);
        assert.equal(options?.shell, false);
        assert.equal(options?.env?.FOUNDRY_ACCOUNT_MODE, "ordinary");
        assert.equal(options?.env?.TIANGONG_LCA_ACCESS_TOKEN, undefined);
        const selected = remotePayloads.get(argv[argv.indexOf("--id") + 1]);
        assert.ok(selected, "normalization requires a fresh read of the observed root");
        return {
          status: 0,
          signal: null,
          stdout: JSON.stringify({ flow: selected }),
          stderr: "",
          pid: 1,
          output: [],
        };
      }
      if (
        Array.isArray(argv) &&
        ["publish-version", "save-draft", "verify-remote"].some((name) => argv.includes(name))
      ) {
        const committing = argv.includes("--commit");
        if (!argv.includes("verify-remote") && !committing) assert.ok(argv.includes("--dry-run"));
        const outDir = argv[argv.indexOf("--out-dir") + 1];
        fs.mkdirSync(outDir, { recursive: true });
        const file = path.join(outDir, "controlled-read-report.json");
        const input =
          argv[argv.indexOf(argv.includes("--input-file") ? "--input-file" : "--input") + 1];
        let report: Record<string, unknown>;
        if (argv.includes("verify-remote")) {
          if (path.basename(input) === "canonical-references.jsonl") {
            referenceQueries++;
            assert.equal(argv[argv.indexOf("--root-policy") + 1], "existing");
            assert.ok(!argv.includes("--commit") && !argv.includes("--compare-root-payload"));
            const references = readRows(input) as Array<Record<string, string>>;
            assert.equal(references.length, 1);
            assert.equal(
              references[0]["@refObjectId"],
              "99999999-9999-4999-8999-999999999999",
              "verify the selected canonical target, not the original input identity",
            );
            const checks = references.map((ref, row_index) => ({
              role: "reference",
              row_index,
              path: "",
              table: "flows",
              id: ref["@refObjectId"],
              version: ref["@version"],
              exact_version: ref["@version"],
              latest_version: referenceResponse === "outdated" ? "00.00.002" : ref["@version"],
              status: referenceResponse === "missing" ? "missing_dataset" : "ok",
            }));
            if (referenceResponse === "duplicate") checks.push({ ...checks[0] });
            if (referenceResponse === "wrong_target") checks[0].id = id;
            const checksFile = path.join(outDir, "checks.jsonl");
            fs.writeFileSync(
              checksFile,
              checks.map((check) => JSON.stringify(check)).join("\n") + "\n",
            );
            const blockers = referenceResponse === "missing" ? [{ code: "missing_dataset" }] : [];
            const report = {
              status: blockers.length
                ? "blocked_remote_verification"
                : "passed_remote_verification",
              root_policy: "existing",
              input_path: input,
              counts: {
                rows: references.length,
                references: checks.length,
                checked: checks.length,
                blockers: blockers.length,
              },
              blockers,
              files: { report: file, checks: checksFile },
            };
            fs.writeFileSync(file, JSON.stringify(report));
            return {
              status: blockers.length ? 1 : 0,
              signal: null,
              stdout: JSON.stringify(report),
              stderr: "",
              pid: 1,
              output: [],
            };
          }
          report = {
            status: "passed_remote_verification",
            input_path: input,
            blockers: [],
            counts: { blockers: 0 },
            checks: [
              {
                role: "reference",
                table: "flowproperties",
                id: "93a60a56-a3c8-11da-a746-0800200b9a66",
                version: "03.00.003",
                status: "ok",
              },
            ],
            files: { report: file },
          };
          if (argv.includes("--compare-root-payload")) {
            const rows = readRows(input);
            const checks = [
              ...(report.checks as Array<Record<string, unknown>>),
              ...rows.map((row, row_index) => {
                const local = unwrapDatasetPayload(row, "flow"),
                  remote = structuredClone(local) as typeof payload;
                if (remoteDifference && !restoreExactPayload) {
                  let changed = 0;
                  const changeTrace = (value: unknown, inSummary = false) => {
                    if (!value || typeof value !== "object") return;
                    for (const [key, child] of Object.entries(value)) {
                      if (inSummary && key === "traceHash") {
                        (value as Record<string, unknown>)[key] = "controlled-remote-hash";
                        changed++;
                      } else
                        changeTrace(
                          child,
                          inSummary || key === "tiangongfoundry:importTraceSummary",
                        );
                    }
                  };
                  changeTrace(remote);
                  assert.ok(changed > 0, "real finalize must produce a trace summary");
                  if (remoteDifference === "other_field")
                    remote.flowDataSet.flowInformation.dataSetInformation.name.baseName["#text"] =
                      "Different fixture content";
                }
                remotePayloads.set(id, remote);
                return {
                  role: "root",
                  path: `${input}#readback`,
                  table: "flows",
                  id,
                  version: "00.00.001",
                  row_index,
                  status: remoteDifference && !restoreExactPayload ? "payload_mismatch" : "ok",
                  local_payload_sha256: canonicalPayloadSha256(local),
                  remote_payload_sha256: canonicalPayloadSha256(remote),
                  remote_user_id: exactReadback || trace ? account.user_id : "another-owner",
                  remote_state_code: !exactReadback && trace ? 20 : 0,
                };
              }),
            ];
            const checksFile = path.join(outDir, "checks.jsonl");
            fs.writeFileSync(
              checksFile,
              checks.map((check) => JSON.stringify(check)).join("\n") + "\n",
            );
            const payloadBlockers = checks
              .filter((check) => check.status === "payload_mismatch")
              .map((check) => ({ ...check, code: "payload_mismatch" }));
            Object.assign(report, {
              status: payloadBlockers.length
                ? "blocked_remote_verification"
                : "passed_remote_verification",
              blockers: payloadBlockers,
              checks,
              counts: {
                blockers: payloadBlockers.length,
                root_readback_checks: rows.length,
                root_payload_mismatches: payloadBlockers.length,
              },
              files: { report: file, checks: checksFile },
            });
          }
        } else {
          if (committing) {
            const taskRoot = path.join(workspace, ".foundry", "workspaces", invocation.taskId);
            const markers = fs.readdirSync(path.join(taskRoot, "attempts", "owner-v1"));
            assert.equal(markers.length, 1);
            assert.ok(
              fs.existsSync(
                path.join(taskRoot, "attempts", "owner-v1", markers[0], "consumed.json"),
              ),
              "attempt is durable before dispatch",
            );
            writes++;
            if (approvalKind === "current_rows")
              return {
                status: null,
                signal: "SIGTERM",
                stdout: "",
                stderr: "response lost after write",
                pid: 1,
                output: [],
              };
          }
          const success = path.join(outDir, "success.json"),
            failed = path.join(outDir, "failed.jsonl");
          fs.writeFileSync(
            success,
            JSON.stringify([{ id, version: "00.00.001", operation: "would_insert" }]),
          );
          fs.writeFileSync(failed, "");
          report = {
            status: "completed_flow_publish_version",
            mode: committing ? "commit" : "dry_run",
            dry_run: !committing,
            commit: committing,
            counts: { selected: 1, success_count: committing ? 1 : 0, failed: 0 },
            input_path: input,
            target_user_id_override: account.user_id,
            files: { report: file, success_list: success, remote_failed: failed },
          };
          if (committing && nativeInsert) {
            assert.deepEqual(argv.slice(1, 5), ["dataset", "save-draft", "--type", "flow"]);
            const contractFile = argv[argv.indexOf("--execution-contract") + 1];
            const contract = JSON.parse(fs.readFileSync(contractFile, "utf8")) as {
              execution_id: string;
              actions: Array<{
                action_id: string;
                desired_sha256: string;
                id: string;
                version: string;
                table: string;
              }>;
            };
            report = {
              schema_version: 2,
              status: "completed",
              mode: "commit",
              commit: true,
              requested_type: "flow",
              input_path: input,
              counts: {
                selected: 1,
                executed: 1,
                attempts_consumed: 1,
                failed: 0,
                unknown: 0,
                blocked: 0,
              },
              files: { summary_json: file },
              execution_contract: {
                path: contractFile,
                sha256: sha256Json(contract),
                execution_id: contract.execution_id,
                target_mode: "owner_draft",
              },
              rows: contract.actions.map((action, index) => ({
                ...action,
                index,
                type: "flow",
                status: "executed",
                operation: "insert",
                attempt_consumed: true,
                replayed: false,
                readback: "desired_exact",
              })),
            };
          }
        }
        if (committing && nativeInsert && nativeResponse !== "normal") {
          if (nativeResponse !== "missing") {
            const summary = path.join(outDir, "outputs", "dataset-save-draft", "summary.json");
            fs.mkdirSync(path.dirname(summary), { recursive: true });
            report.files = { summary_json: summary };
            if (nativeResponse === "unknown") report.status = "completed_with_unknowns";
            fs.writeFileSync(summary, JSON.stringify(report));
          }
          return {
            status: null,
            signal: "SIGTERM",
            stdout: "",
            stderr: "response lost",
            pid: 1,
            output: [],
          };
        }
        if (argv.includes("--reference-intent-file")) {
          const intentFile = argv[argv.indexOf("--reference-intent-file") + 1];
          const intent = JSON.parse(fs.readFileSync(intentFile, "utf8")) as {
            project_ref: string;
            actor_user_id: string;
            consumers: Array<{ payload_sha256: string }>;
            references: Array<{ review: { file: string; sha256: string } }>;
          };
          const rows = readRows(input).map((row) => unwrapDatasetPayload(row, "flow"));
          assert.deepEqual(
            intent.consumers.map((item) => item.payload_sha256),
            rows.map(sha256Json),
            "CLI receives the reviewed final consumer payload",
          );
          const fact = (file: string) => ({
            path: file,
            bytes: fs.statSync(file).size,
            sha256: digestFile(file),
          });
          const reviews = [...new Set(intent.references.map((item) => item.review.file))].map(fact);
          report.reference_intent = {
            file: fact(intentFile),
            actor_user_id: intent.actor_user_id,
            project_ref: intent.project_ref,
            consumers: intent.consumers,
            references: intent.references.map((item) => ({
              ...item,
              review: {
                file: fact(item.review.file),
                latest: JSON.parse(fs.readFileSync(item.review.file, "utf8")).latest,
              },
            })),
            review_files: reviews,
          };
          report.counts = { ...(report.counts as Record<string, unknown>), rows: rows.length };
        }
        fs.writeFileSync(file, JSON.stringify(report));
        return {
          status: report.status === "blocked_remote_verification" ? 1 : 0,
          signal: null,
          stdout: JSON.stringify(report),
          stderr: "",
          pid: 1,
          output: [],
        };
      }
      if (
        !Array.isArray(argv) ||
        (!argv.includes("identity-receipt") && !argv.includes("identity-preflight"))
      )
        return Reflect.apply(originalSpawn, childProcess, args);
      const environment = options?.env ?? {};
      for (const key of Object.keys(ambient)) assert.equal(environment[key], undefined, key);
      assert.equal(args[0], process.execPath);
      assert.equal(argv[0], resolveInstalledTiangongLcaCliPackage().binPath);
      let report: unknown;
      if (argv.includes("identity-receipt")) {
        authCalls++;
        report = testAuthIdentityReceipt({
          projectRef: account.project_ref,
          userId: account.user_id,
          capturedAtUtc: new Date(Date.now()).toISOString(),
        });
      } else {
        preflightCalls++;
        const requestFile = argv[argv.indexOf("--input") + 1],
          outDir = argv[argv.indexOf("--out-dir") + 1];
        const request = JSON.parse(fs.readFileSync(requestFile, "utf8")) as { target: unknown };
        if (!finalizing)
          assert.deepEqual(
            request.target,
            mixed && JSON.stringify(request.target).includes(reusedId) ? reusedPayload : payload,
            "the canonical envelope is removed without changing the target payload",
          );
        else
          assert.ok(
            request.target && typeof request.target === "object" && "flowDataSet" in request.target,
          );
        assert.equal(environment.FOUNDRY_VERIFIED_USER_ID, account.user_id);
        report = {
          schema_version: 1,
          status: "needs_review",
          decision: "manual_review",
          candidates: [],
          ok: true,
        };
        fs.mkdirSync(path.join(outDir, "outputs"), { recursive: true });
        fs.writeFileSync(
          path.join(outDir, "outputs", "identity-decision.json"),
          JSON.stringify(report) + "\n",
        );
        // This synchronous transport fixture has no real process/network delay.
        // Give its new report an explicit fresh tick despite filesystem rounding.
        const reportTime = new Date(Date.now() + 1);
        fs.utimesSync(
          path.join(outDir, "outputs", "identity-decision.json"),
          reportTime,
          reportTime,
        );
        if (failRead)
          return {
            status: 1,
            signal: null,
            stdout: JSON.stringify(report),
            stderr: "",
            pid: 1,
            output: [],
          };
      }
      return {
        status: 0,
        signal: null,
        stdout: JSON.stringify(report),
        stderr: "",
        pid: 1,
        output: [],
      };
    } catch (error) {
      childFailure = error;
      throw error;
    }
  });
  syncBuiltinESMExports();
  t.after(() => {
    restoreEnvironment();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const failed = await facade.resume(invocation);
  if (childFailure) throw childFailure;
  assert.equal(failed.status, "needs_input", JSON.stringify(failed));
  assert.equal(failed.blockers[0]?.code, "identity_preflight_requires_input");
  assert.equal((await facade.status(invocation)).status, "needs_input");
  failRead = false;
  const read = await facade.resume(invocation);
  const evidence = read.artifacts.findLast((item) => item.role === "foundry-identity.json");
  assert.equal(
    read.status,
    "ready",
    evidence?.kind === "file"
      ? fs.readFileSync(evidence.path, "utf8")
      : JSON.stringify(read.blockers),
  );
  assert.ok(evidence?.kind === "file");
  const report = JSON.parse(fs.readFileSync(evidence.path, "utf8")) as {
    status: string;
    index: string;
  };
  assert.equal(report.status, "completed");
  for (const artifact of read.artifacts.filter(
    (item) => item.kind === "file" && item.path.includes("/outputs/identity/"),
  )) {
    assert.ok(artifact.kind === "file");
    assert.ok(!fs.readFileSync(artifact.path, "utf8").includes(ambient.TIANGONG_LCA_ACCESS_TOKEN));
  }
  const index = readRows(report.index) as Array<{
    target_sha256: string;
  }>;
  assert.deepEqual(
    index.map((item) => item.target_sha256).sort(),
    seedRows
      .map((row) => createHash("sha256").update(JSON.stringify(row.json)).digest("hex"))
      .sort(),
  );
  restoreEnvironment();
  const reviewed = await facade.resume(invocation);
  assert.equal(reviewed.status, "needs_input", JSON.stringify(reviewed));
  const latest = reviewed.artifacts.findLast((item) => item.role === "foundry-assessment.json");
  assert.ok(latest?.kind === "file");
  assert.notEqual(latest.sha256, assessment.sha256);
  const current = JSON.parse(fs.readFileSync(latest.path, "utf8")) as {
    identity_report: string;
    owner_base: string;
    sets: Array<{
      rows: string;
      decisions: Array<{ kind: string; task: string; status: string }>;
    }>;
  };
  assert.equal(current.identity_report, evidence.path);
  assert.ok(current.sets[0].decisions.some((item) => item.kind === "identity"));
  if (!mixed) assert.equal(preflightCalls, 2);
  const initialPreflightCalls = preflightCalls;
  assert.equal(authCalls, 2);
  await facade.status(invocation);
  assert.equal(preflightCalls, initialPreflightCalls, "status cannot repeat a remote search");
  const work = current.sets[0].decisions.find((item) => item.kind === "identity");
  assert.ok(work);
  assert.equal(work.status, "ready_for_ai_identity_decisions");
  const task = JSON.parse(fs.readFileSync(work.task, "utf8")) as { files: { template: string } };
  const template = fs
    .readFileSync(path.resolve(current.owner_base, task.files.template), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  for (const decision of template) {
    decision.identity_decision =
      mixed && decision.dataset_id === reusedId ? "reuse_existing_reference" : identityDecision;
    decision.canonical =
      decision.identity_decision === "create_new"
        ? null
        : {
            table: "flows",
            ref_object_id: "99999999-9999-4999-8999-999999999999",
            version: "00.00.001",
            short_description: [{ "@xml:lang": "en", "#text": "Verified fixture natural gas" }],
          };
    decision.basis = "Controlled identity choice from the current task.";
    decision.used_context_kinds = [
      "schema",
      "methodology_yaml",
      "ruleset",
      "classification_schema",
      "location_schema",
    ];
    decision.evidence = {
      ...(decision.evidence as Record<string, unknown>),
      quote_or_trace: "Controlled identity fixture with retained preflight context.",
    };
  }
  const file = path.join(root, "identity-decisions.jsonl"),
    descriptor = path.join(root, "identity-submission.json");
  const write = (decisions = template) => {
    fs.writeFileSync(file, decisions.map((value) => JSON.stringify(value)).join("\n") + "\n");
    fs.writeFileSync(
      descriptor,
      JSON.stringify({
        schema: "tiangong-foundry.semantic-input.v1",
        task_id: invocation.taskId,
        actor_id: invocation.actorId,
        assessment_sha256: latest.sha256,
        submissions: [
          {
            kind: "identity",
            authoring_task_sha256: digestFile(work.task),
            file,
            sha256: digestFile(file),
          },
        ],
      }),
    );
  };
  const oldRows = fs.readFileSync(current.sets[0].rows);
  const wrong = structuredClone(template);
  wrong[0].authoring_package = path.join(root, "unselected-snapshot.json");
  fs.writeFileSync(
    String(wrong[0].authoring_package),
    "This file must never be read by the owner.",
  );
  write(wrong);
  const invalid = await facade.resume({ ...invocation, semanticInputFile: descriptor });
  assert.equal(invalid.blockers[0]?.code, "task_semantic_identity_invalid");
  const badContext = structuredClone(template);
  (badContext[0].authoring_context as Record<string, unknown>).context_bundle_sha256 = "0".repeat(
    64,
  );
  write(badContext);
  assert.equal(
    (await facade.resume({ ...invocation, semanticInputFile: descriptor })).blockers[0]?.code,
    "task_semantic_identity_invalid",
  );
  const unresolved = structuredClone(template);
  unresolved[0].identity_decision = "block_unresolved";
  unresolved[0].canonical = null;
  write(unresolved);
  const refused = await facade.resume({ ...invocation, semanticInputFile: descriptor });
  assert.equal(refused.status, "needs_input");
  assert.equal(refused.blockers[0]?.code, "semantic_input_rejected");
  assert.deepEqual(fs.readFileSync(current.sets[0].rows), oldRows);
  write();
  const applied = await facade.resume({ ...invocation, semanticInputFile: descriptor });
  const semanticReport = applied.artifacts.findLast((item) => item.role === "semantic-result.json");
  assert.equal(
    applied.status,
    "ready",
    semanticReport?.kind === "file"
      ? fs.readFileSync(semanticReport.path, "utf8")
      : JSON.stringify(applied.blockers),
  );
  assert.deepEqual(
    (await facade.resume({ ...invocation, semanticInputFile: descriptor })).artifacts,
    applied.artifacts,
  );
  assert.deepEqual(fs.readFileSync(current.sets[0].rows), oldRows);
  const manifest = applied.artifacts.findLast((item) => item.role === "foundry-rows.json");
  assert.ok(manifest?.kind === "file");
  const resolved = JSON.parse(fs.readFileSync(manifest.path, "utf8")) as {
    sets: Array<{ file: string; count: number }>;
    identity_reports: string[];
  };
  assert.equal(resolved.identity_reports.length, 1);
  const ownerReport = JSON.parse(fs.readFileSync(resolved.identity_reports[0], "utf8")) as {
    counts: { input_rows: number; output_rows: number; reference_rows: number };
    files: { reference_rows: string };
  };
  assert.equal(ownerReport.counts.input_rows, mixed ? 2 : 1);
  assert.equal(
    ownerReport.counts.reference_rows,
    identityDecision === "create_new" && !mixed ? 0 : 1,
  );
  assert.equal(resolved.sets.length, identityDecision === "create_new" ? 1 : 0);
  let finished = await facade.resume(invocation);
  if (identityDecision === "create_new") {
    await facade.resume(invocation);
    finished = await facade.resume(invocation);
    assert.equal(
      preflightCalls,
      initialPreflightCalls + 1,
      "new row lineage needs current preflight before write planning",
    );
  }
  assert.equal(finished.status, "ready", JSON.stringify(finished.blockers));
  assert.notEqual(finished.status, "completed", "local identity resolution is not final delivery");
  finalizing = true;
  let finalized = await facade.resume(invocation);
  if (childFailure) throw childFailure;
  assert.equal(finalized.status, "needs_input", JSON.stringify(finalized.blockers));
  let finalizeArtifact = finalized.artifacts.findLast(
    (item) => item.role === "foundry-finalize.json",
  );
  assert.ok(finalizeArtifact?.kind === "file");
  if (referenceInput) {
    const initial = JSON.parse(fs.readFileSync(finalizeArtifact.path, "utf8")) as {
      sets: Array<{ final_rows: string }>;
    };
    const finalPayloads = readRows(initial.sets[0].final_rows).map((row) =>
      unwrapDatasetPayload(row, "flow"),
    );
    const reviewFile = path.join(root, "selected-reference-review.json"),
      intentFile = path.join(root, "selected-reference-intent.json"),
      referenceDescriptor = path.join(root, "reference-input.json");
    const selected = {
      table: "flowproperties",
      id: "93a60a56-a3c8-11da-a746-0800200b9a66",
      version: "03.00.003",
      payload_sha256: "a".repeat(64),
      user_id: account.user_id,
      state_code: 100,
    };
    fs.writeFileSync(
      reviewFile,
      JSON.stringify({
        schema_version: "dataset-exact-reference-review.v1",
        decision: "use_selected_exact",
        reason: "Explicit synthetic reviewed definition",
        selected,
        latest: selected,
      }),
    );
    fs.writeFileSync(
      intentFile,
      JSON.stringify({
        schema_version: "dataset-exact-reference-intent.v1",
        project_ref: account.project_ref,
        actor_user_id: account.user_id,
        consumers: finalPayloads.map((payload, row_index) => ({
          row_index,
          table: "flows",
          id,
          version: "00.00.001",
          payload_sha256: sha256Json(payload),
        })),
        references: [
          {
            row_index: 0,
            path: "/flowDataSet/flowProperties/flowProperty/0/referenceToFlowPropertyDataSet",
            selected,
            review: { file: reviewFile, sha256: digestFile(reviewFile) },
          },
        ],
      }),
    );
    fs.writeFileSync(
      referenceDescriptor,
      JSON.stringify({
        schema: "tiangong-foundry.reference-input.v1",
        task_id: invocation.taskId,
        actor_id: invocation.actorId,
        rows_manifest_sha256: manifest.sha256,
        dataset_type: "flow",
        qa_reference_rows: [],
        intent: { file: intentFile, sha256: digestFile(intentFile) },
        review_files: [{ file: reviewFile, sha256: digestFile(reviewFile) }],
      }),
    );
    let selectedOutput = "";
    await runFoundryPublicCommand(
      [
        process.execPath,
        "tiangong-foundry",
        "task",
        "resume",
        "--workspace",
        workspace,
        "--task",
        invocation.taskId,
        "--actor",
        invocation.actorId,
        "--reference-input",
        referenceDescriptor,
        "--json",
      ],
      {
        runtimeSelection,
        cacheBase: path.join(root, "cache"),
        writeStdout: (value) => {
          selectedOutput += value;
        },
        setExitCode: () => {},
      },
    );
    const selectedResult = JSON.parse(selectedOutput) as {
      status: string;
      blockers: unknown[];
      artifacts: unknown[];
    };
    assert.equal(selectedResult.status, "ready", JSON.stringify(selectedResult.blockers));
    const repeated = await facade.resume({
      ...invocation,
      referenceInputFile: referenceDescriptor,
    });
    assert.deepEqual(
      repeated.artifacts,
      selectedResult.artifacts,
      "identical reference selection is read-only reuse",
    );
    fs.unlinkSync(intentFile);
    fs.unlinkSync(reviewFile);
    finalized = await facade.resume(invocation);
    finalizeArtifact = finalized.artifacts.findLast(
      (item) => item.role === "foundry-finalize.json",
    );
    assert.ok(finalizeArtifact?.kind === "file", JSON.stringify(finalized.blockers));
  }
  const finalReport = JSON.parse(fs.readFileSync(finalizeArtifact.path, "utf8")) as {
    sets: Array<{
      report: string;
      authorization_inputs: Array<{
        input_kind: string;
        file: string;
        sha256: string;
        binding: Record<string, string>;
      }>;
    }>;
    blockers: unknown[];
  };
  assert.equal(finalReport.sets.length, identityDecision === "create_new" ? 1 : 0);
  assert.equal(
    finalized.blockers[0]?.code,
    identityDecision === "create_new" && !mixed
      ? "task_authorization_required"
      : "reference_verification_required",
    JSON.stringify(finalReport),
  );
  assert.equal(
    finalized.permissions.state,
    identityDecision === "create_new" && !mixed ? "required" : "not_required",
  );
  let readyFinalization = finalized;
  if (mixed) {
    referenceResponse = "passed";
    readyFinalization = await facade.resume(invocation);
    assert.equal(
      readyFinalization.status,
      "needs_input",
      "reference success cannot complete an unwritten scope",
    );
    assert.equal(readyFinalization.blockers[0]?.code, "task_authorization_required");
    assert.equal(readyFinalization.permissions.state, "required");
    assert.equal(referenceQueries, 1);
    assert.equal(writes, 0);
  }
  const reads = [authCalls, preflightCalls];
  if (identityDecision === "create_new")
    assert.deepEqual((await facade.resume(invocation)).artifacts, readyFinalization.artifacts);
  assert.deepEqual(
    [authCalls, preflightCalls],
    reads,
    "pending finalization cannot repeat remote reads",
  );
  if (identityDecision === "reuse_existing_reference") {
    const missing = await facade.resume(invocation);
    assert.equal(missing.status, "needs_input", JSON.stringify(missing.blockers));
    assert.equal(referenceQueries, 1);
    await facade.status(invocation);
    assert.equal(referenceQueries, 1, "status is read-only local projection");
    for (const response of ["duplicate", "outdated", "wrong_target"] as const) {
      referenceResponse = response;
      assert.equal(
        (await facade.resume(invocation)).status,
        "needs_input",
        `${response} checks cannot prove the reference scope`,
      );
    }
    referenceResponse = "passed";
    const complete = await facade.resume(invocation);
    assert.equal(complete.status, "completed", JSON.stringify(complete.blockers));
    assert.equal(referenceQueries, 5);
    assert.equal(writes, 0, "reference reuse never mutates or asks for write approval");
    assert.equal(complete.permissions.state, "not_required");
    assert.equal((await facade.resume(invocation)).status, "completed");
    assert.equal(referenceQueries, 5, "verified scope is reused without more network reads");
    const result = complete.artifacts.findLast(
      (item) => item.role === "foundry-reference-verification.json",
    );
    assert.ok(result?.kind === "file");
    const proof = JSON.parse(fs.readFileSync(result.path, "utf8")) as {
      checks: { path: string };
    };
    fs.appendFileSync(proof.checks.path, "{}\n");
    assert.equal((await facade.resume(invocation)).status, "blocked");
    assert.equal(writes, 0);
    if (childFailure) throw childFailure;
  }
  if (identityDecision === "create_new") {
    const input = finalReport.sets[0].authorization_inputs.find(
      (item) => item.input_kind === approvalKind,
    );
    assert.ok(input);
    const evidenceFile = path.join(root, "approval-evidence.txt"),
      grantFile = path.join(root, "grant.json"),
      approvalFile = path.join(root, "authorization-input.json");
    fs.writeFileSync(
      evidenceFile,
      "Controlled test approval of the exact final-row scope. No real remote writes.",
    );
    const grant = {
      schema: "tiangong-foundry.task-authorization.v1",
      binding: input.binding,
      issued_at_utc: new Date(Date.now() - 1000).toISOString(),
      expires_at_utc: new Date(Date.now() + 3600000).toISOString(),
      remote_state_code: 0,
      allowed_actions: [],
      qa_waivers: [],
      evidence: [
        {
          id: "approval",
          kind: "user-decision",
          reference: fs.realpathSync(evidenceFile),
          sha256: digestFile(evidenceFile),
        },
      ],
    };
    const writeApproval = (value = grant, finalizationSha = finalizeArtifact.sha256) => {
      fs.writeFileSync(grantFile, JSON.stringify(value));
      const nativeFile = path.join(root, "selected-native-insert.json");
      if (nativeInsert) {
        const rows = readRows(input.file);
        fs.writeFileSync(
          nativeFile,
          JSON.stringify({
            schema_version: "dataset-save-draft-execution-contract.v1",
            execution_id: "native-public-case",
            project_ref: account.project_ref,
            target_mode: "owner_draft",
            owner: { user_id: account.user_id, email: "fixture@example.invalid", state_code: 0 },
            actions: rows.map((row, index) => {
              const identity = datasetIdentity(row, index, "flow");
              return {
                action_id: `insert-${index}`,
                expected_operation: "insert",
                table: "flows",
                id: identity.id,
                version: identity.version,
                desired_sha256: sha256Json(identity.payload),
                before_sha256: null,
                dependency_action_ids: [],
              };
            }),
          }),
        );
      }
      fs.writeFileSync(
        approvalFile,
        JSON.stringify({
          schema: "tiangong-foundry.authorization-input.v1",
          task_id: invocation.taskId,
          actor_id: invocation.actorId,
          finalization_sha256: finalizationSha,
          dataset_type: "flow",
          input_kind: approvalKind,
          input_sha256: input.sha256,
          expected_previous_sha256: null,
          ...(nativeInsert
            ? { execution_contract: { file: nativeFile, sha256: digestFile(nativeFile) } }
            : {}),
          grant: { file: grantFile, sha256: digestFile(grantFile) },
          evidence: [
            {
              id: "approval",
              kind: "user-decision",
              file: evidenceFile,
              sha256: digestFile(evidenceFile),
            },
          ],
        }),
      );
    };
    writeApproval(grant, "0".repeat(64));
    assert.equal(
      (await facade.resume({ ...invocation, authorizationInputFile: approvalFile })).blockers[0]
        ?.code,
      "authorization_finalization_mismatch",
    );
    const wrong = structuredClone(grant);
    wrong.binding.actor_id = "wrong-actor";
    writeApproval(wrong);
    const refused = await facade.resume({ ...invocation, authorizationInputFile: approvalFile });
    assert.notEqual(refused.permissions.state, "granted");
    writeApproval();
    const alternateGrant = structuredClone(grant);
    alternateGrant.issued_at_utc = new Date(Date.now() - 2000).toISOString();
    const otherGrantFile = path.join(root, "alternate-grant.json"),
      otherApproval = path.join(root, "alternate-approval.json");
    fs.writeFileSync(otherGrantFile, JSON.stringify(alternateGrant));
    const alternate = JSON.parse(fs.readFileSync(approvalFile, "utf8")) as {
      grant: { file: string; sha256: string };
    };
    alternate.grant = { file: otherGrantFile, sha256: digestFile(otherGrantFile) };
    fs.writeFileSync(otherApproval, JSON.stringify(alternate));
    const raced = await Promise.all(
      [approvalFile, otherApproval].map((authorizationInputFile) =>
        facade.resume({ ...invocation, authorizationInputFile }),
      ),
    );
    assert.equal(
      raced.filter((value) => value.permissions.state === "granted").length,
      1,
      JSON.stringify(raced.map((value) => value.blockers)),
    );
    const winner = raced.findIndex((value) => value.permissions.state === "granted");
    let approved = raced[winner];
    const acceptedApproval = [approvalFile, otherApproval][winner];
    if (approvalKind === "current_rows") {
      assert.equal(approved.blockers[0]?.code, "authorized_refinalization_pending");
      assert.deepEqual(
        (await facade.resume({ ...invocation, authorizationInputFile: acceptedApproval }))
          .artifacts,
        approved.artifacts,
      );
      await facade.resume(invocation);
      if (trace) {
        const pointerFile = path.join(
          workspace,
          ".foundry",
          "workspaces",
          invocation.taskId,
          "authorization.json",
        );
        const beforePointer = digestFile(pointerFile);
        const originalLink = fs.linkSync;
        let interruptCapture = true;
        t.mock.method(fs, "linkSync", (...args: Parameters<typeof fs.linkSync>) => {
          if (interruptCapture && String(args[1]).endsWith("foundry-authorization.json")) {
            interruptCapture = false;
            throw new Error("Controlled interruption after derived activation, before capture.");
          }
          return Reflect.apply(originalLink, fs, args);
        });
        const interrupted = await facade.resume(invocation);
        assert.equal(interrupted.status, "failed");
        assert.notEqual(
          digestFile(pointerFile),
          beforePointer,
          "the exact derived grant activated before interrupted capture",
        );
      }
      approved = await facade.resume(invocation);
    }
    assert.equal(approved.permissions.state, "granted", JSON.stringify(approved.blockers));
    assert.equal(
      approved.blockers[0]?.code,
      "authorized_execution_pending",
      JSON.stringify(approved.blockers),
    );
    const recorded = approved.artifacts.findLast(
      (item) => item.role === "foundry-authorization.json",
    );
    assert.ok(recorded?.kind === "file");
    const authorization = JSON.parse(fs.readFileSync(recorded.path, "utf8")) as {
      status: string;
      expires_at_utc: string;
      capsule: {
        capsule_file: string;
        capsule: { approved_input: { sha256: string }; final_rows: { sha256: string } };
      };
      handoff: { account_mode: string; commands: { commit: { argv: string[] } } };
    };
    assert.equal(authorization.status, "sealed");
    assert.equal(authorization.handoff.account_mode, accountMode);
    assert.equal(
      authorization.expires_at_utc,
      grant.expires_at_utc,
      "continuation does not extend the approved lifetime",
    );
    assert.equal(authorization.capsule.capsule.approved_input.sha256, input.sha256);
    if (trace && approvalKind === "current_rows")
      assert.notEqual(
        authorization.capsule.capsule.final_rows.sha256,
        input.sha256,
        "real cleanup changes the prepared input digest",
      );
    assert.ok(fs.existsSync(authorization.capsule.capsule_file));
    assert.ok(
      authorization.handoff.commands.commit.argv.includes("--commit"),
      "sealed intent is retained without dispatch",
    );
    const authCount = authCalls;
    const reusedApproval = await facade.resume({
      ...invocation,
      authorizationInputFile: acceptedApproval,
    });
    assert.ok(reusedApproval.artifacts.length > 0, JSON.stringify(reusedApproval.blockers));
    assert.deepEqual(reusedApproval.artifacts, approved.artifacts);
    assert.equal(authCalls, authCount, "identical approval is a read-only reuse");
    let stdout = "",
      exitCode = -1;
    await runFoundryPublicCommand(
      [
        process.execPath,
        "tiangong-foundry",
        "task",
        "resume",
        "--workspace",
        workspace,
        "--task",
        invocation.taskId,
        "--actor",
        invocation.actorId,
        "--authorization-input",
        acceptedApproval,
        "--json",
      ],
      {
        runtimeSelection,
        cacheBase: path.join(root, "cache"),
        writeStdout: (text) => {
          stdout += text;
        },
        setExitCode: (code) => {
          exitCode = code;
        },
      },
    );
    assert.equal(stdout.trim().split("\n").length, 1);
    assert.equal(
      (JSON.parse(stdout) as { permissions: { state: string } }).permissions.state,
      "granted",
    );
    assert.equal(exitCode, 2, "sealed execution still requires the subsequent execution stage");
    if (nativeInsert) fs.unlinkSync(path.join(root, "selected-native-insert.json"));
    const preparedExecution = await facade.resume(invocation);
    assert.ok(
      preparedExecution.artifacts.some((item) => item.role === "owner-execution-request.json"),
      JSON.stringify(preparedExecution.blockers),
    );
    assert.equal(writes, 0, "request preparation is local");
    if (referenceInput) {
      for (const empty of ["", "   "]) {
        const rejected = await facade.resume({ ...invocation, referenceInputFile: empty });
        assert.equal(
          writes,
          0,
          "an empty explicit reference selector cannot dispatch a prepared write",
        );
        assert.equal(rejected.blockers[0]?.code, "reference_input_invalid");
      }
    }
    if (approvalKind === "final_rows") {
      const expiredClock = t.mock.method(
        Date,
        "now",
        () => Date.parse(grant.expires_at_utc) + 1000,
      );
      const expired = await facade.resume(invocation);
      expiredClock.mock.restore();
      assert.equal(expired.status, "needs_input", JSON.stringify(expired.blockers));
      assert.equal(expired.blockers[0]?.code, "task_authorization_required");
      assert.notEqual(
        expired.permissions.state,
        "granted",
        "an unattempted expired grant cannot permit dispatch",
      );
      assert.equal(writes, 0);
      assert.ok(!expired.artifacts.some((item) => item.role === "consumed.json"));
    }
    let executed = await facade.resume(invocation);
    assert.equal(writes, 1, JSON.stringify(executed.blockers));
    if (nativeResponse === "missing" || nativeResponse === "unknown") {
      for (let retry = 0; retry < 2; retry++) {
        assert.equal(executed.status, "needs_input", JSON.stringify(executed.blockers));
        executed = await facade.resume(invocation);
        assert.equal(writes, 1, "missing native receipt must never replay mutation");
      }
      assert.equal(executed.status, "needs_input", JSON.stringify(executed.blockers));
      if (childFailure) throw childFailure;
      return;
    }
    if (
      remoteDifference &&
      (accountMode === "production-test" || remoteDifference === "other_field")
    ) {
      assert.equal(executed.status, "needs_input", JSON.stringify(executed.blockers));
      assert.equal(executed.blockers[0]?.code, "mutation_readback_required");
      assert.equal(getCalls, accountMode === "production-test" ? 0 : 1);
      restoreExactPayload = true;
      executed = await facade.resume(invocation);
      assert.equal(writes, 1, "strict mismatch recovery cannot replay mutation");
    } else if (remoteDifference === "trace_hash") assert.equal(getCalls, 1);
    if (approvalKind === "current_rows") {
      if (referenceInput) {
        const denied = await facade.resume({
          ...invocation,
          referenceInputFile: path.join(root, "must-not-read-new-reference.json"),
        });
        assert.equal(denied.blockers[0]?.code, "execution_recovery_required");
        assert.equal(writes, 1, "new reference selection cannot reopen a consumed mutation");
      }
      assert.equal(executed.status, "needs_input", JSON.stringify(executed));
      assert.equal(executed.blockers[0]?.code, "mutation_readback_required");
      const attemptsRoot = path.join(
        workspace,
        ".foundry",
        "workspaces",
        invocation.taskId,
        "attempts",
        "owner-v1",
      );
      for (const scope of fs.readdirSync(attemptsRoot)) {
        for (const name of fs.readdirSync(path.join(attemptsRoot, scope))) {
          if (name.endsWith(".jsonl")) fs.unlinkSync(path.join(attemptsRoot, scope, name));
        }
      }
      exactReadback = true;
      t.mock.method(Date, "now", () => Date.parse(grant.expires_at_utc) + 1000);
      assert.ok(Date.now() > Date.parse(authorization.expires_at_utc));
      executed = await facade.resume(invocation);
    }
    const executionReport = executed.artifacts.findLast(
      (item) => item.role === "owner-execution-result.json",
    );
    if (childFailure) throw childFailure;
    assert.equal(
      executed.status,
      "completed",
      executionReport?.kind === "file"
        ? fs.readFileSync(executionReport.path, "utf8")
        : JSON.stringify(executed.blockers),
    );
    assert.equal(writes, 1, "lost write response recovery never dispatches another write");
    if (mixed)
      assert.equal(referenceQueries, 1, "write completion reuses the verified canonical scope");
    assert.equal((await facade.resume(invocation)).status, "completed");
    assert.equal(writes, 1);
    assert.ok(executionReport?.kind === "file");
    if (remoteDifference === "trace_hash" && accountMode === "ordinary") {
      const result = JSON.parse(fs.readFileSync(executionReport.path, "utf8")) as {
        readback: {
          acceptance: { path: string };
          original_verification: { report: { path: string } };
        };
      };
      assert.ok(fs.existsSync(result.readback.acceptance.path));
      assert.equal(
        JSON.parse(fs.readFileSync(result.readback.original_verification.report.path, "utf8"))
          .status,
        "blocked_remote_verification",
        "original failure evidence is retained beside the accepted proof",
      );
    }
    const proof = JSON.parse(fs.readFileSync(executionReport.path, "utf8")) as {
      readback: {
        checks: { path: string };
        commit_report?: { path: string };
        reference_evidence?: Array<{ path: string }>;
      };
    };
    const evidencePath = referenceInput
      ? proof.readback.reference_evidence?.[0]?.path
      : nativeInsert
        ? proof.readback.commit_report?.path
        : proof.readback.checks.path;
    assert.ok(evidencePath, "native completion retains its execution report fact");
    fs.appendFileSync(evidencePath, "{}\n");
    assert.equal(
      (await facade.resume(invocation)).status,
      "blocked",
      "changed readback evidence cannot retain completion",
    );
    assert.equal(writes, 1, "damaged evidence cannot reset mutation attempts");
    if (childFailure) throw childFailure;
  }
}

export async function verifyDependentScopes(t: TestContext, support: boolean) {
  // This scenario checks authorization lineage, not elapsed wall-clock time.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const firstType = support ? "unitgroup" : "contact",
    secondType = support ? "flowproperty" : "source";
  const { root, workspace, facade } = workflowFixture(t);
  const contactId = "66666666-6666-4666-8666-666666666666",
    sourceId = "55555555-5555-4555-8555-555555555555";
  const account = {
    project_ref: "qgzvkongdjqiiamzbbts",
    user_id: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    session_reference: null,
  };
  const contact = {
    contactDataSet: {
      contactInformation: {
        dataSetInformation: {
          "common:UUID": contactId,
          "common:shortName": { "@xml:lang": "en", "#text": "Fixture institute" },
          name: { "@xml:lang": "en", "#text": "Fixture institute" },
          email: "contact@example.invalid",
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
  const source = sourceRow(sourceId);
  Object.assign(source.sourceDataSet.administrativeInformation.publicationAndOwnership, {
    "common:referenceToOwnershipOfDataSet": {
      "@type": "contact data set",
      "@refObjectId": contactId,
      "@version": "00.00.001",
      "common:shortDescription": { "@xml:lang": "en", "#text": "Fixture institute" },
    },
  });
  const input = path.join(root, "dependent-seed.json"),
    specFile = path.join(root, "dependent-request.json");
  fs.writeFileSync(
    input,
    JSON.stringify({
      rows: support
        ? [supportUnitGroupRow(contactId), supportFlowPropertyRow(sourceId, contactId)]
        : [contact, source],
    }),
  );
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "dependent-owner-scopes",
      actor_id: "scope-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: [firstType, secondType],
      sources: [{ path: input }],
      seed: { path: input },
      account_intent: { ...account, ...(support ? { account_mode: "production-test" } : {}) },
      preparation: null,
    }),
  );
  const writes: string[] = [],
    readbacks: string[] = [],
    remote = new Set<string>(support ? supportFixtureReferences.map((item) => item.id) : []);
  const originalSpawn = childProcess.spawnSync;
  let childFailure: unknown;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    try {
      const argv = args[1];
      if (!Array.isArray(argv)) return Reflect.apply(originalSpawn, childProcess, args);
      if (argv.includes("identity-receipt"))
        return {
          status: 0,
          signal: null,
          stdout: JSON.stringify(
            testAuthIdentityReceipt({
              projectRef: account.project_ref,
              userId: account.user_id,
            }),
          ),
          stderr: "",
          pid: 1,
          output: [],
        };
      if (!argv.includes("save-draft") && !argv.includes("verify-remote"))
        return Reflect.apply(originalSpawn, childProcess, args);
      assert.equal(args[0], process.execPath);
      assert.equal(argv[0], resolveInstalledTiangongLcaCliPackage().binPath);
      const file =
        argv[argv.indexOf(argv.includes("--input-file") ? "--input-file" : "--input") + 1];
      const out = argv[argv.indexOf("--out-dir") + 1];
      fs.mkdirSync(out, { recursive: true });
      const rows = readRows(file).map((row) => {
        const payload = unwrapDatasetPayload(row, "");
        assert.ok(payload && typeof payload === "object");
        return payload;
      });
      const type = Object.keys(bundleRowTypes).find(
        (key) => bundleRowTypes[key as BundleRowType].rootKey in rows[0],
      ) as BundleRowType;
      const table = bundleRowTypes[type].plural,
        reportFile = argv.includes("save-draft")
          ? path.join(out, "outputs", "dataset-save-draft", "summary.json")
          : path.join(out, "outputs", "remote-verification-report.json");
      fs.mkdirSync(path.dirname(reportFile), { recursive: true });
      const identities = rows.map((row, index) => datasetIdentity(row, index, type));
      let report: Record<string, unknown>;
      if (argv.includes("save-draft")) {
        const commit = argv.includes("--commit");
        assert.ok(commit || argv.includes("--dry-run"));
        if (commit) {
          if (support)
            assert.ok(
              argv.includes("--allow-account-local-support"),
              "support dispatch retains its explicit owner flag",
            );
          if (type === secondType)
            assert.ok(
              remote.has(contactId) && readbacks.includes(firstType),
              "contact must be independently read back before dependent source dispatch",
            );
          writes.push(type);
          identities.forEach((item) => remote.add(item.id));
        }
        const progress = path.join(out, "progress.jsonl"),
          failures = path.join(out, "failures.jsonl");
        fs.writeFileSync(
          progress,
          identities
            .map((item) =>
              JSON.stringify({
                id: item.id,
                version: item.version,
                status: "prepared",
                operation: "would_insert",
              }),
            )
            .join("\n") + "\n",
        );
        fs.writeFileSync(failures, "");
        report = {
          status: "completed_dataset_save_draft",
          mode: commit ? "commit" : "dry_run",
          dry_run: !commit,
          commit,
          input_path: file,
          counts: { selected: rows.length, executed: commit ? rows.length : 0, failed: 0 },
          files: {
            summary_json: reportFile,
            progress_jsonl: progress,
            failures_jsonl: failures,
          },
        };
      } else {
        const compare = argv.includes("--compare-root-payload");
        if (compare) readbacks.push(type);
        const checks: Array<Record<string, unknown>> = [];
        if (support)
          checks.push(
            ...supportFixtureReferences.map((ref) => ({
              ...ref,
              role: "reference",
              status: "ok",
              remote_state_code: 100,
            })),
          );
        if (type === secondType)
          checks.push({
            role: "reference",
            table: bundleRowTypes[firstType].plural,
            id: contactId,
            version: "00.00.001",
            status: remote.has(contactId) ? "ok" : "missing_dataset",
            remote_user_id: account.user_id,
            remote_state_code: 0,
          });
        if (compare)
          for (const [index, item] of identities.entries())
            checks.push({
              role: "root",
              row_index: index,
              path: `${file}#readback`,
              table,
              id: item.id,
              version: item.version,
              status: remote.has(item.id) ? "ok" : "missing_dataset",
              local_payload_sha256: canonicalPayloadSha256(rows[index]),
              remote_payload_sha256: canonicalPayloadSha256(rows[index]),
              remote_user_id: account.user_id,
              remote_state_code: 0,
            });
        const blockers = checks
          .filter((check) => check.status !== "ok")
          .map((check) => ({ ...check, code: check.status }));
        const checksFile = path.join(out, "checks.jsonl");
        fs.writeFileSync(
          checksFile,
          checks.map((check) => JSON.stringify(check)).join("\n") + (checks.length ? "\n" : ""),
        );
        report = {
          status: blockers.length ? "blocked_remote_verification" : "passed_remote_verification",
          input_path: file,
          blockers,
          counts: {
            blockers: blockers.length,
            root_readback_checks: compare ? rows.length : 0,
            root_payload_mismatches: 0,
          },
          checks,
          files: { report: reportFile, checks: checksFile },
        };
      }
      fs.writeFileSync(reportFile, JSON.stringify(report));
      return {
        status: report.status === "blocked_remote_verification" ? 1 : 0,
        signal: null,
        stdout: JSON.stringify(report),
        stderr: "",
        pid: 1,
        output: [],
      };
    } catch (error) {
      childFailure = error;
      throw error;
    }
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const started = await facade.start({ specFile });
  assert.ok(started.task_id, JSON.stringify(started));
  const invocation = { taskId: started.task_id, actorId: "scope-actor" };
  let current = started;
  for (let step = 0; step < 4; step++) current = await facade.resume(invocation);
  const loadFinalize = (result: typeof current) => {
    const artifact = result.artifacts.findLast((item) => item.role === "foundry-finalize.json");
    assert.ok(artifact?.kind === "file", JSON.stringify(result));
    const report = JSON.parse(fs.readFileSync(artifact.path, "utf8")) as {
      sets: Array<{
        type: string;
        status: string;
        final_rows: string;
        authorization_inputs: Array<{
          input_kind: string;
          sha256: string;
          binding: Record<string, string>;
        }>;
      }>;
    };
    return { artifact, report };
  };
  let finalized = loadFinalize(current);
  if (!support)
    assert.equal(
      finalized.report.sets.find((item) => item.type === firstType)?.status,
      "ready_for_remote_write",
      JSON.stringify(finalized.report),
    );
  else {
    assert.notEqual(
      finalized.report.sets.find((item) => item.type === firstType)?.status,
      "ready_for_remote_write",
    );
    assert.deepEqual(writes, []);
  }
  assert.notEqual(
    finalized.report.sets.find((item) => item.type === secondType)?.status,
    "ready_for_remote_write",
  );
  let contactRows = finalized.report.sets.find((item) => item.type === firstType)!.final_rows;
  const approve = async (type: typeof firstType | typeof secondType) => {
    const scope = finalized.report.sets.find((item) => item.type === type)!;
    const inputKind = support ? "current_rows" : "final_rows";
    const selected = scope.authorization_inputs.find((item) => item.input_kind === inputKind)!;
    const evidenceFile = path.join(root, `${type}-evidence.txt`),
      grantFile = path.join(root, `${type}-grant.json`),
      descriptor = path.join(root, `${type}-approval.json`);
    fs.writeFileSync(
      evidenceFile,
      "Controlled approval for the exact fixture scope; no live write.",
    );
    fs.writeFileSync(
      grantFile,
      JSON.stringify({
        schema: "tiangong-foundry.task-authorization.v1",
        binding: selected.binding,
        issued_at_utc: new Date(Date.now() - 1000).toISOString(),
        expires_at_utc: new Date(Date.now() + 3600000).toISOString(),
        remote_state_code: 0,
        allowed_actions: support ? ["canonical_support_local_mint", `${type}_write`].sort() : [],
        qa_waivers: [],
        evidence: [
          {
            id: "approval",
            kind: "user-decision",
            reference: fs.realpathSync(evidenceFile),
            sha256: digestFile(evidenceFile),
          },
        ],
      }),
    );
    const pointer = path.join(
      workspace,
      ".foundry",
      "workspaces",
      invocation.taskId,
      "authorization.json",
    );
    fs.writeFileSync(
      descriptor,
      JSON.stringify({
        schema: "tiangong-foundry.authorization-input.v1",
        task_id: invocation.taskId,
        actor_id: invocation.actorId,
        finalization_sha256: finalized.artifact.sha256,
        dataset_type: type,
        input_kind: inputKind,
        input_sha256: selected.sha256,
        expected_previous_sha256: fs.existsSync(pointer) ? digestFile(pointer) : null,
        grant: { file: grantFile, sha256: digestFile(grantFile) },
        evidence: [
          {
            id: "approval",
            kind: "user-decision",
            file: evidenceFile,
            sha256: digestFile(evidenceFile),
          },
        ],
      }),
    );
    if (support && type === firstType) {
      const originalGrant = JSON.parse(fs.readFileSync(grantFile, "utf8")) as Record<
        string,
        unknown
      >;
      const originalDescriptor = JSON.parse(fs.readFileSync(descriptor, "utf8")) as Record<
        string,
        unknown
      >;
      const missingGrant = path.join(root, "missing-mint-grant.json"),
        missingDescriptor = path.join(root, "missing-mint-approval.json");
      fs.writeFileSync(
        missingGrant,
        JSON.stringify({ ...originalGrant, allowed_actions: [`${type}_write`] }),
      );
      fs.writeFileSync(
        missingDescriptor,
        JSON.stringify({
          ...originalDescriptor,
          grant: { file: missingGrant, sha256: digestFile(missingGrant) },
        }),
      );
      await facade.resume({ ...invocation, authorizationInputFile: missingDescriptor });
      const blocked = await facade.resume(invocation);
      const repeated = await facade.resume(invocation);
      assert.deepEqual(
        repeated.artifacts,
        blocked.artifacts,
        "incomplete support permission cannot trigger derived approval or repeated reads",
      );
      assert.deepEqual(writes, []);
      assert.ok(!repeated.artifacts.some((item) => item.role === "owner-execution-request.json"));
      finalized = loadFinalize(blocked);
      fs.writeFileSync(
        descriptor,
        JSON.stringify({
          ...originalDescriptor,
          finalization_sha256: finalized.artifact.sha256,
          expected_previous_sha256: digestFile(pointer),
        }),
      );
    }
    const result = await facade.resume({ ...invocation, authorizationInputFile: descriptor });
    assert.equal(result.permissions.state, "granted", JSON.stringify(result));
    if (support) {
      await facade.resume(invocation);
      const rebound = await facade.resume(invocation);
      assert.equal(
        loadFinalize(rebound).report.sets.find((item) => item.type === type)?.status,
        "ready_for_remote_write",
        JSON.stringify(loadFinalize(rebound).report),
      );
      assert.equal(
        rebound.next_actions[0]?.kind,
        "command",
        "the retained derived approval needs continuation, not another user approval",
      );
      const sealed = await facade.resume(invocation);
      assert.equal(
        sealed.blockers[0]?.code,
        "authorized_execution_pending",
        JSON.stringify(loadFinalize(sealed).report),
      );
      const scopeRows = loadFinalize(sealed).report.sets.find(
        (item) => item.type === firstType,
      )!.final_rows;
      if (type === firstType) contactRows = scopeRows;
      else
        assert.equal(
          scopeRows,
          contactRows,
          "new scope approval preserves an already completed scope generation",
        );
    }
    await facade.resume(invocation);
    return facade.resume(invocation);
  };
  current = await approve(firstType);
  assert.deepEqual(writes, [firstType], JSON.stringify(current));
  assert.notEqual(current.status, "completed");
  current = await facade.resume(invocation);
  finalized = loadFinalize(current);
  assert.equal(
    finalized.report.sets.find((item) => item.type === firstType)?.final_rows,
    contactRows,
    "completed scope retains its exact generation",
  );
  if (!support)
    assert.equal(
      finalized.report.sets.find((item) => item.type === secondType)?.status,
      "ready_for_remote_write",
      JSON.stringify(finalized.report),
    );
  current = await approve(secondType);
  if (childFailure) throw childFailure;
  assert.deepEqual(writes, [firstType, secondType], JSON.stringify(current));
  assert.deepEqual(readbacks, [firstType, secondType]);
  if (support) {
    const finalScopes = loadFinalize(current).report.sets;
    for (const [type, expected] of [
      [firstType, supportUnitGroupRow(contactId)],
      [secondType, supportFlowPropertyRow(sourceId, contactId)],
    ] as const) {
      const file = finalScopes.find((item) => item.type === type)!.final_rows;
      assert.deepEqual(
        readRows(file).map((row) => unwrapDatasetPayload(row, type)),
        [expected],
        "finalization preserves the native-qualified support payload and unit scale",
      );
    }
  }
  assert.equal(current.status, "completed", JSON.stringify(current));
  assert.equal((await facade.resume(invocation)).status, "completed");
  assert.deepEqual(writes, [firstType, secondType]);
}
