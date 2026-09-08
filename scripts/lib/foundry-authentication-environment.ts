import { FoundryContextError } from "./foundry-runtime-context.ts";
import { requirePrivateOAuthSessionFile } from "./oauth-session-reference.ts";
export interface FoundryPublicOAuthConfiguration {
  apiBaseUrl?: string;
  publishableKey?: string;
  oauthClientId?: string;
  oauthRedirectUri?: string;
}
export type FoundryAuthentication =
  | { mode: "oauth"; configuration?: FoundryPublicOAuthConfiguration }
  | { mode: "headless"; accessToken: string; apiBaseUrl: string; publishableKey: string };

const systemKeys = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;

/** Explicit public configuration and process-only credentials; never inherit ambient auth. */
export function createFoundryAuthenticationEnvironment(
  authentication: FoundryAuthentication,
  sessionReference: string | null | undefined,
  systemEnvironment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const account = { sessionReference };
  const reject = (code: string, message: string): never => {
    throw new FoundryContextError(code, message);
  };
  const environment: NodeJS.ProcessEnv = {};
  for (const key of systemKeys)
    if (systemEnvironment[key] !== undefined) environment[key] = systemEnvironment[key];
  if (authentication.mode === "oauth") {
    const config = authentication.configuration ?? {};
    environment.TIANGONG_LCA_API_BASE_URL = config.apiBaseUrl ?? "";
    environment.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY = config.publishableKey ?? "";
    environment.TIANGONG_LCA_OAUTH_CLIENT_ID = config.oauthClientId ?? "";
    environment.TIANGONG_LCA_OAUTH_REDIRECT_URI = config.oauthRedirectUri ?? "";
    environment.TIANGONG_LCA_AUTH_MODE = "oauth";
    environment.TIANGONG_LCA_FORCE_REAUTH = "false";
    environment.TIANGONG_LCA_DISABLE_SESSION_CACHE = "false";
    if (account.sessionReference) {
      requirePrivateOAuthSessionFile(account.sessionReference);
      environment.TIANGONG_LCA_SESSION_FILE = account.sessionReference;
    }
  } else {
    if (!authentication.accessToken || !authentication.apiBaseUrl || !authentication.publishableKey)
      reject(
        "headless_target_required",
        "Headless mode requires the existing CLI explicit target and process-only actor token.",
      );
    environment.TIANGONG_LCA_AUTH_MODE = "access_token";
    environment.TIANGONG_LCA_ACCESS_TOKEN = authentication.accessToken;
    environment.TIANGONG_LCA_API_BASE_URL = authentication.apiBaseUrl;
    environment.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY = authentication.publishableKey;
    environment.TIANGONG_LCA_DISABLE_SESSION_CACHE = "true";
  }
  return environment;
}
