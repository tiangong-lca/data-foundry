import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createGitHubFoundryAssetStore,
  publishFoundryReleaseAssets,
  type FoundryAssetRelease,
  type FoundryAssetStore,
} from "../../scripts/lib/foundry-release-assets.ts";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const request = {
  version: "0.1.1",
  kind: "components" as const,
  sourceCommit: "a".repeat(40),
  assets: [
    { name: "node-24.19.0-linux-x64.tar.gz", bytes: Buffer.from("qualified archive") },
    { name: "runtime-candidate.json", bytes: Buffer.from("qualified candidate") },
  ],
};
function memoryStore(lost: string | null = null) {
  let state: FoundryAssetRelease | null = null;
  const calls: string[] = [];
  const store: FoundryAssetStore = {
    read: async () => state && structuredClone(state),
    createDraft: async (tag, sourceCommit) => {
      calls.push("create");
      state = { id: 1, tag, sourceCommit, draft: true, assets: [] };
      if (lost === "create") throw Error("lost response");
    },
    upload: async (id, asset) => {
      assert.equal(id, 1);
      calls.push(`upload:${asset.name}`);
      state!.assets.push({ name: asset.name, bytes: asset.bytes.length, sha256: sha(asset.bytes) });
      if (lost === "upload") throw Error("lost response");
    },
    publish: async (id) => {
      assert.equal(id, 1);
      calls.push("publish");
      state!.draft = false;
      if (lost === "publish") throw Error("lost response");
    },
  };
  return {
    store,
    calls,
    read: () => state,
    set: (next: FoundryAssetRelease) => {
      state = next;
    },
  };
}

test("release publication creates a draft, retains exact assets and never repeats published writes", async () => {
  const f = memoryStore();
  const first = await publishFoundryReleaseAssets(request, f.store);
  assert.equal(first.release.tag, "foundry-v0.1.1");
  assert.equal(first.release.draft, false);
  assert.deepEqual(f.calls, [
    "create",
    "upload:node-24.19.0-linux-x64.tar.gz",
    "upload:runtime-candidate.json",
    "publish",
  ]);
  await publishFoundryReleaseAssets(request, f.store);
  assert.equal(f.calls.length, 4);
});

test("lost responses reconcile only by reading the exact resulting state", async () => {
  for (const lost of ["create", "upload", "publish"]) {
    const f = memoryStore(lost);
    const result = await publishFoundryReleaseAssets(request, f.store);
    assert.equal(result.release.draft, false);
    assert.equal(f.calls.filter((x) => x === "create").length, 1);
    assert.equal(f.calls.filter((x) => x === "publish").length, 1);
    assert.equal(f.calls.filter((x) => x.startsWith("upload:")).length, 2);
  }
});

test("foreign source, altered assets and unlisted files never reach a release mutation", async () => {
  for (const kind of ["source", "changed", "extra", "published-missing"]) {
    const f = memoryStore();
    const state: FoundryAssetRelease = {
      id: 1,
      tag: "foundry-v0.1.1",
      sourceCommit: request.sourceCommit,
      draft: true,
      assets: [],
    };
    if (kind === "source") state.sourceCommit = "b".repeat(40);
    if (kind === "changed")
      state.assets = [{ name: request.assets[0].name, bytes: 1, sha256: sha(Buffer.from("x")) }];
    if (kind === "extra")
      state.assets = [{ name: "unreviewed", bytes: 1, sha256: sha(Buffer.from("x")) }];
    if (kind === "published-missing") state.draft = false;
    f.set(state);
    await assert.rejects(publishFoundryReleaseAssets(request, f.store));
    assert.deepEqual(f.calls, []);
  }
});

test("incomplete mutation readback stops without replaying upload or publishing", async () => {
  const f = memoryStore();
  f.store.upload = async () => {
    f.calls.push("failed-upload");
    throw Error("unknown upload outcome");
  };
  await assert.rejects(publishFoundryReleaseAssets(request, f.store), /unconfirmed/u);
  assert.deepEqual(f.calls, ["create", "failed-upload"]);
});

test("manifest publication derives a separate immutable tag and rejects unsafe file names", async () => {
  const f = memoryStore();
  const result = await publishFoundryReleaseAssets({ ...request, kind: "manifest" }, f.store);
  assert.equal(result.release.tag, "foundry-runtime-v0.1.1");
  await assert.rejects(
    publishFoundryReleaseAssets(
      { ...request, assets: [{ name: "../escape", bytes: Buffer.from("x") }] },
      memoryStore().store,
    ),
  );
});

