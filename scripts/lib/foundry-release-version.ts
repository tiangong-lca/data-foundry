import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const versionPaths = [
  "package.json",
  "scripts/lib/foundry-package-contract.ts",
  "specs/schemas/foundry-package-descriptor.schema.json",
] as const;
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const maxMetadataBytes = 2 * 1024 * 1024;

export interface FoundryReleaseVersionFile {
  readonly path: string;
  readonly beforeSha256: string;
  readonly afterSha256: string;
}

export interface FoundryReleaseVersionPlan {
  readonly schema: "tiangong-foundry.release-version-plan.v1";
  readonly status: "planned" | "unchanged";
  readonly currentVersion: string;
  readonly version: string;
  readonly files: readonly FoundryReleaseVersionFile[];
}

interface VersionSource {
  readonly relative: string;
  readonly content: string;
  readonly mode: number;
}

interface VersionUpdate extends VersionSource {
  readonly replacement: string;
}

const plans = new WeakMap<
  FoundryReleaseVersionPlan,
  {
    root: string;
    updates: readonly VersionUpdate[];
  }
>();

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function versionParts(value: string): bigint[] {
  if (value.length > 64 || !stableVersion.test(value))
    throw new Error("Release version must be stable canonical major.minor.patch.");
  const parts = value.split(".").map((part) => BigInt(part));
  if (parts.some((part) => part > BigInt(Number.MAX_SAFE_INTEGER)))
    throw new Error("Release version component exceeds the supported integer range.");
  return parts;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Release version ${label} must be an object.`);
  return value as Record<string, unknown>;
}

function readSource(root: string, relative: string): VersionSource {
  const file = path.join(root, relative);
  if (fs.realpathSync(path.dirname(file)) !== path.dirname(file))
    throw new Error(
      `Release version metadata must remain in the real repository tree: ${relative}`,
    );
  let fd: number;
  try {
    const entry = fs.lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("non-regular metadata");
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    throw new Error(`Release version metadata must be a regular file: ${relative}`);
  }
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > maxMetadataBytes)
      throw new Error(`Release version metadata size is invalid: ${relative}`);
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    const current = fs.lstatSync(file);
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      current.isSymbolicLink()
    )
      throw new Error(`Release version metadata changed during read: ${relative}`);
    const content = bytes.toString("utf8");
    if (!Buffer.from(content).equals(bytes))
      throw new Error(`Release version metadata is not valid UTF-8: ${relative}`);
    return { relative, content, mode: before.mode & 0o777 };
  } finally {
    fs.closeSync(fd);
  }
}

function replaceProjection(
  content: string,
  expression: RegExp,
  current: string,
  version: string,
  label: string,
): string {
  const matches = [...content.matchAll(expression)];
  if (matches.length !== 1 || matches[0][2] !== current)
    throw new Error(`Release version ${label} must match one coherent canonical projection.`);
  return content.replace(
    expression,
    (_whole, before: string, _old: string, after: string) => `${before}${version}${after}`,
  );
}

export function projectFoundryReleaseVersion(
  metadata: Readonly<Record<string, string>>,
  version: string,
): { readonly currentVersion: string; readonly replacements: Readonly<Record<string, string>> } {
  const targetParts = versionParts(version);
  const sources = versionPaths.map((relative) => {
    const content = metadata[relative];
    if (typeof content !== "string")
      throw new Error(`Missing release version projection: ${relative}`);
    return { content };
  });
  const manifest = record(JSON.parse(sources[0].content), "manifest");
  if (manifest.name !== "@tiangong-lca/foundry" || typeof manifest.version !== "string")
    throw new Error("Release version package identity is not @tiangong-lca/foundry.");
  const currentVersion = manifest.version;
  const currentParts = versionParts(currentVersion);
  const comparison = targetParts.findIndex((part, index) => part !== currentParts[index]);
  if (comparison >= 0 && targetParts[comparison] < currentParts[comparison])
    throw new Error("Release version cannot decrease.");
  const schema = record(JSON.parse(sources[2].content), "descriptor schema");
  const schemaProperties = record(schema.properties, "schema properties");
  const packageProperties = record(
    record(schemaProperties.package, "package schema").properties,
    "package properties",
  );
  if (
    record(packageProperties.name, "package name").const !== manifest.name ||
    record(packageProperties.version, "package version").const !== currentVersion
  )
    throw new Error("Release version schema and manifest must be coherent.");

  const replacements = [
    replaceProjection(
      sources[0].content,
      /^( {2}"version": ")([^"]+)(",?)$/gmu,
      currentVersion,
      version,
      "manifest",
    ),
    replaceProjection(
      sources[1].content,
      /^(const packageVersion = ")([^"]+)(";)$/gmu,
      currentVersion,
      version,
      "compiled verifier",
    ),
    replaceProjection(
      sources[2].content,
      /^( {8}"version": \{\r?\n {10}"const": ")([^"]+)("\r?\n {8}\},?)$/gmu,
      currentVersion,
      version,
      "descriptor schema",
    ),
  ];
  return Object.freeze({
    currentVersion,
    replacements: Object.freeze(
      Object.fromEntries(versionPaths.map((file, index) => [file, replacements[index]])),
    ),
  });
}

export const foundryReleaseVersionPaths = versionPaths;

export function planFoundryReleaseVersion(
  repoRoot: string,
  version: string,
): FoundryReleaseVersionPlan {
  const root = fs.realpathSync(repoRoot);
  if (!fs.statSync(root).isDirectory() || root === path.parse(root).root)
    throw new Error("Release version requires a repository directory.");
  const sources = versionPaths.map((relative) => readSource(root, relative));
  const projection = projectFoundryReleaseVersion(
    Object.fromEntries(sources.map((source) => [source.relative, source.content])),
    version,
  );
  const currentVersion = projection.currentVersion;
  const updates = sources.map((source) => ({
    ...source,
    replacement: projection.replacements[source.relative],
  }));
  const changed = currentVersion !== version;
  const plan: FoundryReleaseVersionPlan = Object.freeze({
    schema: "tiangong-foundry.release-version-plan.v1",
    status: changed ? "planned" : "unchanged",
    currentVersion,
    version,
    files: Object.freeze(
      changed
        ? updates.map((update) =>
            Object.freeze({
              path: update.relative,
              beforeSha256: sha256(update.content),
              afterSha256: sha256(update.replacement),
            }),
          )
        : [],
    ),
  });
  plans.set(plan, { root, updates });
  return plan;
}

export function applyFoundryReleaseVersion(plan: FoundryReleaseVersionPlan): {
  readonly schema: "tiangong-foundry.release-version-result.v1";
  readonly status: "updated" | "unchanged";
  readonly version: string;
  readonly changedPaths: readonly string[];
} {
  const state = plans.get(plan);
  if (!state) throw new Error("Release version apply requires a fresh in-process plan.");
  const verifySources = () => {
    for (const update of state.updates) {
      const current = readSource(state.root, update.relative);
      if (current.content !== update.content || current.mode !== update.mode)
        throw new Error(`Release version source changed after planning: ${update.relative}`);
    }
  };
  verifySources();
  if (plan.status === "unchanged") {
    return {
      schema: "tiangong-foundry.release-version-result.v1",
      status: "unchanged",
      version: plan.version,
      changedPaths: [],
    };
  }
  const temporary = new Map<string, string>();
  const changedPaths: string[] = [];
  try {
    for (const update of state.updates) {
      const file = path.join(state.root, update.relative);
      const staged = path.join(
        path.dirname(file),
        `.${path.basename(file)}.release-${randomUUID()}.tmp`,
      );
      const fd = fs.openSync(staged, "wx", update.mode);
      temporary.set(update.relative, staged);
      try {
        fs.writeFileSync(fd, update.replacement);
        fs.fchmodSync(fd, update.mode);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    verifySources();
    for (const update of state.updates) {
      fs.renameSync(temporary.get(update.relative)!, path.join(state.root, update.relative));
      temporary.delete(update.relative);
      changedPaths.push(update.relative);
    }
    plans.delete(plan);
    return {
      schema: "tiangong-foundry.release-version-result.v1",
      status: "updated",
      version: plan.version,
      changedPaths: Object.freeze(changedPaths),
    };
  } catch (error) {
    if (changedPaths.length > 0) {
      throw new Error(
        `Release version update is incomplete; review Git changes in: ${changedPaths.join(", ")}.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    for (const staged of temporary.values()) fs.rmSync(staged, { force: true });
  }
}
