import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureRuntimeComponents,
  inspectRuntimeComponents,
  trustRuntimeManifest,
} from "@tiangong-lca/cli/runtime";
import inputs from "../specs/release/runtime-inputs.json" with { type: "json" };
import { aggregateFoundryRuntimeManifests } from "./lib/foundry-release-aggregate.ts";
import { readFoundryReleaseArtifact } from "./lib/foundry-release-prepared.ts";
import { readFoundryReleaseGit as git } from "./lib/foundry-release-contract.ts";
import { sameFoundryReleaseDirectory } from "./lib/foundry-release-root.ts";
import { createFoundryBootstrapLock } from "./lib/foundry-release-bootstrap.ts";
import {
  foundryComponentJson as json,
  foundryComponentHash as hash,
  writeFoundryComponentFile,
  freezeFoundryReleaseValue,
} from "./lib/foundry-release-component-io.ts";

const usage =
  "Usage: release-aggregate-runtime --input <absolute-platform-results> --output <new-absolute-directory> [--candidate]";
const root = path.resolve(import.meta.dirname, "..");
const aggregates = new WeakSet<object>();
function sourceState() {
  if (
    !sameFoundryReleaseDirectory(root, git(root, ["rev-parse", "--show-toplevel"]).trim()) ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("Runtime aggregation requires its own clean source checkout.");
  return {
    repository: "https://github.com/tiangong-lca/foundry",
    commit: git(root, ["rev-parse", "HEAD"]).trim(),
    tree: git(root, ["rev-parse", "HEAD^{tree}"]).trim(),
    date: new Date(git(root, ["show", "-s", "--format=%cI", "HEAD"]).trim()).toISOString(),
  };
}
function directory(value: string): string {
  if (!path.isAbsolute(value)) throw new Error("Aggregation paths must be absolute.");
  const stat = fs.lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Aggregation requires real input directories.");
  return fs.realpathSync(value);
}
function parse(file: string): unknown {
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      readFoundryReleaseArtifact(file, 32 * 1024 * 1024),
    ),
  );
}

export async function prepareFoundryRuntimeAggregate(
  selectedInput: string,
  selectedOutput: string,
  scope: "source-candidate" | "published-release",
) {
  const input = directory(selectedInput);
  if (!path.isAbsolute(selectedOutput)) throw new Error("Aggregation output must be absolute.");
  const output = path.join(directory(path.dirname(selectedOutput)), path.basename(selectedOutput));
  if (fs.existsSync(output)) throw new Error("Aggregation will not replace an existing output.");
  const relative = path.relative(root, output);
  if (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !relative.startsWith(`package-artifacts${path.sep}`)
  )
    throw new Error("Aggregation output must be outside source or under package-artifacts/.");
  const source = sourceState();
  const version = (parse(path.join(root, "package.json")) as { version: string }).version;
  const platforms = Object.keys(inputs.minimum_hosts).sort();
  if (JSON.stringify(fs.readdirSync(input).sort()) !== JSON.stringify(platforms))
    throw new Error("Aggregation input must contain exactly four platform directories.");
  const results = platforms.map((platform) => {
    const selected = directory(path.join(input, platform));
    return {
      manifestBytes: readFoundryReleaseArtifact(
        path.join(selected, "runtime-manifest.json"),
        32 * 1024 * 1024,
      ),
      preparation: parse(path.join(selected, "runtime-platform.json")),
      qualification: parse(path.join(selected, "runtime-qualification.json")),
    };
  });
  const aggregate = aggregateFoundryRuntimeManifests(results, { source, version, scope });
  const trusted = trustRuntimeManifest(aggregate.bytes, aggregate.sha256);
  fs.mkdirSync(output, { mode: 0o700 });
  const created = fs.lstatSync(output, { bigint: true });
  let cache: string | undefined;
  try {
    cache = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-aggregate-verification-"));
    const archives = [];
    for (const item of aggregate.platforms) {
      const platform = item.platform,
        minimum = inputs.minimum_hosts[platform];
      const origin = directory(path.join(input, platform, "components"));
      const components = aggregate.manifest.components.filter(
        (component) => component.platform === platform,
      );
      const names = components.map((component) =>
        new URL(component.archive.url).pathname.split("/").at(-1)!,
      );
      if (JSON.stringify(fs.readdirSync(origin).sort()) !== JSON.stringify([...names].sort()))
        throw new Error("Aggregation found missing or extra component archives.");
      const paths = new Map<string, string>();
      for (const [index, component] of components.entries()) {
        const bytes = readFoundryReleaseArtifact(
          path.join(origin, names[index]),
          512 * 1024 * 1024,
        );
        if (bytes.length !== component.archive.bytes || hash(bytes) !== component.archive.sha256)
          throw new Error("Aggregation archive differs from its qualified component.");
        const fact = writeFoundryComponentFile(output, `components/${names[index]}`, bytes);
        paths.set(component.id, path.join(output, fact.path));
        archives.push({ platform, id: component.id, ...fact });
      }
      // The foreign-host selector validates archive structure/inventory only; it
      // never executes a foreign binary or substitutes for the native job result.
      const host = { platform, osRelease: minimum.os_release, glibc: minimum.glibc };
      const status = inspectRuntimeComponents(trusted, { host, cacheDir: cache });
      const archiveSeeds = Object.fromEntries(
        status.components.map((component) => [component.key, paths.get(component.id)!]),
      );
      const verified = await ensureRuntimeComponents(trusted, {
        host,
        cacheDir: cache,
        archiveSeeds,
        fetchImpl: async () => {
          throw new Error("Aggregation must use its verified local archives.");
        },
      });
      if (verified.status !== "ready")
        throw new Error("Aggregated archive inventory verification failed.");
    }
    if (JSON.stringify(sourceState()) !== JSON.stringify(source))
      throw new Error("Aggregation source changed during verification.");
    writeFoundryComponentFile(output, "runtime-manifest.json", aggregate.bytes);
    const bootstrapLock = json(
      createFoundryBootstrapLock(
        trusted,
        `https://github.com/tiangong-lca/foundry/releases/download/foundry-v${version}/runtime-candidate.json`,
      ),
    );
    const bootstrap = writeFoundryComponentFile(output, "bootstrap-lock.json", bootstrapLock);
    const report = {
      schema: "tiangong-foundry.runtime-aggregate.v1",
      status: "verified",
      scope,
      source,
      version,
      package: aggregate.package,
      manifest_sha256: aggregate.sha256,
      platforms: aggregate.platforms,
      archives,
      bootstrap,
    };
    writeFoundryComponentFile(output, "runtime-aggregate.json", json(report));
    const result = freezeFoundryReleaseValue({ output, ...report, manifest: aggregate.manifest });
    aggregates.add(result);
    return result;
  } catch (error) {
    const current = fs.lstatSync(output, { bigint: true });
    if (
      current.isDirectory() &&
      !current.isSymbolicLink() &&
      current.dev === created.dev &&
      current.ino === created.ino
    )
      fs.rmSync(output, { recursive: true, force: true });
    throw error;
  } finally {
    if (cache) fs.rmSync(cache, { recursive: true, force: true });
  }
}

