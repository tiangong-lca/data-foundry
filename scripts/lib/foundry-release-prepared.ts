import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { npmReleasePolicy, verifyNpmProvenanceBundle } from "./foundry-release-provenance.ts";

export function readFoundryReleaseArtifact(
  file: string,
  limit: number,
  allowEmpty = false,
): Buffer {
  let fd: number;
  try {
    if (!fs.lstatSync(file).isFile()) throw new Error("Not a regular file.");
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch {
    throw new Error("Prepared artifact must be an existing regular file.");
  }
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new Error("Prepared artifact must be a regular file.");
    if (before.size < (allowEmpty ? 0n : 1n) || before.size > BigInt(limit))
      throw new Error("Prepared artifact size exceeds its bound or is empty.");
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const current = fs.lstatSync(file, { bigint: true });
    if (
      BigInt(length) !== before.size ||
      !current.isFile() ||
      [after, current].some(
        (stat) =>
          stat.dev !== before.dev ||
          stat.ino !== before.ino ||
          stat.size !== before.size ||
          stat.mtimeNs !== before.mtimeNs ||
          stat.ctimeNs !== before.ctimeNs,
      )
    )
      throw new Error("Prepared artifact changed while it was read.");
    return buffer.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}

/** The caller selects the expected release from reviewed source, never from the download. */
export async function verifyPreparedFoundryNpm(
  directory: string,
  expectation: { readonly version: string; readonly gitHead: string },
) {
  const expected = { ...expectation, package: "foundry" as const };
  const policy = npmReleasePolicy(expected);
  if (!path.isAbsolute(directory)) throw new Error("Prepared artifact directory must be absolute.");
  if (!fs.lstatSync(directory).isDirectory())
    throw new Error("Prepared artifacts require a real directory.");
  const root = fs.realpathSync(directory);
  const archive = `tiangong-lca-foundry-${expected.version}.tgz`;
  const provenance = `foundry-${expected.version}.sigstore`;
  const tarballBytes = readFoundryReleaseArtifact(path.join(root, archive), 64 * 1024 * 1024);
  const bundleBytes = readFoundryReleaseArtifact(path.join(root, provenance), 4 * 1024 * 1024);
  const sha512 = createHash("sha512").update(tarballBytes).digest("hex");
  const binding = await verifyNpmProvenanceBundle(bundleBytes, expected, sha512);
  return Object.freeze({
    schema: "tiangong-foundry.verified-prepared-npm.v1",
    status: "prepared",
    package: { name: policy.name, version: expected.version },
    source: { repository: policy.repository, gitCommit: expected.gitHead, ...binding },
    tarball: {
      file: archive,
      bytes: tarballBytes.length,
      sha512,
      sha256: createHash("sha256").update(tarballBytes).digest("hex"),
    },
    provenance: {
      file: provenance,
      bytes: bundleBytes.length,
      sha256: createHash("sha256").update(bundleBytes).digest("hex"),
    },
  });
}
