import { createHash } from "node:crypto";
import { FOUNDRY_RELEASE_REPOSITORY } from "./foundry-release-contract.ts";
import {
  createGitHubFoundryTagStore,
  foundryReleaseRef,
  type FoundryReleaseKind,
} from "./foundry-release-tag.ts";

export interface FoundryAssetInput {
  readonly name: string;
  readonly bytes: Uint8Array;
}
export interface FoundryAssetFact {
  name: string;
  bytes: number;
  sha256: string;
}
export interface FoundryAssetRelease {
  id: number;
  tag: string;
  sourceCommit: string;
  draft: boolean;
  assets: FoundryAssetFact[];
}
export interface FoundryAssetStore {
  read(tag: string): Promise<FoundryAssetRelease | null>;
  createDraft(tag: string, sourceCommit: string): Promise<void>;
  upload(id: number, asset: FoundryAssetInput): Promise<void>;
  publish(id: number): Promise<void>;
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sourceSha = (value: string) => /^[0-9a-f]{40}$/u.test(value) && value !== "0".repeat(40);
function name(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value) || value.includes(".."))
    throw new Error("Release asset name is invalid.");
}
function tagKind(tag: string): { version: string; kind: FoundryReleaseKind } {
  const match = /^foundry(-runtime)?-v(.+)$/u.exec(tag);
  if (!match) throw new Error("Release tag is invalid.");
  const kind = match[1] ? "manifest" : "components";
  if (foundryReleaseRef(match[2], kind) !== `refs/tags/${tag}`)
    throw new Error("Release tag is invalid.");
  return { version: match[2], kind };
}
function id(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Release id is invalid.");
}

