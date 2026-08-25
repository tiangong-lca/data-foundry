import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const runtimeEnvFilePolicyKey = "FOUNDRY_RUNTIME_ENV_FILE_POLICY";
export const runtimeEnvFilePolicyDisabled = "disabled";

export interface FoundryIsolatedChildEnvironmentOptions {
  tempRoot: string;
  sourceEnv?: NodeJS.ProcessEnv;
  overrides?: NodeJS.ProcessEnv;
}

export function copyFoundryIsolatedExecutable(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, fs.statSync(sourcePath).mode & 0o777);
}

const credentialLikeEnvironmentKey =
  /(?:^|_)(?:API_?KEY|ACCESS_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|CREDENTIALS?|COOKIE|SESSION|AUTH)(?:$|_)/iu;
const allowedOverrideEnvironmentKeys = new Set(["TIANGONG_LCA_CLI_BIN", "TIDAS_BIN"]);

export function createFoundryIsolatedChildEnvironment({
  tempRoot,
  sourceEnv = process.env,
  overrides = {},
}: FoundryIsolatedChildEnvironmentOptions): NodeJS.ProcessEnv {
  const homeDir = path.join(tempRoot, "home");
  const tempDir = path.join(tempRoot, "tmp");
  const configDir = path.join(tempRoot, "config");
  const cacheDir = path.join(tempRoot, "cache");
  const dataDir = path.join(tempRoot, "data");
  const stateDir = path.join(tempRoot, "state");
  const corepackHome = path.join(tempRoot, "corepack");
  for (const directory of [
    homeDir,
    tempDir,
    configDir,
    cacheDir,
    dataDir,
    stateDir,
    corepackHome,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const environment: NodeJS.ProcessEnv = {
    HOME: homeDir,
    USERPROFILE: homeDir,
    TMPDIR: tempDir,
    TEMP: tempDir,
    TMP: tempDir,
    APPDATA: path.join(dataDir, "appdata"),
    LOCALAPPDATA: path.join(dataDir, "local-appdata"),
    XDG_CONFIG_HOME: configDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_DATA_HOME: dataDir,
    XDG_STATE_HOME: stateDir,
    COREPACK_HOME: corepackHome,
    NPM_CONFIG_USERCONFIG: path.join(configDir, "npmrc"),
    NPM_CONFIG_CACHE: path.join(cacheDir, "npm"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_AUDIT: "false",
    GIT_CONFIG_GLOBAL: path.join(configDir, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    CI: "1",
    HUSKY: "0",
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    NO_COLOR: "1",
    [runtimeEnvFilePolicyKey]: runtimeEnvFilePolicyDisabled,
  };

  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "windir",
    "ComSpec",
    "COMSPEC",
    "PATHEXT",
  ]) {
    const value = sourceEnv[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (!allowedOverrideEnvironmentKeys.has(key)) {
      throw new Error(`Refusing non-allowlisted environment override in isolated child: ${key}`);
    }
    environment[key] = value;
  }
  for (const key of Object.keys(environment)) {
    if (credentialLikeEnvironmentKey.test(key)) {
      throw new Error(`Refusing credential-like environment key in isolated child: ${key}`);
    }
  }
  return environment;
}
