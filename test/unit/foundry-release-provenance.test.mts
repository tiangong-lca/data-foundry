import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  npmReleasePolicy,
  validateNpmReleaseMetadata,
  validateNpmProvenanceStatement,
  verifyNpmReleaseEvidence,
  type NpmReleaseExpectation,
} from "../../scripts/lib/foundry-release-provenance.ts";

const cli: NpmReleaseExpectation = {
  package: "cli",
  version: "0.1.10",
  gitHead: "58191977a837e1cdd673ef6d77c35fa2a4caf7ed",
};
const tarball = Buffer.from("A bounded package fixture, never a published release.");
const sha512 = createHash("sha512").update(tarball).digest("hex");
const integrity = `sha512-${Buffer.from(sha512, "hex").toString("base64")}`;

function metadata() {
  return {
    name: "@tiangong-lca/cli",
    version: cli.version,
    gitHead: cli.gitHead,
    dist: {
      tarball: "https://registry.npmjs.org/@tiangong-lca/cli/-/cli-0.1.10.tgz",
      integrity,
      attestations: {
        url: "https://registry.npmjs.org/-/npm/v1/attestations/@tiangong-lca%2fcli@0.1.10",
        provenance: { predicateType: "https://slsa.dev/provenance/v1" },
      },
    },
  };
}

function statement(expected = cli, ref = `refs/tags/cli-v${cli.version}`) {
  const policy = npmReleasePolicy(expected);
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: `pkg:npm/%40tiangong-lca/${expected.package}@${expected.version}`,
        digest: { sha512 },
      },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: { ref, repository: policy.repository, path: policy.workflow },
        },
        internalParameters: {
          github: { event_name: ref === "refs/heads/main" ? "push" : "workflow_dispatch" },
        },
        resolvedDependencies: [
          { uri: `git+${policy.repository}@${ref}`, digest: { gitCommit: expected.gitHead } },
        ],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: { invocationId: `${policy.repository}/actions/runs/123/attempts/1` },
      },
    },
  };
}

function identity(expected = cli, ref = `refs/tags/cli-v${cli.version}`): string {
  const policy = npmReleasePolicy(expected);
  return `${policy.repository}/${policy.workflow}@${ref}`;
}

test("npm evidence admits only canonical package, stable version and exact source expectations", () => {
  assert.equal(npmReleasePolicy(cli).name, "@tiangong-lca/cli");
  assert.throws(() => npmReleasePolicy({ ...cli, version: "latest" }), /version/iu);
  assert.throws(() => npmReleasePolicy({ ...cli, version: "01.1.10" }), /version/iu);
  assert.throws(() => npmReleasePolicy({ ...cli, gitHead: "HEAD" }), /commit/iu);
  const invalid: unknown = { ...cli, package: "other" };
  assert.throws(() => npmReleasePolicy(invalid as NpmReleaseExpectation), /package/iu);
});

test("npm metadata binds the exact tarball, sha512 and attestation location", () => {
  const result = validateNpmReleaseMetadata(metadata(), cli);
  assert.equal(result.sha512, sha512);
  assert.equal(result.integrity, integrity);
  for (const location of [
    "https://registry.npmjs.org.evil.invalid/@tiangong-lca/cli/-/cli-0.1.10.tgz",
    "https://secret@registry.npmjs.org/@tiangong-lca/cli/-/cli-0.1.10.tgz",
    `${metadata().dist.tarball}?token=secret`,
    `${metadata().dist.tarball}#fragment`,
    "http://registry.npmjs.org/@tiangong-lca/cli/-/cli-0.1.10.tgz",
    "https://registry.npmjs.org/@tiangong-lca/cli/-/cli-0.1.9.tgz",
  ]) {
    const bad = metadata();
    bad.dist.tarball = location;
    assert.throws(() => validateNpmReleaseMetadata(bad, cli), /URL/iu);
  }
  const badAttestation = metadata();
  badAttestation.dist.attestations.url = badAttestation.dist.attestations.url.replace(
    "cli@",
    "foundry@",
  );
  assert.throws(() => validateNpmReleaseMetadata(badAttestation, cli), /URL/iu);
  for (const value of ["sha256-abc", integrity + " ", integrity.slice(0, -1)]) {
    const bad = metadata();
    bad.dist.integrity = value;
    assert.throws(() => validateNpmReleaseMetadata(bad, cli), /sha512/iu);
  }
  assert.throws(
    () => validateNpmReleaseMetadata({ ...metadata(), gitHead: "a".repeat(40) }, cli),
    /commit/iu,
  );
  assert.throws(
    () => validateNpmReleaseMetadata({ ...metadata(), name: "@other/cli" }, cli),
    /identity/iu,
  );
});

