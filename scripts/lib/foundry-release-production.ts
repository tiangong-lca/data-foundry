import { createHash } from "node:crypto";
import { parseDocument } from "yaml";

export interface FoundryProductionPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly download_url: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly peer_dependencies: Readonly<
    Record<string, Readonly<{ range: string; optional: boolean; target: string | null }>>
  >;
}

export interface FoundryProductionLock {
  readonly schema: "tiangong-foundry.production-lock.v1";
  readonly package_manager: "pnpm@11.24.0";
  readonly source: {
    readonly path: "pnpm-lock.yaml";
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly root_dependencies: Readonly<Record<string, string>>;
  readonly packages: readonly FoundryProductionPackage[];
}

const productionLocks = new WeakSet<object>();

export function assertFoundryProductionLock(value: FoundryProductionLock): void {
  if (!productionLocks.has(value))
    throw new Error("Production materialization requires a freshly projected owning lock.");
}

function mapping(value: unknown, label: string): Map<string, unknown> {
  if (!(value instanceof Map) || [...value.keys()].some((key) => typeof key !== "string"))
    throw new Error(`Production lock ${label} must be a string-keyed mapping.`);
  return value as Map<string, unknown>;
}

function dependencies(value: unknown, label: string): Map<string, unknown> {
  return value === undefined ? new Map() : mapping(value, label);
}

function packageIdentity(
  name: string,
  version: unknown,
): { id: string; name: string; version: string } {
  if (name.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(name))
    throw new Error("Production lock package name is invalid.");
  if (
    typeof version !== "string" ||
    version.length > 64 ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version) ||
    version.split(".").some((part) => BigInt(part) > BigInt(Number.MAX_SAFE_INTEGER))
  )
    throw new Error("Production lock requires an exact stable registry dependency locator.");
  return { id: `${name}@${version}`, name, version };
}

function integrity(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("sha512-") || value.length > 128)
    throw new Error("Production lock package integrity must be canonical SHA-512.");
  const bytes = Buffer.from(value.slice(7), "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value.slice(7))
    throw new Error("Production lock package integrity must be canonical SHA-512.");
  return value;
}

