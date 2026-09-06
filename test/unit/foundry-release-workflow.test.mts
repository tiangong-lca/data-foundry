import assert from "node:assert/strict";
import test from "node:test";
import {
  parseFoundryReleaseWorkflowEvent,
  validateMergedFoundryReleasePr,
} from "../../scripts/lib/foundry-release-workflow.ts";

const head = "a".repeat(40),
  base = "b".repeat(40);
const repository = "tiangong-lca/data-foundry";
function environment(ref = "refs/heads/main", event = "push"): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: head,
    GITHUB_REF: ref,
    GITHUB_EVENT_NAME: event,
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/publish-foundry.yml@${ref}`,
    GITHUB_WORKFLOW_SHA: head,
  };
}
function push() {
  return {
    repository: { full_name: repository },
    before: base,
    after: head,
    ref: "refs/heads/main",
    created: false,
    deleted: false,
    forced: false,
    head_commit: { id: head },
  };
}
function pull() {
  return {
    number: 123,
    html_url: `https://github.com/${repository}/pull/123`,
    state: "closed",
    merged_at: "2026-09-06T01:00:00Z",
    merge_commit_sha: head,
    head: { sha: "c".repeat(40), repo: { full_name: repository } },
    base: { ref: "main", repo: { full_name: repository } },
  };
}

test("release event binds the canonical workflow definition and exact main push", () => {
  assert.deepEqual(parseFoundryReleaseWorkflowEvent(environment(), push()), {
    mode: "main-push",
    ref: "refs/heads/main",
    base,
    head,
  });
  for (const delta of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_REPOSITORY: "other/data-foundry" },
    { GITHUB_SHA: "HEAD" },
    { GITHUB_WORKFLOW_SHA: base },
    { GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/quality-gate.yml@refs/heads/main` },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/heads/dev" },
  ])
    assert.throws(
      () => parseFoundryReleaseWorkflowEvent({ ...environment(), ...delta }, push()),
      /release/iu,
    );
  for (const delta of [
    { before: "0".repeat(40) },
    { before: head },
    { after: base },
    { forced: true },
    { created: true },
    { deleted: true },
    { ref: "refs/heads/dev" },
    { head_commit: { id: base } },
    { repository: { full_name: "other/data-foundry" } },
  ])
    assert.throws(
      () => parseFoundryReleaseWorkflowEvent(environment(), { ...push(), ...delta }),
      /release/iu,
    );
});

test("manual recovery uses the dispatched tag and never accepts an alternate checkout input", () => {
  const ref = "refs/tags/foundry-v0.1.1";
  const event = { repository: { full_name: repository }, ref: "foundry-v0.1.1", inputs: {} };
  assert.deepEqual(parseFoundryReleaseWorkflowEvent(environment(ref, "workflow_dispatch"), event), {
    mode: "tag-recovery",
    ref,
    base: null,
    head,
  });
  for (const invalid of [
    "refs/heads/main",
    "refs/tags/cli-v0.1.1",
    "refs/tags/foundry-v01.1.1",
    "refs/tags/foundry-v0.1.1-rc.1",
  ])
    assert.throws(
      () => parseFoundryReleaseWorkflowEvent(environment(invalid, "workflow_dispatch"), event),
      /release/iu,
    );
  assert.throws(
    () =>
      parseFoundryReleaseWorkflowEvent(environment(ref, "workflow_dispatch"), {
        ...event,
        inputs: { tag_name: "foundry-v9.0.0" },
      }),
    /release/iu,
  );
  assert.throws(
    () =>
      parseFoundryReleaseWorkflowEvent(environment(ref, "workflow_dispatch"), {
        ...event,
        ref: "foundry-v0.1.0",
      }),
    /release/iu,
  );
});

test("release source requires one merged canonical main PR with the exact merge commit", () => {
  const proof = validateMergedFoundryReleasePr([pull()], head);
  assert.deepEqual(proof, { number: 123, url: pull().html_url, head: pull().head.sha });
  assert.throws(() => validateMergedFoundryReleasePr([], head), /merged.*PR/iu);
  assert.throws(() => validateMergedFoundryReleasePr([pull(), pull()], head), /merged.*PR/iu);
  for (const delta of [
    { state: "open" },
    { merged_at: null },
    { merge_commit_sha: base },
    { base: { ref: "dev", repo: { full_name: repository } } },
    { base: { ref: "main", repo: { full_name: "other/data-foundry" } } },
  ])
    assert.throws(
      () => validateMergedFoundryReleasePr([{ ...pull(), ...delta }], head),
      /merged.*PR/iu,
    );
  assert.throws(
    () =>
      validateMergedFoundryReleasePr(
        [{ ...pull(), html_url: "https://example.invalid/pull/123" }],
        head,
      ),
    /PR/iu,
  );
});

test("a merged fork PR remains valid evidence after its source repository is deleted", () => {
  for (const repo of [{ full_name: "contributor/data-foundry" }, null]) {
    const source = { ...pull(), head: { ...pull().head, repo } };
    assert.equal(validateMergedFoundryReleasePr([source], head).number, 123);
    assert.throws(
      () => validateMergedFoundryReleasePr([{ ...source, merged_at: null }], head),
      /merged.*PR/iu,
    );
    assert.throws(
      () => validateMergedFoundryReleasePr([{ ...source, merge_commit_sha: base }], head),
      /merged.*PR/iu,
    );
  }
});