test("provenance policy binds package bytes, source, workflow, signer and hosted run together", () => {
  const result = validateNpmProvenanceStatement(statement(), cli, sha512, identity());
  assert.equal(result.ref, "refs/tags/cli-v0.1.10");
  const edits: ((value: ReturnType<typeof statement>) => void)[] = [
    (value) => {
      value.subject[0].digest.sha512 = "a".repeat(128);
    },
    (value) => {
      value.subject[0].name = "pkg:npm/%40tiangong-lca/foundry@0.1.10";
    },
    (value) => {
      value.subject.push(value.subject[0]);
    },
    (value) => {
      value.predicate.buildDefinition.externalParameters.workflow.path =
        ".github/workflows/other.yml";
    },
    (value) => {
      value.predicate.buildDefinition.externalParameters.workflow.repository += "-fork";
    },
    (value) => {
      value.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "a".repeat(40);
    },
    (value) => {
      value.predicate.buildDefinition.resolvedDependencies.push(
        value.predicate.buildDefinition.resolvedDependencies[0],
      );
    },
    (value) => {
      value.predicate.runDetails.builder.id = "self-hosted";
    },
    (value) => {
      value.predicate.runDetails.metadata.invocationId += "/../../different";
    },
    (value) => {
      value.predicate.buildDefinition.internalParameters.github.event_name = "pull_request";
    },
    (value) => {
      value.predicateType = "https://example.invalid/provenance";
    },
  ];
  for (const edit of edits) {
    const value = statement();
    edit(value);
    assert.throws(
      () => validateNpmProvenanceStatement(value, cli, sha512, identity()),
      /provenance/iu,
    );
  }
  assert.throws(
    () => validateNpmProvenanceStatement(statement(), cli, sha512, `${identity()}-fork`),
    /signer/iu,
  );
});

test("Foundry provenance permits main pushes and exact tag recovery with matching identities", () => {
  const foundry: NpmReleaseExpectation = {
    package: "foundry",
    version: "0.1.1",
    gitHead: "b".repeat(40),
  };
  for (const ref of ["refs/heads/main", "refs/tags/foundry-v0.1.1"])
    assert.equal(
      validateNpmProvenanceStatement(
        statement(foundry, ref),
        foundry,
        sha512,
        identity(foundry, ref),
      ).ref,
      ref,
    );
  for (const ref of ["refs/heads/dev", "refs/tags/foundry-v0.1.0", "refs/pull/1/merge"])
    assert.throws(
      () =>
        validateNpmProvenanceStatement(
          statement(foundry, ref),
          foundry,
          sha512,
          identity(foundry, ref),
        ),
      /provenance/iu,
    );
  assert.throws(
    () =>
      validateNpmProvenanceStatement(
        statement(foundry, "refs/heads/main"),
        foundry,
        sha512,
        identity(foundry, "refs/tags/foundry-v0.1.1"),
      ),
    /signer/iu,
  );
  const wrongEvent = statement(foundry, "refs/heads/main");
  wrongEvent.predicate.buildDefinition.internalParameters.github.event_name = "workflow_dispatch";
  assert.throws(
    () =>
      validateNpmProvenanceStatement(
        wrongEvent,
        foundry,
        sha512,
        identity(foundry, "refs/heads/main"),
      ),
    /event/iu,
  );
});

test("unverified, corrupt, missing or ambiguous evidence cannot produce a verified release", async () => {
  const input = {
    expected: cli,
    metadataBytes: Buffer.from(JSON.stringify(metadata())),
    tarballBytes: tarball,
    attestationBytes: Buffer.from('{"attestations":[]}'),
  };
  await assert.rejects(
    verifyNpmReleaseEvidence({ ...input, tarballBytes: Buffer.from("corrupt") }),
    /integrity/iu,
  );
  await assert.rejects(verifyNpmReleaseEvidence(input), /provenance/iu);
  const empty = { predicateType: "https://slsa.dev/provenance/v1", bundle: {} };
  await assert.rejects(
    verifyNpmReleaseEvidence({
      ...input,
      attestationBytes: Buffer.from(JSON.stringify({ attestations: [empty, empty] })),
    }),
    /provenance/iu,
  );
  await assert.rejects(
    verifyNpmReleaseEvidence({
      ...input,
      attestationBytes: Buffer.from(JSON.stringify({ attestations: [empty] })),
    }),
    /DSSE/iu,
  );
});
