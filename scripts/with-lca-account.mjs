#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return `Usage:
  node scripts/with-lca-account.mjs <profile> [--no-auth-check] -- <command> [args...]

Examples:
  node scripts/with-lca-account.mjs example-account -- node scripts/foundry.mjs env-check
  node scripts/with-lca-account.mjs bafu -- node node_modules/@tiangong-lca/cli/bin/tiangong-lca.js process list --state-code 0 --limit 1 --json
`;
}

function parseEnvFile(filePath) {
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line
      .slice(0, index)
      .trim()
      .replace(/^export\s+/u, "");
    let value = line.slice(index + 1).trim();
    value = value.replace(/^["']|["']$/gu, "");
    values[key] = value;
  }
  return values;
}

function assertProfileName(profile) {
  if (!/^[A-Za-z0-9._-]+$/u.test(profile)) {
    throw new Error(`Invalid account profile name: ${profile}`);
  }
}

function assertSafeFileStem(value, label) {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function readThreadAccountGuard(threadId) {
  if (!threadId) return null;
  assertSafeFileStem(threadId, "CODEX_THREAD_ID");
  const guardPath = path.join(
    repoRoot,
    ".foundry",
    "state",
    "thread-account-guards",
    `${threadId}.json`,
  );
  if (!fs.existsSync(guardPath)) return null;
  const guard = JSON.parse(fs.readFileSync(guardPath, "utf8"));
  return { guard, guardPath };
}

function assertThreadAccountGuard({ profile, profileEnv }) {
  const threadId = String(process.env.CODEX_THREAD_ID ?? "").trim();
  const threadGuard = readThreadAccountGuard(threadId);
  if (!threadGuard) return null;

  const { guard, guardPath } = threadGuard;
  const guardThreadId = String(guard.codex_thread_id ?? "").trim();
  const guardProfile = String(guard.profile ?? "").trim();
  const guardExpectedUserId = String(guard.expected_user_id ?? "").trim();
  const profileExpectedUserId = String(profileEnv.FOUNDRY_EXPECTED_USER_ID ?? "").trim();

  if (guardThreadId && guardThreadId !== threadId) {
    throw new Error(`Thread account guard ${guardPath} is for ${guardThreadId}, not ${threadId}.`);
  }
  if (!guardProfile) {
    throw new Error(`Thread account guard ${guardPath} is missing profile.`);
  }
  if (guardProfile !== profile) {
    throw new Error(
      `CODEX_THREAD_ID ${threadId} is locked to profile ${guardProfile}; refused profile ${profile}.`,
    );
  }
  if (
    guardExpectedUserId &&
    profileExpectedUserId &&
    guardExpectedUserId !== profileExpectedUserId
  ) {
    throw new Error(
      `Thread account guard expected user ${guardExpectedUserId}, but profile ${profile} expects ${profileExpectedUserId}.`,
    );
  }

  return { threadId, guardPath };
}

function decodeUserApiKey(apiKey) {
  try {
    const parsed = JSON.parse(Buffer.from(String(apiKey ?? "").trim(), "base64").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const email = String(parsed.email ?? "").trim();
    const password = String(parsed.password ?? "").trim();
    return email && password ? { email, password } : null;
  } catch {
    return null;
  }
}

function maskEmail(email) {
  const [localPart, domainPart] = String(email ?? "").split("@");
  if (!localPart || !domainPart) return "****";
  if (localPart.length <= 2) return `****@${domainPart}`;
  return `${localPart.slice(0, 2)}****@${domainPart}`;
}

function projectBaseUrl(apiBaseUrl) {
  const url = new URL(apiBaseUrl);
  if (url.hostname.endsWith(".functions.supabase.co")) {
    url.hostname = url.hostname.replace(".functions.supabase.co", ".supabase.co");
    url.pathname = "";
    url.search = "";
    return url.toString().replace(/\/$/u, "");
  }
  return `${url.protocol}//${url.hostname}`;
}

async function assertExpectedUser(env, profile) {
  const expectedUserId = String(env.FOUNDRY_EXPECTED_USER_ID ?? "").trim();
  if (!expectedUserId) return;
  const credentials = decodeUserApiKey(env.TIANGONG_LCA_API_KEY);
  if (!credentials) {
    throw new Error(`Profile ${profile} has an invalid TIANGONG_LCA_API_KEY.`);
  }
  if (!env.TIANGONG_LCA_API_BASE_URL || !env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      `Profile ${profile} cannot run user guard without API base URL and publishable key.`,
    );
  }
  const baseUrl = projectBaseUrl(env.TIANGONG_LCA_API_BASE_URL);
  const tokenResponse = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify(credentials),
  });
  const tokenBody = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(`Profile ${profile} auth guard failed for ${maskEmail(credentials.email)}.`);
  }
  const userResponse = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: {
      apikey: env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${tokenBody.access_token}`,
    },
  });
  const userBody = await userResponse.json().catch(() => ({}));
  const actualUserId = String(userBody.id ?? "").trim();
  if (actualUserId !== expectedUserId) {
    throw new Error(
      `Profile ${profile} resolved user ${actualUserId || "<missing>"}, expected ${expectedUserId}.`,
    );
  }
  console.error(
    `[with-lca-account] profile=${profile} user=${actualUserId} email=${maskEmail(userBody.email ?? credentials.email)}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help") || args.length === 0) {
    console.log(usage());
    return 0;
  }
  const separatorIndex = args.indexOf("--");
  if (separatorIndex <= 0 || separatorIndex === args.length - 1) {
    console.error(usage());
    return 2;
  }
  const profile = args[0];
  assertProfileName(profile);
  const flags = new Set(args.slice(1, separatorIndex));
  const command = args.slice(separatorIndex + 1);
  const profileDir =
    process.env.FOUNDRY_ACCOUNT_PROFILES_DIR || path.join(repoRoot, ".foundry", "account-profiles");
  const profilePath = path.join(profileDir, `${profile}.env`);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Account profile not found: ${profilePath}`);
  }
  const profileEnv = parseEnvFile(profilePath);
  const threadGuard = assertThreadAccountGuard({ profile, profileEnv });
  const env = {
    ...process.env,
    ...profileEnv,
    FOUNDRY_ACCOUNT_PROFILE: profile,
    ...(threadGuard ? { FOUNDRY_THREAD_ACCOUNT_GUARD: threadGuard.guardPath } : {}),
  };
  const shouldCheck =
    !flags.has("--no-auth-check") && env.FOUNDRY_ACCOUNT_PROFILE_SKIP_AUTH_CHECK !== "true";
  if (shouldCheck) {
    await assertExpectedUser(env, profile);
  }
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  return result.status ?? 1;
}

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error(`[with-lca-account] ${error.message}`);
    process.exit(1);
  });
