import { createHash } from "node:crypto";
import path from "node:path";
import { Ajv, type AnySchema } from "ajv";
import upstream from "../../specs/release/upstream-assets.json" with { type: "json" };
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import { npmReleasePolicy } from "./foundry-release-provenance.ts";
import {
  assertFoundryProductionTree,
  type FoundryProductionTree,
} from "./foundry-release-production-materialize.ts";

export interface FoundrySbomPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly download_url: string;
  readonly sha256: string;
  readonly sha512?: string;
  readonly declared_license: string | null;
  readonly license_files: readonly string[];
  readonly dependencies: readonly string[];
  readonly purl?: string;
  readonly source_info: string;
}

function hash(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function upstreamBytes(asset: { file: string; bytes: number; sha256: string }): Buffer {
  if (path.basename(asset.file) !== asset.file)
    throw new Error("Release upstream asset path is invalid.");
  const bytes = readFoundryReleaseArtifact(
    path.resolve(import.meta.dirname, "../../specs/release", asset.file),
    512 * 1024,
  );
  if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256)
    throw new Error("Release upstream asset changed from its reviewed source.");
  return bytes;
}

export function collectFoundryNpmMetadata(tree: FoundryProductionTree) {
  assertFoundryProductionTree(tree);
  const files = new Map<string, Buffer>();
  const facts = new Map(tree.files.map((file) => [file.path, file]));
  const packages: FoundrySbomPackage[] = [];
  const license_index: Array<{
    package_id: string;
    declared_license: string | null;
    files: Array<{
      path: string;
      bytes: number;
      sha256: string;
      source_url: string;
      source_path: string;
    }>;
  }> = [];
  for (const pkg of tree.lock.packages) {
    const instance = tree.packages.find((item) => item.id === pkg.id);
    if (!instance) throw new Error("Production metadata package inventory is incomplete.");
    const sources: Array<{ bytes: Buffer; source_url: string; source_path: string }> = [];
    for (const file of instance.license_files) {
      const expected = facts.get(file);
      const bytes = readFoundryReleaseArtifact(path.join(tree.root, file), 512 * 1024);
      if (!expected || bytes.length !== expected.bytes || hash(bytes) !== expected.sha256)
        throw new Error("Production license bytes changed after package verification.");
      sources.push({
        bytes,
        source_url: pkg.download_url,
        source_path: file.slice(instance.path.length + 1),
      });
    }
    if (!sources.length) {
      const supplement = upstream.license_supplements.find(
        (item) => item.package_id === pkg.id && item.package_integrity === pkg.integrity,
      );
      if (!supplement)
        throw new Error(`Production package requires a reviewed license supplement: ${pkg.id}`);
      sources.push({
        bytes: upstreamBytes(supplement),
        source_url: supplement.source_url,
        source_path: supplement.file,
      });
    }
    const copied = sources.map((source) => {
      if (!Buffer.from(source.bytes.toString("utf8")).equals(source.bytes))
        throw new Error("Production license text must be UTF-8.");
      const sha256 = hash(source.bytes),
        file = `metadata/licenses/${sha256}.LICENSE`;
      files.set(file, Buffer.from(source.bytes));
      return {
        path: file,
        bytes: source.bytes.length,
        sha256,
        source_url: source.source_url,
        source_path: source.source_path,
      };
    });
    license_index.push({
      package_id: pkg.id,
      declared_license: instance.declared_license,
      files: copied,
    });
    packages.push(
      Object.freeze({
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        download_url: pkg.download_url,
        sha256: instance.archive_sha256,
        sha512: Buffer.from(pkg.integrity.slice(7), "base64").toString("hex"),
        declared_license: instance.declared_license,
        license_files: Object.freeze(copied.map((file) => file.path)),
        dependencies: Object.freeze(Object.values(pkg.dependencies).sort()),
        purl: `pkg:npm/${pkg.name.replace("@", "%40")}@${pkg.version}`,
        source_info: `Exact registry artifact selected by pnpm lock SHA-256 ${tree.lock.source.sha256}. Optional peers are recorded in production-lock.json; absent peers are not installed software.`,
      }),
    );
  }
  return Object.freeze({
    packages: Object.freeze(packages),
    roots: Object.freeze(Object.values(tree.lock.root_dependencies).sort()),
    license_index: Object.freeze(license_index),
    files: Object.freeze(
      [...files]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([file, bytes]) => Object.freeze({ path: file, bytes })),
    ),
  });
}

