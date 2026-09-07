import {
  copyTrustedRuntimeManifestBytes,
  inspectRuntimeComponents,
  type ComponentFile,
  type TrustedRuntimeManifest,
} from "@tiangong-lca/cli/runtime";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import inputs from "../../specs/release/runtime-inputs.json" with { type: "json" };
import { foundryComponentHash, freezeFoundryReleaseValue } from "./foundry-release-component-io.ts";

export const FOUNDRY_BOOTSTRAP_INTEGRITY = "metadata/bootstrap-sha256.txt";
export const FOUNDRY_BOOTSTRAP_CLI = "node_modules/@tiangong-lca/cli/bin/tiangong-lca.js";

/** The public C1 bootstrap checks this complete list before it can run Node. */
export function createFoundryBootstrapIntegrity(files: readonly ComponentFile[]) {
  if (!files.length || files.length >= 50_000)
    throw new Error("Bootstrap file inventory exceeds its bound.");
  const seen = new Set<string>();
  for (const file of files) {
    if (
      !file.path ||
      file.path.length > 255 ||
      /[\\:\p{Cc}]/u.test(file.path) ||
      file.path
        .split("/")
        .some((part) => !part || part === "." || part === ".." || part.startsWith("-")) ||
      file.path.toLowerCase() === FOUNDRY_BOOTSTRAP_INTEGRITY ||
      seen.has(file.path.toLowerCase()) ||
      !/^[0-9a-f]{64}$/u.test(file.sha256)
    )
      throw new Error("Bootstrap inventory contains an unsafe, duplicate or reserved file.");
    seen.add(file.path.toLowerCase());
  }
  const bytes = Buffer.from(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => `${file.sha256}  ${file.path}\n`)
      .join(""),
  );
  return { path: FOUNDRY_BOOTSTRAP_INTEGRITY, bytes, fileCount: files.length };
}

/** Produces adjacent lock data from a caller-trusted complete product manifest. */
export function createFoundryBootstrapLock(
  trusted: TrustedRuntimeManifest,
  manifestUrl: string,
  entry: "foundry" | "foundry-read" = "foundry",
) {
  const bytes = copyTrustedRuntimeManifestBytes(trusted);
  const manifest = trusted.manifest;
  const version = manifest.product.version;
  const origin = "https://github.com/tiangong-lca/data-foundry/releases/download/";
  if (
    manifest.product.id !== "tiangong-foundry" ||
    !["foundry", "foundry-read"].includes(entry) ||
    ![
      `${origin}foundry-v${version}/runtime-candidate.json`,
      `${origin}foundry-runtime-v${version}/runtime-manifest.json`,
    ].includes(manifestUrl)
  )
    throw new Error("Bootstrap lock requires the exact Foundry release manifest URL and entry.");
  const lock: Record<string, string | number> = {
    schema: "tiangong-lca.runtime-bootstrap-lock.v1",
    bootstrap_protocol: manifest.bootstrap_protocol,
    posix_script_sha256: inputs.cli.bootstrap.posix.sha256,
    powershell_script_sha256: inputs.cli.bootstrap.powershell.sha256,
    manifest_url: manifestUrl,
    manifest_bytes: bytes.length,
    manifest_sha256: trusted.sha256,
    app_entry: entry,
  };
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-bootstrap-key-"));
  try {
    for (const platform of Object.keys(
      inputs.minimum_hosts,
    ) as (keyof typeof inputs.minimum_hosts)[]) {
      const component = manifest.components.find(
        (item) => item.platform === platform && item.id === "node",
      );
      const nodePath = `bin/node${platform === "win32-x64" ? ".exe" : ""}`;
      const integrity = component?.files.find((file) => file.path === FOUNDRY_BOOTSTRAP_INTEGRITY);
      if (
        !component ||
        component.version !== inputs.node.version ||
        !component.protocols.includes("tiangong-lca.runtime-bootstrap.v1") ||
        !component.files.some((file) => file.path === nodePath && file.mode === 0o755) ||
        !component.files.some((file) => file.path === FOUNDRY_BOOTSTRAP_CLI) ||
        !integrity ||
        !manifest.launches.some(
          (launch) =>
            launch.platform === platform &&
            launch.id === entry &&
            launch.executable.component === component.id &&
            launch.executable.path === nodePath,
        )
      )
        throw new Error("Bootstrap base is missing its Node, CLI, integrity or launch binding.");
      const checksum = createFoundryBootstrapIntegrity(
        component.files.filter((file) => file.path !== FOUNDRY_BOOTSTRAP_INTEGRITY),
      );
      if (
        integrity.bytes !== checksum.bytes.length ||
        integrity.sha256 !== foundryComponentHash(checksum.bytes)
      )
        throw new Error("Bootstrap checksum index differs from the complete component inventory.");
      const minimum = inputs.minimum_hosts[platform];
      const status = inspectRuntimeComponents(trusted, {
        cacheDir: path.join(probe, "cache"),
        host: { platform, osRelease: minimum.os_release, glibc: minimum.glibc },
      });
      const key = status.components.find((item) => item.id === component.id)?.key;
      if (!key) throw new Error("Bootstrap component key is missing.");
      const prefix = platform.replaceAll("-", "_");
      Object.assign(
        lock,
        Object.fromEntries(
          Object.entries({
            component_key: key,
            archive_url: component.archive.url,
            archive_bytes: component.archive.bytes,
            archive_sha256: component.archive.sha256,
            integrity_path: integrity.path,
            integrity_sha256: integrity.sha256,
            file_count: checksum.fileCount,
            node_path: nodePath,
            cli_path: FOUNDRY_BOOTSTRAP_CLI,
          }).map(([name, value]) => [`${prefix}_${name}`, value]),
        ),
      );
    }
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
  return freezeFoundryReleaseValue(lock);
}
