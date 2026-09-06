import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CLI_RUNTIME_EXPECTATION_SCHEMA,
  assertCliRuntimeMatches,
  type CliRuntimeDescriptor,
  type CliRuntimeExpectation,
} from "@tiangong-lca/cli/runtime";
import {
  assertFoundryRuntimeContext,
  captureFoundryInput,
  FoundryContextError,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { createFoundryIsolatedChildEnvironment } from "./foundry-runtime-environment.ts";
import { copyFoundryIsolatedExecutable } from "./foundry-runtime-environment.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import {
  runTidasHandshake,
  TIDAS_OPERATION_REPORT_SCHEMA,
  TIDAS_VALIDATION_BATCH_FINAL_SCHEMA,
  TIDAS_VALIDATION_DESCRIBE_SCHEMA,
} from "./tidas-adapter.ts";

export const FOUNDRY_RUNTIME_QUALIFICATION_SCHEMA =
  "tiangong-foundry.runtime-qualification.v1" as const;
export const FOUNDRY_TIDAS_EXPECTATION_SCHEMA =
  "tiangong-foundry.tidas-runtime-expectation.v1" as const;

export interface ContentFact {
  readonly bytes: number;
  readonly sha256: string;
}

export interface FoundryTidasRuntimeExpectation {
  readonly schema: typeof FOUNDRY_TIDAS_EXPECTATION_SCHEMA;
  readonly platform: string;
  readonly binary_version: string;
  readonly executable: Readonly<ContentFact>;
  readonly validation: Readonly<{
    schema_version: typeof TIDAS_VALIDATION_DESCRIBE_SCHEMA;
    asset_fingerprint: string;
    protocols: readonly string[];
    event_schema_versions: readonly string[];
  }>;
}

export interface QualifiedFoundryRuntime {
  readonly schema: typeof FOUNDRY_RUNTIME_QUALIFICATION_SCHEMA;
  readonly foundry: Readonly<{
    package_name: string;
    package_version: string;
    package_manifest_sha256: string;
    entry_sha256: string;
    platform: string;
  }>;
  readonly cli: Readonly<{
    expectation: Readonly<CliRuntimeExpectation>;
    content_sha256: string;
  }>;
  readonly tidas: Readonly<{
    expectation: Readonly<FoundryTidasRuntimeExpectation>;
    executable_path: string;
  }>;
  readonly qualification_sha256: string;
}