export function createFoundrySpdxDocument(
  input: readonly FoundrySbomPackage[],
  roots: readonly string[],
  context: {
    readonly component: string;
    readonly version: string;
    readonly platform: string;
    readonly sourceCommit: string;
    readonly sourceDate: string;
  },
) {
  npmReleasePolicy({ package: "foundry", version: context.version, gitHead: context.sourceCommit });
  if (
    !/^[a-z][a-z0-9-]{0,127}$/u.test(context.component) ||
    !/^\d+\.\d+\.\d+$/u.test(context.version) ||
    !["linux-x64", "linux-arm64", "darwin-arm64", "win32-x64"].includes(context.platform) ||
    !/^[0-9a-f]{40}$/u.test(context.sourceCommit) ||
    !Number.isFinite(Date.parse(context.sourceDate)) ||
    new Date(context.sourceDate).toISOString() !== context.sourceDate
  )
    throw new Error("SPDX source, version, platform or reproducible date is invalid.");
  if (!input.length || input.length > 1000 || !roots.length || roots.length > 64)
    throw new Error("SPDX package graph exceeds its bounds or is empty.");
  const selected = [...input].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = new Map(selected.map((pkg) => [pkg.id, `SPDXRef-Package-${hash(pkg.id)}`]));
  if (
    ids.size !== selected.length ||
    new Set(roots).size !== roots.length ||
    roots.some((root) => !ids.has(root))
  )
    throw new Error("SPDX dependency roots or package identities are invalid.");
  const relationships = roots.map((id) => ({
    spdxElementId: "SPDXRef-DOCUMENT",
    relatedSpdxElement: ids.get(id)!,
    relationshipType: "DESCRIBES",
  }));
  const packages = selected.map((pkg) => {
    if (
      !pkg.name ||
      !pkg.version ||
      !/^[0-9a-f]{64}$/u.test(pkg.sha256) ||
      (pkg.sha512 !== undefined && !/^[0-9a-f]{128}$/u.test(pkg.sha512)) ||
      !pkg.license_files.length
    )
      throw new Error("SPDX package identity, checksum or license evidence is incomplete.");
    const url = new URL(pkg.download_url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new Error("SPDX package source URL is invalid.");
    for (const id of pkg.dependencies) {
      if (!ids.has(id)) throw new Error("SPDX dependency graph is incomplete.");
      relationships.push({
        spdxElementId: ids.get(pkg.id)!,
        relatedSpdxElement: ids.get(id)!,
        relationshipType: "DEPENDS_ON",
      });
    }
    return {
      SPDXID: ids.get(pkg.id)!,
      name: pkg.name,
      versionInfo: pkg.version,
      downloadLocation: url.href,
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      copyrightText: "NOASSERTION",
      licenseDeclared:
        pkg.declared_license &&
        ["MIT", "ISC", "0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"].includes(
          pkg.declared_license,
        )
          ? pkg.declared_license
          : "NOASSERTION",
      licenseComments: `Declared package license: ${pkg.declared_license ?? "not supplied"}. Full retained texts: ${pkg.license_files.join(", ")}.`,
      sourceInfo: pkg.source_info,
      checksums: [
        { algorithm: "SHA256", checksumValue: pkg.sha256 },
        ...(pkg.sha512 ? [{ algorithm: "SHA512", checksumValue: pkg.sha512 }] : []),
      ],
      ...(pkg.purl
        ? {
            externalRefs: [
              {
                referenceCategory: "PACKAGE-MANAGER",
                referenceType: "purl",
                referenceLocator: pkg.purl,
              },
            ],
          }
        : {}),
    };
  });
  const document = {
    SPDXID: "SPDXRef-DOCUMENT",
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    name: `${context.component}@${context.version} (${context.platform})`,
    documentNamespace: `https://github.com/tiangong-lca/data-foundry/spdx/${context.sourceCommit}/${context.component}/${context.platform}/${hash(JSON.stringify(selected))}`,
    creationInfo: {
      created: context.sourceDate,
      creators: [`Tool: tiangong-foundry-release-${context.version}`],
      comment:
        "Timestamp normalized to the owning source commit for reproducible builds. Package-level SPDX data; the component manifest separately binds every shipped file.",
    },
    documentDescribes: roots.map((root) => ids.get(root)!),
    packages,
    relationships: relationships.sort((a, b) =>
      JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0,
    ),
  };
  const schema = JSON.parse(upstreamBytes(upstream.spdx_schema).toString("utf8")) as AnySchema;
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (!validate(document))
    throw new Error(
      `Generated SPDX document violates its pinned upstream schema: ${JSON.stringify(validate.errors)}`,
    );
  return Object.freeze(document);
}
