import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CLI_RUNTIME_EXPECTATION_SCHEMA,
  RUNTIME_HOST_CONTEXT_PROTOCOL,
  inspectRuntimeComponents,
  trustRuntimeManifest,
  writeRuntimeComponentArchive,
  type ComponentFile,
  type RuntimeComponent,
  type RuntimeManifest,
  type RuntimePlatform,
  type TrustedRuntimeManifest,
} from "@tiangong-lca/cli/runtime";
import inputs from "../../specs/release/runtime-inputs.json" with { type: "json" };
import { foundryPackageRepoRoot } from "../build-foundry-package.ts";
import { packFoundryPackage } from "../pack-foundry-package.ts";
import {
  prepareFoundryProductionInput,
  assertPreparedFoundryProductionInput,
} from "../release-prepare-production.ts";
import {
  prepareFoundryNativeInput,
  assertPreparedFoundryNativeInput,
} from "../release-prepare-native.ts";
import { assertFoundryPackage } from "./foundry-package-contract.ts";
import {
  FOUNDRY_MANAGED_RUNTIME_PATH,
  FOUNDRY_MANAGED_RUNTIME_SCHEMA,
} from "./foundry-managed-host.ts";
import {
  FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
  parseFoundryTidasRuntimeExpectation,
} from "./foundry-runtime-qualification.ts";
import { readFoundryReleaseGit as git } from "./foundry-release-contract.ts";
import { sameFoundryReleaseDirectory } from "./foundry-release-root.ts";
import { extractFoundryNpmTarball } from "./foundry-release-extract.ts";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import { npmReleasePolicy, verifyPublicNpmRelease } from "./foundry-release-provenance.ts";
import { createFoundrySpdxDocument, type FoundrySbomPackage } from "./foundry-release-metadata.ts";
import {
  assertFoundryComponentFiles,
  copyFoundryComponentPayload,
  writeFoundryComponentFile,
  foundryComponentJson as json,
  foundryComponentHash as hash,
  freezeFoundryReleaseValue,
} from "./foundry-release-component-io.ts";

export type FoundryRuntimeComponentSource = "source-candidate" | "published-release";
export interface PreparedFoundryRuntimeComponents {
  readonly output: string;
  readonly source: Readonly<{ repository: string; commit: string; tree: string; date: string }>;
  readonly version: string;
  readonly platform: RuntimePlatform;
  readonly scope: FoundryRuntimeComponentSource;
  readonly manifest: Readonly<{ file: string; sha256: string }>;
  readonly package: Readonly<{
    name: string;
    version: string;
    sha256: string;
    sha512: string;
    bytes: number;
    inventory_sha256: string;
  }>;
  readonly components: readonly RuntimeComponent[];
  readonly release_blockers: readonly string[];
}
interface RuntimePreparationAuthority {
  manifest: TrustedRuntimeManifest;
  seeds: Readonly<Record<string, string>>;
  expected: Readonly<{
    foundry: string;
    cli: string;
    node: string;
    tidas: string;
    assetFingerprint: string;
  }>;
}
const prepared = new WeakMap<object, RuntimePreparationAuthority>();

/** This private source-side identity is never restored from a receipt or a manifest file. */
export function preparedFoundryRuntimeAuthority(
  value: PreparedFoundryRuntimeComponents,
): RuntimePreparationAuthority {
  const result = prepared.get(value);
  if (!result)
    throw new Error("Runtime qualification requires its in-process prepared component authority.");
  if (JSON.stringify(sourceState()) !== JSON.stringify(value.source))
    throw new Error("Runtime qualification source changed after component preparation.");
  const manifestBytes = readFoundryReleaseArtifact(
    path.join(value.output, value.manifest.file),
    32 * 1024 * 1024,
  );
  if (hash(manifestBytes) !== result.manifest.sha256)
    throw new Error("Prepared runtime manifest changed before qualification.");
  return result;
}