export type PreparedFoundryRuntimeAggregate = Awaited<
  ReturnType<typeof prepareFoundryRuntimeAggregate>
>;
/** Rechecks fresh process-local aggregation before exposing release bytes. */
export function readPreparedFoundryRuntimeAggregate(value: PreparedFoundryRuntimeAggregate) {
  if (!value || !aggregates.has(value))
    throw new Error("Release requires fresh in-process runtime aggregation.");
  if (JSON.stringify(sourceState()) !== JSON.stringify(value.source))
    throw new Error("Aggregated release source changed.");
  const output = directory(value.output);
  directory(path.join(output, "components"));
  const manifestBytes = readFoundryReleaseArtifact(
    path.join(output, "runtime-manifest.json"),
    32 * 1024 * 1024,
  );
  if (hash(manifestBytes) !== value.manifest_sha256)
    throw new Error("Aggregated manifest changed.");
  const { output: _output, manifest: _manifest, ...report } = value;
  const reportBytes = readFoundryReleaseArtifact(
    path.join(output, "runtime-aggregate.json"),
    32 * 1024 * 1024,
  );
  if (!reportBytes.equals(json(report))) throw new Error("Aggregated report changed.");
  const bootstrapLockBytes = readFoundryReleaseArtifact(
    path.join(output, value.bootstrap.path),
    32 * 1024 * 1024,
  );
  if (
    bootstrapLockBytes.length !== value.bootstrap.bytes ||
    hash(bootstrapLockBytes) !== value.bootstrap.sha256
  )
    throw new Error("Aggregated bootstrap lock changed.");
  const archives = value.archives.map((fact) => {
    const bytes = readFoundryReleaseArtifact(path.join(output, fact.path), 512 * 1024 * 1024);
    if (bytes.length !== fact.bytes || hash(bytes) !== fact.sha256)
      throw new Error("Aggregated release archive changed.");
    return { name: path.basename(fact.path), bytes };
  });
  return { manifestBytes, reportBytes, archives, bootstrapLockBytes };
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (
    (args.length !== 4 && args.length !== 5) ||
    args[0] !== "--input" ||
    !args[1] ||
    args[2] !== "--output" ||
    !args[3] ||
    (args.length === 5 && args[4] !== "--candidate")
  )
    throw new Error(usage);
  const result = await prepareFoundryRuntimeAggregate(
    args[1],
    args[3],
    args.length === 5 ? "source-candidate" : "published-release",
  );
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `manifest_sha256=${result.manifest_sha256}\n`);
  process.stdout.write(
    json({
      status: "verified",
      scope: result.scope,
      source: result.source.commit,
      output: result.output,
      manifest_sha256: result.manifest_sha256,
      platforms: result.platforms.map((item) => item.platform),
      components: result.archives.length,
    }),
  );
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Runtime aggregation failed."}\n`,
    );
    process.exitCode = 1;
  });
