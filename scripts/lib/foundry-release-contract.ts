import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  foundryReleaseVersionPaths,
  projectFoundryReleaseVersion,
} from "./foundry-release-version.ts";

export const FOUNDRY_RELEASE_REPOSITORY = "tiangong-lca/data-foundry";
export const FOUNDRY_PUBLISH_WORKFLOW = ".github/workflows/publish-foundry.yml";

export interface ReleaseFileChange {
  path: string;
  before: string | null;
  after: string | null;
  beforeMode: string | null;
  afterMode: string | null;
}

export type FoundryReleaseChange =
  | { readonly release: false; readonly changedPaths: readonly string[] }
  | {
      readonly release: true;
      readonly currentVersion: string;
      readonly version: string;
      readonly tag: string;
      readonly changedPaths: readonly string[];
    };

function manifest(content: string | null): { name: string; version: string } {
  if (content === null) throw new Error("Release-only metadata must exist in both commits.");
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Release-only package manifest is invalid.");
  const data = value as Record<string, unknown>;
  if (data.name !== "@tiangong-lca/foundry" || typeof data.version !== "string")
    throw new Error("Release-only package identity is invalid.");
  return { name: data.name, version: data.version };
}

function withoutReviewMetadata(content: string, yaml: boolean): string {
  const parts = yaml
    ? ["", content, ""]
    : /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n[\s\S]*)?)$/u.exec(content)?.slice(1);
  if (!parts) throw new Error("Release-only document requires existing review frontmatter.");
  const seen = new Set<string>();
  const header = parts[1].replace(
    /^(lastReviewedAt|lastReviewedCommit|lastReviewedNote)(:[ \t]+)[^\r\n]+/gmu,
    (_line, key: string, separator: string) => {
      if (seen.has(key)) throw new Error("Release-only document has duplicate review metadata.");
      seen.add(key);
      return `${key}${separator}<reviewed>`;
    },
  );
  return `${parts[0]}${header}${parts[2]}`;
}

export function validateFoundryReleaseChange(
  changes: readonly ReleaseFileChange[],
): FoundryReleaseChange {
  if (new Set(changes.map((item) => item.path)).size !== changes.length)
    throw new Error("Release-only diff contains duplicate paths.");
  const changedPaths = Object.freeze(changes.map((file) => file.path).sort());
  const packageChange = changes.find((file) => file.path === "package.json");
  if (!packageChange) return { release: false, changedPaths };
  const before = manifest(packageChange.before),
    after = manifest(packageChange.after);
  if (before.version === after.version) return { release: false, changedPaths };
  const metadata: Record<string, string> = {};
  for (const file of foundryReleaseVersionPaths) {
    const change = changes.find((entry) => entry.path === file);
    if (!change || change.before === null || change.after === null)
      throw new Error(`Missing release version projection: ${file}`);
    metadata[file] = change.before;
  }
  const projection = projectFoundryReleaseVersion(metadata, after.version);
  for (const change of changes) {
    if (change.beforeMode !== "100644" || change.afterMode !== change.beforeMode)
      throw new Error(`Release-only file mode changed or is unsupported: ${change.path}`);
    const projected = projection.replacements[change.path];
    if (projected !== undefined) {
      if (change.after !== projected)
        throw new Error(`Unexpected release projection change: ${change.path}`);
      continue;
    }
    if (
      change.before === null ||
      change.after === null ||
      !(change.path.endsWith(".md") || change.path === ".docpact/config.yaml")
    )
      throw new Error(`Unexpected release-only path: ${change.path}`);
    if (
      withoutReviewMetadata(change.before, change.path.endsWith(".yaml")) !==
      withoutReviewMetadata(change.after, change.path.endsWith(".yaml"))
    )
      throw new Error(`Unexpected release-only document change: ${change.path}`);
  }
  return Object.freeze({
    release: true,
    currentVersion: projection.currentVersion,
    version: after.version,
    tag: `foundry-v${after.version}`,
    changedPaths,
  });
}

function git(root: string, args: readonly string[]): string {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.startsWith("GIT_")) delete environment[key];
  const result = spawnSync("git", ["--no-replace-objects", ...args], {
    cwd: root,
    env: environment,
    shell: false,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.status !== 0 || result.error)
    throw new Error(`Release Git inspection failed: ${args[0]}`);
  const text = result.stdout.toString("utf8");
  if (!Buffer.from(text).equals(result.stdout))
    throw new Error(`Release Git inspection requires valid UTF-8: ${args[0]}`);
  return text;
}

export function inspectFoundryRelease(
  root: string,
  base: string,
  head: string,
): FoundryReleaseChange & {
  readonly schema: "tiangong-foundry.release-context.v1";
  readonly base: string;
  readonly head: string;
  readonly tree: string;
} {
  if (![base, head].every((sha) => /^[0-9a-f]{40}$/u.test(sha)))
    throw new Error("Release inspection requires exact 40-character commits.");
  const actualRoot = fs.realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim());
  if (actualRoot !== fs.realpathSync(root)) throw new Error("Release inspection root mismatch.");
  git(root, ["merge-base", "--is-ancestor", base, head]);
  const names = git(root, ["diff", "--name-only", "-z", base, head]).split("\0").filter(Boolean);
  const tree = git(root, ["rev-parse", `${head}^{tree}`]).trim();
  const noRelease = () =>
    Object.freeze({
      schema: "tiangong-foundry.release-context.v1" as const,
      release: false as const,
      changedPaths: Object.freeze([...names].sort()),
      base,
      head,
      tree,
    });
  if (!names.includes("package.json")) return noRelease();
  const side = (ref: string, file: string): { content: string | null; mode: string | null } => {
    const entry = git(root, ["ls-tree", "-z", ref, "--", file]);
    if (!entry) return { content: null, mode: null };
    const match = /^([0-7]{6}) blob [0-9a-f]{40}\t([^\0]+)\0$/u.exec(entry);
    if (!match || match[2] !== file)
      throw new Error("Release-only diff contains a non-file entry.");
    return { content: git(root, ["show", `${ref}:${file}`]), mode: match[1] };
  };
  const packageBefore = side(base, "package.json"),
    packageAfter = side(head, "package.json");
  if (manifest(packageBefore.content).version === manifest(packageAfter.content).version)
    return noRelease();
  const changes = names.map((file): ReleaseFileChange => {
    const before = side(base, file),
      after = side(head, file);
    return {
      path: file,
      before: before.content,
      after: after.content,
      beforeMode: before.mode,
      afterMode: after.mode,
    };
  });
  const result = validateFoundryReleaseChange(changes);
  return Object.freeze({
    schema: "tiangong-foundry.release-context.v1",
    ...result,
    base,
    head,
    tree,
  });
}
