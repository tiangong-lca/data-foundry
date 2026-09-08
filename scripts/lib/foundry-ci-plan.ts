import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

export interface FoundryTestShard {
  readonly index: number;
  readonly total: number;
  readonly files: readonly string[];
  readonly estimatedSeconds: number;
}

export interface FoundryTestPlan {
  readonly schema: "tiangong-foundry.ci-test-plan.v1";
  readonly planSha256: string;
  readonly unprofiledFiles: readonly string[];
  readonly shards: readonly FoundryTestShard[];
}

export function planFoundryTestShards(
  selectedFiles: readonly string[],
  durations: Readonly<Record<string, number>>,
  count: number,
): FoundryTestPlan {
  if (!Number.isInteger(count) || count < 1 || count > selectedFiles.length)
    throw new Error("CI shard count must select at least one test file per shard.");
  const files = [...selectedFiles].sort();
  if (new Set(files).size !== files.length)
    throw new Error("CI test inventory contains duplicate paths.");
  for (const file of files) {
    if (
      !file.startsWith("test/") ||
      !file.endsWith(".test.mts") ||
      path.posix.normalize(file) !== file ||
      file.includes("\\") ||
      file.includes(":") ||
      file.split("").some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error(`Invalid CI test path: ${JSON.stringify(file)}`);
  }
  for (const [file, duration] of Object.entries(durations)) {
    if (!files.includes(file))
      throw new Error(`CI duration refers to an unknown test file: ${file}`);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error(`Invalid CI test duration: ${file}`);
  }
  const weighted = files.map((file) => ({ file, seconds: durations[file] ?? 1 }));
  const shards = Array.from({ length: count }, (_, offset) => ({
    index: offset + 1,
    total: count,
    files: [] as string[],
    estimatedSeconds: 0,
  }));
  for (const item of [...weighted].sort(
    (a, b) => b.seconds - a.seconds || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  )) {
    const shard = shards.reduce((least, next) =>
      next.estimatedSeconds < least.estimatedSeconds ? next : least,
    );
    shard.files.push(item.file);
    shard.estimatedSeconds += item.seconds;
  }
  if (shards.some((shard) => shard.files.length === 0))
    throw new Error("CI shard count produced an empty shard.");
  const planSha256 = createHash("sha256").update(JSON.stringify({ count, weighted })).digest("hex");
  return Object.freeze({
    schema: "tiangong-foundry.ci-test-plan.v1",
    planSha256,
    unprofiledFiles: Object.freeze(files.filter((file) => durations[file] === undefined)),
    shards: Object.freeze(
      shards.map((shard) => Object.freeze({ ...shard, files: Object.freeze(shard.files) })),
    ),
  });
}

export function selectFoundryCiMode(
  eventName: string,
  reusableSource: string | undefined,
  inspection: import("./foundry-release-contract.ts").FoundryReleaseChange,
): "full" | "version-only" {
  return eventName === "pull_request" && reusableSource === undefined && inspection.release
    ? "version-only"
    : "full";
}

export function loadFoundryTestPlan(root: string, count = 4): FoundryTestPlan {
  const walk = (relative: string): string[] => {
    const directory = path.join(root, relative);
    if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())
      throw new Error("CI test inventory requires real source directories.");
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`CI test inventory cannot follow links: ${file}`);
      if (entry.isDirectory()) return walk(file);
      return entry.isFile() && file.endsWith(".test.mts") ? [file] : [];
    });
  };
  const value: unknown = JSON.parse(
    fs.readFileSync(path.join(root, "specs/ci/test-durations.json"), "utf8"),
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CI duration input must be an object.");
  const input = value as Record<string, unknown>;
  if (
    input.schema !== "tiangong-foundry.ci-test-durations.v1" ||
    !input.weights_seconds ||
    typeof input.weights_seconds !== "object" ||
    Array.isArray(input.weights_seconds)
  )
    throw new Error("CI duration input has an unsupported schema.");
  const durations: Record<string, number> = {};
  for (const [file, seconds] of Object.entries(input.weights_seconds)) {
    if (typeof seconds !== "number") throw new Error(`Invalid CI test duration: ${file}`);
    durations[file] = seconds;
  }
  return planFoundryTestShards(walk("test"), durations, count);
}
