import path from "node:path";
import { parseArgs } from "node:util";

export type ProductionContactDraftCaseOptions = {
  envFile: string;
  expectedProjectRef: string;
  expectedUserId: string;
  outDir: string;
};

export type ProductionContactDraftRuntimeEvidence = {
  entrypoint: string;
  cliPackageName: string;
  cliPackageVersion: string;
  cliEntrypointSha256: string;
  cliRuntimeSha256: string;
  runnerSha256: string;
  pnpmLockSha256: string;
  cleanup: () => void;
};

export type ProductionContactDraftSpawn = {
  command: string;
  args: string[];
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    encoding: "utf8";
    maxBuffer: number;
    timeout: number;
    windowsHide: true;
  };
};

export type ProductionContactDraftCaseManifest = {
  schema: "tiangong-foundry.production-contact-draft-case.v1";
  status: "passed";
  contact_id: string;
  project_ref: string;
  user_id: string;
  mutation_dispatch_count: 1;
  unique_root_readback_checks: 1;
};

export type RunProductionContactDraftCaseDeps = {
  processEnv?: NodeJS.ProcessEnv;
  now?: () => Date;
  randomUUID?: () => string;
  prepareRuntimeSnapshot?: () => ProductionContactDraftRuntimeEvidence;
  spawnImpl?: (
    command: string,
    args: string[],
    options: ProductionContactDraftSpawn["options"],
  ) => {
    status: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    error?: Error;
  };
};

function required(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`Production contact draft case requires ${label}.`);
  return text;
}

export function parseProductionContactDraftCaseArgs(
  argv: string[],
): ProductionContactDraftCaseOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const parsed = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    tokens: true,
    options: {
      "env-file": { type: "string" },
      "expected-project-ref": { type: "string" },
      "expected-user-id": { type: "string" },
      "out-dir": { type: "string" },
    },
  });
  for (const name of ["env-file", "expected-project-ref", "expected-user-id", "out-dir"] as const) {
    if (
      parsed.tokens.filter((token) => token.kind === "option" && token.name === name).length !== 1
    ) {
      throw new Error(`Production contact draft case requires exactly one --${name}.`);
    }
  }
  return {
    envFile: path.resolve(required(parsed.values["env-file"], "--env-file")),
    expectedProjectRef: required(parsed.values["expected-project-ref"], "--expected-project-ref"),
    expectedUserId: required(parsed.values["expected-user-id"], "--expected-user-id"),
    outDir: path.resolve(required(parsed.values["out-dir"], "--out-dir")),
  };
}

export async function runProductionContactDraftCase(
  _options: ProductionContactDraftCaseOptions,
  _deps: RunProductionContactDraftCaseDeps = {},
): Promise<ProductionContactDraftCaseManifest> {
  throw new Error("Production contact draft case is not implemented.");
}
