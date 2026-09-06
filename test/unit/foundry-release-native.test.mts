import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { create } from "tar";
import { zipSync } from "fflate";
import {
  selectFoundryNativeFiles,
  fetchFoundryNativeBytes,
} from "../../scripts/lib/foundry-release-native.ts";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("native ZIP and raw inputs return only exact selected bytes after checksum verification", () => {
  const zipped = Buffer.from(
    zipSync({
      "release/bin/tool.exe": Buffer.from("binary fixture"),
      "release/LICENSE": Buffer.from("license fixture"),
      "release/unused": Buffer.from("not selected"),
    }),
  );
  const result = selectFoundryNativeFiles(zipped, {
    format: "zip",
    sha256: digest(zipped),
    files: ["release/bin/tool.exe", "release/LICENSE"],
  });
  assert.equal(result.size, 2);
  assert.equal(result.get("release/bin/tool.exe")?.toString(), "binary fixture");
  assert.throws(
    () =>
      selectFoundryNativeFiles(zipped, {
        format: "zip",
        sha256: "0".repeat(64),
        files: ["release/LICENSE"],
      }),
    /checksum/u,
  );
  assert.throws(
    () =>
      selectFoundryNativeFiles(zipped, {
        format: "zip",
        sha256: digest(zipped),
        files: ["release/missing"],
      }),
    /missing/u,
  );
  const raw = Buffer.from("raw fixture");
  assert.equal(
    selectFoundryNativeFiles(raw, { format: "file", sha256: digest(raw), files: ["tool.exe"] })
      .get("tool.exe")
      ?.toString(),
    "raw fixture",
  );
});

test("native tar selection ignores unrelated tools but rejects selected links and duplicate names", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-native-tar-"));
  try {
    fs.mkdirSync(path.join(root, "release/bin"), { recursive: true });
    fs.writeFileSync(path.join(root, "release/bin/tool"), "binary fixture");
    fs.symlinkSync("tool", path.join(root, "release/bin/unused"));
    const archive = path.join(root, "native.tgz");
    create({ cwd: root, file: archive, gzip: true, sync: true }, [
      "release/bin/tool",
      "release/bin/unused",
    ]);
    let bytes = fs.readFileSync(archive);
    assert.equal(
      selectFoundryNativeFiles(bytes, {
        format: "tar-gzip",
        sha256: digest(bytes),
        files: ["release/bin/tool"],
      }).size,
      1,
    );
    assert.throws(
      () =>
        selectFoundryNativeFiles(bytes, {
          format: "tar-gzip",
          sha256: digest(bytes),
          files: ["release/bin/unused"],
        }),
      /regular/u,
    );
    create({ cwd: root, file: archive, gzip: true, sync: true }, [
      "release/bin/tool",
      "release/bin/tool",
    ]);
    bytes = fs.readFileSync(archive);
    assert.throws(
      () =>
        selectFoundryNativeFiles(bytes, {
          format: "tar-gzip",
          sha256: digest(bytes),
          files: ["release/bin/tool"],
        }),
      /duplicate/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native downloads follow only the expected HTTPS artifact hosts without forwarding credentials", async () => {
  const bytes = Buffer.from("native fixture");
  const calls: string[] = [];
  const result = await fetchFoundryNativeBytes(
    "https://github.com/tiangong-lca/tidas-tools/releases/download/v0.2.1/fixture.tar.gz",
    digest(bytes),
    async (url, init) => {
      calls.push(url);
      assert.equal(init.redirect, "manual");
      assert.equal(new Headers(init.headers).has("authorization"), false);
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://release-assets.githubusercontent.com/fixture" },
          })
        : new Response(bytes);
    },
  );
  assert.deepEqual(result, bytes);
  assert.equal(calls.length, 2);
  await assert.rejects(
    fetchFoundryNativeBytes(
      "https://nodejs.org/dist/v24.19.0/fixture",
      digest(bytes),
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://elsewhere.invalid/fixture" },
        }),
    ),
    /host/u,
  );
});
