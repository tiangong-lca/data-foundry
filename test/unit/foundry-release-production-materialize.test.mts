import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { FoundryProductionLock } from "../../scripts/lib/foundry-release-production.ts";
import { createFoundryProductionFixture as fixture } from "../fixtures/foundry-release-production.ts";
import { materializeFoundryProductionPackages } from "../../scripts/lib/foundry-release-production-materialize.ts";

test("materialization downloads exact locked bytes and records every installed dependency file", async () => {
  const f = fixture();
  try {
    const calls: string[] = [];
    const output = path.join(f.root, "output");
    const result = await materializeFoundryProductionPackages(f.lock, output, async (url, init) => {
      calls.push(url);
      assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).has("authorization"), false);
      const pkg = f.lock.packages.find((item) => item.download_url === url);
      assert(pkg);
      return new Response(f.tarballs.get(pkg.name));
    });
    assert.equal(calls.length, 2);
    assert.equal(result.packages.length, 2);
    assert.equal(result.files.length, 4);
    assert(result.files.every((item) => item.path.startsWith("node_modules/")));
    assert.equal(
      fs.readFileSync(path.join(output, "node_modules/fixture-b/LICENSE"), "utf8"),
      "Fixture-only license text\n",
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("an absent optional peer stays absent and is checked against the frozen declaration", async () => {
  const f = fixture(false, true);
  try {
    const result = await materializeFoundryProductionPackages(
      f.lock,
      path.join(f.root, "output"),
      async (url) => {
        const pkg = f.lock.packages.find((item) => item.download_url === url)!;
        return new Response(f.tarballs.get(pkg.name));
      },
    );
    assert.equal(result.packages.length, 2);
    assert.equal(fs.existsSync(path.join(result.root, "node_modules/fixture-optional")), false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("corrupt package bytes and inconsistent manifests are rejected without retaining a partial tree", async () => {
  for (const wrongManifest of [false, true]) {
    const f = fixture(wrongManifest);
    try {
      const output = path.join(f.root, "output");
      await assert.rejects(
        materializeFoundryProductionPackages(f.lock, output, async (url) => {
          const pkg = f.lock.packages.find((item) => item.download_url === url)!;
          return new Response(
            wrongManifest ? f.tarballs.get(pkg.name) : Buffer.from("corrupt bytes"),
          );
        }),
        /integrity|dependencies/u,
      );
      assert.equal(fs.existsSync(output), false);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test("serialized locks and existing output directories never start a download", async () => {
  const f = fixture();
  try {
    let calls = 0;
    const download = async () => {
      calls++;
      return new Response("unexpected");
    };
    const restored = JSON.parse(JSON.stringify(f.lock)) as FoundryProductionLock;
    await assert.rejects(
      materializeFoundryProductionPackages(restored, path.join(f.root, "output"), download),
      /owning lock/u,
    );
    await assert.rejects(materializeFoundryProductionPackages(f.lock, f.root, download), /exist/u);
    assert.equal(calls, 0);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
