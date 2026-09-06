import { FOUNDRY_RELEASE_REPOSITORY } from "./foundry-release-contract.ts";

export interface FoundryReleaseTagTarget {
  readonly ref: string;
  readonly head: string;
}
export interface FoundryReleaseTagStore {
  read(ref: string): Promise<FoundryReleaseTagTarget | null>;
  create(ref: string, head: string): Promise<FoundryReleaseTagTarget>;
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value) && value !== "0".repeat(40);
}
function releaseRef(version: string): string {
  if (
    typeof version !== "string" ||
    version.length > 64 ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version) ||
    version.split(".").some((part) => BigInt(part) > BigInt(Number.MAX_SAFE_INTEGER))
  )
    throw new Error("Foundry tag requires a stable canonical version.");
  return `refs/tags/foundry-v${version}`;
}
function requireRef(ref: string): void {
  const prefix = "refs/tags/foundry-v";
  if (!ref.startsWith(prefix) || releaseRef(ref.slice(prefix.length)) !== ref)
    throw new Error("Foundry tag identity is invalid.");
}
function requireTarget(value: FoundryReleaseTagTarget, ref: string, head: string): void {
  if (value.ref !== ref || !sha(value.head))
    throw new Error("Foundry tag response identity is invalid.");
  if (value.head !== head)
    throw new Error(
      "Foundry tag already identifies a different source commit; it cannot be changed.",
    );
}

export async function ensureFoundryReleaseTag(
  request: { readonly version: string; readonly head: string },
  store: FoundryReleaseTagStore,
): Promise<FoundryReleaseTagTarget & { readonly status: "created" | "existing" | "reconciled" }> {
  const ref = releaseRef(request.version),
    head = request.head;
  if (!sha(head)) throw new Error("Foundry tag requires an exact source commit.");
  const existing = await store.read(ref);
  if (existing) {
    requireTarget(existing, ref, head);
    return Object.freeze({ status: "existing", ref, head });
  }
  let created: FoundryReleaseTagTarget;
  try {
    created = await store.create(ref, head);
  } catch {
    const observed = await store.read(ref);
    if (!observed)
      throw new Error(
        "Foundry tag creation is unconfirmed; inspect and rerun the same release workflow.",
      );
    requireTarget(observed, ref, head);
    return Object.freeze({ status: "reconciled", ref, head });
  }
  requireTarget(created, ref, head);
  return Object.freeze({ status: "created", ref, head });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Foundry tag response must be an object.");
  return value as Record<string, unknown>;
}

/** Only this repository's tag GET and create-only reference endpoints are reachable. */
export function createGitHubFoundryTagStore(
  token: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
): FoundryReleaseTagStore {
  if (!token || /\s/u.test(token))
    throw new Error("Foundry tag creation requires the owning workflow token.");
  const origin = `https://api.github.com/repos/${FOUNDRY_RELEASE_REPOSITORY}`;
  async function request(
    method: "GET" | "POST",
    suffix: string,
    body?: { ref: string; sha: string },
  ): Promise<unknown> {
    const response = await fetchImpl(`${origin}/${suffix}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (method === "GET" && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    const limit = 2 * 1024 * 1024;
    if (
      response.status !== (method === "GET" ? 200 : 201) ||
      !response.body ||
      Number(response.headers.get("content-length") ?? 0) > limit
    ) {
      await response.body?.cancel();
      throw new Error(`Foundry tag API request failed (HTTP ${response.status}).`);
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.length;
        if (total > limit) throw new Error("Foundry tag response exceeded its byte bound.");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks, total),
      text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes))
      throw new Error("Foundry tag response must be valid UTF-8.");
    const parsed: unknown = JSON.parse(text);
    return parsed;
  }
  async function target(value: unknown, ref: string): Promise<FoundryReleaseTagTarget> {
    const root = record(value);
    if (root.ref !== ref) throw new Error("Foundry tag response identity mismatch.");
    let object = record(root.object);
    const visited = new Set<string>();
    for (;;) {
      if (!sha(object.sha)) throw new Error("Foundry tag object commit is invalid.");
      if (object.type === "commit") return Object.freeze({ ref, head: object.sha });
      if (object.type !== "tag" || visited.has(object.sha) || visited.size >= 4)
        throw new Error("Foundry tag annotation chain is invalid or exceeds its bound.");
      visited.add(object.sha);
      const annotation = record(await request("GET", `git/tags/${object.sha}`));
      if (annotation.sha !== object.sha)
        throw new Error("Foundry tag annotation identity mismatch.");
      object = record(annotation.object);
    }
  }
  return Object.freeze({
    read: async (ref: string) => {
      requireRef(ref);
      const value = await request("GET", `git/ref/${ref.slice("refs/".length)}`);
      return value === null ? null : target(value, ref);
    },
    create: async (ref: string, head: string) => {
      requireRef(ref);
      if (!sha(head)) throw new Error("Foundry tag source commit is invalid.");
      return target(await request("POST", "git/refs", { ref, sha: head }), ref);
    },
  });
}
