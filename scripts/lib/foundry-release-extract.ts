import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extract, list } from "tar";
import type { ComponentFile } from "@tiangong-lca/cli/runtime";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";

function packagePath(value: string): string {
  if (
    !value.startsWith("package/") ||
    Buffer.byteLength(value) > 2048 ||
    value.normalize("NFC") !== value
  )
    throw new Error("npm archive path must be portable and contained in package/.");
  const relative = value.slice(8),
    parts = relative.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[<>:"\\|?*]/u.test(part) ||
        part.endsWith(".") ||
        part.endsWith(" ") ||
        /\p{Cc}/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    )
  )
    throw new Error("npm archive path must be portable and contained in package/.");
  return relative;
}

/** Source verification belongs to the caller; this only validates and materializes exact npm bytes. */
export function extractFoundryNpmTarball(
  input: Buffer,
  destination: string,
): {
  readonly root: string;
  readonly archive: { readonly bytes: number; readonly sha256: string; readonly sha512: string };
  readonly files: readonly ComponentFile[];
} {
  const bytes = Buffer.from(input);
  if (
    bytes.length < 18 ||
    bytes.length > 64 * 1024 * 1024 ||
    bytes[0] !== 0x1f ||
    bytes[1] !== 0x8b
  )
    throw new Error("npm archive must be a bounded gzip tarball.");
  if (!path.isAbsolute(destination)) throw new Error("npm archive destination must be absolute.");
  const target = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
  if (fs.existsSync(target)) throw new Error("npm archive destination already exists.");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-npm-archive-"));
  fs.chmodSync(temporary, 0o700);
  const archivePath = path.join(temporary, "package.tgz");
  const files = new Map<string, ComponentFile>();
  const names = new Set<string>();
  let total = 0,
    created: fs.BigIntStats | undefined;
  try {
    fs.writeFileSync(archivePath, bytes, { flag: "wx", mode: 0o400 });
    list({
      file: archivePath,
      sync: true,
      strict: true,
      maxMetaEntrySize: 1024 * 1024,
      onReadEntry(entry) {
        if (entry.type !== "File" && entry.type !== "OldFile")
          throw new Error("npm archive may contain regular files only.");
        const relative = packagePath(entry.path),
          folded = relative.toLowerCase();
        if (names.has(folded))
          throw new Error("npm archive contains a duplicate or case-colliding path.");
        names.add(folded);
        total += entry.size;
        if (
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0 ||
          entry.size > 512 * 1024 * 1024 ||
          total > 512 * 1024 * 1024 ||
          names.size > 50000
        )
          throw new Error("npm archive exceeds its unpacked file/count/byte bounds.");
        const hash = createHash("sha256");
        const mode = (entry.mode ?? 0) & 0o111 ? 0o755 : 0o644;
        let received = 0;
        entry.on("data", (chunk: Buffer) => {
          received += chunk.length;
          hash.update(chunk);
        });
        entry.on("end", () => {
          if (received !== entry.size) throw new Error("npm archive file body is incomplete.");
          files.set(
            relative,
            Object.freeze({ path: relative, bytes: received, sha256: hash.digest("hex"), mode }),
          );
        });
      },
    });
    if (!files.has("package.json") || files.size !== names.size)
      throw new Error("npm archive requires a complete package manifest and file bodies.");
    for (const name of names) {
      const parts = name.split("/");
      for (let index = 1; index < parts.length; index++)
        if (names.has(parts.slice(0, index).join("/")))
          throw new Error("npm archive contains a file/directory path collision.");
    }
    fs.mkdirSync(target, { mode: 0o700 });
    created = fs.lstatSync(target, { bigint: true });
    extract({
      file: archivePath,
      cwd: target,
      sync: true,
      strict: true,
      strip: 1,
      preservePaths: false,
      preserveOwner: false,
      chmod: false,
      noMtime: true,
      fmode: 0o600,
      dmode: 0o700,
      maxMetaEntrySize: 1024 * 1024,
      filter(name, entry) {
        return (
          "type" in entry &&
          (entry.type === "File" || entry.type === "OldFile") &&
          files.has(packagePath(name))
        );
      },
    });
    let observed = 0;
    const inspect = (directory: string, prefix = ""): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relative = prefix + entry.name,
          file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          inspect(file, `${relative}/`);
          continue;
        }
        const expected = files.get(relative);
        if (!entry.isFile() || !expected)
          throw new Error("Extracted npm payload contains an undeclared or linked file.");
        const actual = readFoundryReleaseArtifact(file, 512 * 1024 * 1024, true);
        if (
          actual.length !== expected.bytes ||
          createHash("sha256").update(actual).digest("hex") !== expected.sha256
        )
          throw new Error("Extracted npm payload differs from its archive bytes.");
        fs.chmodSync(file, expected.mode);
        observed++;
      }
    };
    inspect(target);
    if (observed !== files.size) throw new Error("Extracted npm payload is incomplete.");
    return Object.freeze({
      root: target,
      archive: Object.freeze({
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sha512: createHash("sha512").update(bytes).digest("hex"),
      }),
      files: Object.freeze(
        [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      ),
    });
  } catch (error) {
    if (created && fs.existsSync(target)) {
      const current = fs.lstatSync(target, { bigint: true });
      if (current.isDirectory() && current.dev === created.dev && current.ino === created.ino)
        fs.rmSync(target, { recursive: true, force: true });
    }
    throw error;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
