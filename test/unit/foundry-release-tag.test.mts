import assert from "node:assert/strict";
import test from "node:test";
import {
  createGitHubFoundryTagStore,
  ensureFoundryReleaseTag,
  type FoundryReleaseTagStore,
} from "../../scripts/lib/foundry-release-tag.ts";

const head = "a".repeat(40);
const request = { version: "0.1.9", head };
const ref = "refs/tags/foundry-v0.1.9";

test("tag creation derives one immutable ref and reuses only the same source commit", async () => {
  let value: { ref: string; head: string } | null = null;
  const writes: { ref: string; head: string }[] = [];
  const store: FoundryReleaseTagStore = {
    read: async (name) => {
      assert.equal(name, ref);
      return value;
    },
    create: async (name, sha) => {
      value = { ref: name, head: sha };
      writes.push(value);
      return value;
    },
  };
  assert.deepEqual(await ensureFoundryReleaseTag(request, store), { status: "created", ref, head });
  assert.deepEqual(await ensureFoundryReleaseTag(request, store), {
    status: "existing",
    ref,
    head,
  });
  assert.deepEqual(writes, [{ ref, head }]);
});

test("a different existing tag target can never be changed by the release helper", async () => {
  let writes = 0;
  const store: FoundryReleaseTagStore = {
    read: async () => ({ ref, head: "b".repeat(40) }),
    create: async () => {
      writes++;
      throw new Error("must not write");
    },
  };
  await assert.rejects(ensureFoundryReleaseTag(request, store), /different.*commit/iu);
  assert.equal(writes, 0);
});

test("the runtime manifest gets a distinct exact-source tag without broadening arbitrary ref access", async () => {
  const runtimeRef = "refs/tags/foundry-runtime-v0.1.9";
  const result = await ensureFoundryReleaseTag(
    { ...request, kind: "manifest" },
    {
      read: async (name) => {
        assert.equal(name, runtimeRef);
        return null;
      },
      create: async (name, sha) => ({ ref: name, head: sha }),
    },
  );
  assert.equal(result.ref, runtimeRef);
  const store = createGitHubFoundryTagStore("test-only-token", async (url) => {
    assert.ok(url.endsWith("git/ref/tags/foundry-runtime-v0.1.9"));
    return Response.json({ ref: runtimeRef, object: { type: "commit", sha: head } });
  });
  assert.deepEqual(await store.read(runtimeRef), { ref: runtimeRef, head });
  await assert.rejects(store.read("refs/tags/other-v0.1.1"), /identity/u);
});

test("lost tag-creation responses reconcile by readback without a second mutation", async () => {
  let reads = 0,
    writes = 0;
  const store: FoundryReleaseTagStore = {
    read: async () => (++reads === 1 ? null : { ref, head }),
    create: async () => {
      writes++;
      throw new Error("lost response");
    },
  };
  assert.deepEqual(await ensureFoundryReleaseTag(request, store), {
    status: "reconciled",
    ref,
    head,
  });
  assert.equal(writes, 1);
  assert.equal(reads, 2);
});

test("unconfirmed or conflicting creation stays failed and never replays the write", async () => {
  for (const observed of [null, { ref, head: "b".repeat(40) }]) {
    let reads = 0,
      writes = 0;
    const store: FoundryReleaseTagStore = {
      read: async () => (++reads === 1 ? null : observed),
      create: async () => {
        writes++;
        throw new Error("lost response");
      },
    };
    await assert.rejects(ensureFoundryReleaseTag(request, store), /tag/iu);
    assert.equal(writes, 1);
  }
});

test("invalid versions, commits and response identities fail before success", async () => {
  const store: FoundryReleaseTagStore = {
    read: async () => {
      throw new Error("unexpected lookup");
    },
    create: async () => {
      throw new Error("unexpected mutation");
    },
  };
  for (const invalid of [
    { ...request, version: "latest" },
    { ...request, version: "01.1.1" },
    { ...request, head: "HEAD" },
  ])
    await assert.rejects(ensureFoundryReleaseTag(invalid, store), /version|commit/iu);
  await assert.rejects(
    ensureFoundryReleaseTag(request, {
      read: async () => ({ ref: "refs/tags/foundry-v0.1.0", head }),
      create: (name, sha) => store.create(name, sha),
    }),
    /tag.*identity/iu,
  );
  await assert.rejects(
    ensureFoundryReleaseTag(request, {
      read: async () => null,
      create: async () => ({ ref, head: "b".repeat(40) }),
    }),
    /different.*commit/iu,
  );
});

test("publication floor rejects legacy versions on creation but keeps historical tags verifiable", async () => {
  let writes = 0;
  const store: FoundryReleaseTagStore = {
    read: async () => null,
    create: async () => {
      writes++;
      throw new Error("must not write legacy versions");
    },
  };
  await assert.rejects(
    ensureFoundryReleaseTag({ version: "0.1.8", head }, store),
    /publication floor/iu,
  );
  await assert.rejects(
    ensureFoundryReleaseTag({ version: "0.0.33", head }, store),
    /publication floor/iu,
  );
  assert.equal(writes, 0);
  // An already-existing historical tag stays verifiable through the same helper.
  const historical: FoundryReleaseTagStore = {
    read: async (name) => (name === "refs/tags/foundry-v0.1.8" ? { ref: name, head } : null),
    create: async () => {
      throw new Error("must not write");
    },
  };
  assert.deepEqual(await ensureFoundryReleaseTag({ version: "0.1.8", head }, historical), {
    status: "existing",
    ref: "refs/tags/foundry-v0.1.8",
    head,
  });
});

test("GitHub tag transport peels bounded annotations and creates only exact tag refs", async () => {
  const annotation = "b".repeat(40);
  const calls: { url: string; init: RequestInit }[] = [];
  const store = createGitHubFoundryTagStore("unit-test-token", async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.redirect, "error");
    if (url.endsWith(`git/ref/tags/foundry-v0.1.9`))
      return Response.json({ ref, object: { type: "tag", sha: annotation } });
    if (url.endsWith(`git/tags/${annotation}`))
      return Response.json({ sha: annotation, object: { type: "commit", sha: head } });
    assert.equal(url, "https://api.github.com/repos/tiangong-lca/foundry/git/refs");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), { ref, sha: head });
    return Response.json({ ref, object: { type: "commit", sha: head } }, { status: 201 });
  });
  assert.deepEqual(await store.read(ref), { ref, head });
  assert.deepEqual(await store.create(ref, head), { ref, head });
  assert.equal(calls.length, 3);
  await assert.rejects(store.create("refs/heads/main", head), /identity/iu);
  assert.equal(calls.length, 3);
});

test("GitHub tag transport refuses annotation cycles and oversized responses", async () => {
  const annotation = "b".repeat(40);
  let calls = 0;
  const cyclic = createGitHubFoundryTagStore("unit-test-token", async (_url, _init) => {
    calls++;
    return Response.json(
      calls === 1
        ? { ref, object: { type: "tag", sha: annotation } }
        : { sha: annotation, object: { type: "tag", sha: annotation } },
    );
  });
  await assert.rejects(cyclic.read(ref), /annotation chain/iu);
  assert.equal(calls, 2);
  const huge = createGitHubFoundryTagStore(
    "unit-test-token",
    async () => new Response("{}", { headers: { "content-length": String(3 * 1024 * 1024) } }),
  );
  await assert.rejects(huge.read(ref), /API request/iu);
});
