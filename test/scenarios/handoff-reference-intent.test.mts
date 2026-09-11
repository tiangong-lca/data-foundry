import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { createFoundryApplication } from "../../scripts/foundry.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { parseFoundryCommandSpec } from "../../scripts/lib/foundry-command-spec.ts";
import { processRowWithFlowRef } from "../fixtures/row-builders.ts";
import { writeReadyFinalizeFixture } from "../fixtures/finalize-fixtures.ts";
import { targetUserId } from "../fixtures/foundry-core.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
function write(file: string, value: unknown) {
  fs.writeFileSync(file, JSON.stringify(value));
}
function fact(file: string) {
  const bytes = fs.readFileSync(file);
  return {
    path: file,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
function fixture(t: import("node:test").TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-reference-handoff-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const processId = "11111111-1111-4111-8111-111111111111",
    flowId = "22222222-2222-4222-8222-222222222222",
    version = "00.00.001";
  const row = processRowWithFlowRef(processId, flowId),
    rows = path.join(root, "rows.json");
  Object.assign(row.processDataSet.exchanges.exchange[0].referenceToFlowDataSet, {
    "@type": "flow data set",
  });
  write(rows, [row]);
  const prepared = writeReadyFinalizeFixture({ root, datasetType: "process", rowsFile: rows });
  const reviewFile = path.join(root, "review.json"),
    intentFile = path.join(root, "intent.json"),
    precommitFile = path.join(root, "precommit.json");
  const selected = {
    table: "flows",
    id: flowId,
    version,
    user_id: targetUserId,
    state_code: 100,
    payload_sha256: "a".repeat(64),
  };
  const latest = { ...selected, version: "00.00.002", payload_sha256: "b".repeat(64) };
  write(reviewFile, {
    schema_version: "dataset-exact-reference-review.v1",
    decision: "use_selected_exact",
    reason: "Reviewed physical definition",
    selected,
    latest,
  });
  const consumers = [
    { row_index: 0, table: "processes", id: processId, version, payload_sha256: sha256Json(row) },
  ];
  const occurrence = {
    row_index: 0,
    path: "/processDataSet/exchanges/exchange/0/referenceToFlowDataSet",
    selected,
  };
  write(intentFile, {
    schema_version: "dataset-exact-reference-intent.v1",
    project_ref: "abcdefghijklmnopqrst",
    actor_user_id: targetUserId,
    consumers,
    references: [{ ...occurrence, review: { file: reviewFile, sha256: fact(reviewFile).sha256 } }],
  });
  write(precommitFile, {
    schema_version: 1,
    status: "passed_remote_verification",
    input_path: rows,
    counts: { rows: 1, blockers: 0 },
    blockers: [],
    reference_intent: {
      file: fact(intentFile),
      actor_user_id: targetUserId,
      project_ref: "abcdefghijklmnopqrst",
      consumers,
      references: [{ ...occurrence, review: { file: fact(reviewFile), latest } }],
      review_files: [fact(reviewFile)],
    },
  });
  const finalize = JSON.parse(fs.readFileSync(prepared.finalizeReport, "utf8")) as {
    files: Record<string, unknown>;
  };
  finalize.files.remote_verify_report = precommitFile;
  write(prepared.finalizeReport, finalize);
  const app = createFoundryApplication({ repoRoot });
  const run = (extra: Record<string, unknown> = {}) =>
    app.execute("dataset-commit-handoff-plan", {
      finalizeReport: prepared.finalizeReport,
      outDir: path.join(root, "handoff"),
      ...extra,
    });
  return {
    root,
    rows,
    intentFile,
    reviewFile,
    precommitFile,
    finalizeFile: prepared.finalizeReport,
    run,
  };
}

test("handoff automatically retains the passing reference intent and all evidence in both command specs", async (t) => {
  const f = fixture(t),
    report = (await f.run()) as Record<string, unknown>;
  assert.equal(report.status, "ready_for_explicit_commit", JSON.stringify(report));
  const commands = report.commands as Record<string, unknown>;
  const commit = parseFoundryCommandSpec(commands.commit),
    verify = parseFoundryCommandSpec(commands.post_write_verify);
  assert.equal(commit.argv.includes("--reference-intent-file"), false);
  assert.equal(verify.argv[verify.argv.indexOf("--reference-intent-file") + 1], f.intentFile);
  assert.deepEqual(commit.binding.artifacts, verify.binding.artifacts);
  assert.deepEqual(
    commit.binding.artifacts.map((item) => item.role),
    ["final_rows", "reference_intent", "reference_precommit", "reference_review"],
  );
  await assert.rejects(f.run(), /fresh handoff/u);
});

test("changed review or consumer and a different asserted selection cannot produce a handoff", async (t) => {
  for (const mode of ["review", "consumer", "assertion"] as const) {
    const f = fixture(t);
    if (mode === "review") fs.appendFileSync(f.reviewFile, " ");
    if (mode === "consumer")
      write(f.rows, [
        processRowWithFlowRef(
          "33333333-3333-4333-8333-333333333333",
          "22222222-2222-4222-8222-222222222222",
        ),
      ]);
    await assert.rejects(
      f.run(
        mode === "assertion" ? { referenceIntentFile: path.join(f.root, "other-intent.json") } : {},
      ),
      /reference-intent-file/u,
    );
    assert.equal(fs.existsSync(path.join(f.root, "handoff")), false);
  }
});

test("an explicitly marked finalization cannot lose its precommit intent and fall back", async (t) => {
  const f = fixture(t);
  const finalize = JSON.parse(fs.readFileSync(f.finalizeFile, "utf8")) as {
    reference_intent_file?: string;
    files: Record<string, unknown>;
  };
  finalize.reference_intent_file = f.intentFile;
  finalize.files.remote_verify_report = null;
  write(f.finalizeFile, finalize);
  await assert.rejects(f.run(), /reference-intent-file/u);
  assert.equal(fs.existsSync(path.join(f.root, "handoff")), false);
});

test("full closeout cannot accept plain root proof for an intent-bound handoff", async (t) => {
  const f = fixture(t);
  const handoff = await f.run();
  assert.equal((handoff as Record<string, unknown>).status, "ready_for_explicit_commit");
  const row = JSON.parse(fs.readFileSync(f.rows, "utf8"))[0] as Record<string, unknown>;
  const commitFile = path.join(f.root, "commit.json"),
    verifyFile = path.join(f.root, "verify.json"),
    checksFile = path.join(f.root, "checks.jsonl");
  write(commitFile, {
    status: "completed_process_save_draft",
    mode: "commit",
    commit: true,
    input_path: f.rows,
    counts: { executed: 1, failed: 0 },
  });
  fs.writeFileSync(
    checksFile,
    JSON.stringify({
      role: "root",
      table: "processes",
      id: "11111111-1111-4111-8111-111111111111",
      version: "00.00.001",
      row_index: 0,
      path: "/processDataSet#readback",
      status: "ok",
      local_payload_sha256: sha256Json(row),
      remote_payload_sha256: sha256Json(row),
      remote_user_id: targetUserId,
      remote_state_code: 0,
    }) + "\n",
  );
  const verify = {
    status: "passed_remote_verification",
    input_path: f.rows,
    counts: { blockers: 0, root_readback_checks: 1, root_payload_mismatches: 0 },
    blockers: [],
    files: { checks: checksFile },
  };
  write(verifyFile, verify);
  const app = createFoundryApplication({ repoRoot });
  const close = (out: string) =>
    app.execute("dataset-post-write-closeout", {
      handoffPlan: path.join(f.root, "handoff/dataset-commit-handoff-plan.json"),
      commitReport: commitFile,
      postWriteVerifyReport: verifyFile,
      outDir: path.join(f.root, out),
    });
  const rejected = (await close("missing-reference-proof")) as Record<string, unknown>;
  assert.equal(rejected.status, "blocked", JSON.stringify(rejected));
  assert.ok(
    (rejected.blockers as Array<{ code: string }>).some(
      (blocker) => blocker.code === "reference_intent_evidence_invalid",
    ),
  );
  const precommit = JSON.parse(fs.readFileSync(f.precommitFile, "utf8")) as Record<string, unknown>;
  write(verifyFile, { ...verify, reference_intent: precommit.reference_intent });
  const accepted = (await close("matching-reference-proof")) as Record<string, unknown>;
  assert.equal(accepted.status, "completed", JSON.stringify(accepted));
  for (const mode of ["hash", "actor", "consumers", "reviews"] as const) {
    const changed = structuredClone(precommit.reference_intent) as Record<string, unknown>;
    if (mode === "hash") (changed.file as Record<string, unknown>).sha256 = "0".repeat(64);
    if (mode === "actor") changed.actor_user_id = "other-actor";
    if (mode === "consumers") changed.consumers = [];
    if (mode === "reviews") changed.review_files = [];
    write(verifyFile, { ...verify, reference_intent: changed });
    const invalid = (await close(`changed-${mode}`)) as Record<string, unknown>;
    assert.equal(invalid.status, "blocked", mode);
    assert.ok(
      (invalid.blockers as Array<{ code: string }>).some(
        (blocker) => blocker.code === "reference_intent_evidence_invalid",
      ),
    );
  }
  const planFile = path.join(f.root, "handoff/dataset-commit-handoff-plan.json");
  const unbound = JSON.parse(fs.readFileSync(planFile, "utf8")) as Record<string, unknown>;
  delete unbound.reference_intent;
  write(planFile, unbound);
  write(verifyFile, verify);
  const lostBinding = (await close("lost-binding")) as Record<string, unknown>;
  assert.equal(
    lostBinding.status,
    "blocked",
    "an explicit command flag cannot silently lose its handoff binding",
  );
});
