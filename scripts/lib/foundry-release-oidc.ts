function oidcRequest(environment: Readonly<NodeJS.ProcessEnv>): { url: URL; token: string } {
  const value = environment.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (
    environment.GITHUB_ACTIONS !== "true" ||
    !value ||
    !token ||
    token.length > 16_384 ||
    /\s/u.test(token) ||
    environment.SIGSTORE_ID_TOKEN
  )
    throw new Error(
      "Foundry OIDC requires the GitHub workflow endpoint and request token, with no static identity token.",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Foundry OIDC endpoint is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".actions.githubusercontent.com") ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Foundry OIDC requires an uncredentialed GitHub Actions HTTPS endpoint.");
  return { url, token };
}

export function assertFoundryGitHubOidcEnvironment(environment: Readonly<NodeJS.ProcessEnv>): void {
  oidcRequest(environment);
}

export async function requestFoundryGitHubOidcToken(
  environment: Readonly<NodeJS.ProcessEnv>,
  audience: "sigstore" | "npm:registry.npmjs.org",
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  if (!["sigstore", "npm:registry.npmjs.org"].includes(audience))
    throw new Error("Foundry OIDC audience is unsupported.");
  const { url, token } = oidcRequest(environment);
  url.searchParams.set("audience", audience);
  const response = await fetchImpl(url.href, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
  });
  const limit = 256 * 1024;
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get("content-length") ?? 0) > limit
  ) {
    await response.body?.cancel();
    throw new Error(`Foundry OIDC request failed (HTTP ${response.status}).`);
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > limit) throw new Error("Foundry OIDC response exceeds its byte bound.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, total);
  const json = bytes.toString("utf8");
  if (!Buffer.from(json).equals(bytes))
    throw new Error("Foundry OIDC response must be valid UTF-8.");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Foundry OIDC response must be JSON.");
  }
  const identity =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).value
      : undefined;
  if (
    typeof identity !== "string" ||
    identity.length > 32_768 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(identity)
  )
    throw new Error("Foundry OIDC response contains no bounded identity token.");
  return identity;
}
