import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { selectFoundryWorkspaceRuntime } from "../../scripts/lib/foundry-runtime-selection.ts";
import { createFoundryFacade } from "../../scripts/public-api.ts";
import { workspaceManifestFixture } from "../helpers/foundry-runtime-manifest.mts";

const moduleUrl = new URL("../../scripts/public-api.ts", import.meta.url).href;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
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
  const current = await component(root, "0.1.0", true),
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
