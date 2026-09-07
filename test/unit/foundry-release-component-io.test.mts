import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ComponentFile, RuntimePlatform } from "@tiangong-lca/cli/runtime";
import {
  assertFoundryComponentFiles,
  copyFoundryComponentPayload,
  writeFoundryComponentFile,
} from "../../scripts/lib/foundry-release-component-io.ts";
import { assertPreparedFoundryProductionInput } from "../../scripts/release-prepare-production.ts";
import { assertPreparedFoundryNativeInput } from "../../scripts/release-prepare-native.ts";

const platform = `${process.platform}-${process.arch}` as RuntimePlatform;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-component-io-"));
  const source = path.join(root, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "entry"), "entry\n", { mode: 0o755 });
  fs.chmodSync(path.join(source, "entry"), 0o755);
  const files: ComponentFile[] = [
    { path: "entry", bytes: 6, sha256: hash("entry\n"), mode: 0o755 },
  ];
  return { root, source, files, target: path.join(root, "target") };
}

test("component staging retains complete declared bytes/modes and exact metadata inventory", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  copyFoundryComponentPayload(f.source, f.files, f.target, platform);
  const metadata = writeFoundryComponentFile(f.target, "metadata/source.json", Buffer.from("{}\n"));
  assert.equal(metadata.path, "metadata/source.json");
  assert.equal(metadata.sha256, hash("{}\n"));
  assertFoundryComponentFiles(f.target, [...f.files, metadata], platform);
  assert.equal(fs.readFileSync(path.join(f.target, "entry"), "utf8"), "entry\n");
  assert.throws(() => writeFoundryComponentFile(f.target, "../escaped", Buffer.from("bad")));
  assert.throws(() =>
    writeFoundryComponentFile(f.target, "metadata/source.json", Buffer.from("changed")),
  );
  assert.equal(fs.readFileSync(path.join(f.target, metadata.path), "utf8"), "{}\n");
});

test("native component splitting selects only declared files after checking the complete source", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const metadata = writeFoundryComponentFile(f.source, "metadata/input.json", Buffer.from("{}\n"));
  copyFoundryComponentPayload(f.source, [...f.files, metadata], f.target, platform, ["entry"]);
  assertFoundryComponentFiles(f.target, f.files, platform);
  assert.equal(fs.existsSync(path.join(f.target, "metadata")), false);
  assert.throws(() =>
    copyFoundryComponentPayload(
      f.source,
      [...f.files, metadata],
      path.join(f.root, "bad"),
      platform,
      ["missing"],
    ),
  );
});

test("serialized preparation receipts cannot supply runtime assembly authority", () => {
  const copied = { status: "prepared", source: { commit: "a".repeat(40) }, files: [] };
  assert.throws(() => assertPreparedFoundryProductionInput(copied), /freshly prepared/u);
  assert.throws(() => assertPreparedFoundryNativeInput(copied), /freshly prepared/u);
});

test("unknown, changed or linked input files cannot enter a component or replace a destination", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.source, "extra"), "unlisted");
  assert.throws(() => copyFoundryComponentPayload(f.source, f.files, f.target, platform));
  assert.equal(fs.existsSync(f.target), false);
  fs.rmSync(path.join(f.source, "extra"));
  fs.writeFileSync(path.join(f.source, "entry"), "changed\n");
  assert.throws(() => copyFoundryComponentPayload(f.source, f.files, f.target, platform));
  assert.equal(fs.existsSync(f.target), false);
  fs.writeFileSync(path.join(f.source, "entry"), "entry\n");
  fs.chmodSync(path.join(f.source, "entry"), 0o755);
  fs.mkdirSync(f.target);
  fs.writeFileSync(path.join(f.target, "owner"), "retained");
  assert.throws(() => copyFoundryComponentPayload(f.source, f.files, f.target, platform));
  assert.equal(fs.readFileSync(path.join(f.target, "owner"), "utf8"), "retained");
  const linked = path.join(f.root, "linked");
  fs.symlinkSync(f.source, linked, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => assertFoundryComponentFiles(linked, f.files, platform));
});
