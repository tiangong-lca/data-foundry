import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  copyTrustedRuntimeManifestBytes,
  ensureRuntimeComponents,
  inspectRuntimeComponents,
  type TrustedRuntimeManifest,
  type RuntimePlatform,
} from "@tiangong-lca/cli/runtime";
import inputs from "../../specs/release/runtime-inputs.json" with { type: "json" };
import {
  createFoundryBootstrapLock,
  FOUNDRY_BOOTSTRAP_INTEGRITY,
} from "./foundry-release-bootstrap.ts";
import { fetchFoundryNativeBytes } from "./foundry-release-native.ts";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";
import { assertFoundryOperationResult } from "./foundry-operation-result.ts";
import {
  foundryComponentJson as json,
  foundryComponentHash as hash,
  writeFoundryComponentFile,
} from "./foundry-release-component-io.ts";

type Source = Readonly<{ repository: string; commit: string; tree: string; date: string }>;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Bootstrap qualification received invalid identity data.");
  return value as Record<string, unknown>;
}
function executable(): string {
  if (process.platform !== "win32") return "/bin/sh";
  const system = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!system) throw new Error("Windows bootstrap qualification needs SystemRoot.");
  const found = spawnSync(path.join(system, "System32", "where.exe"), ["pwsh"], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 64 * 1024,
  });
  const candidate = found.stdout?.trim().split(/\r?\n/u)[0];
  if (
    found.status !== 0 ||
    !candidate ||
    !path.isAbsolute(candidate) ||
    !fs.statSync(candidate).isFile()
  )
    throw new Error("Bootstrap qualification needs the installed PowerShell executable.");
  return candidate;
}

export function createFoundryBootstrapEnvironment(
  home: string,
  temporary: string,
): NodeJS.ProcessEnv {
  const localAppData = path.join(home, "AppData", "Local");
  const systemPath =
    process.platform === "win32"
      ? [
          path.join(process.env.SystemRoot ?? process.env.SYSTEMROOT!, "System32"),
          process.env.SystemRoot ?? process.env.SYSTEMROOT!,
        ].join(path.delimiter)
      : "/usr/bin:/bin:/usr/sbin:/sbin";
  const environment: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: localAppData,
    APPDATA: path.join(home, "AppData", "Roaming"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PATH: systemPath,
    Path: systemPath,
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
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
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_ARCHITEW6432",
  ])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  return environment;
}

