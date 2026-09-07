import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { create } from "tar";
import { extractFoundryNpmTarball } from "../../scripts/lib/foundry-release-extract.ts";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-npm-extract-"));
  fs.mkdirSync(path.join(root, "package"));
  fs.writeFileSync(
    path.join(root, "package/package.json"),
    '{"name":"fixture","version":"1.0.0"}\n',
  );
  fs.writeFileSync(path.join(root, "package/LICENSE"), "Fixture license text\n");
  fs.writeFileSync(path.join(root, "package/empty"), "");
  return {
    root,
    archive: (files: string[]) => {
      const file = path.join(root, "fixture.tgz");
      create({ cwd: root, file, gzip: true, sync: true, portable: true }, files);
      return fs.readFileSync(file);
    },
  };
}

test("regular npm payloads extract exactly, including empty files, into a new owned root", () => {
  const f = fixture();
  try {
    const output = path.join(f.root, "output");
    const bytes = f.archive(["package/package.json", "package/LICENSE", "package/empty"]);
    const result = extractFoundryNpmTarball(bytes, output);
    assert.equal(result.files.length, 3);
    assert.equal(fs.readFileSync(path.join(output, "LICENSE"), "utf8"), "Fixture license text\n");
    assert.equal(fs.statSync(path.join(output, "empty")).size, 0);
    assert.throws(() => extractFoundryNpmTarball(bytes, output), /exist/u);
    assert.equal(fs.readFileSync(path.join(output, "LICENSE"), "utf8"), "Fixture license text\n");
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("links and colliding archive names fail before any payload is published", () => {
  const f = fixture();
  try {
    const output = path.join(f.root, "output");
    fs.symlinkSync("LICENSE", path.join(f.root, "package/link"));
    assert.throws(
      () => extractFoundryNpmTarball(f.archive(["package/package.json", "package/link"]), output),
      /regular/u,
    );
    assert.equal(fs.existsSync(output), false);
    assert.throws(
      () =>
        extractFoundryNpmTarball(
          f.archive(["package/package.json", "package/LICENSE", "package/LICENSE"]),
          output,
        ),
      /duplicate/u,
    );
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("out-of-prefix, incomplete and corrupt payloads cannot become npm package roots", () => {
  const f = fixture();
  try {
    const output = path.join(f.root, "output");
    fs.writeFileSync(path.join(f.root, "outside"), "unbound payload");
    assert.throws(
      () => extractFoundryNpmTarball(f.archive(["package/package.json", "outside"]), output),
      /path/u,
    );
    assert.throws(
      () => extractFoundryNpmTarball(f.archive(["package/LICENSE"]), output),
      /manifest/u,
    );
    assert.throws(
      () => extractFoundryNpmTarball(Buffer.from("not an archive"), output),
      /archive/u,
    );
    const valid = f.archive(["package/package.json", "package/LICENSE"]);
    assert.throws(() => extractFoundryNpmTarball(valid.subarray(0, valid.length - 14), output));
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
