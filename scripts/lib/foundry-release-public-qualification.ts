import { isDeepStrictEqual } from "node:util";
import {
  copyTrustedRuntimeManifestBytes,
  type TrustedRuntimeManifest,
  type RuntimePlatform,
} from "@tiangong-lca/cli/runtime";
import inputs from "../../specs/release/runtime-inputs.json" with { type: "json" };

export type FoundryQualificationSource = Readonly<{
  repository: string;
  commit: string;
  tree: string;
  date: string;
}>;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Public bootstrap evidence must be an object.");
  return value as Record<string, unknown>;
}
/** Consistency gate for evidence from all successful native public-bootstrap jobs. */
export function verifyFoundryPublicBootstrapReports(
  values: readonly unknown[],
  trusted: TrustedRuntimeManifest,
  source: FoundryQualificationSource,
) {
  copyTrustedRuntimeManifestBytes(trusted);
  const platforms = Object.keys(inputs.minimum_hosts).sort() as RuntimePlatform[];
  if (
    trusted.manifest.product.id !== "tiangong-foundry" ||
    trusted.manifest.components.length !== 12 ||
    trusted.manifest.launches.length !== 8 ||
    platforms.some(
      (platform) =>
        trusted.manifest.components
          .filter((component) => component.platform === platform)
          .map((component) => component.id)
          .sort()
          .join(",") !== "foundry,node,tidas" ||
        trusted.manifest.launches
          .filter((launch) => launch.platform === platform)
          .map((launch) => launch.id)
          .sort()
          .join(",") !== "foundry,foundry-read",
    )
  )
    throw new Error("Final publication requires the complete Foundry runtime component set.");
  if (values.length !== platforms.length)
    throw new Error("Public bootstrap requires all four platform reports.");
  const seen = new Set<string>();
  const phases = [
    ["initial", 0],
    ["warm", 0],
    ["task-start", 0],
    ["returned-action", 0],
    ["developer-command-rejected", 2],
    ["changed-script-rejected", 1],
    ["changed-base-index-rejected", 1],
  ] as const;
  const expectedUrl = `https://github.com/tiangong-lca/foundry/releases/download/foundry-v${trusted.manifest.product.version}/runtime-candidate.json`;
  for (const value of values) {
    const report = object(value);
    const platform = report.platform;
    if (
      typeof platform !== "string" ||
      !platforms.includes(platform as RuntimePlatform) ||
      seen.has(platform)
    )
      throw new Error("Public bootstrap platform is missing, duplicated or unsupported.");
    seen.add(platform);
    if (
      report.schema !== "tiangong-foundry.bootstrap-qualification.v1" ||
      report.status !== "passed" ||
      report.mode !== "public" ||
      report.initial_cache !== "empty" ||
      report.system_tar !== "executed-by-bootstrap" ||
      report.cache_status !== "ready" ||
      !isDeepStrictEqual(report.source, source) ||
      report.manifest_sha256 !== trusted.sha256 ||
      report.manifest_url !== expectedUrl ||
      !isDeepStrictEqual(report.script_sha256, {
        posix: inputs.cli.bootstrap.posix.sha256,
        powershell: inputs.cli.bootstrap.powershell.sha256,
      })
    )
      throw new Error(
        "Public bootstrap evidence differs from its release source or cold-download scope.",
      );
    if (
      !Array.isArray(report.checks) ||
      report.checks.length !== phases.length ||
      report.checks.some((value, index) => {
        const check = object(value);
        return (
          check.phase !== phases[index][0] ||
          check.exit !== phases[index][1] ||
          !Number.isSafeInteger(check.milliseconds) ||
          Number(check.milliseconds) < 0
        );
      })
    )
      throw new Error("Public bootstrap checks are incomplete or failed.");
    const runtime = object(report.runtime_identity),
      qualified = object(runtime.qualification),
      identity = object(qualified.identity),
      cli = object(identity.cli),
      tidas = object(identity.tidas);
    const node = trusted.manifest.components.find(
      (component) => component.platform === platform && component.id === "node",
    );
    const native = trusted.manifest.components.find(
      (component) => component.platform === platform && component.id === "tidas",
    );
    const suffix = platform === "win32-x64" ? ".exe" : "";
    if (
      !node ||
      !native ||
      qualified.status !== "ready" ||
      object(runtime.foundry).package_version !== trusted.manifest.product.version ||
      cli.package_version !== inputs.cli.version ||
      cli.node_version !== inputs.node.version ||
      cli.node_sha256 !== node.files.find((file) => file.path === `bin/node${suffix}`)?.sha256 ||
      cli.content_sha256 !== node.asset_fingerprints.cli ||
      tidas.binary_version !== inputs.tidas.version ||
      object(tidas.executable).sha256 !==
        native.files.find((file) => file.path === `bin/tidas${suffix}`)?.sha256 ||
      tidas.asset_fingerprint !== native.asset_fingerprints.validation
    )
      throw new Error("Public bootstrap ran a different package or native runtime.");
  }
  return { status: "passed" as const, platforms, manifest_sha256: trusted.sha256 };
}