/** Executes unchanged C1 scripts in a new private home; these reports are evidence, not publication authority. */
export async function qualifyFoundryBootstrap(request: {
  readonly trusted: TrustedRuntimeManifest;
  readonly source: Source;
  readonly mode: "cached" | "public";
  readonly output: string;
  readonly archiveDirectory?: string;
}) {
  const bytes = copyTrustedRuntimeManifestBytes(request.trusted);
  const manifest = request.trusted.manifest;
  const selected = `${process.platform}-${process.arch}`;
  if (
    !Object.hasOwn(inputs.minimum_hosts, selected) ||
    !["cached", "public"].includes(request.mode) ||
    !path.isAbsolute(request.output) ||
    fs.existsSync(request.output)
  )
    throw new Error(
      "Bootstrap qualification requires a supported native host and a new absolute output.",
    );
  const platform = selected as RuntimePlatform;
  if (
    (request.mode === "cached" &&
      (!request.archiveDirectory || !path.isAbsolute(request.archiveDirectory))) ||
    (request.mode === "public" && request.archiveDirectory !== undefined)
  )
    throw new Error(
      "Bootstrap qualification requires exactly the archive inputs for its selected mode.",
    );
  const url = `https://github.com/tiangong-lca/data-foundry/releases/download/foundry-v${manifest.product.version}/runtime-candidate.json`;
  const lock = createFoundryBootstrapLock(request.trusted, url);
  const shell = executable();
  const scripts = await Promise.all(
    (["posix", "powershell"] as const).map(async (kind) => {
      const spec = inputs.cli.bootstrap[kind];
      const content = await fetchFoundryNativeBytes(spec.source_url, spec.sha256);
      if (content.length !== spec.bytes)
        throw new Error("Bootstrap source script size differs from its pinned release.");
      return { kind, bytes: content, sha256: spec.sha256 };
    }),
  );
  const output = path.join(
    fs.realpathSync(path.dirname(request.output)),
    path.basename(request.output),
  );
  fs.mkdirSync(output, { mode: 0o700 });
  const home = path.join(output, "home"),
    workspace = path.join(output, "项目 workspace"),
    temporary = path.join(output, "temp"),
    scriptRoot = path.join(output, "bootstrap");
  for (const dir of [home, workspace, temporary, scriptRoot]) fs.mkdirSync(dir, { mode: 0o700 });
  const localAppData = path.join(home, "AppData", "Local");
  const cache =
    process.platform === "win32"
      ? path.join(localAppData, "tiangong-lca", "runtimes", "v1")
      : process.platform === "darwin"
        ? path.join(home, "Library", "Caches", "tiangong-lca", "runtimes", "v1")
        : path.join(home, ".cache", "tiangong-lca", "runtimes", "v1");
  const environment = createFoundryBootstrapEnvironment(home, temporary);
  const scriptPaths = new Map<string, string>();
  for (const script of scripts) {
    const filename =
      script.kind === "posix" ? "tiangong-runtime-bootstrap.sh" : "tiangong-runtime-bootstrap.ps1";
    writeFoundryComponentFile(
      scriptRoot,
      filename,
      script.bytes,
      script.kind === "posix" ? 0o755 : 0o644,
    );
    scriptPaths.set(script.kind, path.join(scriptRoot, filename));
  }
  writeFoundryComponentFile(scriptRoot, "bootstrap-lock.json", json(lock));
  const status = inspectRuntimeComponents(request.trusted, { cacheDir: cache });
  const node = status.components.find((component) => component.id === "node");
  if (!node) throw new Error("Bootstrap base is absent from the native manifest.");
  if (request.mode === "cached") {
    if (!request.archiveDirectory || !path.isAbsolute(request.archiveDirectory))
      throw new Error("Cached bootstrap qualification requires local qualified archives.");
    const archiveStat = fs.lstatSync(request.archiveDirectory);
    if (!archiveStat.isDirectory() || archiveStat.isSymbolicLink())
      throw new Error("Bootstrap archive inputs require a real directory.");
    const archiveRoot = fs.realpathSync(request.archiveDirectory);
    const seeds: Record<string, string> = {};
    for (const item of status.components) {
      const component = manifest.components.find(
        (value) => value.id === item.id && value.platform === platform,
      )!;
      const filename = new URL(component.archive.url).pathname.split("/").at(-1)!;
      const archive = readFoundryReleaseArtifact(
        path.join(archiveRoot, filename),
        512 * 1024 * 1024,
      );
      if (archive.length !== component.archive.bytes || hash(archive) !== component.archive.sha256)
        throw new Error("Bootstrap seed archive differs from the independent manifest.");
      const copied = writeFoundryComponentFile(output, `seeds/${filename}`, archive);
      seeds[item.key] = path.join(output, copied.path);
    }
    const installed = await ensureRuntimeComponents(request.trusted, {
      cacheDir: cache,
      archiveSeeds: seeds,
      fetchImpl: async () => {
        throw new Error("Cached bootstrap seed preparation must not download components.");
      },
    });
    if (installed.status !== "ready")
      throw new Error("Bootstrap seed cache could not be verified.");
    const component = manifest.components.find(
      (item) => item.id === "node" && item.platform === platform,
    )!;
    const tar =
      process.platform === "win32"
        ? path.join(environment.SystemRoot ?? environment.SYSTEMROOT!, "System32", "tar.exe")
        : "/usr/bin/tar";
    const archive = seeds[node.key];
    const listing = spawnSync(tar, ["-tzf", archive], {
      encoding: "utf8",
      env: environment,
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const verbose = spawnSync(tar, ["-tvzf", archive], {
      encoding: "utf8",
      env: environment,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (
      listing.status !== 0 ||
      verbose.status !== 0 ||
      JSON.stringify(listing.stdout.trimEnd().split(/\r?\n/u).sort()) !==
        JSON.stringify(component.files.map((file) => file.path).sort()) ||
      verbose.stdout
        .trimEnd()
        .split(/\r?\n/u)
        .some((line) => !line.startsWith("-"))
    )
      throw new Error("System tar cannot represent the exact regular-file bootstrap archive.");
    fs.rmSync(node.root, { recursive: true });
    fs.mkdirSync(node.root);
    const extraction = spawnSync(tar, ["-xzf", archive, "-C", node.root], {
      encoding: "utf8",
      env: environment,
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (extraction.status !== 0)
      throw new Error(
        `System bootstrap tar extraction failed: ${extraction.stderr.slice(0, 1024)}`,
      );
    fs.unlinkSync(path.join(path.dirname(node.root), "receipt.json"));
    fs.mkdirSync(path.join(cache, "manifests"), { recursive: true });
    fs.writeFileSync(path.join(cache, "manifests", `${request.trusted.sha256}.json`), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  } else if (request.archiveDirectory !== undefined || fs.existsSync(cache))
    throw new Error("Public bootstrap must begin without a cache or archive seeds.");
  const script = scriptPaths.get(process.platform === "win32" ? "powershell" : "posix")!;
  const prefix =
    process.platform === "win32" ? ["-NoProfile", "-NonInteractive", "-File", script] : [script];
  const checks: Array<{ phase: string; exit: number | null; milliseconds: number }> = [];
  const run = (phase: string, args: string[], expected: number) => {
    const started = performance.now();
    const result = spawnSync(shell, [...prefix, ...args], {
      cwd: workspace,
      env: environment,
      encoding: "utf8",
      timeout: 900_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (
      result.status !== expected ||
      result.error ||
      result.signal ||
      (expected === 0 && result.stderr)
    )
      throw new Error(
        `Copied bootstrap ${phase} failed (exit ${result.status}): ${result.stderr.slice(0, 4096)}`,
      );
    checks.push({
      phase,
      exit: result.status,
      milliseconds: Math.round(performance.now() - started),
    });
    return result;
  };
  const initial = assertFoundryOperationResult(
    JSON.parse(run("initial", ["workspace", "init", "--workspace", workspace, "--json"], 0).stdout),
  );
  if (initial.status !== "ready")
    throw new Error("Copied bootstrap did not initialize its private workspace.");
  const doctor = assertFoundryOperationResult(
    JSON.parse(run("warm", ["doctor", "--workspace", workspace, "--json"], 0).stdout),
  );
  const runtime = object(doctor.runtime_identity),
    qualified = object(runtime.qualification),
    identity = object(qualified.identity),
    cli = object(identity.cli),
    tidas = object(identity.tidas);
  if (
    doctor.status !== "ready" ||
    qualified.status !== "ready" ||
    object(runtime.foundry).package_version !== manifest.product.version ||
    cli.package_version !== inputs.cli.version ||
    cli.node_version !== inputs.node.version ||
    tidas.binary_version !== inputs.tidas.version ||
    inspectRuntimeComponents(request.trusted, { cacheDir: cache }).status !== "ready"
  )
    throw new Error(
      "Copied bootstrap runtime identity or cache differs from the qualified release.",
    );
  const unknown = assertFoundryOperationResult(
    JSON.parse(
      run("developer-command-rejected", ["profiles-list", "--workspace", workspace, "--json"], 2)
        .stdout,
    ),
  );
  if (unknown.status !== "needs_input")
    throw new Error("Copied bootstrap exposed a developer command.");
  const original = readFoundryReleaseArtifact(script, 1024 * 1024);
  fs.appendFileSync(script, "\n");
  try {
    const rejected = run(
      "changed-script-rejected",
      ["workspace", "init", "--workspace", path.join(output, "must-not-exist"), "--json"],
      1,
    );
    if (
      !/bootstrap_script_changed/u.test(rejected.stderr) ||
      fs.existsSync(path.join(output, "must-not-exist"))
    )
      throw new Error("Changed bootstrap script was not rejected before workspace effects.");
  } finally {
    fs.writeFileSync(script, original);
  }
  const integrity = path.join(node.root, FOUNDRY_BOOTSTRAP_INTEGRITY);
  const originalIndex = readFoundryReleaseArtifact(integrity, 16 * 1024 * 1024);
  fs.writeFileSync(integrity, "changed\n");
  try {
    const rejected = run(
      "changed-base-index-rejected",
      ["doctor", "--workspace", workspace, "--json"],
      1,
    );
    if (!/integrity_file_changed/u.test(rejected.stderr))
      throw new Error("Changed base checksum index was not rejected.");
  } finally {
    fs.writeFileSync(integrity, originalIndex);
  }
  const cacheStatus = inspectRuntimeComponents(request.trusted, { cacheDir: cache }).status;
  if (cacheStatus !== "ready")
    throw new Error("Bootstrap qualification did not restore its verified cache.");
  const report = {
    schema: "tiangong-foundry.bootstrap-qualification.v1",
    status: "passed",
    source: request.source,
    platform,
    mode: request.mode,
    manifest_sha256: request.trusted.sha256,
    manifest_url: url,
    script_sha256: {
      posix: inputs.cli.bootstrap.posix.sha256,
      powershell: inputs.cli.bootstrap.powershell.sha256,
    },
    initial_cache: request.mode === "public" ? "empty" : "verified-local-seeds",
    system_tar: request.mode === "cached" ? "verified" : "executed-by-bootstrap",
    runtime_identity: doctor.runtime_identity,
    checks,
    cache_status: cacheStatus,
  };
  writeFoundryComponentFile(output, "bootstrap-qualification.json", json(report));
  return report;
}
