import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseDocument } from "yaml";
import { foundryCiPlatforms } from "../../scripts/lib/foundry-ci-results.ts";
import {
  inventoryCapsuleFiles,
  type CapsuleExpectation,
} from "../../scripts/lib/foundry-ci-capsule.ts";
import { validateStageEvidence } from "../../scripts/lib/foundry-ci-stage.ts";

const root = path.resolve(import.meta.dirname, "../..");
function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function workflow(file: string): Record<string, unknown> {
  const document = parseDocument(
    fs.readFileSync(path.join(root, ".github/workflows", file), "utf8"),
    { uniqueKeys: true },
  );
  assert.deepEqual(document.errors, []);
  return object(document.toJS());
}
function steps(job: Record<string, unknown>): Record<string, unknown>[] {
  assert.ok(Array.isArray(job.steps));
  return job.steps.map(object);
}

test("public bootstrap seals only its completed proof and keeps disposable directories outside the capsule", (t) => {
  const job = object(object(workflow("publish-foundry.yml").jobs)["qualify-bootstrap-public"]);
  const selected = steps(job);
  const staging = selected.find((step) => step.name === "Stage completed bootstrap proof");
  assert.ok(staging, "Public bootstrap needs a separate proof boundary before sealing.");
  const qualify = selected.find((step) => String(step.run).includes("release:qualify-bootstrap"));
  assert.ok(qualify);
  assert.equal(object(qualify.env).BOOTSTRAP_OUTPUT, object(staging.env).BOOTSTRAP_WORK);
  assert.notEqual(object(staging.env).BOOTSTRAP_WORK, object(staging.env).BOOTSTRAP_PROOF);
  assert.equal(staging.if, "steps.restore.outputs.reused != 'true'");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-proof-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const work = path.join(temporary, "qualification work"),
    proof = path.join(temporary, "proof");
  fs.mkdirSync(path.join(work, "home", "empty"), { recursive: true });
  const expected: CapsuleExpectation = {
    stage: "bootstrap",
    platform: "win32-x64",
    purpose: "release",
    input_sha256: "f".repeat(64),
    identity: {
      repository: { id: "123", owner_id: "456" },
      source: { commit: "a".repeat(40), tree: "b".repeat(40) },
      package: { name: "@tiangong-lca/foundry", version: "0.1.5" },
      toolchain: {
        node: "24.19.0",
        pnpm: "11.24.0",
        typescript: "7.0.2",
        lock_sha256: "c".repeat(64),
      },
      runtime_inputs_sha256: "d".repeat(64),
      test_plan_sha256: "e".repeat(64),
    },
  };
  const report = {
    schema: "tiangong-foundry.bootstrap-qualification.v1",
    status: "passed",
    source: {
      repository: "https://github.com/tiangong-lca/data-foundry",
      ...expected.identity.source,
    },
    platform: expected.platform,
    mode: "public",
    manifest_sha256: expected.input_sha256,
    cache_status: "ready",
    initial_cache: "empty",
    checks: [
      ["initial", 0],
      ["warm", 0],
      ["developer-command-rejected", 2],
      ["changed-script-rejected", 1],
      ["changed-base-index-rejected", 1],
    ].map(([phase, exit]) => ({ phase, exit, milliseconds: 1 })),
  };
  const bytes = Buffer.from(JSON.stringify(report));
  fs.writeFileSync(path.join(work, "bootstrap-qualification.json"), bytes);
  assert.throws(() => inventoryCapsuleFiles(work), /empty capsule directory/u);
  const execute = () =>
    spawnSync("bash", ["-eu", "-c", String(staging.run)], {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        BOOTSTRAP_WORK: work,
        BOOTSTRAP_PROOF: proof,
      },
    });
  const result = execute();
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(proof), ["bootstrap-qualification.json"]);
  assert.deepEqual(fs.readFileSync(path.join(proof, "bootstrap-qualification.json")), bytes);
  assert.equal(inventoryCapsuleFiles(proof).length, 1);
  validateStageEvidence(proof, expected);
  assert.notEqual(execute().status, 0, "Existing completed evidence must not be overwritten.");
  fs.writeFileSync(
    path.join(proof, "bootstrap-qualification.json"),
    JSON.stringify({ ...report, status: "failed" }),
  );
  assert.throws(() => validateStageEvidence(proof, expected), /Incomplete or failed bootstrap/u);
  fs.mkdirSync(path.join(proof, "unexpected-empty"));
  assert.throws(() => inventoryCapsuleFiles(proof), /empty capsule directory/u);
});

