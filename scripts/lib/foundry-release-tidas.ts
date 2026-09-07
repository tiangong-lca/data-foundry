import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { selectFoundryNativeFiles } from "./foundry-release-native.ts";

interface Digest {
  readonly sha256: string;
  readonly bytes: number;
}
export interface FoundryTidasDistribution {
  readonly schema_version: "tidas.distribution-manifest.v2";
  readonly product: "tidas";
  readonly version: string;
  readonly target: string;
  readonly executable: string;
  readonly self_contained_native_xml: true;
  readonly third_party_notices: Digest;
}
interface Expectation {
  readonly format: "tar-gzip" | "zip";
  readonly sha256: string;
  readonly version: string;
  readonly target: string;
  readonly sourceCommit: string;
}
type ObjectValue = Record<string, unknown>;
const targets: Readonly<Record<string, string>> = {
  "x86_64-unknown-linux-gnu": "x64-linux",
  "aarch64-unknown-linux-gnu": "arm64-linux",
  "aarch64-apple-darwin": "arm64-osx",
  "x86_64-pc-windows-msvc": "x64-windows-static",
};
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const fail = (message: string): never => {
  throw new Error(`TIDAS ${message}`);
};
function object(value: unknown, keys?: readonly string[]): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("notice object is invalid.");
  if (
    keys &&
    (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
  )
    return fail("notice object has unexpected fields.");
  return value as ObjectValue;
}
function parse(bytes: Buffer): ObjectValue {
  if (!bytes.length || bytes.length > 16 * 1024 * 1024)
    return fail("manifest exceeds its byte bound.");
  return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}
function digest(value: unknown): Digest {
  const record = object(value, ["sha256", "bytes"]);
  if (
    typeof record.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record.sha256) ||
    !Number.isSafeInteger(record.bytes) ||
    (record.bytes as number) < 0
  )
    return fail("file digest is invalid.");
  return { sha256: record.sha256, bytes: record.bytes as number };
}
function equalBytes(bytes: Buffer, expected: Digest): void {
  if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256)
    fail("retained file bytes differ from the inventory.");
}
function array(value: unknown, maximum = 4096): readonly unknown[] {
  if (!Array.isArray(value) || !value.length || value.length > maximum)
    return fail("notice scope is empty or oversized.");
  return value;
}
function textReferences(value: unknown, inventory: ObjectValue): readonly ObjectValue[] {
  return array(value).map((item) => {
    const text = object(item);
    const expected = digest({ sha256: text.sha256, bytes: text.bytes });
    if (
      !expected.bytes ||
      typeof text.kind !== "string" ||
      typeof text.source_path !== "string" ||
      !text.source_path
    )
      return fail("notice text record is incomplete.");
    if (!isDeepStrictEqual(digest(inventory[`texts/${expected.sha256}.txt`]), expected))
      return fail("notice text is absent from its file inventory.");
    return text;
  });
}

export function selectFoundryTidasDistribution(
  input: Buffer,
  expectation: Expectation,
): {
  readonly distribution: FoundryTidasDistribution;
  readonly notice: Readonly<ObjectValue>;
  readonly files: ReadonlyMap<string, Buffer>;
} {
  if (
    !Object.hasOwn(targets, expectation.target) ||
    !/^\d+\.\d+\.\d+$/u.test(expectation.version) ||
    !/^[0-9a-f]{40}$/u.test(expectation.sourceCommit)
  )
    return fail("release expectation is invalid.");
  const root = `tidas-v${expectation.version}-${expectation.target}/`;
  const executable = `bin/tidas${expectation.target === "x86_64-pc-windows-msvc" ? ".exe" : ""}`;
  const prefix = `${root}share/licenses/tidas/third-party-notices/`;
  const initial = [
    `${root}${executable}`,
    `${root}share/licenses/tidas/LICENSE`,
    `${root}distribution-manifest.json`,
    `${prefix}notice-manifest.json`,
  ];
  const first = selectFoundryNativeFiles(input, { ...expectation, files: initial });
  const distribution = parse(first.get(initial[2])!);
  object(distribution, [
    "schema_version",
    "product",
    "version",
    "target",
    "executable",
    "self_contained_native_xml",
    "third_party_notices",
  ]);
  if (
    distribution.schema_version !== "tidas.distribution-manifest.v2" ||
    distribution.product !== "tidas" ||
    distribution.version !== expectation.version ||
    distribution.target !== expectation.target ||
    distribution.executable !== executable ||
    distribution.self_contained_native_xml !== true
  )
    return fail("distribution differs from its qualified native target.");
  const noticeBytes = first.get(initial[3])!;
  const noticeDigest = digest(distribution.third_party_notices);
  equalBytes(noticeBytes, noticeDigest);
  const notice = parse(noticeBytes);
  object(notice, [
    "schema_version",
    "product",
    "version",
    "target",
    "executable",
    "source",
    "cargo_packages",
    "native_packages",
    "rust_library_texts",
    "files",
  ]);
  if (
    notice.schema_version !== "tidas.native-notice-bundle.v1" ||
    notice.product !== "tidas" ||
    notice.version !== expectation.version ||
    notice.target !== expectation.target
  )
    return fail("notice manifest differs from its distribution.");
  equalBytes(first.get(initial[0])!, digest(notice.executable));
  const source = object(notice.source, [
    "repository",
    "commit",
    "cargo_lock_sha256",
    "vcpkg_commit",
    "vcpkg_triplet",
    "rustc_commit",
    "rustc_release",
  ]);
  if (
    source.repository !== "https://github.com/tiangong-lca/tidas-tools" ||
    source.commit !== expectation.sourceCommit ||
    source.vcpkg_triplet !== targets[expectation.target]
  )
    return fail("notice source differs from the reviewed release.");
  const inventory = object(notice.files);
  const names = Object.keys(inventory);
  if (!names.length || names.length > 8192 - initial.length)
    return fail("notice inventory exceeds its file bound.");
  const files = selectFoundryNativeFiles(input, {
    ...expectation,
    files: [...initial, ...names.map((name) => prefix + name)],
    completeInventory: true,
  });
  let total = 0;
  for (const name of names) {
    const expected = digest(inventory[name]);
    total += expected.bytes;
    if (expected.bytes > 16 * 1024 * 1024 || total > 128 * 1024 * 1024)
      return fail("notice inventory exceeds its byte bound.");
    equalBytes(files.get(prefix + name)!, expected);
  }
  verifyNoticeScopes(notice, inventory, files, prefix, first.get(initial[1])!, source);
  return {
    distribution: {
      schema_version: "tidas.distribution-manifest.v2",
      product: "tidas",
      version: expectation.version,
      target: expectation.target,
      executable,
      self_contained_native_xml: true,
      third_party_notices: noticeDigest,
    },
    notice,
    files,
  };
}