test("GitHub release transport discovers drafts and then binds every read to the exact id", async () => {
  const calls: { url: string; method: string | undefined }[] = [];
  const draft = {
    id: 42,
    tag_name: "foundry-v0.1.1",
    target_commitish: "main",
    draft: true,
    prerelease: false,
    assets: [],
  };
  const store = createGitHubFoundryAssetStore("test-only-token", async (url, init) => {
    calls.push({ url, method: init.method });
    assert.equal(init.redirect, "error");
    if (url.endsWith("/releases/tags/foundry-v0.1.1")) return new Response(null, { status: 404 });
    if (url.endsWith("/releases?per_page=100&page=1")) return Response.json([draft]);
    if (url.endsWith("/git/ref/tags/foundry-v0.1.1"))
      return Response.json({
        ref: "refs/tags/foundry-v0.1.1",
        object: { type: "commit", sha: request.sourceCommit },
      });
    assert.ok(url.endsWith("/releases/42"));
    return Response.json(draft);
  });
  assert.equal((await store.read("foundry-v0.1.1"))?.sourceCommit, request.sourceCommit);
  await store.read("foundry-v0.1.1");
  assert.equal(calls.filter((call) => call.url.includes("?per_page")).length, 1);
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("incomplete or ambiguous draft lookup cannot authorize a second release", async () => {
  for (const ambiguous of [false, true]) {
    let calls = 0;
    const store = createGitHubFoundryAssetStore("test-only-token", async (url, init) => {
      calls++;
      assert.equal(init.method, "GET");
      if (url.includes("/releases/tags/")) return new Response(null, { status: 404 });
      return Response.json(
        ambiguous
          ? [{ tag_name: "foundry-v0.1.1" }, { tag_name: "foundry-v0.1.1" }]
          : Array.from({ length: 100 }, () => ({ tag_name: "other" })),
      );
    });
    await assert.rejects(store.read("foundry-v0.1.1"), /ambiguous|page bound/u);
    assert.equal(calls, ambiguous ? 2 : 11);
  }
});

test("draft lookup follows reported pagination even when a page contains fewer than100 releases", async () => {
  let pages = 0;
  const store = createGitHubFoundryAssetStore("test-only-token", async (url) => {
    if (url.includes("/releases/tags/")) return new Response(null, { status: 404 });
    pages++;
    if (pages === 1)
      return Response.json([], {
        headers: {
          link: '<https://api.github.com/repos/tiangong-lca/data-foundry/releases?per_page=100&page=2>; rel="next"',
        },
      });
    return Response.json([{ tag_name: "foundry-v0.1.1" }, { tag_name: "foundry-v0.1.1" }]);
  });
  await assert.rejects(store.read("foundry-v0.1.1"), /ambiguous/u);
  assert.equal(pages, 2);
});

test("GitHub transport uploads exact bytes only to canonical endpoints and publishes after readback", async () => {
  const draft: {
    id: number;
    tag_name: string;
    draft: boolean;
    prerelease: boolean;
    assets: { name: string; state: string; size: number; digest: string }[];
    upload_url: string;
  } = {
    id: 7,
    tag_name: "foundry-v0.1.1",
    draft: true,
    prerelease: false,
    assets: [],
    upload_url: "https://untrusted.example/upload",
  };
  let created = false;
  const writes: string[] = [];
  const store = createGitHubFoundryAssetStore("test-only-token", async (url, init) => {
    const selected = new URL(url);
    assert.ok(["api.github.com", "uploads.github.com"].includes(selected.hostname));
    assert.equal((init.headers as Record<string, string>).authorization, "Bearer test-only-token");
    assert.equal(init.redirect, "error");
    if (url.includes("/git/ref/"))
      return Response.json({
        ref: "refs/tags/foundry-v0.1.1",
        object: { type: "commit", sha: request.sourceCommit },
      });
    if (init.method === "GET") {
      if (url.endsWith("/releases?per_page=100&page=1")) return Response.json([]);
      return created ? Response.json(draft) : new Response(null, { status: 404 });
    }
    writes.push(`${init.method} ${selected.hostname}${selected.pathname}`);
    if (selected.hostname === "uploads.github.com") {
      const name = selected.searchParams.get("name")!;
      const bytes = Buffer.from(init.body as Uint8Array);
      assert.deepEqual(bytes, request.assets.find((asset) => asset.name === name)?.bytes);
      draft.assets.push({
        name,
        state: "uploaded",
        size: bytes.length,
        digest: `sha256:${sha(bytes)}`,
      });
      return Response.json(draft.assets.at(-1), { status: 201 });
    }
    const body = JSON.parse(String(init.body));
    if (init.method === "POST") {
      assert.equal(body.draft, true);
      assert.equal(body.target_commitish, request.sourceCommit);
      created = true;
      return Response.json(draft, { status: 201 });
    }
    assert.deepEqual(body, { draft: false, make_latest: "false" });
    draft.draft = false;
    return Response.json(draft);
  });
  const result = await publishFoundryReleaseAssets(request, store);
  assert.equal(result.release.draft, false);
  assert.equal(writes.length, 4);
  assert.equal(writes.filter((value) => value.startsWith("POST uploads.github.com")).length, 2);
});