test("full CI runs all platforms with independent tests and native qualification before their final join", () => {
  const jobs = object(workflow("quality-gate.yml").jobs);
  const tests = object(jobs["test-shards"]),
    native = object(jobs["quality-gate"]);
  const testMatrix = object(object(tests.strategy).matrix),
    nativeMatrix = object(object(native.strategy).matrix);
  assert.ok(Array.isArray(testMatrix.include) && Array.isArray(nativeMatrix.include));
  const testHosts = testMatrix.include.map(object),
    nativeHosts = nativeMatrix.include.map(object);
  assert.deepEqual(testHosts.map((host) => host.platform).sort(), [...foundryCiPlatforms].sort());
  assert.deepEqual(nativeHosts.map((host) => host.platform).sort(), [...foundryCiPlatforms].sort());
  assert.deepEqual(testMatrix.os, [
    "ubuntu-latest",
    "ubuntu-24.04-arm",
    "macos-latest",
    "windows-latest",
  ]);
  assert.match(String(testMatrix.shard), /needs\.plan\.outputs\.shards/u);
  assert.equal(native.if, "always()");
  assert.ok(Array.isArray(native.needs));
  for (const requirement of ["plan", "build-package", "version-pr"])
    assert.ok(native.needs.includes(requirement));
  assert.ok(!native.needs.includes("verify-tests"));
  assert.ok(!(object(jobs["aggregate-runtime"]).needs as string[]).includes("verify-tests"));
  assert.ok((object(jobs["qualification-gate"]).needs as string[]).includes("verify-tests"));
  const guard = steps(native)[0];
  assert.equal(guard.shell, "bash");
  const script = String(guard.run);
  for (const required of [
    'test "$PLAN_RESULT" = success',
    'test "$BUILD_RESULT" = success',
    'full) test "$BUILD_RESULT" = success',
    'test "$VERSION_RESULT" = success',
    "*) exit 1",
  ])
    assert.ok(script.includes(required));
  assert.match(String(object(jobs["aggregate-runtime"]).if), /mode == 'full'/u);
});

test("publication consumes signed complete source qualification and retains every release dependency", () => {
  const quality = workflow("quality-gate.yml"),
    publish = workflow("publish-foundry.yml");
  const caller = object(object(publish.jobs)["release-qualification"]);
  assert.equal(caller.uses, "./.github/workflows/quality-gate.yml");
  assert.equal(object(caller.with).source_sha, "${{ needs.release-context.outputs.release_head }}");
  const call = object(object(quality.on).workflow_call);
  assert.equal(object(object(call.inputs).source_sha).required, true);
  const outputs = object(call.outputs);
  assert.match(
    String(object(outputs.package_sha256).value),
    /jobs\.build-package\.outputs\.package_sha256/u,
  );
  for (const id of ["npm-package", "prepare-runtime"]) {
    const job = object(object(publish.jobs)[id]);
    assert.ok(Array.isArray(job.needs) && job.needs.includes("release-qualification"));
    const consumer = steps(job).find(
      (step) => object(step.env ?? {}).FOUNDRY_QUALIFICATION_CAPSULE !== undefined,
    );
    assert.ok(consumer);
    const env = object(consumer.env);
    assert.equal(env.FOUNDRY_QUALIFICATION_CAPSULE, "${{ runner.temp }}/qualified-source");
    assert.equal(env.FOUNDRY_CI_PACKAGE_DIR, undefined);
    assert.equal(env.GH_TOKEN, "${{ github.token }}");
  }
});

