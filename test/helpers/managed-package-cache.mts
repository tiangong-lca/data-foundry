import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  copyTrustedRuntimeManifestBytes,
  ensureRuntimeComponents,
  inspectRuntimeComponents,
  pruneRuntimeComponents,
  trustRuntimeManifest,
  writeRuntimeComponentArchive,
  type ComponentFile,
  type RuntimeManifest,
  type TrustedRuntimeManifest,
} from "@tiangong-lca/cli/runtime";
import { workspaceManifestFixture } from "./foundry-runtime-manifest.mts";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function trusted(value: RuntimeManifest): TrustedRuntimeManifest {
  const bytes = Buffer.from(JSON.stringify(value));
  return trustRuntimeManifest(bytes, hash(bytes));
}

function files(root: string, relative = ""): ComponentFile[] {
  return fs
    .readdirSync(path.join(root, relative))
    .sort()
    .flatMap((name) => {
      const selected = relative ? `${relative}/${name}` : name;
      const target = path.join(root, selected);
      const stat = fs.lstatSync(target);
      if (stat.isDirectory()) return files(root, selected);
      assert.equal(
        stat.isFile(),
        true,
        `Component fixture must contain regular files: ${selected}`,
      );
      const bytes = fs.readFileSync(target);
      return [
        {
          path: selected,
          bytes: bytes.length,
          sha256: hash(bytes),
          mode: stat.mode & 0o111 ? 493 : 420,
        },
      ];
    });
}

/** Real installed application bytes; the surrounding component metadata is a test fixture. */
async function component(
  root: string,
  id: string,
  source: string,
  template: TrustedRuntimeManifest,
  executable: string,
) {
  for (const name of ["fixture-lock.json", "fixture-sbom.json", "fixture-provenance.json"])
    fs.writeFileSync(path.join(source, name), "{}\n");
  fs.writeFileSync(path.join(source, "fixture-license.txt"), "Component metadata fixture only.\n");
  fs.chmodSync(path.join(source, executable), 0o755);
  const inventory = files(source).sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const archive = path.join(root, `${id}.tar.gz`);
  const archiveFact = await writeRuntimeComponentArchive(source, inventory, archive);
  const platform = template.manifest.components[0].platform;
  const manifest = trusted({
    ...template.manifest,
    components: [
      {
        id,
        version: template.manifest.product.version,
        platform,
        archive: {
          format: "tar-gzip-ustar-v1",
          url: `https://github.com/tiangong-lca/runtime-fixture/releases/download/v1.0.0/${id}.tar.gz`,
          ...archiveFact,
        },
        files: inventory,
        content_sha256: hash(JSON.stringify(inventory)),
        production_lock: "fixture-lock.json",
        sbom: "fixture-sbom.json",
        licenses: ["fixture-license.txt"],
        provenance: ["fixture-provenance.json"],
        protocols: ["fixture.v1"],
        asset_fingerprints: {},
      },
    ],
    launches: [
      {
        id: "tool",
        platform,
        executable: { component: id, path: executable },
        environment: "isolated",
        argv: [],
      },
    ],
  });
  return { manifest, archive };
}

