import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ComponentFile } from "@tiangong-lca/cli/runtime";
import {
  assertFoundryProductionLock,
  type FoundryProductionLock,
} from "./foundry-release-production.ts";
import { extractFoundryNpmTarball } from "./foundry-release-extract.ts";
import { readFoundryReleaseArtifact } from "./foundry-release-prepared.ts";

export interface FoundryProductionPackageInstance {
  readonly id: string;
  readonly path: string;
  readonly archive_sha256: string;
  readonly archive_bytes: number;
  readonly package_inventory_sha256: string;
  readonly declared_license: string | null;
  readonly license_files: readonly string[];
}

export interface FoundryProductionTree {
  readonly root: string;
  readonly lock: FoundryProductionLock;
  readonly packages: readonly FoundryProductionPackageInstance[];
  readonly files: readonly ComponentFile[];
}

const productionTrees = new WeakSet<object>();
export function assertFoundryProductionTree(value: FoundryProductionTree): void {
  if (!productionTrees.has(value))
    throw new Error("Production metadata requires a freshly verified package tree.");
}

async function downloadPackage(
  url: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Buffer> {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: { accept: "application/octet-stream" },
  });
  const limit = 64 * 1024 * 1024;
  const declared = response.headers.get("content-length");
  if (
    !response.ok ||
    !response.body ||
    (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit))
  ) {
    await response.body?.cancel();
    throw new Error(
      `Production package download failed or exceeds its bound (HTTP ${response.status}).`,
    );
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.length;
      if (total > limit) throw new Error("Production package download exceeds its byte bound.");
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Production package manifest must contain objects.");
  return value as Record<string, unknown>;
}

/** Materializes the qualified, single-version registry closure without dependency resolution or lifecycle execution. */
export async function materializeFoundryProductionPackages(
  lock: FoundryProductionLock,
  destination: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<FoundryProductionTree> {
  assertFoundryProductionLock(lock);
  if (!path.isAbsolute(destination))
    throw new Error("Production package destination must be absolute.");
  const names = new Set(lock.packages.map((item) => item.name));
  if (names.size !== lock.packages.length)
    throw new Error(
      "Production layout requires separately qualified handling of multiple versions of one package.",
    );
  const root = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
  fs.mkdirSync(root, { mode: 0o700 });
  const created = fs.lstatSync(root, { bigint: true });
  const packages: FoundryProductionPackageInstance[] = [],
    files: ComponentFile[] = [];
  let unpacked = 0;
  try {
    fs.mkdirSync(path.join(root, "node_modules"), { mode: 0o700 });
    for (const pkg of lock.packages) {
      const tarball = await downloadPackage(pkg.download_url, fetchImpl);
      if (`sha512-${createHash("sha512").update(tarball).digest("base64")}` !== pkg.integrity)
        throw new Error(`Production package integrity differs from the frozen lock: ${pkg.id}`);
      const relative = `node_modules/${pkg.name}`,
        target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      const extracted = extractFoundryNpmTarball(tarball, target);
      const manifestBytes = readFoundryReleaseArtifact(
        path.join(target, "package.json"),
        2 * 1024 * 1024,
      );
      const manifestText = manifestBytes.toString("utf8");
      if (!Buffer.from(manifestText).equals(manifestBytes))
        throw new Error("Production package manifest must be UTF-8.");
      const manifest = object(JSON.parse(manifestText));
      if (manifest.name !== pkg.name || manifest.version !== pkg.version)
        throw new Error("Production package manifest identity differs from the frozen lock.");
      const declared = object(manifest.dependencies ?? {});
      const peers = object(manifest.peerDependencies ?? {}),
        peerMetadata = object(manifest.peerDependenciesMeta ?? {});
      if (
        JSON.stringify(Object.keys(peers).sort()) !==
        JSON.stringify(Object.keys(pkg.peer_dependencies).sort())
      )
        throw new Error(
          `Production package peer dependencies differ from the frozen lock: ${pkg.id}`,
        );
      for (const [name, expected] of Object.entries(pkg.peer_dependencies)) {
        const meta = object(peerMetadata[name] ?? {});
        if (peers[name] !== expected.range || (meta.optional === true) !== expected.optional)
          throw new Error(
            `Production package peer dependency declaration differs from the frozen lock: ${pkg.id}`,
          );
      }
      const dependencyNames = [
        ...new Set([
          ...Object.keys(declared),
          ...Object.entries(pkg.peer_dependencies)
            .filter(([, peer]) => peer.target !== null)
            .map(([name]) => name),
        ]),
      ].sort();
      if (
        JSON.stringify(dependencyNames) !== JSON.stringify(Object.keys(pkg.dependencies).sort()) ||
        Object.values(declared).some((value) => typeof value !== "string")
      )
        throw new Error("Production package manifest dependencies differ from the frozen lock.");
      if (
        Object.keys(object(manifest.optionalDependencies ?? {})).length ||
        extracted.files.some((file) => file.path.startsWith("node_modules/"))
      )
        throw new Error(
          `Production package contains unqualified optional or bundled dependencies: ${pkg.id}`,
        );
      unpacked += extracted.files.reduce((sum, file) => sum + file.bytes, 0);
      if (unpacked > 2 * 1024 * 1024 * 1024 || files.length + extracted.files.length > 50000)
        throw new Error("Production component file inventory exceeds its bounds.");
      files.push(
        ...extracted.files.map((file) =>
          Object.freeze({ ...file, path: `${relative}/${file.path}` }),
        ),
      );
      packages.push(
        Object.freeze({
          id: pkg.id,
          path: relative,
          archive_sha256: extracted.archive.sha256,
          archive_bytes: extracted.archive.bytes,
          package_inventory_sha256: createHash("sha256")
            .update(JSON.stringify(extracted.files))
            .digest("hex"),
          declared_license: typeof manifest.license === "string" ? manifest.license : null,
          license_files: Object.freeze(
            extracted.files
              .filter((file) =>
                /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/iu.test(
                  path.posix.basename(file.path),
                ),
              )
              .map((file) => `${relative}/${file.path}`),
          ),
        }),
      );
    }
    const result: FoundryProductionTree = Object.freeze({
      root,
      lock,
      packages: Object.freeze(packages),
      files: Object.freeze(files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))),
    });
    productionTrees.add(result);
    return result;
  } catch (error) {
    if (fs.existsSync(root)) {
      const current = fs.lstatSync(root, { bigint: true });
      if (current.isDirectory() && current.dev === created.dev && current.ino === created.ino)
        fs.rmSync(root, { recursive: true, force: true });
    }
    throw error;
  }
}
