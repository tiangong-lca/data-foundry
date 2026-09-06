import fs from "node:fs";
import path from "node:path";
import {
  RUNTIME_HOST_CONTEXT_PROTOCOL,
  assertCliRuntimeMatches,
  inspectRuntimeComponents,
  receiveRuntimeHostContext,
  trustRuntimeManifest,
  type RuntimeHostContext,
  type RuntimeLaunch,
} from "@tiangong-lca/cli/runtime";
import type { FoundryRuntimeCommandHost } from "../runtime-entry.ts";
import { FoundryContextError } from "./foundry-runtime-error.ts";
import { describeFoundryRuntime } from "./foundry-runtime-paths.ts";
import { assertFoundryPackage } from "./foundry-package-contract.ts";
import { parseFoundryTidasRuntimeExpectation } from "./foundry-runtime-qualification.ts";
import { transferHash, transferRead } from "./foundry-migration-transfer-io.ts";

export const FOUNDRY_MANAGED_RUNTIME_SCHEMA = "tiangong-foundry.managed-runtime.v1" as const;
export const FOUNDRY_MANAGED_RUNTIME_PATH = "metadata/foundry-runtime.json" as const;

type Reference = RuntimeLaunch["executable"];
type PreparedHost = Omit<FoundryRuntimeCommandHost, "signal" | "writeStdout" | "setExitCode">;
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u;