const qualifications = new WeakSet<object>();
const shaPattern = /^[0-9a-f]{64}$/u;
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("runtime_qualification_invalid", `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail("runtime_qualification_invalid", `${label} has unsupported or missing fields.`);
}

function strings(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 32 ||
    value.some((item) => typeof item !== "string" || !item || item.length > 128) ||
    new Set(value).size !== value.length ||
    [...value].sort().some((item, index) => item !== value[index])
  )
    fail(
      "runtime_qualification_invalid",
      `${label} must be a unique, sorted, bounded string array.`,
    );
  return Object.freeze([...value] as string[]);
}

function parseTidasExpectation(value: unknown, platform: string): FoundryTidasRuntimeExpectation {
  const item = record(value, "TIDAS runtime expectation");
  exact(
    item,
    ["schema", "platform", "binary_version", "executable", "validation"],
    "TIDAS runtime expectation",
  );
  const executable = record(item.executable, "TIDAS executable expectation");
  exact(executable, ["bytes", "sha256"], "TIDAS executable expectation");
  const validation = record(item.validation, "TIDAS validation expectation");
  exact(
    validation,
    ["schema_version", "asset_fingerprint", "protocols", "event_schema_versions"],
    "TIDAS validation expectation",
  );
  if (
    item.schema !== FOUNDRY_TIDAS_EXPECTATION_SCHEMA ||
    item.platform !== platform ||
    typeof item.binary_version !== "string" ||
    !versionPattern.test(item.binary_version) ||
    !item.binary_version.startsWith("0.2.") ||
    !Number.isSafeInteger(executable.bytes) ||
    Number(executable.bytes) < 1 ||
    Number(executable.bytes) > 512 * 1024 * 1024 ||
    typeof executable.sha256 !== "string" ||
    !shaPattern.test(executable.sha256) ||
    validation.schema_version !== TIDAS_VALIDATION_DESCRIBE_SCHEMA ||
    typeof validation.asset_fingerprint !== "string" ||
    !shaPattern.test(validation.asset_fingerprint)
  )
    fail(
      "runtime_qualification_invalid",
      "TIDAS expectation does not match the selected platform and v0.2 contract.",
    );
  const protocols = strings(validation.protocols, "TIDAS protocols");
  const eventSchemaVersions = strings(validation.event_schema_versions, "TIDAS event schemas");
  if (
    !protocols.includes("document-validation-batch.v1") ||
    !eventSchemaVersions.includes(TIDAS_VALIDATION_BATCH_FINAL_SCHEMA)
  )
    fail(
      "runtime_qualification_invalid",
      "TIDAS expectation omits the required document-validation protocol.",
    );
  return Object.freeze({
    schema: FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
    platform,
    binary_version: item.binary_version,
    executable: Object.freeze({
      bytes: Number(executable.bytes),
      sha256: executable.sha256,
    }),
    validation: Object.freeze({
      schema_version: TIDAS_VALIDATION_DESCRIBE_SCHEMA,
      asset_fingerprint: validation.asset_fingerprint,
      protocols,
      event_schema_versions: eventSchemaVersions,
    }),
  });
}

export { parseTidasExpectation as parseFoundryTidasRuntimeExpectation };

function hash(value: unknown): string {
  return sha256Json(value);
}

function captureExpectedTidas(
  expectation: FoundryTidasRuntimeExpectation,
  executablePath: string,
): ReturnType<typeof captureFoundryInput> {
  if (!path.isAbsolute(executablePath))
    fail("runtime_tidas_unqualified", "TIDAS executable selection must be absolute.");
  const executable = captureFoundryInput(executablePath);
  if (
    executable.bytes !== expectation.executable.bytes ||
    executable.sha256 !== expectation.executable.sha256
  )
    fail(
      "runtime_tidas_unqualified",
      "TIDAS executable bytes do not match the independent expectation.",
    );
  return executable;
}

function observeTidas(
  context: FoundryRuntimeContext,
  expectation: FoundryTidasRuntimeExpectation,
  executablePath: string,
): ReturnType<typeof captureFoundryInput> {
  const executable = captureExpectedTidas(expectation, executablePath);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-runtime-qualification-"));
  fs.chmodSync(temp, 0o700);
  try {
    const isolatedExecutable = path.join(temp, `tidas-runtime${path.extname(executable.path)}`);
    copyFoundryIsolatedExecutable(executable.path, isolatedExecutable);
    const isolated = captureFoundryInput(isolatedExecutable);
    if (
      isolated.bytes !== expectation.executable.bytes ||
      isolated.sha256 !== expectation.executable.sha256
    )
      fail(
        "runtime_tidas_unqualified",
        "TIDAS executable changed before it could enter the isolated qualification boundary.",
      );
    const environment = createFoundryIsolatedChildEnvironment({
      tempRoot: temp,
      sourceEnv: process.env,
      overrides: { TIDAS_BIN: isolated.path },
    });
    const handshake = runTidasHandshake({
      repoRoot: context.runtimeRoot,
      options: { tidasBin: isolated.path },
      environment,
    });
    if (handshake.stderr || handshake.validation_describe_stderr)
      fail("runtime_tidas_unqualified", "TIDAS qualification produced diagnostics.");
    const validation = handshake.validation_describe;
    const protocols = [...(validation.protocols ?? [])].sort();
    const eventSchemaVersions = [...(validation.event_schema_versions ?? [])].sort();
    if (
      handshake.report.schema_version !== TIDAS_OPERATION_REPORT_SCHEMA ||
      handshake.binary_version !== expectation.binary_version ||
      validation.schema_version !== expectation.validation.schema_version ||
      validation.asset_fingerprint !== expectation.validation.asset_fingerprint ||
      JSON.stringify(protocols) !== JSON.stringify(expectation.validation.protocols) ||
      JSON.stringify(eventSchemaVersions) !==
        JSON.stringify(expectation.validation.event_schema_versions)
    )
      fail(
        "runtime_tidas_unqualified",
        "TIDAS version, protocols or assets do not match the independent expectation.",
      );
    return executable;
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    return fail("runtime_tidas_unqualified", "TIDAS runtime qualification failed closed.");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function portableIdentity(
  context: FoundryRuntimeContext,
  cli: CliRuntimeDescriptor,
  cliExpectation: CliRuntimeExpectation,
  tidasExpectation: FoundryTidasRuntimeExpectation,
) {
  return {
    schema: FOUNDRY_RUNTIME_QUALIFICATION_SCHEMA,
    foundry: {
      package_name: context.runtime.packageName,
      package_version: context.runtime.packageVersion,
      package_manifest_sha256: context.runtime.packageManifestSha256,
      entry_sha256: context.runtime.entrySha256,
      platform: context.platform,
    },
    cli: { expectation: cliExpectation, content_sha256: cli.content_sha256 },
    tidas: { expectation: tidasExpectation },
  };
}

export function qualifyFoundryRuntime(
  context: FoundryRuntimeContext,
  options: {
    cliExpectation: unknown;
    tidasExpectation: unknown;
    tidasExecutable: string;
  },
): QualifiedFoundryRuntime {
  assertFoundryRuntimeContext(context);
  let cli: CliRuntimeDescriptor;
  try {
    cli = assertCliRuntimeMatches(options.cliExpectation);
  } catch {
    return fail(
      "runtime_cli_unqualified",
      "CLI runtime bytes do not match the independently selected C1 expectation.",
    );
  }
  if (cli.package.version !== "0.1.11" || cli.platform !== context.platform)
    fail(
      "runtime_cli_unqualified",
      "Foundry requires the exact CLI 0.1.11 C1 runtime on the selected platform.",
    );
  const cliExpectation = Object.freeze({ ...(options.cliExpectation as CliRuntimeExpectation) });
  if (cliExpectation.schema !== CLI_RUNTIME_EXPECTATION_SCHEMA)
    fail("runtime_cli_unqualified", "CLI runtime expectation is not the supported schema.");
  const tidasExpectation = parseTidasExpectation(options.tidasExpectation, context.platform);
  const executable = observeTidas(context, tidasExpectation, options.tidasExecutable);
  const portable = portableIdentity(context, cli, cliExpectation, tidasExpectation);
  const qualification: QualifiedFoundryRuntime = Object.freeze({
    ...portable,
    foundry: Object.freeze(portable.foundry),
    cli: Object.freeze({
      expectation: cliExpectation,
      content_sha256: cli.content_sha256,
    }),
    tidas: Object.freeze({
      expectation: tidasExpectation,
      executable_path: executable.path,
    }),
    qualification_sha256: hash(portable),
  });
  qualifications.add(qualification);
  return qualification;
}

export function assertQualifiedFoundryRuntime(
  context: FoundryRuntimeContext,
  qualification: QualifiedFoundryRuntime,
): void {
  assertFoundryRuntimeContext(context);
  if (!qualification || !qualifications.has(qualification))
    fail(
      "runtime_qualification_unverified",
      "Serialized or copied runtime qualification is not execution authority.",
    );
  let cli: CliRuntimeDescriptor;
  try {
    cli = assertCliRuntimeMatches(qualification.cli.expectation);
  } catch {
    return fail(
      "runtime_cli_unqualified",
      "CLI runtime changed after its qualification was established.",
    );
  }
  const expected = parseTidasExpectation(qualification.tidas.expectation, context.platform);
  captureExpectedTidas(expected, qualification.tidas.executable_path);
  const portable = portableIdentity(context, cli, qualification.cli.expectation, expected);
  if (
    hash(portable) !== qualification.qualification_sha256 ||
    qualification.foundry.package_manifest_sha256 !== context.runtime.packageManifestSha256 ||
    qualification.foundry.entry_sha256 !== context.runtime.entrySha256
  )
    fail(
      "runtime_qualification_changed",
      "Runtime qualification no longer matches the current Foundry package.",
    );
}

export function foundryRuntimeQualificationIdentity(
  context: FoundryRuntimeContext,
  qualification: QualifiedFoundryRuntime,
) {
  assertQualifiedFoundryRuntime(context, qualification);
  return Object.freeze({
    schema: qualification.schema,
    qualification_sha256: qualification.qualification_sha256,
    cli: Object.freeze({
      package_version: qualification.cli.expectation.package_version,
      platform: qualification.cli.expectation.platform,
      content_sha256: qualification.cli.expectation.content_sha256,
      node_version: qualification.cli.expectation.node_version,
      node_sha256: qualification.cli.expectation.node_sha256,
    }),
    tidas: Object.freeze({
      binary_version: qualification.tidas.expectation.binary_version,
      executable: qualification.tidas.expectation.executable,
      asset_fingerprint: qualification.tidas.expectation.validation.asset_fingerprint,
      protocols: qualification.tidas.expectation.validation.protocols,
      event_schema_versions: qualification.tidas.expectation.validation.event_schema_versions,
    }),
  });
}
