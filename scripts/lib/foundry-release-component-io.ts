import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ComponentFile, RuntimePlatform } from "@tiangong-lca/cli/runtime";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";

const fileLimit = 512 * 1024 * 1024;
const inventoryLimit = 50_000;
export const foundryComponentJson = (value: unknown): Buffer =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export const foundryComponentHash = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

export function freezeFoundryReleaseValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (
    value &&
    typeof value === "object" &&
    !seen.has(value) &&
    (Array.isArray(value) ||
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    seen.add(value);
    for (const child of Object.values(value)) freezeFoundryReleaseValue(child, seen);
    Object.freeze(value);
  }
  return value;
}

function relativeFile(value: string): void {
  if (
    !value ||
    path.isAbsolute(value) ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Component paths must name contained regular files.");
}

function realRoot(root: string): string {
  if (!path.isAbsolute(root)) throw new Error("Component roots must be absolute.");
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Component roots must be real directories.");
  return fs.realpathSync(root);
}

function targetFile(root: string, relative: string): string {
  relativeFile(relative);
  let current = root;
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory()))
        throw new Error("Component paths cannot traverse links or non-directories.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return current;
}

function checkedBytes(root: string, fact: ComponentFile, platform: RuntimePlatform): Buffer {
  const file = targetFile(root, fact.path);
  const bytes = readFoundryReleaseArtifact(file, fileLimit);
  if (
    bytes.length !== fact.bytes ||
    foundryComponentHash(bytes) !== fact.sha256 ||
    (platform !== "win32-x64" && (fs.statSync(file).mode & 0o777) !== fact.mode)
  )
    throw new Error("Component source bytes or modes changed after verification.");
  return bytes;
}

export function assertFoundryComponentFiles(
  root: string,
  files: readonly ComponentFile[],
  platform: RuntimePlatform,
): void {
  root = realRoot(root);
  if (!files.length || files.length > inventoryLimit)
    throw new Error("Component inventory is empty or exceeds its bound.");
  const expected = new Set<string>(),
    portable = new Set<string>();
  let total = 0;
  for (const file of files) {
    relativeFile(file.path);
    total += file.bytes;
    if (
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > fileLimit ||
      !/^[0-9a-f]{64}$/u.test(file.sha256) ||
      ![0o644, 0o755].includes(file.mode) ||
      expected.has(file.path) ||
      portable.has(file.path.toLowerCase()) ||
      total > 2 * 1024 * 1024 * 1024
    )
      throw new Error("Component inventory contains invalid or duplicate facts.");
    expected.add(file.path);
    portable.add(file.path.toLowerCase());
  }
  const actual = new Set<string>();
  const walk = (relative: string, depth: number) => {
    if (depth > 64) throw new Error("Component directory nesting exceeds its bound.");
    for (const name of fs.readdirSync(path.join(root, relative))) {
      const selected = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(targetFile(root, selected));
      if (stat.isDirectory()) walk(selected, depth + 1);
      else if (stat.isFile() && expected.has(selected)) actual.add(selected);
      else throw new Error("Component contains an unlisted or non-regular file.");
    }
  };
  walk("", 0);
  if (actual.size !== expected.size) throw new Error("Component inventory has missing files.");
  for (const file of files) checkedBytes(root, file, platform);
}

export function writeFoundryComponentFile(
  root: string,
  relative: string,
  input: Uint8Array,
  mode: 420 | 493 = 0o644,
): ComponentFile {
  root = realRoot(root);
  const bytes = Buffer.from(input);
  if (bytes.length > fileLimit || ![0o644, 0o755].includes(mode))
    throw new Error("Component file exceeds its byte or mode contract.");
  const file = targetFile(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  targetFile(root, relative);
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    mode,
  );
  try {
    fs.writeFileSync(fd, bytes);
    fs.fchmodSync(fd, mode);
  } finally {
    fs.closeSync(fd);
  }
  return Object.freeze({
    path: relative,
    bytes: bytes.length,
    sha256: foundryComponentHash(bytes),
    mode,
  });
}

/** Copies only a complete verified inventory into a newly owned destination. */
export function copyFoundryComponentPayload(
  source: string,
  files: readonly ComponentFile[],
  destination: string,
  platform: RuntimePlatform,
  selection?: readonly string[],
): void {
  source = realRoot(source);
  assertFoundryComponentFiles(source, files, platform);
  const selected = selection ? new Set(selection) : null;
  if (
    selected &&
    (!selected.size ||
      selected.size !== selection!.length ||
      [...selected].some((name) => !files.some((file) => file.path === name)))
  )
    throw new Error("Component selection must contain unique declared input files.");
  const copied = selected ? files.filter((file) => selected.has(file.path)) : files;
  if (!path.isAbsolute(destination)) throw new Error("Component destination must be absolute.");
  destination = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
  fs.mkdirSync(destination, { mode: 0o700 });
  const created = fs.lstatSync(destination, { bigint: true });
  try {
    for (const file of copied)
      writeFoundryComponentFile(
        destination,
        file.path,
        checkedBytes(source, file, platform),
        file.mode,
      );
    assertFoundryComponentFiles(source, files, platform);
    assertFoundryComponentFiles(destination, copied, platform);
  } catch (error) {
    const current = fs.lstatSync(destination, { bigint: true });
    if (
      current.isDirectory() &&
      !current.isSymbolicLink() &&
      current.dev === created.dev &&
      current.ino === created.ino
    )
      fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}