function sourceState() {
  const root = foundryPackageRepoRoot;
  if (
    !sameFoundryReleaseDirectory(root, git(root, ["rev-parse", "--show-toplevel"]).trim()) ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("Runtime assembly requires its own clean source checkout.");
  return {
    repository: "https://github.com/tiangong-lca/data-foundry",
    commit: git(root, ["rev-parse", "HEAD"]).trim(),
    tree: git(root, ["rev-parse", "HEAD^{tree}"]).trim(),
    date: new Date(git(root, ["show", "-s", "--format=%cI", "HEAD"]).trim()).toISOString(),
  };
}

export async function prepareFoundryRuntimeComponents(
  selectedOutput: string,
  scope: FoundryRuntimeComponentSource,
): Promise<PreparedFoundryRuntimeComponents> {
  if (
    !path.isAbsolute(selectedOutput) ||
    !["source-candidate", "published-release"].includes(scope)
  )
    throw new Error("Runtime assembly requires an absolute output and an explicit source mode.");
  const output = path.join(
    fs.realpathSync(path.dirname(selectedOutput)),
    path.basename(selectedOutput),
  );
  if (fs.existsSync(output))
    throw new Error("Runtime assembly will not replace an existing directory.");
  const relative = path.relative(foundryPackageRepoRoot, output);
  if (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !relative.startsWith(`package-artifacts${path.sep}`)
  )
    throw new Error("Runtime output must be outside source or under package-artifacts/.");
  const source = sourceState();
  fs.mkdirSync(output, { mode: 0o700 });
  const created = fs.lstatSync(output, { bigint: true });
  try {
    const work = path.join(output, ".build");
    fs.mkdirSync(work);
    const production = await prepareFoundryProductionInput(path.join(work, "npm-input"));
    const native = await prepareFoundryNativeInput(path.join(work, "native-input"));
    assertPreparedFoundryProductionInput(production);
    assertPreparedFoundryNativeInput(native);
    if (
      [production, native].some(
        (input) => input.source.commit !== source.commit || input.source.tree !== source.tree,
      ) ||
      production.version !== native.version ||
      production.platform !== native.platform
    )
      throw new Error(
        "Runtime preparation inputs must belong to the same exact source, version and platform.",
      );
    const version = production.version,
      platform = production.platform;
    const releaseBlockers =
      native.licenseCoverage.tidas === "owner-inventory-verified"
        ? []
        : ["tidas_third_party_notices_required"];
    if (scope === "published-release" && releaseBlockers.length)
      throw new Error(
        "Published runtime assembly requires owner-qualified TIDAS third-party license evidence.",
      );
    const packed = packFoundryPackage(path.join(work, "package"));
    const publication =
      scope === "published-release"
        ? await verifyPublicNpmRelease({ package: "foundry", version, gitHead: source.commit })
        : null;
    if (publication && !publication.tarballBytes.equals(packed.bytes))
      throw new Error("Published Foundry tarball differs from the exact qualified source package.");
    const packageBytes = publication?.tarballBytes ?? packed.bytes;
    const packageFact = {
      name: packed.descriptor.package.name,
      version,
      bytes: packageBytes.length,
      sha256: hash(packageBytes),
      sha512: createHash("sha512").update(packageBytes).digest("hex"),
      inventory_sha256: packed.descriptor.files_sha256,
    };
    const stages = path.join(work, "components");
    fs.mkdirSync(stages);
    const artifacts = path.join(output, "components");
    fs.mkdirSync(artifacts);
    const applicationRoot = path.join(stages, "application");
    copyFoundryComponentPayload(
      production.payloadRoot,
      production.files,
      applicationRoot,
      platform,
    );
    const applicationFiles: ComponentFile[] = [...production.files];
    const packagePath = "node_modules/@tiangong-lca/foundry";
    const extracted = extractFoundryNpmTarball(
      packageBytes,
      path.join(applicationRoot, packagePath),
    );
    const descriptor = assertFoundryPackage(path.join(applicationRoot, packagePath));
    if (
      descriptor.files_sha256 !== packageFact.inventory_sha256 ||
      descriptor.package.version !== version ||
      descriptor.package.cli_dependency.version !== production.cli.package.version
    )
      throw new Error(
        "Assembled Foundry package differs from its source and locked CLI dependency.",
      );
    applicationFiles.push(
      ...extracted.files.map((file) => ({ ...file, path: `${packagePath}/${file.path}` })),
    );
    const packageLicense = `${packagePath}/LICENSE`;
    if (!applicationFiles.some((file) => file.path === packageLicense))
      throw new Error("Foundry package license is missing.");
    const packageId = `${packageFact.name}@${version}`;
    const software: FoundrySbomPackage = {
      id: packageId,
      name: packageFact.name,
      version,
      download_url: publication?.evidence.tarball.url ?? "NOASSERTION",
      sha256: packageFact.sha256,
      sha512: packageFact.sha512,
      declared_license: "MIT",
      license_files: [packageLicense],
      dependencies: Object.values(production.lock.root_dependencies).sort(),
      purl: `pkg:npm/${packageFact.name.replace("@", "%40")}@${version}`,
      source_info: publication
        ? `Verified public npm artifact from ${source.repository} at ${source.commit}.`
        : `Unpublished candidate packed from ${source.repository} at ${source.commit}; no registry availability is asserted.`,
    };
    const applicationSoftware = [...production.software, software];
    const add = (root: string, files: ComponentFile[], name: string, value: unknown) =>
      files.push(writeFoundryComponentFile(root, name, json(value)));
    add(applicationRoot, applicationFiles, "metadata/runtime-lock.json", {
      schema: "tiangong-foundry.runtime-component-lock.v1",
      component: "foundry",
      scope,
      root: { ...packageFact, dependencies: production.lock.root_dependencies },
      frozen_dependencies: production.lock,
      native_components: (["node", "tidas"] as const).map((id) => ({
        id,
        source: native.sources[id],
        package: native.software.find((pkg) => pkg.name === id),
        executable: native.files.find((file) => file.path === native.executables[id]),
      })),
    });
    add(
      applicationRoot,
      applicationFiles,
      "metadata/runtime-sbom.spdx.json",
      createFoundrySpdxDocument(applicationSoftware, [packageId], {
        component: "foundry",
        version,
        platform,
        sourceCommit: source.commit,
        sourceDate: source.date,
      }),
    );
    add(applicationRoot, applicationFiles, "metadata/runtime-licenses.json", {
      schema: "tiangong-foundry.runtime-license-index.v1",
      packages: [
        ...production.licenses,
        {
          package_id: packageId,
          declared_license: "MIT",
          files: [applicationFiles.find((file) => file.path === packageLicense)!],
        },
      ],
    });
    add(applicationRoot, applicationFiles, "metadata/runtime-provenance.json", {
      schema: "tiangong-foundry.runtime-component-provenance.v1",
      scope,
      source,
      package: packageFact,
      published_package: publication?.evidence ?? null,
      cli: production.cli,
      source_lock: production.lock.source,
    });
    if (publication) {
      applicationFiles.push(
        writeFoundryComponentFile(
          applicationRoot,
          "metadata/foundry-registry.json",
          publication.metadataBytes,
        ),
      );
      applicationFiles.push(
        writeFoundryComponentFile(
          applicationRoot,
          "metadata/foundry-attestations.json",
          publication.attestationBytes,
        ),
      );
    }
    const nodeFact = native.files.find((file) => file.path === native.executables.node)!;
    const tidasFact = native.files.find((file) => file.path === native.executables.tidas)!;
    const describe = native.observations.tidas.validation_describe;
    const tidasExpectation = parseFoundryTidasRuntimeExpectation(
      {
        schema: FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
        platform,
        binary_version: native.observations.tidas.binary_version,
        executable: { bytes: tidasFact.bytes, sha256: tidasFact.sha256 },
        validation: {
          schema_version: describe.schema_version,
          asset_fingerprint: describe.asset_fingerprint,
          protocols: [...(describe.protocols ?? [])].sort(),
          event_schema_versions: [...(describe.event_schema_versions ?? [])].sort(),
        },
      },
      platform,
    );
    add(applicationRoot, applicationFiles, FOUNDRY_MANAGED_RUNTIME_PATH, {
      schema: FOUNDRY_MANAGED_RUNTIME_SCHEMA,
      platform,
      cli: {
        schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
        package_version: production.cli.package.version,
        platform,
        content_sha256: production.cliContentSha256,
        node_version: native.observations.node.version,
        node_sha256: nodeFact.sha256,
      },
      tidas: {
        executable: { component: "tidas", path: native.executables.tidas },
        expectation: tidasExpectation,
      },
      launches: [
        { id: "foundry", access: "write", target: null },
        { id: "foundry-read", access: "read", target: null },
      ],
    });
    const componentInputs: Array<{
      id: string;
      version: string;
      root: string;
      files: ComponentFile[];
      licenses: string[];
      provenance: string[];
      protocols: string[];
      fingerprints: Record<string, string>;
    }> = [
      {
        id: "foundry",
        version,
        root: applicationRoot,
        files: applicationFiles,
        licenses: [
          ...new Set([
            ...production.licenses.flatMap((item) => item.files.map((file) => file.path)),
            packageLicense,
          ]),
        ].sort(),
        provenance: [
          "metadata/runtime-provenance.json",
          "metadata/cli-attestations.json",
          ...(publication ? ["metadata/foundry-attestations.json"] : []),
        ],
        protocols: [FOUNDRY_MANAGED_RUNTIME_SCHEMA],
        fingerprints: { cli: production.cliContentSha256, foundry: packageFact.inventory_sha256 },
      },
    ];
    for (const id of ["node", "tidas"] as const) {
      const selected = native.files.filter(
        (file) =>
          file.path === native.executables[id] ||
          file.path.startsWith(`share/licenses/${id}/`) ||
          (id === "tidas" && file.path === "metadata/tidas-distribution.json"),
      );
      const root = path.join(stages, id);
      copyFoundryComponentPayload(
        native.payloadRoot,
        native.files,
        root,
        platform,
        selected.map((file) => file.path),
      );
      const nativePackage = native.software.find((pkg) => pkg.name === id)!;
      const upstream = native.sources[id];
      const files = [...selected];
      add(root, files, "metadata/runtime-lock.json", {
        schema: "tiangong-foundry.runtime-component-lock.v1",
        component: id,
        package: nativePackage,
        files: selected,
        source: upstream,
      });
      add(
        root,
        files,
        "metadata/runtime-sbom.spdx.json",
        createFoundrySpdxDocument([nativePackage], [nativePackage.id], {
          component: id,
          version: nativePackage.version,
          platform,
          sourceCommit: upstream.commit,
          sourceDate: upstream.date,
          namespaceRepository: upstream.repository,
          creator: "Tool: tiangong-foundry-component-v1",
        }),
      );
      add(root, files, "metadata/runtime-provenance.json", native.provenance[id]);
      componentInputs.push({
        id,
        version: nativePackage.version,
        root,
        files,
        licenses: [...nativePackage.license_files],
        provenance: ["metadata/runtime-provenance.json"],
        protocols:
          id === "node"
            ? ["tiangong-foundry.node-runtime.v1"]
            : [...tidasExpectation.validation.protocols],
        fingerprints:
          id === "node"
            ? { executable: nodeFact.sha256 }
            : { validation: tidasExpectation.validation.asset_fingerprint },
      });
    }
    const nativeSoftware = native.software.map((pkg) => ({
      ...pkg,
      license_files: pkg.license_files.map((file) => `${pkg.name}:${file}`),
    }));
    add(
      applicationRoot,
      applicationFiles,
      "metadata/product-sbom.spdx.json",
      createFoundrySpdxDocument(
        [
          ...production.software,
          {
            ...software,
            dependencies: [...software.dependencies, ...nativeSoftware.map((pkg) => pkg.id)].sort(),
          },
          ...nativeSoftware,
        ],
        [packageId],
        {
          component: "foundry-runtime",
          version,
          platform,
          sourceCommit: source.commit,
          sourceDate: source.date,
        },
      ),
    );
    const policy = npmReleasePolicy({ package: "foundry", version, gitHead: source.commit });
    const tag = policy.refs.find((ref) => ref.startsWith("refs/tags/"))!.slice("refs/tags/".length);
    const components: RuntimeComponent[] = [],
      archiveFiles: Record<string, string> = {};
    for (const item of componentInputs) {
      item.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      assertFoundryComponentFiles(item.root, item.files, platform);
      const filename = `${item.id}-${item.version}-${platform}.tar.gz`;
      const archivePath = path.join(artifacts, filename);
      const archive = await writeRuntimeComponentArchive(item.root, item.files, archivePath);
      const component: RuntimeComponent = {
        id: item.id,
        version: item.version,
        platform,
        archive: {
          format: "tar-gzip-ustar-v1",
          url: `${policy.repository}/releases/download/${tag}/${filename}`,
          ...archive,
        },
        files: item.files,
        content_sha256: hash(Buffer.from(JSON.stringify(item.files))),
        production_lock: "metadata/runtime-lock.json",
        sbom: "metadata/runtime-sbom.spdx.json",
        licenses: item.licenses,
        provenance: item.provenance,
        protocols: item.protocols,
        asset_fingerprints: item.fingerprints,
      };
      components.push(component);
      archiveFiles[item.id] = archivePath;
    }
    const workspace = (schemas: readonly string[]) =>
      schemas.map((schema) => ({
        schema,
        features:
          schema === "tiangong-foundry.workspace.v2"
            ? ["migration-adoption-v1", "registered-tasks-v2"]
            : ["registered-tasks-v2"],
      }));
    const manifestValue: RuntimeManifest = {
      schema: "tiangong-lca.runtime-manifest.v1",
      bootstrap_protocol: "tiangong-lca.runtime-bootstrap.v1",
      product: { id: "tiangong-foundry", version },
      minimum_hosts: { [platform]: inputs.minimum_hosts[platform] },
      workspace: {
        read: workspace(descriptor.runtime.workspace_read_schemas),
        write: workspace(descriptor.runtime.workspace_write_schemas),
      },
      components,
      launches: ["foundry", "foundry-read"].map((id) => ({
        id,
        platform,
        executable: { component: "node", path: native.executables.node },
        environment: "isolated",
        context_protocol: RUNTIME_HOST_CONTEXT_PROTOCOL,
        argv: [{ component: "foundry", path: `${packagePath}/${descriptor.package.bin}` }],
      })),
    };
    const manifestBytes = json(manifestValue),
      manifestSha = hash(manifestBytes);
    const trusted = trustRuntimeManifest(manifestBytes, manifestSha);
    writeFoundryComponentFile(output, "runtime-manifest.json", manifestBytes);
    const result = freezeFoundryReleaseValue({
      output,
      source,
      version,
      platform,
      scope,
      manifest: { file: "runtime-manifest.json", sha256: manifestSha },
      package: packageFact,
      components,
      release_blockers: releaseBlockers,
    });
    const status = inspectRuntimeComponents(trusted, { cacheDir: path.join(output, ".key-probe") });
    const seeds = Object.fromEntries(
      status.components.map((item) => [item.key, archiveFiles[item.id]]),
    );
    prepared.set(
      result,
      freezeFoundryReleaseValue({
        manifest: trusted,
        seeds,
        expected: {
          foundry: version,
          cli: production.cli.package.version,
          node: native.observations.node.version,
          tidas: native.observations.tidas.binary_version,
          assetFingerprint: tidasExpectation.validation.asset_fingerprint,
        },
      }),
    );
    if (JSON.stringify(sourceState()) !== JSON.stringify(source))
      throw new Error("Runtime source changed during component assembly.");
    writeFoundryComponentFile(
      output,
      "runtime-platform.json",
      json({
        schema: "tiangong-foundry.prepared-runtime-components.v1",
        status: "prepared",
        ...result,
        output: undefined,
      }),
    );
    fs.rmSync(work, { recursive: true, force: true });
    return result;
  } catch (error) {
    if (fs.existsSync(output)) {
      const current = fs.lstatSync(output, { bigint: true });
      if (
        current.isDirectory() &&
        !current.isSymbolicLink() &&
        current.dev === created.dev &&
        current.ino === created.ino
      )
        fs.rmSync(output, { recursive: true, force: true });
    }
    throw error;
  }
}