function fail(message: string): never {
  throw new FoundryContextError("managed_runtime_invalid", message);
}

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object.`);
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== keys.length || keys.some((key) => !Object.hasOwn(item, key)))
    fail(`${label} has missing or unsupported fields.`);
  return item;
}

function reference(value: unknown): Reference {
  const item = object(value, ["component", "path"], "Managed component reference");
  if (
    typeof item.component !== "string" ||
    !identifier.test(item.component) ||
    typeof item.path !== "string"
  )
    fail("Managed component references require a declared component and file.");
  return { component: item.component, path: item.path };
}

function decode(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function prepare(context: RuntimeHostContext): PreparedHost {
  const runtime = describeFoundryRuntime(import.meta.url);
  const descriptor = assertFoundryPackage(runtime.runtimeRoot);
  if (
    runtime.mode !== "emitted" ||
    context.manifest.manifest.product.id !== "tiangong-foundry" ||
    context.manifest.manifest.product.version !== descriptor.package.version
  )
    fail("The managed manifest must select this installed Foundry package.");
  const inspected = inspectRuntimeComponents(context.manifest, {
    cacheDir: context.cacheDir,
    host: context.host,
  });
  if (inspected.status !== "ready") fail("Managed components changed before Foundry admission.");
  const selected = context.manifest.manifest.launches.find(
    (item) => item.platform === context.host.platform && item.id === context.entry,
  );
  if (
    !selected ||
    selected.context_protocol !== RUNTIME_HOST_CONTEXT_PROTOCOL ||
    selected.argv.length !== 1
  )
    fail("The managed launch must select the Foundry package entry directly.");
  const application = reference(selected.argv[0]);
  const file = (ref: Reference) => {
    const component = context.manifest.manifest.components.find(
      (item) => item.platform === context.host.platform && item.id === ref.component,
    );
    const fact = component?.files.find((item) => item.path === ref.path);
    const installed = inspected.components.find(
      (item) => item.id === ref.component && item.status === "ready",
    );
    if (!component || !fact || !installed)
      fail("Managed runtime bindings must name verified component files.");
    return { component, fact, absolute: path.join(installed.root, fact.path) };
  };
  const bytes = (ref: Reference, limit: number) => {
    const bound = file(ref);
    if (bound.fact.bytes > limit) fail("Managed runtime metadata exceeds its admission limit.");
    const value = transferRead(bound.absolute, limit);
    if (value.length !== bound.fact.bytes || transferHash(value) !== bound.fact.sha256)
      fail("Managed runtime metadata changed after component verification.");
    return value;
  };
  const applicationFile = file(application);
  if (
    !applicationFile.component.protocols.includes(FOUNDRY_MANAGED_RUNTIME_SCHEMA) ||
    fs.realpathSync(applicationFile.absolute) !== runtime.entryPath ||
    !process.argv[1] ||
    fs.realpathSync(process.argv[1]) !== runtime.entryPath ||
    runtime.entryRepoRelativePath !== descriptor.package.bin
  )
    fail("The managed launch and executing package entry do not match.");
  const decoded = decode(
    bytes({ component: application.component, path: FOUNDRY_MANAGED_RUNTIME_PATH }, 256 * 1024),
  );
  if (
    decoded &&
    typeof decoded === "object" &&
    !Array.isArray(decoded) &&
    "schema" in decoded &&
    typeof decoded.schema === "string" &&
    decoded.schema !== FOUNDRY_MANAGED_RUNTIME_SCHEMA
  )
    throw new FoundryContextError(
      "managed_runtime_unsupported",
      "This Foundry package cannot read the selected managed runtime protocol.",
    );
  const input = object(
    decoded,
    ["schema", "platform", "cli", "tidas", "launches"],
    "Foundry managed runtime",
  );
  if (input.schema !== FOUNDRY_MANAGED_RUNTIME_SCHEMA)
    fail("Managed runtime metadata requires its supported schema identifier.");
  if (input.platform !== context.host.platform)
    fail("Managed runtime metadata must match the current platform.");
  const cli = object(
    input.cli,
    ["schema", "package_version", "platform", "content_sha256", "node_version", "node_sha256"],
    "Managed CLI expectation",
  );
  const observedCli = assertCliRuntimeMatches(cli);
  if (
    observedCli.package.version !== descriptor.package.cli_dependency.version ||
    file(selected.executable).fact.sha256 !== cli.node_sha256
  )
    fail("The managed CLI and Node must match this package's independently selected runtime.");
  const tidas = object(input.tidas, ["executable", "expectation"], "Managed TIDAS binding");
  const tidasFile = file(reference(tidas.executable));
  const tidasExpectation = parseFoundryTidasRuntimeExpectation(
    tidas.expectation,
    context.host.platform,
  );
  if (
    tidasFile.fact.mode !== 0o755 ||
    tidasFile.fact.bytes !== tidasExpectation.executable.bytes ||
    tidasFile.fact.sha256 !== tidasExpectation.executable.sha256
  )
    fail("The managed TIDAS expectation must bind its selected executable bytes.");
  if (!Array.isArray(input.launches) || input.launches.length < 1 || input.launches.length > 16)
    fail("Managed runtime metadata requires a bounded launch policy.");
  const seen = new Set<string>();
  const policies = input.launches.map(
    (value: unknown): { id: string; access: "read" | "write"; target: Reference | null } => {
      const item = object(value, ["id", "access", "target"], "Managed launch policy");
      if (
        typeof item.id !== "string" ||
        !identifier.test(item.id) ||
        seen.has(item.id) ||
        (item.access !== "read" && item.access !== "write")
      )
        fail("Managed launch policy requires unique ids and explicit read/write access.");
      seen.add(item.id);
      const launch = context.manifest.manifest.launches.find(
        (candidate) => candidate.platform === context.host.platform && candidate.id === item.id,
      );
      if (
        !launch ||
        launch.context_protocol !== RUNTIME_HOST_CONTEXT_PROTOCOL ||
        launch.argv.length !== 1 ||
        launch.executable.component !== selected.executable.component ||
        launch.executable.path !== selected.executable.path
      )
        fail("Every managed policy must select the declared Node and Foundry entry.");
      const entry = reference(launch.argv[0]);
      if (entry.component !== application.component || entry.path !== application.path)
        fail("Managed launch policies cannot redirect the package entry.");
      const target = item.target === null ? null : reference(item.target);
      if (target) file(target);
      return { id: item.id, access: item.access, target };
    },
  );
  const policy = policies.find((item) => item.id === context.entry);
  if (!policy) fail("The selected launch has no Foundry access policy.");
  const target = policy.target
    ? trustRuntimeManifest(bytes(policy.target, 32 * 1024 * 1024), file(policy.target).fact.sha256)
    : context.manifest;
  if (target.manifest.product.id !== "tiangong-foundry")
    fail("Runtime selection targets must be Foundry manifests.");
  return Object.freeze({
    workspaceAccess: Object.freeze({ manifest: context.manifest, access: policy.access }),
    runtimeSelection: Object.freeze({
      cliExpectation: Object.freeze(cli),
      tidasExpectation,
      tidasExecutable: tidasFile.absolute,
    }),
    runtimeTarget: target,
    runtimeManager: Object.freeze({ cacheDir: context.cacheDir, host: context.host }),
    cacheBase: path.join(context.cacheDir, "foundry-workspaces"),
  });
}

/** Package-owned initializer; it accepts no task, environment or argv trust anchors. */
export async function receiveFoundryManagedHost(signal: AbortSignal): Promise<PreparedHost> {
  if (typeof process.send !== "function") return {};
  const abort = () => {
    if (process.connected) process.disconnect?.();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) abort();
    const context = await receiveRuntimeHostContext();
    if (signal.aborted)
      throw new FoundryContextError("operation_interrupted", "Managed startup was interrupted.");
    return prepare(context);
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    throw new FoundryContextError(
      "managed_runtime_invalid",
      "Foundry could not verify the managed host context and component bindings.",
    );
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