function verifyNoticeScopes(
  notice: ObjectValue,
  inventory: ObjectValue,
  files: ReadonlyMap<string, Buffer>,
  prefix: string,
  license: Buffer,
  source: ObjectValue,
): void {
  const required = [
    "README.txt",
    "evidence/Cargo.lock",
    "evidence/cargo-packages.json",
    "evidence/vcpkg-status.txt",
    "evidence/vcpkg-manifest.json",
    "evidence/rustc-version.txt",
    "evidence/rust-target-libraries.json",
  ];
  for (const name of required)
    if (!Object.hasOwn(inventory, name)) fail("notice source evidence is incomplete.");
  if (hash(files.get(prefix + "evidence/Cargo.lock")!) !== source.cargo_lock_sha256)
    fail("Cargo lock differs from its source binding.");
  const cargo = array(notice.cargo_packages).map((item) => object(item));
  const identities = new Set<string>();
  let projectLicense = false;
  for (const item of cargo) {
    const identity = `${String(item.name)}@${String(item.version)}`;
    if (identities.has(identity)) fail("Cargo package identity is duplicated.");
    identities.add(identity);
    const texts = textReferences(item.texts, inventory);
    if (item.name === "tidas" && item.version === notice.version && item.registry_checksum === null)
      projectLicense = texts.some(
        (text) => text.kind === "project-license" && text.sha256 === hash(license),
      );
  }
  if (!projectLicense) fail("project license differs from its source record.");
  const cargoEvidence: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      files.get(prefix + "evidence/cargo-packages.json"),
    ),
  );
  if (!isDeepStrictEqual(cargoEvidence, notice.cargo_packages))
    fail("Cargo package set differs from retained evidence.");
  const nativeNames = new Set<string>();
  for (const item of array(notice.native_packages)) {
    const record = object(item);
    if (
      typeof record.name !== "string" ||
      nativeNames.has(record.name) ||
      record.triplet !== source.vcpkg_triplet
    )
      return fail("native package identity is invalid.");
    nativeNames.add(record.name);
    textReferences(record.texts, inventory);
  }
  if (!nativeNames.has("libxml2") || !nativeNames.has("libxslt"))
    fail("native XML notices are incomplete.");
  const rust = textReferences(notice.rust_library_texts, inventory);
  for (const kind of [
    "rust-project-license",
    "rust-library-notice-report",
    "rust-library-source-license-or-notice",
  ])
    if (!rust.some((text) => text.kind === kind)) fail("Rust library notice scope is incomplete.");
  const vcpkg = parse(files.get(prefix + "evidence/vcpkg-manifest.json")!);
  if (vcpkg["builtin-baseline"] !== source.vcpkg_commit)
    fail("native baseline differs from source evidence.");
  const rustc = new TextDecoder("utf-8", { fatal: true }).decode(
    files.get(prefix + "evidence/rustc-version.txt"),
  );
  const fields = new Map(
    rustc.split(/\r?\n/u).map((line) => {
      const separator = line.indexOf(": ");
      return [line.slice(0, separator), line.slice(separator + 2)] as const;
    }),
  );
  if (
    fields.get("release") !== source.rustc_release ||
    fields.get("commit-hash") !== source.rustc_commit
  )
    fail("Rust toolchain differs from source evidence.");
}
