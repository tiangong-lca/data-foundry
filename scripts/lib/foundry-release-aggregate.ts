import { isDeepStrictEqual } from "node:util";
import {
  parseRuntimeManifest,
  type RuntimeManifest,
  type RuntimePlatform,
} from "@tiangong-lca/cli/runtime";
import inputs from "../../specs/release/runtime-inputs.json" with { type: "json" };
import {
  foundryComponentHash as hash,
  foundryComponentJson as json,
  freezeFoundryReleaseValue,
} from "./foundry-release-component-io.ts";

export interface FoundryRuntimeAggregateExpectation {
  readonly source: Readonly<{ repository: string; commit: string; tree: string; date: string }>;
  readonly version: string;
  readonly scope: "source-candidate" | "published-release";
}
export interface FoundryRuntimePlatformResult {
  readonly manifestBytes: Uint8Array;
  readonly preparation: unknown;
  readonly qualification: unknown;
}
type RecordValue = Record<string, unknown>;
const platforms = Object.keys(inputs.minimum_hosts).sort() as RuntimePlatform[];
const fail = (message: string): never => {
  throw new Error(`Runtime aggregation ${message}.`);
};
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("requires an object");
  return value as RecordValue;
}
function empty(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

/** Checks consistency of a four-job handoff. The result alone grants no publication authority. */
export function aggregateFoundryRuntimeManifests(
  results: readonly FoundryRuntimePlatformResult[],
  expectation: FoundryRuntimeAggregateExpectation,
) {
  if (
    results.length !== platforms.length ||
    expectation.source.repository !== "https://github.com/tiangong-lca/data-foundry" ||
    !/^[0-9a-f]{40}$/u.test(expectation.source.commit) ||
    !/^[0-9a-f]{40}$/u.test(expectation.source.tree) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(expectation.source.date) ||
    !Number.isFinite(Date.parse(expectation.source.date)) ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(expectation.version) ||
    !["source-candidate", "published-release"].includes(expectation.scope)
  )
    return fail("requires four results and an independently selected source/version");
  const selected = new Map<RuntimePlatform, { manifest: RuntimeManifest; sha256: string }>();
  let packageFact: RecordValue | undefined;
  let workspace: RuntimeManifest["workspace"] | undefined;
  let tidasFingerprint: string | undefined;
  for (const result of results) {
    const bytes = Buffer.from(result.manifestBytes);
    if (!bytes.length || bytes.length > 32 * 1024 * 1024)
      return fail("manifest exceeds its byte bound");
    const manifest = parseRuntimeManifest(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    const preparation = record(result.preparation),
      qualification = record(result.qualification);
    const platform = preparation.platform;
    if (
      typeof platform !== "string" ||
      !platforms.includes(platform as RuntimePlatform) ||
      selected.has(platform as RuntimePlatform)
    )
      return fail("has a missing, duplicated or unsupported platform");
    const target = platform as RuntimePlatform;
    const digest = hash(bytes);
    const manifestFact = record(preparation.manifest);
    if (
      preparation.schema !== "tiangong-foundry.prepared-runtime-components.v1" ||
      preparation.status !== "prepared" ||
      preparation.version !== expectation.version ||
      preparation.scope !== expectation.scope ||
      !isDeepStrictEqual(preparation.source, expectation.source) ||
      manifestFact.file !== "runtime-manifest.json" ||
      manifestFact.sha256 !== digest ||
      !isDeepStrictEqual(preparation.components, manifest.components) ||
      !empty(preparation.release_blockers)
    )
      return fail("preparation differs from its expected source or complete manifest");
    if (
      qualification.schema !== "tiangong-foundry.runtime-component-qualification.v1" ||
      qualification.status !== "passed" ||
      qualification.scope !== "native-local-archive-runtime" ||
      qualification.platform !== target ||
      qualification.package_source !== expectation.scope ||
      !isDeepStrictEqual(qualification.source, expectation.source) ||
      qualification.manifest_sha256 !== digest ||
      qualification.manager_download_calls !== 0 ||
      qualification.global_node_or_package_manager_required !== false ||
      qualification.launches !== 11 ||
      !Array.isArray(qualification.checks) ||
      qualification.checks.length !== qualification.launches ||
      !empty(qualification.release_blockers)
    )
      return fail("requires successful matching native qualification");
    const runtime = record(qualification.runtime_identity),
      foundry = record(runtime.foundry),
      qualified = record(runtime.qualification),
      identity = record(qualified.identity),
      cli = record(identity.cli),
      tidas = record(identity.tidas);
    if (
      qualified.status !== "ready" ||
      foundry.package_version !== expectation.version ||
      cli.package_version !== inputs.cli.version ||
      cli.node_version !== inputs.node.version ||
      tidas.binary_version !== inputs.tidas.version ||
      typeof tidas.asset_fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/u.test(tidas.asset_fingerprint) ||
      (tidasFingerprint !== undefined && tidasFingerprint !== tidas.asset_fingerprint)
    )
      return fail("runtime identity differs across qualified owners");
    tidasFingerprint = tidas.asset_fingerprint;
    const pkg = record(preparation.package);
    if (
      Object.keys(pkg).sort().join(",") !== "bytes,inventory_sha256,name,sha256,sha512,version" ||
      pkg.name !== "@tiangong-lca/foundry" ||
      pkg.version !== expectation.version ||
      !Number.isSafeInteger(pkg.bytes) ||
      Number(pkg.bytes) < 1 ||
      Number(pkg.bytes) > 256 * 1024 * 1024 ||
      typeof pkg.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(pkg.sha256) ||
      typeof pkg.sha512 !== "string" ||
      !/^[0-9a-f]{128}$/u.test(pkg.sha512) ||
      typeof pkg.inventory_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(pkg.inventory_sha256) ||
      (packageFact && !isDeepStrictEqual(packageFact, pkg))
    )
      return fail("package bytes or inventory differ across platforms");
    packageFact = pkg;
    if (
      manifest.product.id !== "tiangong-foundry" ||
      manifest.product.version !== expectation.version ||
      !isDeepStrictEqual(manifest.minimum_hosts, { [target]: inputs.minimum_hosts[target] }) ||
      (workspace && !isDeepStrictEqual(workspace, manifest.workspace))
    )
      return fail("product, workspace or minimum-host contracts differ");
    workspace = manifest.workspace;
    if (
      manifest.components.length !== 3 ||
      manifest.components
        .map((item) => item.id)
        .sort()
        .join(",") !== "foundry,node,tidas"
    )
      return fail("requires complete Foundry, Node and TIDAS components");
    for (const component of manifest.components) {
      const version =
        component.id === "foundry"
          ? expectation.version
          : component.id === "node"
            ? inputs.node.version
            : inputs.tidas.version;
      const url = `https://github.com/tiangong-lca/data-foundry/releases/download/foundry-v${expectation.version}/${component.id}-${version}-${target}.tar.gz`;
      if (
        component.platform !== target ||
        component.version !== version ||
        component.archive.url !== url
      )
        return fail("component identity or immutable destination differs");
    }
    if (
      manifest.launches.length !== 2 ||
      manifest.launches
        .map((launch) => launch.id)
        .sort()
        .join(",") !== "foundry,foundry-read" ||
      manifest.launches.some(
        (launch) =>
          launch.platform !== target ||
          launch.environment !== "isolated" ||
          launch.context_protocol !== "tiangong-lca.runtime-host.v1" ||
          launch.executable.component !== "node" ||
          launch.argv.length !== 1 ||
          !("component" in launch.argv[0]) ||
          launch.argv[0].component !== "foundry",
      )
    )
      return fail("launch contract differs from managed Foundry admission");
    selected.set(target, { manifest, sha256: digest });
  }
  if (selected.size !== platforms.length || !workspace || !packageFact)
    return fail("platform set is incomplete");
  const manifest = parseRuntimeManifest({
    schema: "tiangong-lca.runtime-manifest.v1",
    bootstrap_protocol: "tiangong-lca.runtime-bootstrap.v1",
    product: { id: "tiangong-foundry", version: expectation.version },
    workspace,
    minimum_hosts: Object.fromEntries(
      platforms.map((platform) => [platform, inputs.minimum_hosts[platform]]),
    ),
    components: platforms.flatMap((platform) =>
      [...selected.get(platform)!.manifest.components].sort((a, b) => a.id.localeCompare(b.id)),
    ),
    launches: platforms.flatMap((platform) =>
      [...selected.get(platform)!.manifest.launches].sort((a, b) => a.id.localeCompare(b.id)),
    ),
  });
  const bytes = json(manifest);
  return freezeFoundryReleaseValue({
    manifest,
    bytes,
    sha256: hash(bytes),
    package: packageFact,
    platforms: platforms.map((platform) => ({
      platform,
      manifest_sha256: selected.get(platform)!.sha256,
    })),
  });
}