export async function verifyManagedPackageCache(installedPackage: string, root: string) {
  const input = path.join(root, "managed-package-input");
  const modules = path.dirname(path.dirname(installedPackage));
  fs.mkdirSync(input);
  fs.cpSync(modules, path.join(input, "node_modules"), {
    recursive: true,
    filter: (source) =>
      !path
        .relative(modules, source)
        .split(path.sep)
        .some((part) => [".bin", ".package-lock.json"].includes(part)),
  });
  const current = await component(
    root,
    "application",
    input,
    workspaceManifestFixture({ write: ["registered-tasks-v2"] }),
    "node_modules/@tiangong-lca/foundry/package-dist/scripts/package-entry.js",
  );
  const oldInput = path.join(root, "older-component-input");
  fs.mkdirSync(oldInput);
  fs.writeFileSync(path.join(oldInput, "tool"), "Older component fixture.\n");
  const older = await component(
    root,
    "older",
    oldInput,
    workspaceManifestFixture({ version: "0.0.9" }),
    "tool",
  );
  const cache = path.join(root, "managed-cache-parent", "components-cache");
  const archiveSeeds = Object.fromEntries(
    [current, older].map((item) => [
      inspectRuntimeComponents(item.manifest, { cacheDir: cache }).components[0].key,
      item.archive,
    ]),
  );
  let networkCalls = 0;
  const manager = {
    cacheDir: cache,
    archiveSeeds,
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error("Managed package cache tests must remain offline.");
    },
  };
  const installed = await ensureRuntimeComponents(current.manifest, manager);
  assert.equal(installed.status, "ready");
  const packageRoot = path.join(installed.components[0].root, "node_modules/@tiangong-lca/foundry");
  const api = (await import(
    pathToFileURL(path.join(packageRoot, "package-dist/scripts/public-api.js")).href
  )) as typeof import("../../scripts/public-api.ts");
  const access = (manifest: TrustedRuntimeManifest, mode: "read" | "write") =>
    api.createFoundryWorkspaceAccess({
      manifestBytes: copyTrustedRuntimeManifestBytes(manifest),
      expectedSha256: manifest.sha256,
      access: mode,
    });
  const currentAccess = access(current.manifest, "write");
  const oldAccess = access(older.manifest, "read");
  const options = {
    workspace: path.join(root, "managed-package-workspace"),
    cacheBase: path.join(root, "managed-package-work-cache"),
    workspaceAccess: currentAccess,
    runtimeManager: manager,
  };
  const facade = api.createFoundryFacade(options);
  assert.equal(facade.initialize().status, "ready");
  const marker = path.join(options.workspace, ".foundry/workspace.json");
  const markerBytes = fs.readFileSync(marker);
  const request = {
    requestId: "managed-current",
    actorId: "actor",
    access: "write" as const,
    manifest: currentAccess.manifest,
  };
  const selected = await facade.runtimeUse(request);
  assert.equal(selected.status, "ready", JSON.stringify(selected.blockers));
  assert.equal((await facade.runtimeUse(request)).status, "ready");
  const rollback = await facade.runtimeUse({
    ...request,
    requestId: "managed-rollback",
    access: "read",
    manifest: oldAccess.manifest,
  });
  assert.equal(rollback.status, "ready", JSON.stringify(rollback.blockers));
  assert.equal(facade.initialize().status, "blocked");
  const restored = await facade.runtimeUse({ ...request, requestId: "managed-restore" });
  assert.equal(restored.status, "ready", JSON.stringify(restored.blockers));
  assert.equal(facade.initialize().status, "ready");
  assert.deepEqual((await pruneRuntimeComponents(older.manifest, { cacheDir: cache })).removed, []);
  assert.equal(inspectRuntimeComponents(current.manifest, { cacheDir: cache }).status, "ready");
  assert.equal(inspectRuntimeComponents(older.manifest, { cacheDir: cache }).status, "ready");

  const alias = path.join(root, "managed-cache-alias");
  fs.symlinkSync(cache, alias, process.platform === "win32" ? "junction" : "dir");
  const aliased = await api
    .createFoundryFacade({
      ...options,
      runtimeManager: { ...manager, cacheDir: alias },
    })
    .runtimeUse({ ...request, requestId: "cache-alias" });
  assert.equal(aliased.status, "ready", JSON.stringify(aliased.blockers));

  const selectionPath = path.join(options.workspace, ".foundry/state/runtime-selection.json");
  const selectionBytes = fs.readFileSync(selectionPath);
  for (const [index, badCache] of [
    options.workspace,
    path.join(options.workspace, "cache"),
    packageRoot,
    path.join(packageRoot, "cache"),
    path.dirname(cache),
  ].entries()) {
    const result = await api
      .createFoundryFacade({ ...options, runtimeManager: { ...manager, cacheDir: badCache } })
      .runtimeUse({ ...request, requestId: `invalid-cache-${index}` });
    assert.equal(result.status, "failed", badCache);
    assert.equal(result.blockers[0].code, "runtime_cache_boundary", badCache);
  }
  const foreign = trusted({
    ...current.manifest.manifest,
    components: older.manifest.manifest.components,
    launches: older.manifest.manifest.launches,
  });
  const foreignAccess = access(foreign, "write");
  const foreignResult = await api
    .createFoundryFacade({ ...options, workspaceAccess: foreignAccess })
    .runtimeUse({ ...request, requestId: "foreign-owner", manifest: foreignAccess.manifest });
  assert.equal(foreignResult.status, "failed");
  assert.equal(foreignResult.blockers[0].code, "runtime_cache_boundary");

  const metadata = path.join(installed.components[0].root, "fixture-lock.json");
  const original = fs.readFileSync(metadata);
  try {
    fs.writeFileSync(metadata, "changed\n");
    const corrupt = await facade.runtimeUse({ ...request, requestId: "corrupt-owner" });
    assert.equal(corrupt.status, "failed");
    assert.equal(corrupt.blockers[0].code, "runtime_cache_boundary");
    assert.equal(fs.readFileSync(metadata, "utf8"), "changed\n");
    fs.rmSync(metadata);
    const missing = await facade.runtimeUse({ ...request, requestId: "missing-owner" });
    assert.equal(missing.status, "failed");
    assert.equal(missing.blockers[0].code, "runtime_cache_boundary");
    assert.equal(fs.existsSync(metadata), false);
  } finally {
    fs.writeFileSync(metadata, original);
  }
  assert.deepEqual(fs.readFileSync(marker), markerBytes);
  assert.deepEqual(fs.readFileSync(selectionPath), selectionBytes);
  assert.equal(networkCalls, 0);
}
