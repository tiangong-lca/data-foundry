import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  trustRuntimeManifest,
  writeRuntimeComponentArchive,
  inspectRuntimeComponents,
  pruneRuntimeComponents,
  type RuntimeManifest,
} from "@tiangong-lca/cli/runtime";
import {
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";
import {
  leaseFoundryRuntime,
  selectFoundryWorkspaceRuntime,
} from "../../scripts/lib/foundry-runtime-selection.ts";
import { createFoundryFacade } from "../../scripts/public-api.ts";
import { workspaceManifestFixture } from "../helpers/foundry-runtime-manifest.mts";

const moduleUrl = new URL("../../scripts/public-api.ts", import.meta.url).href;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

test("managed cache ownership never admits source or developer-emitted roots or excluded migration roots", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cache-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = workspaceManifestFixture({ write: ["registered-tasks-v2"] });
  const options = {
    moduleUrl,
    workspace: path.join(root, "project"),
    cacheBase: path.join(root, "work-cache"),
    workspaceAccess: { manifest, access: "write" as const },
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const source = createFoundryRuntimeContext(options);
  const boundary = (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "runtime_cache_boundary";
  const offline = async () => {
    throw new Error("Rejected cache must not download components.");
  };
  for (const cacheDir of [
    source.runtimeRoot,
    path.dirname(source.runtimeRoot),
    path.join(source.runtimeRoot, "components"),
  ])
    await assert.rejects(
      leaseFoundryRuntime(source, manifest, source.workspaceId!, { cacheDir, fetchImpl: offline }),
      boundary,
    );

  const developerCache = path.join(root, "developer-cache");
  const checkout = path.join(developerCache, "checkout");
  const entry = path.join(checkout, "dist/scripts/foundry.js");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "// Developer-emitted fixture, not an installed package.\n");
  fs.writeFileSync(
    path.join(checkout, "package.json"),
    JSON.stringify({
      name: "@tiangong-lca/foundry",
      version: manifest.manifest.product.version,
      foundryRuntime: {
        schema: "tiangong-foundry.runtime-layout.v1",
        asset_root: ".",
        source_entry: "scripts/foundry.ts",
        emitted_entry: "dist/scripts/foundry.js",
      },
    }),
  );
  const emitted = createFoundryRuntimeContext({ ...options, moduleUrl: pathToFileURL(entry).href });
  assert.equal(emitted.runtime.mode, "emitted");
  await assert.rejects(
    leaseFoundryRuntime(emitted, manifest, emitted.workspaceId!, {
      cacheDir: developerCache,
      fetchImpl: offline,
    }),
    boundary,
  );
  const cacheDir = path.join(root, "migration-cache");
  if (process.platform === "win32") {
    const absentDrive = [..."ZYXWVUTSRQPONMLKJIHGFE"].find(
      (drive) => !fs.existsSync(`${drive}:\\`),
    );
    if (absentDrive)
      await assert.rejects(
        leaseFoundryRuntime(source, manifest, source.workspaceId!, {
          cacheDir: `${absentDrive}:\\components`,
          fetchImpl: offline,
        }),
        boundary,
      );
  }
  await assert.rejects(
    leaseFoundryRuntime(source, manifest, source.workspaceId!, { cacheDir, fetchImpl: offline }, [
      path.join(cacheDir, "source"),
    ]),
    boundary,
  );
  await assert.rejects(
    leaseFoundryRuntime(source, manifest, source.workspaceId!, { cacheDir, fetchImpl: offline }, [
      cacheDir,
    ]),
    boundary,
  );
  assert.equal(fs.existsSync(cacheDir), false);
});

async function component(root: string, version: string, writable: boolean) {
  const source = path.join(root, version);
  fs.mkdirSync(source);
  const manifest = JSON.parse(
    JSON.stringify(
      workspaceManifestFixture({ version, write: writable ? ["registered-tasks-v2"] : undefined })
        .manifest,
    ),
  ) as RuntimeManifest;
  const data = manifest.components[0];
  const files = data.files.map((file) => {
    const bytes = Buffer.from(`${version}:${file.path}\n`);
    const target = path.join(source, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    fs.chmodSync(target, file.mode);
    return { ...file, bytes: bytes.length, sha256: hash(bytes) };
  });
  const archive = path.join(root, `${version}.tar.gz`);
  const archiveFact = await writeRuntimeComponentArchive(source, files, archive);
  const value = {
    ...manifest,
    components: [
      {
        ...data,
        version,
        files,
        content_sha256: hash(JSON.stringify(files)),
        archive: { ...data.archive, ...archiveFact },
      },
    ],
  };
  const bytes = Buffer.from(JSON.stringify(value));
  return { manifest: trustRuntimeManifest(bytes, hash(bytes)), archive };
}

test("runtime rollback preserves both component leases and cannot convert read compatibility into task writes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-runtime-switch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = await component(root, workspaceManifestFixture().manifest.product.version, true),
    older = await component(root, "0.0.9", false);
  const cache = path.join(root, "components");
  const seeds = Object.fromEntries(
    [current, older].map((item) => [
      inspectRuntimeComponents(item.manifest, { cacheDir: cache }).components[0].key,
      item.archive,
    ]),
  );
  const manager = {
    cacheDir: cache,
    archiveSeeds: seeds,
    fetchImpl: async () => {
      throw new Error("network must not be used");
    },
  };
  const options = {
    moduleUrl,
    workspace: path.join(root, "project"),
    cacheBase: path.join(root, "cache"),
    workspaceAccess: { manifest: current.manifest, access: "write" as const },
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const context = createFoundryRuntimeContext(options);
  const marker = fs.readFileSync(path.join(context.controlRoot, "workspace.json"));
  const result = await selectFoundryWorkspaceRuntime(context, current.manifest, older.manifest, {
    requestId: "rollback",
    actorId: "actor",
    access: "read",
    manager,
  });
  assert.equal(result.record.access, "read");
  const validate = new Ajv2020({ strict: true }).compile(
    JSON.parse(
      fs.readFileSync(
        new URL("../../specs/schemas/foundry-runtime-selection.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  assert.equal(validate(result.record), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...result.record, access: "force-write" }), false);
  assert.equal(createFoundryFacade(options).initialize().status, "blocked");
  const reader = createFoundryFacade({
    ...options,
    workspaceAccess: { manifest: older.manifest, access: "read" },
  });
  assert.equal(reader.doctor().status, "ready");
  assert.equal(reader.initialize().status, "blocked");
  await assert.rejects(
    selectFoundryWorkspaceRuntime(context, current.manifest, older.manifest, {
      requestId: "unsafe-downgrade",
      actorId: "actor",
      access: "write",
      manager,
    }),
    /does not qualify/u,
  );
  assert.deepEqual(
    await selectFoundryWorkspaceRuntime(context, current.manifest, older.manifest, {
      requestId: "rollback",
      actorId: "actor",
      access: "read",
      manager,
    }),
    result,
  );
  const pruned = await pruneRuntimeComponents(older.manifest, { cacheDir: cache });
  assert.deepEqual(pruned.removed, []);
  assert.equal(inspectRuntimeComponents(current.manifest, { cacheDir: cache }).status, "ready");
  const restored = await selectFoundryWorkspaceRuntime(
    context,
    current.manifest,
    current.manifest,
    { requestId: "restore", actorId: "actor", access: "write", manager },
  );
  assert.equal(restored.record.access, "write");
  assert.equal(createFoundryFacade(options).initialize().status, "ready");
  assert.deepEqual(fs.readFileSync(path.join(context.controlRoot, "workspace.json")), marker);
});
