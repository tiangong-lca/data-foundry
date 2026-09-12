import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { RuntimeManifest } from "@tiangong-lca/cli/runtime";
import inputs from "../../specs/release/runtime-inputs.json" with { type: "json" };
import { aggregateFoundryRuntimeManifests } from "../../scripts/lib/foundry-release-aggregate.ts";
import {
  readPreparedFoundryRuntimeAggregate,
  type PreparedFoundryRuntimeAggregate,
} from "../../scripts/release-aggregate-runtime.ts";

const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const source = {
  repository: "https://github.com/tiangong-lca/foundry",
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  date: "2026-09-07T00:00:00.000Z",
};
const expectation = { source, version: "0.1.0", scope: "published-release" as const };

test("a serialized aggregate cannot supply publication bytes", () => {
  assert.throws(
    () =>
      readPreparedFoundryRuntimeAggregate({
        source,
        scope: "published-release",
      } as unknown as PreparedFoundryRuntimeAggregate),
    /in-process/u,
  );
});

// Small explicit wire fixtures exercise aggregation, never native/public qualification.
function samples() {
  return Object.entries(inputs.minimum_hosts).map(([selected, minimum]) => {
    const platform = selected as keyof typeof inputs.minimum_hosts;
    const files = [{ path: "entry", bytes: 1, sha256: sha("x"), mode: 0o755 as const }];
    const components = ["foundry", "node", "tidas"].map((id) => {
      const version =
        id === "foundry"
          ? expectation.version
          : id === "node"
            ? inputs.node.version
            : inputs.tidas.version;
      return {
        id,
        version,
        platform,
        files,
        archive: {
          format: "tar-gzip-ustar-v1" as const,
          url: `https://github.com/tiangong-lca/foundry/releases/download/foundry-v0.1.0/${id}-${version}-${platform}.tar.gz`,
          bytes: 1,
          sha256: sha("x"),
        },
        content_sha256: sha(JSON.stringify(files)),
        production_lock: "entry",
        sbom: "entry",
        licenses: ["entry"],
        provenance: ["entry"],
        protocols: ["fixture.v1"],
        asset_fingerprints: {},
      };
    });
    const manifest: RuntimeManifest = {
      schema: "tiangong-lca.runtime-manifest.v1",
      bootstrap_protocol: "tiangong-lca.runtime-bootstrap.v1",
      product: { id: "tiangong-foundry", version: "0.1.0" },
      minimum_hosts: { [platform]: minimum },
      workspace: {
        read: [{ schema: "workspace.v1", features: [] }],
        write: [{ schema: "workspace.v1", features: [] }],
      },
      components,
      launches: ["foundry", "foundry-read"].map((id) => ({
        id,
        platform,
        executable: { component: "node", path: "entry" },
        environment: "isolated",
        context_protocol: "tiangong-lca.runtime-host.v1",
        argv: [{ component: "foundry", path: "entry" }],
      })),
    };
    const manifestBytes = encode(manifest);
    const preparation = {
      schema: "tiangong-foundry.prepared-runtime-components.v1",
      status: "prepared",
      source,
      version: "0.1.0",
      platform,
      scope: "published-release",
      manifest: { file: "runtime-manifest.json", sha256: sha(manifestBytes) },
      package: {
        name: "@tiangong-lca/foundry",
        version: "0.1.0",
        bytes: 1,
        sha256: sha("package"),
        sha512: "c".repeat(128),
        inventory_sha256: sha("inventory"),
      },
      components,
      release_blockers: [],
    };
    const qualification = {
      schema: "tiangong-foundry.runtime-component-qualification.v1",
      status: "passed",
      scope: "native-local-archive-runtime",
      source,
      platform,
      manifest_sha256: sha(manifestBytes),
      package_source: "published-release",
      launches: 13,
      checks: Array.from({ length: 13 }, () => ({ status: "ready", exit: 0 })),
      bootstrap_base: { status: "passed", receipt_adopted: true, warm_verified: true },
      manager_download_calls: 0,
      global_node_or_package_manager_required: false,
      release_blockers: [],
      runtime_identity: {
        foundry: { package_version: "0.1.0" },
        qualification: {
          status: "ready",
          identity: {
            cli: { package_version: inputs.cli.version, node_version: inputs.node.version },
            tidas: { binary_version: inputs.tidas.version, asset_fingerprint: "d".repeat(64) },
          },
        },
      },
    };
    return { manifestBytes, preparation, qualification };
  });
}

test("aggregation requires all four matching native results and preserves every component", () => {
  const values = samples();
  const result = aggregateFoundryRuntimeManifests(values, expectation);
  assert.equal(result.manifest.components.length, 12);
  assert.equal(result.manifest.launches.length, 8);
  assert.deepEqual(
    Object.keys(result.manifest.minimum_hosts).sort(),
    Object.keys(inputs.minimum_hosts).sort(),
  );
  assert.deepEqual(aggregateFoundryRuntimeManifests([...values].reverse(), expectation), result);
});

test("missing, duplicate, mixed source, failed and candidate results cannot form a published set", () => {
  for (const kind of [
    "missing",
    "duplicate",
    "source",
    "failed",
    "scope",
    "package",
    "workspace",
    "manifest",
    "bootstrap",
  ] as const) {
    const values = samples();
    if (kind === "missing") values.pop();
    if (kind === "duplicate") values[1] = values[0];
    if (kind === "source") values[0].preparation.source = { ...source, commit: "e".repeat(40) };
    if (kind === "failed") values[0].qualification.status = "failed";
    if (kind === "scope") values[0].preparation.scope = "source-candidate";
    if (kind === "package") values[0].preparation.package.sha256 = sha("different");
    if (kind === "workspace") {
      const m = JSON.parse(values[0].manifestBytes.toString());
      m.workspace.write[0].features = ["unreviewed"];
      values[0].manifestBytes = encode(m);
      values[0].preparation.manifest.sha256 = sha(values[0].manifestBytes);
      values[0].qualification.manifest_sha256 = sha(values[0].manifestBytes);
    }
    if (kind === "manifest") values[0].manifestBytes = Buffer.from("{}");
    if (kind === "bootstrap") values[0].qualification.bootstrap_base.receipt_adopted = false;
    assert.throws(() => aggregateFoundryRuntimeManifests(values, expectation), Error, kind);
  }
});