/** Derives release evidence from the owning lock; it grants no installation or publication authority. */
export function projectFoundryProductionLock(
  input: Buffer,
  expectedDirect: Readonly<Record<string, string>>,
): FoundryProductionLock {
  const bytes = Buffer.from(input);
  if (!bytes.length || bytes.length > 16 * 1024 * 1024)
    throw new Error("Production lock input exceeds its byte bound or is empty.");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) throw new Error("Production lock must be valid UTF-8.");
  let parsed: unknown;
  try {
    const document = parseDocument(text, {
      strict: true,
      uniqueKeys: true,
      version: "1.2",
      logLevel: "error",
    });
    if (document.errors.length || document.warnings.length) throw new Error("Invalid document.");
    parsed = document.toJS({ mapAsMap: true, maxAliasCount: 0 });
  } catch {
    throw new Error("Production lock must be one strict YAML document without aliases.");
  }
  const lock = mapping(parsed, "document");
  if (lock.get("lockfileVersion") !== "9.0")
    throw new Error("Production lock format must be pnpm 9.0.");
  const importers = mapping(lock.get("importers"), "importers");
  if (importers.size !== 1 || !importers.has("."))
    throw new Error("Production lock requires the single owning root importer.");
  const owner = mapping(importers.get("."), "root importer");
  const roots = dependencies(owner.get("dependencies"), "root dependencies");
  if (roots.size < 1 || roots.size > 64 || roots.size !== Object.keys(expectedDirect).length)
    throw new Error("Production lock root dependency set differs from the public package.");
  if (dependencies(owner.get("optionalDependencies"), "optional root dependencies").size)
    throw new Error(
      "Production lock optional root dependencies require separate platform qualification.",
    );
  const queue: ReturnType<typeof packageIdentity>[] = [];
  const root_dependencies = Object.fromEntries(
    [...roots]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, value]) => {
        const entry = mapping(value, "root dependency");
        if (
          !Object.hasOwn(expectedDirect, name) ||
          entry.get("specifier") !== expectedDirect[name] ||
          entry.get("version") !== expectedDirect[name]
        )
          throw new Error(
            "Production lock root dependency differs from the exact public package dependency.",
          );
        const target = packageIdentity(name, entry.get("version"));
        queue.push(target);
        return [name, target.id];
      }),
  );
  const packages = mapping(lock.get("packages"), "packages");
  const snapshots = mapping(lock.get("snapshots"), "snapshots");
  const selected = new Map<string, FoundryProductionPackage>();
  for (let index = 0; index < queue.length; index++) {
    const identity = queue[index];
    if (selected.has(identity.id)) continue;
    if (selected.size >= 1000 || queue.length > 10000)
      throw new Error("Production lock dependency graph exceeds its bound.");
    const metadata = mapping(packages.get(identity.id), "package metadata");
    const resolution = mapping(metadata.get("resolution"), "package resolution");
    if (resolution.size !== 1 || !resolution.has("integrity"))
      throw new Error(
        "Production lock resolution must bind a canonical registry package by integrity.",
      );
    const snapshot = mapping(snapshots.get(identity.id), "dependency snapshot");
    if (dependencies(snapshot.get("optionalDependencies"), "optional dependencies").size)
      throw new Error(
        "Production lock optional dependency locators require separate platform qualification.",
      );
    const edges = dependencies(snapshot.get("dependencies"), "dependency edges");
    const resolved = Object.fromEntries(
      [...edges]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, value]) => {
          const target = packageIdentity(name, value);
          queue.push(target);
          return [name, target.id];
        }),
    );
    const peers = dependencies(metadata.get("peerDependencies"), "peer dependencies");
    const peerMetadata = dependencies(
      metadata.get("peerDependenciesMeta"),
      "peer dependency metadata",
    );
    const peer_dependencies = Object.fromEntries(
      [...peers]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, range]) => {
          packageIdentity(name, "0.0.0");
          if (typeof range !== "string" || !range || range.length > 1024)
            throw new Error("Production lock peer dependency range is invalid.");
          const meta = dependencies(peerMetadata.get(name), "peer metadata");
          if (meta.has("optional") && typeof meta.get("optional") !== "boolean")
            throw new Error("Production lock peer optionality is invalid.");
          const optional = meta.get("optional") === true,
            target = resolved[name] ?? null;
          if (target === null && !optional)
            throw new Error("Production lock is missing a required peer dependency.");
          return [name, Object.freeze({ range, optional, target })];
        }),
    );
    selected.set(
      identity.id,
      Object.freeze({
        ...identity,
        integrity: integrity(resolution.get("integrity")),
        download_url: `https://registry.npmjs.org/${identity.name}/-/${identity.name.split("/").at(-1)}-${identity.version}.tgz`,
        dependencies: Object.freeze(resolved),
        peer_dependencies: Object.freeze(peer_dependencies),
      }),
    );
  }
  const selectedNames = new Set([...selected.values()].map((pkg) => pkg.name));
  for (const pkg of selected.values())
    for (const [name, peer] of Object.entries(pkg.peer_dependencies))
      if (peer.target === null && selectedNames.has(name))
        throw new Error("Production layout would resolve an unbound optional peer dependency.");
  const result: FoundryProductionLock = Object.freeze({
    schema: "tiangong-foundry.production-lock.v1",
    package_manager: "pnpm@11.24.0",
    source: Object.freeze({
      path: "pnpm-lock.yaml",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }),
    root_dependencies: Object.freeze(root_dependencies),
    packages: Object.freeze(
      [...selected.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    ),
  });
  productionLocks.add(result);
  return result;
}
