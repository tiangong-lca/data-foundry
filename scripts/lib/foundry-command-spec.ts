import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";

export const FOUNDRY_COMMAND_SPEC_SCHEMA = "tiangong-foundry.command-spec.v1" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const VALUE_FLAGS = new Set([
  "--input",
  "--input-file",
  "--out-dir",
  "--root-policy",
  "--state-code",
  "--target-user-id",
  "--type",
]);
const BOOLEAN_FLAGS = new Set(["--commit", "--compare-root-payload", "--json"]);
const UNIQUE_FLAGS = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS]);
const INPUT_FLAG_ALIASES = new Set(["--input", "--input-file"]);

type JsonRecord = Record<string, unknown>;

export type FoundryArtifactFact = {
  role: string;
  path: string;
  bytes: number;
  sha256: string;
};

export type FoundryCommandSpecBinding = {
  artifacts: FoundryArtifactFact[];
};

export type FoundryCommandSpec = {
  schema: typeof FOUNDRY_COMMAND_SPEC_SCHEMA;
  executable: string;
  argv: string[];
  display: string;
  binding: FoundryCommandSpecBinding;
  sha256: string;
};

type CreateFoundryCommandSpecOptions = {
  executable: string;
  argv: readonly string[];
  binding?: FoundryCommandSpecBinding;
};

type CreateFileArtifactFactOptions = {
  role: string;
  path: string;
  filePath: string;
};

export type FoundryCommandSpecSpawnOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  encoding: "utf8";
  maxBuffer?: number;
  shell: false;
  windowsHide: true;
};

export type FoundryCommandSpecSpawnResult = {
  pid?: number;
  output?: unknown[];
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

type ExecuteFoundryCommandSpecSyncOptions = {
  resolveArtifactPath: (artifactPath: string) => string | null;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  spawnImpl?: (
    executable: string,
    argv: readonly string[],
    options: FoundryCommandSpecSpawnOptions,
  ) => FoundryCommandSpecSpawnResult;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJsonValue(value[key])]),
  );
}