test("full qualification cannot succeed when aggregation or copied bootstrap was skipped", () => {
  const jobs = object(workflow("quality-gate.yml").jobs);
  for (const id of ["aggregate-runtime", "qualify-bootstrap-cached"]) {
    const job = object(jobs[id]);
    assert.match(String(job.if), /!cancelled\(\)/u);
    assert.match(String(job.if), /result == 'success'/u);
    assert.match(String(job.if), /mode == 'full'/u);
  }
  const complete = object(jobs["qualification-gate"]);
  assert.equal(complete.if, "always()");
  assert.ok(Array.isArray(complete.needs));
  for (const id of [
    "plan",
    "build-package",
    "verify-tests",
    "version-pr",
    "quality-gate",
    "aggregate-runtime",
    "qualify-bootstrap-cached",
  ])
    assert.ok(complete.needs.includes(id));
  const guard = String(steps(complete)[0].run);
  for (const key of [
    "PLAN_RESULT",
    "BUILD_RESULT",
    "TEST_RESULT",
    "NATIVE_RESULT",
    "AGGREGATE_RESULT",
    "BOOTSTRAP_RESULT",
    "VERSION_RESULT",
  ])
    assert.ok(guard.includes(`test "$${key}" = success`));
});

function executeGuard(job: Record<string, unknown>, env: Record<string, string>) {
  return spawnSync("bash", ["-eu", "-c", String(steps(job)[0].run)], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).status;
}
test("real shell qualification guards reject each failed, cancelled or skipped full requirement", () => {
  const jobs = object(workflow("quality-gate.yml").jobs);
  const valid = {
    MODE: "full",
    PLAN_RESULT: "success",
    BUILD_RESULT: "success",
    TEST_RESULT: "success",
    VERSION_RESULT: "skipped",
    NATIVE_RESULT: "success",
    AGGREGATE_RESULT: "success",
    BOOTSTRAP_RESULT: "success",
    REUSE_VERIFIED: "false",
  };
  assert.equal(executeGuard(object(jobs["qualification-gate"]), valid), 0);
  for (const key of [
    "PLAN_RESULT",
    "BUILD_RESULT",
    "TEST_RESULT",
    "NATIVE_RESULT",
    "AGGREGATE_RESULT",
    "BOOTSTRAP_RESULT",
  ]) {
    for (const result of ["failure", "cancelled", "skipped", ""])
      assert.notEqual(
        executeGuard(object(jobs["qualification-gate"]), { ...valid, [key]: result }),
        0,
        `${key}=${result}`,
      );
  }
  const final = object(jobs["complete-qualification"]);
  const complete = {
    MODE: "full",
    PLAN_RESULT: "success",
    GATE_RESULT: "success",
    SEALABLE: "true",
    SEAL_RESULT: "success",
    REUSE_VERIFIED: "false",
  };
  assert.equal(executeGuard(final, complete), 0);
  assert.notEqual(executeGuard(final, { ...complete, SEAL_RESULT: "skipped" }), 0);
  assert.notEqual(executeGuard(final, { ...complete, MODE: "reused", SEAL_RESULT: "skipped" }), 0);
  assert.equal(
    executeGuard(final, {
      ...complete,
      MODE: "reused",
      SEAL_RESULT: "skipped",
      REUSE_VERIFIED: "true",
    }),
    0,
  );
});
test("publication stages restore required proofs and diagnostics have no publication credentials", () => {
  const jobs = object(workflow("publish-foundry.yml").jobs);
  for (const id of ["publish-components", "publish-runtime-manifest"]) {
    const restore = steps(object(jobs[id])).filter((s) =>
      String(s.run).includes("ci:stage restore"),
    );
    assert.equal(restore.length, id === "publish-components" ? 4 : 5);
    for (const s of restore) assert.match(String(s.run), /--required true/u);
  }
  const native = steps(object(jobs["prepare-runtime"]));
  assert.ok(native.some((s) => String(s.run).includes("ci:stage restore")));
  assert.match(
    String(native.find((s) => String(s.run).includes("release:prepare-runtime"))?.if),
    /reused != 'true'/u,
  );
  const diagnose = object(jobs["diagnose-platform"]);
  assert.equal(object(diagnose.permissions)["id-token"], undefined);
  assert.equal(object(diagnose.permissions).contents, "read");
  const caller = object(jobs["release-qualification"]);
  assert.ok((caller.needs as string[]).includes("release-preflight"));
});
