import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { FoundryContextError } from "./foundry-runtime-error.ts";
import type { FoundryInputFact } from "./foundry-runtime-context-types.ts";

export function transferFail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}
export function transferBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2) + "\n");
}
export function transferHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function transferPath(root: string, relative: string): string {
  if (
    path.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.includes(":") ||
    relative.split("/").some((p) => p === ".." || p === "." || !p)
  )
    transferFail("migration_path_invalid", "Transfer paths must be contained relative paths.");
  const target = path.join(root, relative);
  let current = root;
  for (const part of ["", ...relative.split("/")]) {
    if (part) current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (current !== target && !stat.isDirectory()))
        transferFail(
          "migration_path_invalid",
          "Transfer state cannot traverse a link or non-directory.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}

export function transferRead(file: string, limit = 16 * 1024 * 1024): Buffer {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(limit))
    transferFail("migration_state_invalid", "Transfer metadata must be a bounded regular file.");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size)
      transferFail("migration_state_changed", "Transfer metadata changed while opening.");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) break;
      offset += count;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const linked = fs.lstatSync(file, { bigint: true });
    if (
      offset !== bytes.length ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      linked.isSymbolicLink() ||
      linked.ino !== before.ino ||
      linked.dev !== before.dev
    )
      transferFail("migration_state_changed", "Transfer metadata changed while reading.");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

export function transferWriteOnce(
  root: string,
  relative: string,
  bytes: Buffer,
  scratchRelative?: string,
): void {
  const file = transferPath(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  transferPath(root, relative);
  if (fs.existsSync(file)) {
    if (!transferRead(file).equals(bytes))
      transferFail(
        "migration_destination_conflict",
        "Existing transfer metadata has different bytes.",
      );
    return;
  }
  const temp = path.join(
    scratchRelative ? transferPath(root, scratchRelative) : path.dirname(file),
    `write-${randomUUID()}.tmp`,
  );
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(temp, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!transferRead(file).equals(bytes))
      transferFail("migration_destination_conflict", "Concurrent transfer metadata differs.");
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function transferFileFact(file: string): FoundryInputFact {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > 64n * 1024n * 1024n)
    transferFail("migration_file_invalid", "Transfer file must be bounded and regular.");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (opened.ino !== before.ino || opened.dev !== before.dev)
      transferFail("migration_source_changed", "Transfer file identity changed.");
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    while (true) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      bytes += count;
      if (bytes > Number(before.size))
        transferFail("migration_source_changed", "Transfer file grew.");
      hash.update(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const linked = fs.lstatSync(file, { bigint: true });
    if (
      bytes !== Number(before.size) ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      linked.isSymbolicLink() ||
      linked.ino !== before.ino ||
      linked.dev !== before.dev
    )
      transferFail("migration_source_changed", "Transfer file changed during hashing.");
    return { path: fs.realpathSync(file), bytes, sha256: hash.digest("hex") };
  } finally {
    fs.closeSync(fd);
  }
}

export function transferCopy(
  root: string,
  relative: string,
  source: FoundryInputFact,
  scratch: string,
): void {
  const file = transferPath(root, relative);
  if (fs.existsSync(file)) {
    const current = transferFileFact(file);
    if (current.bytes !== source.bytes || current.sha256 !== source.sha256)
      transferFail(
        "migration_destination_conflict",
        "An existing archived file differs; it was preserved.",
      );
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  transferPath(root, relative);
  const before = fs.lstatSync(source.path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size !== BigInt(source.bytes))
    transferFail("migration_source_changed", "Source changed before transfer.");
  const temp = path.join(scratch, `copy-${randomUUID()}.tmp`);
  const input = fs.openSync(source.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let output: number | undefined;
  try {
    const opened = fs.fstatSync(input, { bigint: true });
    if (opened.ino !== before.ino || opened.dev !== before.dev)
      transferFail("migration_source_changed", "Source identity changed before copy.");
    output = fs.openSync(temp, "wx", 0o600);
    const buffer = Buffer.alloc(1024 * 1024),
      hash = createHash("sha256");
    let bytes = 0;
    while (true) {
      const count = fs.readSync(input, buffer, 0, buffer.length, null);
      if (!count) break;
      bytes += count;
      if (bytes > source.bytes)
        transferFail("migration_source_changed", "Source grew during copy.");
      hash.update(buffer.subarray(0, count));
      let offset = 0;
      while (offset < count) offset += fs.writeSync(output, buffer, offset, count - offset);
    }
    const after = fs.fstatSync(input, { bigint: true });
    if (
      bytes !== source.bytes ||
      hash.digest("hex") !== source.sha256 ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    )
      transferFail("migration_source_changed", "Source bytes changed during transfer.");
    fs.fsyncSync(output);
    fs.closeSync(output);
    output = undefined;
    transferPath(root, relative);
    try {
      fs.linkSync(temp, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = transferFileFact(file);
      if (existing.bytes !== source.bytes || existing.sha256 !== source.sha256)
        transferFail("migration_destination_conflict", "Concurrent archive bytes differ.");
    }
  } finally {
    fs.closeSync(input);
    if (output !== undefined) fs.closeSync(output);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function transferTree(root: string): { files: string[]; directories: string[] } {
  const files: string[] = [],
    directories: string[] = [];
  const walk = (relative: string, depth: number) => {
    if (depth > 80 || files.length + directories.length > 30_000)
      transferFail("migration_inventory_limit", "Transfer tree exceeds its bounds.");
    const directory = relative ? transferPath(root, relative) : root;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const value = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(transferPath(root, value));
      if (stat.isSymbolicLink())
        transferFail("migration_path_invalid", "Archived state cannot contain links.");
      if (stat.isDirectory()) {
        directories.push(value);
        walk(value, depth + 1);
      } else if (stat.isFile()) files.push(value);
      else transferFail("migration_state_invalid", "Archived state contains unsupported entries.");
    }
  };
  walk("", 0);
  return { files: files.sort(), directories: directories.sort() };
}