function sha256Buffer(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function commandSpecAuthority(value: {
  schema: unknown;
  executable: unknown;
  argv: unknown;
  binding: unknown;
}): JsonRecord {
  return {
    schema: value.schema,
    executable: value.executable,
    argv: value.argv,
    binding: value.binding,
  };
}

function commandSpecSha256(value: {
  schema: unknown;
  executable: unknown;
  argv: unknown;
  binding: unknown;
}): string {
  return sha256Buffer(JSON.stringify(canonicalJsonValue(commandSpecAuthority(value))));
}

function commandToken(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string without NUL bytes.`);
  }
  return value;
}

function renderDisplayToken(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

export function renderFoundryCommandDisplay(executable: string, argv: readonly string[]): string {
  return [executable, ...argv].map(renderDisplayToken).join(" ");
}

function parseArtifactFact(value: unknown, index: number): FoundryArtifactFact {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["bytes", "path", "role", "sha256"]) ||
    !Number.isSafeInteger(value.bytes) ||
    Number(value.bytes) < 0 ||
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256)
  ) {
    throw new Error(`CommandSpec artifact ${index} failed exact bytes/SHA-256 validation.`);
  }
  return {
    role: commandToken(value.role, `CommandSpec artifact ${index} role`),
    path: commandToken(value.path, `CommandSpec artifact ${index} path`),
    bytes: Number(value.bytes),
    sha256: value.sha256,
  };
}

function parseBinding(value: unknown): FoundryCommandSpecBinding {
  if (!isRecord(value) || !hasExactKeys(value, ["artifacts"]) || !Array.isArray(value.artifacts)) {
    throw new Error("CommandSpec binding must contain the exact artifacts key.");
  }
  const artifacts = value.artifacts.map(parseArtifactFact);
  const roles = artifacts.map((artifact) => artifact.role);
  if (new Set(roles).size !== roles.length) {
    throw new Error("CommandSpec artifact roles must be unique.");
  }
  return { artifacts };
}

function criticalFlagName(token: string): string | null {
  if (UNIQUE_FLAGS.has(token)) return token;
  const equals = token.indexOf("=");
  if (equals <= 0) return null;
  const name = token.slice(0, equals);
  return UNIQUE_FLAGS.has(name) ? name : null;
}

function validateCriticalFlags(argv: readonly string[]): void {
  const counts = new Map<string, number>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const name = criticalFlagName(token);
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (VALUE_FLAGS.has(name) && token === name) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`CommandSpec critical flag ${name} requires one value.`);
      }
    }
  }
  for (const [name, count] of counts) {
    if (count > 1) throw new Error(`CommandSpec critical flag ${name} may appear only once.`);
  }
  const inputAliasCount = [...INPUT_FLAG_ALIASES].reduce(
    (count, name) => count + (counts.get(name) ?? 0),
    0,
  );
  if (inputAliasCount > 1) {
    throw new Error("CommandSpec input aliases --input and --input-file are mutually exclusive.");
  }
}

export function parseFoundryCommandSpec(value: unknown): FoundryCommandSpec {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["argv", "binding", "display", "executable", "schema", "sha256"])
  ) {
    throw new Error("CommandSpec must contain exact keys with no unexpected fields.");
  }
  if (value.schema !== FOUNDRY_COMMAND_SPEC_SCHEMA) {
    throw new Error(`CommandSpec schema must be ${FOUNDRY_COMMAND_SPEC_SCHEMA}.`);
  }
  const executable = commandToken(value.executable, "CommandSpec executable");
  if (!Array.isArray(value.argv)) throw new Error("CommandSpec argv must be an array.");
  const argv = value.argv.map((entry, index) => commandToken(entry, `CommandSpec argv[${index}]`));
  const display = commandToken(value.display, "CommandSpec display");
  const binding = parseBinding(value.binding);
  validateCriticalFlags(argv);
  if (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256)) {
    throw new Error("CommandSpec SHA-256 is missing or malformed.");
  }
  const expectedSha256 = commandSpecSha256({
    schema: value.schema,
    executable,
    argv,
    binding,
  });
  if (value.sha256 !== expectedSha256) {
    throw new Error("CommandSpec SHA-256 does not match executable, argv, and binding.");
  }
  return {
    schema: FOUNDRY_COMMAND_SPEC_SCHEMA,
    executable,
    argv,
    display,
    binding,
    sha256: value.sha256,
  };
}

export function createFoundryCommandSpec(
  options: CreateFoundryCommandSpecOptions,
): FoundryCommandSpec {
  const executable = commandToken(options.executable, "CommandSpec executable");
  const argv = options.argv.map((entry, index) =>
    commandToken(entry, `CommandSpec argv[${index}]`),
  );
  const binding = parseBinding(options.binding ?? { artifacts: [] });
  validateCriticalFlags(argv);
  const authority = {
    schema: FOUNDRY_COMMAND_SPEC_SCHEMA,
    executable,
    argv,
    binding,
  };
  return parseFoundryCommandSpec({
    ...authority,
    display: renderFoundryCommandDisplay(executable, argv),
    sha256: commandSpecSha256(authority),
  });
}

export function createFileArtifactFact(
  options: CreateFileArtifactFactOptions,
): FoundryArtifactFact {
  const role = commandToken(options.role, "Artifact role");
  const artifactPath = commandToken(options.path, "Artifact path");
  const filePath = commandToken(options.filePath, "Artifact file path");
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`CommandSpec artifact is not a readable file: ${artifactPath}`);
  }
  const bytes = fs.readFileSync(filePath);
  return {
    role,
    path: artifactPath,
    bytes: bytes.byteLength,
    sha256: sha256Buffer(bytes),
  };
}

export function commandSpecOptionValue(value: unknown, optionName: string): string | null {
  const spec = parseFoundryCommandSpec(value);
  for (let index = 0; index < spec.argv.length; index += 1) {
    const token = spec.argv[index];
    if (token === optionName) return spec.argv[index + 1] ?? null;
    if (token.startsWith(`${optionName}=`)) return token.slice(optionName.length + 1) || null;
  }
  return null;
}

export function assertFoundryCommandSpecArtifactsCurrent(
  value: unknown,
  resolveArtifactPath: (artifactPath: string) => string | null,
): FoundryCommandSpec {
  const spec = parseFoundryCommandSpec(value);
  for (const artifact of spec.binding.artifacts) {
    const filePath = resolveArtifactPath(artifact.path);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`CommandSpec artifact drift: ${artifact.role} is missing.`);
    }
    const bytes = fs.readFileSync(filePath);
    const sha256 = sha256Buffer(bytes);
    if (bytes.byteLength !== artifact.bytes || sha256 !== artifact.sha256) {
      throw new Error(`CommandSpec artifact drift: ${artifact.role} bytes/SHA-256 changed.`);
    }
  }
  return spec;
}

export function executeFoundryCommandSpecSync(
  value: unknown,
  options: ExecuteFoundryCommandSpecSyncOptions,
): FoundryCommandSpecSpawnResult {
  const spec = assertFoundryCommandSpecArtifactsCurrent(value, options.resolveArtifactPath);
  const spawnOptions: FoundryCommandSpecSpawnOptions = {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.maxBuffer ? { maxBuffer: options.maxBuffer } : {}),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  };
  const spawnImpl =
    options.spawnImpl ??
    ((executable: string, argv: readonly string[], childOptions: FoundryCommandSpecSpawnOptions) =>
      spawnSync(executable, [...argv], childOptions));
  return spawnImpl(spec.executable, spec.argv, spawnOptions);
}
