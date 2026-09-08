import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseDocument } from "yaml";
import { foundryCiPlatforms } from "../../scripts/lib/foundry-ci-results.ts";

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

test("full CI expands every supported platform and verifies every shard before native qualification", () => {
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
  for (const requirement of ["plan", "build-package", "verify-tests", "version-pr"])
    assert.ok(native.needs.includes(requirement));
  const guard = steps(native)[0];
  assert.equal(guard.shell, "bash");
  const script = String(guard.run);
  for (const required of [
    'test "$PLAN_RESULT" = success',
    'test "$BUILD_RESULT" = success',
    'full) test "$TEST_RESULT" = success',
    'version-only) test "$VERSION_RESULT" = success',
    "*) exit 1",
  ])
    assert.ok(script.includes(required));
  assert.match(String(object(jobs["aggregate-runtime"]).if), /mode == 'full'/u);
});

test("publication always calls full source qualification and reuses only its independent artifact digests", () => {
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
      (step) => object(step.env ?? {}).FOUNDRY_CI_PACKAGE_DIR !== undefined,
    );
    assert.ok(consumer);
    const env = object(consumer.env);
    assert.equal(
      env.FOUNDRY_CI_PACKAGE_SHA256,
      "${{ needs.release-qualification.outputs.package_sha256 }}",
    );
    assert.equal(
      env.FOUNDRY_CI_PACKAGE_MANIFEST_SHA256,
      "${{ needs.release-qualification.outputs.package_manifest_sha256 }}",
    );
  }
});
