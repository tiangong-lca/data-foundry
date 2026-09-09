import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { executeRuntimeLaunch, inspectRuntimeComponents } from "@tiangong-lca/cli/runtime";
import { FOUNDRY_BOOTSTRAP_CLI } from "./foundry-release-bootstrap.ts";
import { assertFoundryOperationResult } from "./foundry-operation-result.ts";
import {
  preparedFoundryRuntimeAuthority,
  type PreparedFoundryRuntimeComponents,
} from "./foundry-release-components.ts";
import {
  foundryComponentJson as json,
  writeFoundryComponentFile,
  freezeFoundryReleaseValue,
} from "./foundry-release-component-io.ts";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Runtime qualification received an invalid identity object.");
  return value as Record<string, unknown>;
}

/** Independent public-CLI consumer of the in-process prepared artifacts; no receipt grants authority. */
export async function qualifyFoundryRuntimeComponents(prepared: PreparedFoundryRuntimeComponents) {
  const authority = preparedFoundryRuntimeAuthority(prepared);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-runtime-qualification-"));
  const cache = path.join(root, "component-cache");
  const workspace = path.join(root, "项目 workspace");
  const home = path.join(root, "home"),
    temporary = path.join(root, "temp"),
    emptyPath = path.join(root, "no-global-tools");
  for (const directory of [workspace, home, temporary, emptyPath]) fs.mkdirSync(directory);
  const environment: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    PATH: emptyPath,
    Path: emptyPath,
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary,
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
  };
  for (const key of [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "windir",
    "ComSpec",
    "COMSPEC",
    "PATHEXT",
  ])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  let downloads = 0,
    launches = 0;
  const checks: Array<{
    operation: string;
    entry: string;
    exit: number;
    status: string;
    milliseconds: number;
  }> = [];
  let failure: Record<string, unknown> = { phase: "setup" };
  const run = async (entry: string, argv: string[], expectedExit: number, seed = false) => {
    const started = performance.now();
    failure = { phase: "launch", entry, index: launches, expected_exit: expectedExit };
    const result = await executeRuntimeLaunch(authority.manifest, {
      cacheDir: cache,
      entry,
      cwd: workspace,
      argv,
      env: environment,
      archiveSeeds: seed ? authority.seeds : {},
      timeoutMs: 120_000,
      fetchImpl: async () => {
        downloads += 1;
        throw new Error("Qualified local archives and warm cache must not download components.");
      },
    });
    launches += 1;
    failure = {
      ...failure,
      observed_exit: result.status,
      signalled: Boolean(result.signal),
      execution_error: Boolean(result.error),
      stderr_present: Boolean(result.stderr),
      stdout_lines: result.stdout.trimEnd().split("\n").length,
    };
    if (
      result.status !== expectedExit ||
      result.signal ||
      result.error ||
      result.stderr ||
      result.stdout.trimEnd().split("\n").length !== 1
    )
      throw new Error(
        `Assembled runtime launch failed its public result contract (${entry}, expected exit ${expectedExit}, observed ${result.status}).`,
      );
    const value = assertFoundryOperationResult(JSON.parse(result.stdout));
    checks.push({
      operation: value.operation,
      entry,
      exit: expectedExit,
      status: value.status,
      milliseconds: Math.round(performance.now() - started),
    });
    return value;
  };
  try {
    if (inspectRuntimeComponents(authority.manifest, { cacheDir: cache }).status === "ready")
      throw new Error("Runtime cold qualification did not start with an empty cache.");
    const init = await run(
      "foundry",
      ["workspace", "init", "--workspace", workspace, "--json"],
      0,
      true,
    );
    if (init.status !== "ready")
      throw new Error("Assembled runtime did not initialize its isolated workspace.");
    const doctor = await run("foundry", ["doctor", "--workspace", workspace, "--json"], 0);
    const runtime = object(doctor.runtime_identity),
      foundry = object(runtime.foundry),
      qualification = object(runtime.qualification);
    const identity = object(qualification.identity),
      cli = object(identity.cli),
      tidas = object(identity.tidas);
    if (
      doctor.status !== "ready" ||
      qualification.status !== "ready" ||
      foundry.package_version !== authority.expected.foundry ||
      cli.package_version !== authority.expected.cli ||
      cli.node_version !== authority.expected.node ||
      tidas.binary_version !== authority.expected.tidas ||
      tidas.asset_fingerprint !== authority.expected.assetFingerprint
    )
      throw new Error(
        "Assembled runtime identity differs from its independently prepared package and native inputs.",
      );
    const source = path.join(workspace, "source.jsonl"),
      spec = path.join(workspace, "task.json");
    fs.writeFileSync(source, '{"flowDataSet":{}}\n');
    fs.writeFileSync(
      spec,
      json({
        schema: "tiangong-foundry.task-start.v1",
        request_id: "runtime-qualification",
        actor_id: "release-qualifier",
        lane: "external-dataset-curated-import",
        profile_id: "generic",
        target_entities: ["flow"],
        sources: [{ path: source }],
        seed: null,
        account_intent: null,
        preparation: {
          operation: "dataset-curation-cleanup",
          type: "flow",
          input: source,
          source_input: null,
          output_directory: "outputs/cleanup",
        },
      }),
    );
    const started = await run(
      "foundry",
      ["task", "start", "--workspace", workspace, "--spec", spec, "--json"],
      0,
    );
    if (!started.task_id || started.status !== "ready")
      throw new Error("Assembled runtime did not register its local qualification task.");
    const task = [
      "--workspace",
      workspace,
      "--task",
      started.task_id,
      "--actor",
      "release-qualifier",
      "--json",
    ];
    await run("foundry", ["task", "status", ...task], 0);
    await run("foundry", ["task", "resume", ...task], 0);
    const selection = (request: string, access: string) => [
      "workspace",
      "migrate",
      "--workspace",
      workspace,
      "--runtime-use",
      "--actor",
      "release-qualifier",
      "--request",
      request,
      "--access",
      access,
      "--json",
    ];
    await run("foundry", selection("read-selection", "read"), 0);
    await run("foundry-read", ["task", "status", ...task], 0);
    await run("foundry", ["workspace", "init", "--workspace", workspace, "--json"], 4);
    await run("foundry", selection("restore-writer", "write"), 0);
    await run("foundry", ["doctor", "--workspace", workspace, "--json"], 0);
    await run("foundry", ["profiles-list", "--workspace", workspace, "--json"], 2);
    if (
      downloads ||
      inspectRuntimeComponents(authority.manifest, { cacheDir: cache }).status !== "ready"
    )
      throw new Error("Warm runtime qualification downloaded or changed its verified components.");
    const nodeBase = inspectRuntimeComponents(authority.manifest, {
      cacheDir: cache,
    }).components.find((component) => component.id === "node");
    if (!nodeBase) throw new Error("Bootstrap base is missing after native qualification.");
    const receipt = path.join(path.dirname(nodeBase.root), "receipt.json");
    fs.unlinkSync(receipt);
    for (const phase of ["bootstrap-adoption", "bootstrap-warm"]) {
      failure = { phase };
      const started = performance.now();
      const output = spawnSync(
        path.join(nodeBase.root, `bin/node${prepared.platform === "win32-x64" ? ".exe" : ""}`),
        [
          path.join(nodeBase.root, FOUNDRY_BOOTSTRAP_CLI),
          "runtime",
          "exec",
          "--manifest",
          path.join(prepared.output, prepared.manifest.file),
          "--manifest-sha256",
          prepared.manifest.sha256,
          "--cache-dir",
          cache,
          "--entry",
          "foundry",
          "--cwd",
          workspace,
          "--",
          "doctor",
          "--workspace",
          workspace,
          "--json",
        ],
        {
          cwd: workspace,
          env: environment,
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      if (
        output.status !== 0 ||
        output.signal ||
        output.error ||
        output.stderr ||
        output.stdout.trimEnd().split("\n").length !== 1
      )
        throw new Error(`Bootstrap base CLI failed ${phase}.`);
      const result = assertFoundryOperationResult(JSON.parse(output.stdout));
      const identity = object(object(object(result.runtime_identity).qualification).identity);
      if (
        result.status !== "ready" ||
        object(identity.cli).package_version !== authority.expected.cli ||
        object(identity.cli).node_version !== authority.expected.node ||
        object(identity.tidas).binary_version !== authority.expected.tidas ||
        !fs.existsSync(receipt)
      )
        throw new Error(
          "Bootstrap base identity or cache adoption differs from its expected runtime.",
        );
      launches += 1;
      checks.push({
        operation: result.operation,
        entry: phase,
        exit: 0,
        status: result.status,
        milliseconds: Math.round(performance.now() - started),
      });
    }
    if (inspectRuntimeComponents(authority.manifest, { cacheDir: cache }).status !== "ready")
      throw new Error("Bootstrap base did not leave a verified warm cache.");
    preparedFoundryRuntimeAuthority(prepared);
    const report = freezeFoundryReleaseValue({
      schema: "tiangong-foundry.runtime-component-qualification.v1",
      status: "passed",
      scope: "native-local-archive-runtime",
      source: prepared.source,
      platform: prepared.platform,
      manifest_sha256: prepared.manifest.sha256,
      package_source: prepared.scope,
      runtime_identity: doctor.runtime_identity,
      manager_download_calls: downloads,
      launches,
      bootstrap_base: { status: "passed", receipt_adopted: true, warm_verified: true },
      checks,
      global_node_or_package_manager_required: false,
      release_blockers: prepared.release_blockers,
    });
    writeFoundryComponentFile(prepared.output, "runtime-qualification.json", json(report));
    return report;
  } catch (error) {
    const report = {
      schema: "tiangong-foundry.runtime-diagnostic.v1",
      status: "failed",
      source: prepared.source,
      platform: prepared.platform,
      failure,
      completed_checks: checks,
      launches,
      manager_download_calls: downloads,
    };
    writeFoundryComponentFile(prepared.output, "runtime-diagnostic.json", json(report));
    process.stderr.write(`${JSON.stringify(report)}\n`);
    throw error;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