/** Create-only release state machine. The owning workflow must establish qualification first. */
export async function publishFoundryReleaseAssets(
  request: {
    readonly version: string;
    readonly kind: FoundryReleaseKind;
    readonly sourceCommit: string;
    readonly assets: readonly FoundryAssetInput[];
  },
  store: FoundryAssetStore,
) {
  const tag = foundryReleaseRef(request.version, request.kind).slice("refs/tags/".length);
  if (!sourceSha(request.sourceCommit) || !request.assets.length || request.assets.length > 64)
    throw new Error("Release requires an exact source and bounded asset set.");
  let total = 0;
  const selected = new Map<string, FoundryAssetInput>();
  const facts = new Map<string, FoundryAssetFact>();
  for (const asset of request.assets) {
    name(asset.name);
    total += asset.bytes.byteLength;
    if (
      selected.has(asset.name) ||
      !asset.bytes.byteLength ||
      asset.bytes.byteLength > 512 * 1024 * 1024 ||
      total > 2 * 1024 * 1024 * 1024
    )
      throw new Error("Release assets are duplicated, empty or oversized.");
    const bytes = Buffer.from(asset.bytes);
    selected.set(asset.name, { name: asset.name, bytes });
    facts.set(asset.name, { name: asset.name, bytes: bytes.length, sha256: hash(bytes) });
  }
  const check = (release: FoundryAssetRelease, complete = false) => {
    id(release.id);
    if (
      release.tag !== tag ||
      release.sourceCommit !== request.sourceCommit ||
      typeof release.draft !== "boolean" ||
      !Array.isArray(release.assets) ||
      release.assets.length > facts.size
    )
      throw new Error("Release differs from its exact source or asset set.");
    const names = new Set<string>();
    for (const asset of release.assets) {
      const expected = facts.get(asset.name);
      if (
        !expected ||
        names.has(asset.name) ||
        asset.bytes !== expected.bytes ||
        asset.sha256 !== expected.sha256
      )
        throw new Error(
          "Existing release asset differs from reviewed bytes; it cannot be replaced.",
        );
      names.add(asset.name);
    }
    if ((complete || !release.draft) && names.size !== facts.size)
      throw new Error("Published release is missing required assets.");
    return release;
  };
  let release = await store.read(tag);
  if (!release) {
    try {
      await store.createDraft(tag, request.sourceCommit);
    } catch {
      /* Readback owns uncertain outcomes. */
    }
    release = await store.read(tag);
    if (!release) throw new Error("Release creation is unconfirmed; no mutation was retried.");
  }
  check(release);
  if (!release.draft) return { status: "existing" as const, release };
  const releaseId = release.id;
  for (const asset of selected.values()) {
    if (release.assets.some((value) => value.name === asset.name)) continue;
    try {
      await store.upload(releaseId, asset);
    } catch {
      /* Never replay an upload automatically. */
    }
    const observed = await store.read(tag);
    if (!observed || observed.id !== releaseId) throw new Error("Release upload is unconfirmed.");
    release = check(observed);
    if (!release.assets.some((value) => value.name === asset.name))
      throw new Error("Release upload is unconfirmed; no mutation was retried.");
  }
  check(release, true);
  if (release.draft) {
    try {
      await store.publish(releaseId);
    } catch {
      /* Confirm through a fresh read. */
    }
    const observed = await store.read(tag);
    if (!observed || observed.id !== releaseId || observed.draft)
      throw new Error("Release publication is unconfirmed; no mutation was retried.");
    release = check(observed, true);
  }
  return { status: "published" as const, release };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Release API returned an invalid object.");
  return value as Record<string, unknown>;
}
/** Only canonical release GET/create, asset upload and draft publication are exposed. */
export function createGitHubFoundryAssetStore(
  token: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
): FoundryAssetStore {
  if (!token || /\s/u.test(token))
    throw new Error("Release publication requires the owning workflow token.");
  const origin = `https://api.github.com/repos/${FOUNDRY_RELEASE_REPOSITORY}`;
  const tags = createGitHubFoundryTagStore(token, fetchImpl);
  const releaseIds = new Map<string, number>();
  const nextPages = new Map<string, boolean>();
  async function request(
    method: "GET" | "POST" | "PATCH",
    url: string,
    body?: Record<string, unknown> | Uint8Array,
    paginated = false,
  ): Promise<unknown> {
    const binary = body instanceof Uint8Array;
    const response = await fetchImpl(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(binary ? 300_000 : 30_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        ...(body
          ? { "content-type": binary ? "application/octet-stream" : "application/json" }
          : {}),
      },
      ...(body ? { body: binary ? new Uint8Array(body) : JSON.stringify(body) } : {}),
    });
    if (method === "GET" && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    const limit = 2 * 1024 * 1024;
    if (
      response.status !== (method === "POST" ? 201 : 200) ||
      !response.body ||
      (!paginated && response.headers.has("link")) ||
      Number(response.headers.get("content-length") ?? 0) > limit
    ) {
      await response.body?.cancel();
      throw new Error(`Release API request failed (HTTP ${response.status}).`);
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let total = 0;
    if (paginated) nextPages.set(url, /rel="next"/u.test(response.headers.get("link") ?? ""));
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.length;
        if (total > limit) throw new Error("Release API response exceeds its byte bound.");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total)),
    );
  }
  async function read(tag: string): Promise<FoundryAssetRelease | null> {
    tagKind(tag);
    const known = releaseIds.get(tag);
    let response = await request(
      "GET",
      known ? `${origin}/releases/${known}` : `${origin}/releases/tags/${encodeURIComponent(tag)}`,
    );
    // The tag endpoint documents published releases only. Discover an existing
    // draft once, with complete bounded pagination, then read its exact id.
    if (response === null && known === undefined) {
      const matches: Record<string, unknown>[] = [];
      for (let page = 1; page <= 10; page++) {
        const pageUrl = `${origin}/releases?per_page=100&page=${page}`;
        const values = await request("GET", pageUrl, undefined, true);
        if (!Array.isArray(values) || values.length > 100)
          throw new Error("Release draft lookup is incomplete.");
        matches.push(...values.map(object).filter((value) => value.tag_name === tag));
        if (matches.length > 1) throw new Error("Release tag has ambiguous draft records.");
        if (values.length < 100 && !nextPages.get(pageUrl)) {
          response = matches[0] ?? null;
          break;
        }
        if (page === 10) throw new Error("Release draft lookup exceeds its page bound.");
      }
    }
    if (response === null) return null;
    const value = object(response);
    if (
      value.tag_name !== tag ||
      typeof value.id !== "number" ||
      typeof value.draft !== "boolean" ||
      value.prerelease !== false ||
      !Array.isArray(value.assets) ||
      value.assets.length > 64
    )
      throw new Error("Release API identity or asset inventory is invalid.");
    id(value.id);
    if (known !== undefined && known !== value.id)
      throw new Error("Release id changed during publication.");
    const target = await tags.read(`refs/tags/${tag}`);
    if (!target) throw new Error("Release tag is missing.");
    releaseIds.set(tag, value.id);
    const assets = value.assets.map((item) => {
      const asset = object(item);
      if (
        typeof asset.name !== "string" ||
        asset.state !== "uploaded" ||
        !Number.isSafeInteger(asset.size) ||
        Number(asset.size) < 1 ||
        typeof asset.digest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(asset.digest)
      )
        throw new Error("Release asset is incomplete or lacks a server digest.");
      name(asset.name);
      return { name: asset.name, bytes: Number(asset.size), sha256: asset.digest.slice(7) };
    });
    return { id: value.id, tag, sourceCommit: target.head, draft: value.draft, assets };
  }
  return {
    read,
    createDraft: async (tag, sourceCommit) => {
      tagKind(tag);
      if (!sourceSha(sourceCommit)) throw new Error("Release source commit is invalid.");
      const target = await tags.read(`refs/tags/${tag}`);
      if (target?.head !== sourceCommit)
        throw new Error("Release requires its existing exact source tag.");
      const created = object(
        await request("POST", `${origin}/releases`, {
          tag_name: tag,
          target_commitish: sourceCommit,
          name: tag,
          body: `Qualified Foundry software assets from ${sourceCommit}.`,
          draft: true,
          prerelease: false,
          make_latest: "false",
        }),
      );
      if (created.tag_name !== tag || typeof created.id !== "number")
        throw new Error("Created release response identity is invalid.");
      id(created.id);
      releaseIds.set(tag, created.id);
    },
    upload: async (releaseId, asset) => {
      id(releaseId);
      name(asset.name);
      if (!asset.bytes.byteLength || asset.bytes.byteLength > 512 * 1024 * 1024)
        throw new Error("Release upload size is invalid.");
      await request(
        "POST",
        `https://uploads.github.com/repos/${FOUNDRY_RELEASE_REPOSITORY}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`,
        asset.bytes,
      );
    },
    publish: async (releaseId) => {
      id(releaseId);
      await request("PATCH", `${origin}/releases/${releaseId}`, {
        draft: false,
        make_latest: "false",
      });
    },
  };
}
