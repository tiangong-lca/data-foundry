import { npmReleasePolicy } from "./foundry-release-provenance.ts";
import { requestFoundryGitHubOidcToken } from "./foundry-release-oidc.ts";
import { assertFoundryNpmWorkflowEnvironment } from "./foundry-release-signing.ts";
import type { FoundryReleaseWorkflowContext } from "./foundry-release-workflow.ts";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const registry = "https://registry.npmjs.org";
const packagePath = encodeURIComponent("@tiangong-lca/foundry");

async function boundedJson(
  response: Response,
  limit: number,
  label: string,
): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error(`${label} response is empty.`);
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit)) {
    await response.body.cancel();
    throw new Error(`${label} response exceeds its byte bound.`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.length;
      if (total > limit) throw new Error(`${label} response exceeds its byte bound.`);
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, total),
    text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) throw new Error(`${label} response must be valid UTF-8.`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} response must be valid JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} response must be an object.`);
  return value as Record<string, unknown>;
}

export async function inspectFoundryNpmAvailability(
  version: string,
  fetchImpl: Fetch = fetch,
): Promise<"version-exists" | "version-available" | "first-package-identity"> {
  npmReleasePolicy({ package: "foundry", version, gitHead: "0".repeat(40) });
  for (const suffix of [`/${version}`, ""]) {
    const response = await fetchImpl(`${registry}/${packagePath}${suffix}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (response.status === 200 && !suffix) {
      const value = await boundedJson(response, 8 * 1024 * 1024, "npm registry preflight");
      if (value.name !== "@tiangong-lca/foundry")
        throw new Error("npm registry package identity differs.");
      const tags = value["dist-tags"];
      const latest =
        tags && typeof tags === "object" && !Array.isArray(tags)
          ? (tags as Record<string, unknown>).latest
          : undefined;
      if (latest !== undefined) {
        if (typeof latest !== "string") throw new Error("npm registry latest version is invalid.");
        npmReleasePolicy({ package: "foundry", version: latest, gitHead: "0".repeat(40) });
        const current = latest.split(".").map((part) => BigInt(part));
        const candidate = version.split(".").map((part) => BigInt(part));
        const differing = candidate.findIndex((part, index) => part !== current[index]);
        if (differing < 0 || candidate[differing] < current[differing])
          throw new Error("npm publication must advance the public latest version.");
      }
      return "version-available";
    }
    await response.body?.cancel();
    if (response.status === 200) return "version-exists";
    if (response.status !== 404)
      throw new Error(`npm registry preflight failed (HTTP ${response.status}).`);
  }
  return "first-package-identity";
}

export async function exchangeFoundryNpmOidcToken(
  context: FoundryReleaseWorkflowContext,
  environment: Readonly<NodeJS.ProcessEnv>,
  fetchImpl: Fetch = fetch,
  now = Date.now(),
): Promise<{ readonly token: string; readonly expiresAt: number }> {
  assertFoundryNpmWorkflowEnvironment(context, environment);
  const identity = await requestFoundryGitHubOidcToken(
    environment,
    "npm:registry.npmjs.org",
    fetchImpl,
  );
  let response: Response;
  try {
    response = await fetchImpl(`${registry}/-/npm/v1/oidc/token/exchange/package/${packagePath}`, {
      method: "POST",
      body: "",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${identity}`,
        "content-length": "0",
      },
    });
  } catch {
    throw new Error("npm OIDC exchange failed; publication did not start.");
  }
  if (response.status !== 201) {
    await response.body?.cancel();
    throw new Error(
      `npm OIDC exchange failed (HTTP ${response.status}); review the exact Trusted Publisher binding before publication.`,
    );
  }
  const value = await boundedJson(response, 256 * 1024, "npm OIDC exchange");
  const created = typeof value.created === "string" ? Date.parse(value.created) : NaN;
  const expires = typeof value.expires === "string" ? Date.parse(value.expires) : NaN;
  if (
    value.token_type !== "oidc" ||
    typeof value.token !== "string" ||
    !value.token ||
    value.token.length > 16384 ||
    /\s/u.test(value.token) ||
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    Math.abs(now - created) > 300000 ||
    expires < now + 60000 ||
    expires <= created ||
    expires - created > 7200000
  )
    throw new Error("npm OIDC exchange returned no fresh short-lived credential.");
  return Object.freeze({ token: value.token, expiresAt: expires });
}

export function foundryNpmPublishEnvironment(
  source: Readonly<NodeJS.ProcessEnv>,
  userConfig: string,
  globalConfig: string,
  token: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "ComSpec",
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "TZ",
    "PNPM_HOME",
  ])
    if (source[key] !== undefined) env[key] = source[key];
  return {
    ...env,
    CI: "true",
    NO_COLOR: "1",
    NODE_AUTH_TOKEN: token,
    NPM_CONFIG_USERCONFIG: userConfig,
    npm_config_userconfig: userConfig,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    npm_config_globalconfig: globalConfig,
  };
}

/** One transport attempt; public evidence owns success even if the response was lost. */
export async function publishOnceAndReadBack<T>(
  publish: () => Promise<void>,
  readback: () => Promise<T>,
): Promise<{ readonly transport: "reported-success" | "uncertain"; readonly evidence: T }> {
  let transport: "reported-success" | "uncertain" = "reported-success";
  try {
    await publish();
  } catch {
    transport = "uncertain";
  }
  const evidence = await readback();
  return Object.freeze({ transport, evidence });
}
