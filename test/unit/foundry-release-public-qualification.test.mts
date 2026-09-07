import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  RUNTIME_PLATFORMS,
  trustRuntimeManifest,
  type RuntimeManifest,
} from "@tiangong-lca/cli/runtime";
import inputs from "../../specs/release/runtime-inputs.json" with { type: "json" };
import { verifyFoundryPublicBootstrapReports } from "../../scripts/lib/foundry-release-public-qualification.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const source = {
  repository: "https://github.com/tiangong-lca/data-foundry",
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  date: "2026-09-07T00:00:00.000Z",
};
function fixture() {
  const components = RUNTIME_PLATFORMS.flatMap((platform) =>
    ["node", "tidas", "foundry"].map((id) => {
      const file = {
        path: `bin/${id}${platform === "win32-x64" ? ".exe" : ""}`,
        bytes: 1,
        sha256: hash(`${platform}/${id}`),
        mode: 0o755 as const,
      };
      return {
        id,
        version:
          id === "node" ? inputs.node.version : id === "tidas" ? inputs.tidas.version : "0.1.0",
        platform,
        files: [file],
        archive: {
          format: "tar-gzip-ustar-v1" as const,
          url: `https://github.com/tiangong-lca/data-foundry/releases/download/foundry-v0.1.0/${id}-${platform}.tar.gz`,
          bytes: 1,
          sha256: hash("archive"),
        },
        content_sha256: hash(JSON.stringify([file])),
        production_lock: file.path,
        sbom: file.path,
        licenses: [file.path],
        provenance: [file.path],
        protocols: ["fixture.v1"],
        asset_fingerprints: {
          [id === "node" ? "cli" : "validation"]: hash(
            id === "node" ? platform + "cli" : "tidas-assets",
          ),
        },
      };
    }),
  );
  const manifest: RuntimeManifest = {
    schema: "tiangong-lca.runtime-manifest.v1",
    bootstrap_protocol: "tiangong-lca.runtime-bootstrap.v1",
    product: { id: "tiangong-foundry", version: "0.1.0" },
    minimum_hosts: inputs.minimum_hosts,
    workspace: {
      read: [{ schema: "workspace.v1", features: [] }],
      write: [{ schema: "workspace.v1", features: [] }],
    },
    components,
    launches: RUNTIME_PLATFORMS.flatMap((platform) =>
      ["foundry", "foundry-read"].map((id) => ({
        id,
        platform,
        executable: {
          component: "node",
          path: `bin/node${platform === "win32-x64" ? ".exe" : ""}`,
        },
        environment: "isolated",
        argv: [
          { component: "foundry", path: `bin/foundry${platform === "win32-x64" ? ".exe" : ""}` },
        ],
      })),
    ),
  };
  const bytes = Buffer.from(JSON.stringify(manifest));
  const trusted = trustRuntimeManifest(bytes, hash(bytes.toString()));
  const phases = [
    ["initial", 0],
    ["warm", 0],
    ["developer-command-rejected", 2],
    ["changed-script-rejected", 1],
    ["changed-base-index-rejected", 1],
  ] as const;
  const reports = RUNTIME_PLATFORMS.map((platform) => ({
    schema: "tiangong-foundry.bootstrap-qualification.v1",
    status: "passed",
    source,
    platform,
    mode: "public",
    initial_cache: "empty",
    system_tar: "executed-by-bootstrap",
    cache_status: "ready",
    manifest_sha256: trusted.sha256,
    manifest_url:
      "https://github.com/tiangong-lca/data-foundry/releases/download/foundry-v0.1.0/runtime-candidate.json",
    script_sha256: {
      posix: inputs.cli.bootstrap.posix.sha256,
      powershell: inputs.cli.bootstrap.powershell.sha256,
    },
    checks: phases.map(([phase, exit]) => ({ phase, exit, milliseconds: 1 })),
    runtime_identity: {
      foundry: { package_version: "0.1.0" },
      qualification: {
        status: "ready",
        identity: {
          cli: {
            package_version: inputs.cli.version,
            node_version: inputs.node.version,
            node_sha256: hash(`${platform}/node`),
            content_sha256: hash(platform + "cli"),
          },
          tidas: {
            binary_version: inputs.tidas.version,
            executable: { sha256: hash(`${platform}/tidas`) },
            asset_fingerprint: hash("tidas-assets"),
          },
        },
      },
    },
  }));
  return { trusted, reports };
}

test("final publication requires matching public cold-bootstrap proof from every platform", () => {
  const f = fixture();
  assert.equal(verifyFoundryPublicBootstrapReports(f.reports, f.trusted, source).status, "passed");
  assert.throws(() => verifyFoundryPublicBootstrapReports(f.reports.slice(1), f.trusted, source));
  assert.throws(() =>
    verifyFoundryPublicBootstrapReports(
      [f.reports[0], f.reports[0], ...f.reports.slice(2)],
      f.trusted,
      source,
    ),
  );
});

test("cached, failed, stale or different-runtime reports cannot finalize a release", () => {
  for (const kind of [
    "cached",
    "failed",
    "source",
    "digest",
    "script",
    "checks",
    "node",
    "tidas",
  ]) {
    const f = fixture(),
      report = f.reports[0];
    if (kind === "cached") report.mode = "cached";
    if (kind === "failed") report.status = "failed";
    if (kind === "source") report.source = { ...source, commit: "c".repeat(40) };
    if (kind === "digest") report.manifest_sha256 = hash("other");
    if (kind === "script") report.script_sha256.posix = hash("other");
    if (kind === "checks") report.checks.pop();
    if (kind === "node")
      report.runtime_identity.qualification.identity.cli.node_sha256 = hash("other");
    if (kind === "tidas")
      report.runtime_identity.qualification.identity.tidas.binary_version = "0.0.1";
    assert.throws(
      () => verifyFoundryPublicBootstrapReports(f.reports, f.trusted, source),
      Error,
      kind,
    );
  }
});
