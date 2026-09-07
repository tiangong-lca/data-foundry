import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { zipSync } from "fflate";
import { selectFoundryTidasDistribution } from "../../scripts/lib/foundry-release-tidas.ts";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);

function fixture() {
  const version = "0.3.0",
    target = "x86_64-pc-windows-msvc",
    sourceCommit = "a".repeat(40);
  const root = `tidas-v${version}-${target}/`;
  const prefix = `${root}share/licenses/tidas/third-party-notices/`;
  const binary = Buffer.from("TIDAS executable fixture"),
    license = Buffer.from("project MIT fixture");
  const files: Record<string, Buffer> = {
    "README.txt": Buffer.from("notice fixture"),
    "evidence/Cargo.lock": Buffer.from("locked fixture"),
    "evidence/vcpkg-status.txt": Buffer.from("native status fixture"),
    "evidence/vcpkg-manifest.json": json({ "builtin-baseline": "b".repeat(40) }),
    "evidence/rustc-version.txt": Buffer.from(`release: 1.98.1\ncommit-hash: ${"c".repeat(40)}\n`),
    "evidence/rust-target-libraries.json": json({ target, libraries: {} }),
  };
  const text = (kind: string, bytes: Buffer) => {
    files[`texts/${sha(bytes)}.txt`] = bytes;
    return {
      sha256: sha(bytes),
      bytes: bytes.length,
      kind,
      source_path: "LICENSE",
      source_url: null,
    };
  };
  const project = text("project-license", license);
  const native = text("native-upstream-notices", Buffer.from("native source notice fixture"));
  const rust = [
    text("rust-project-license", Buffer.from("Rust project fixture")),
    text("rust-library-notice-report", Buffer.from("Rust report fixture")),
    text("rust-library-source-license-or-notice", Buffer.from("Rust source fixture")),
  ];
  const cargo = [
    {
      name: "tidas",
      version,
      registry_checksum: null,
      declared_license: "MIT",
      scopes: ["rust-normal"],
      target_kinds: ["bin"],
      features: [],
      texts: [project],
    },
  ];
  files["evidence/cargo-packages.json"] = json(cargo);
  const notice = {
    schema_version: "tidas.native-notice-bundle.v1",
    product: "tidas",
    version,
    target,
    executable: { sha256: sha(binary), bytes: binary.length },
    source: {
      repository: "https://github.com/tiangong-lca/tidas-tools",
      commit: sourceCommit,
      cargo_lock_sha256: sha(files["evidence/Cargo.lock"]),
      vcpkg_commit: "b".repeat(40),
      vcpkg_triplet: "x64-windows-static",
      rustc_commit: "c".repeat(40),
      rustc_release: "1.98.1",
    },
    cargo_packages: cargo,
    native_packages: ["libxml2", "libxslt"].map((name) => ({
      name,
      version: "1",
      scope: "vcpkg-target-build-input",
      triplet: "x64-windows-static",
      features: [],
      texts: [native],
    })),
    rust_library_texts: rust,
    files: Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [
        name,
        { sha256: sha(bytes), bytes: bytes.length },
      ]),
    ),
  };
  const noticeBytes = json(notice);
  const distribution = {
    schema_version: "tidas.distribution-manifest.v2",
    product: "tidas",
    version,
    target,
    executable: "bin/tidas.exe",
    self_contained_native_xml: true,
    third_party_notices: { sha256: sha(noticeBytes), bytes: noticeBytes.length },
  };
  const entries: Record<string, Buffer> = Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [prefix + name, bytes]),
  );
  entries[`${root}bin/tidas.exe`] = binary;
  entries[`${root}share/licenses/tidas/LICENSE`] = license;
  entries[`${root}distribution-manifest.json`] = json(distribution);
  entries[`${prefix}notice-manifest.json`] = noticeBytes;
  return {
    entries,
    root,
    prefix,
    expectation: { version, target, sourceCommit, format: "zip" as const },
  };
}

test("TIDAS v2 retains its complete source-bound notice inventory", () => {
  const sample = fixture();
  const bytes = Buffer.from(zipSync(sample.entries));
  const result = selectFoundryTidasDistribution(bytes, {
    ...sample.expectation,
    sha256: sha(bytes),
  });
  assert.equal(result.files.size, Object.keys(sample.entries).length);
  assert.equal(result.distribution.schema_version, "tidas.distribution-manifest.v2");
  assert.throws(
    () =>
      selectFoundryTidasDistribution(bytes, {
        ...sample.expectation,
        sourceCommit: "d".repeat(40),
        sha256: sha(bytes),
      }),
    /source/u,
  );
});

test("TIDAS v2 rejects changed, missing and unlisted material despite a new outer checksum", () => {
  for (const mode of ["changed", "missing", "extra"] as const) {
    const sample = fixture();
    const selected = Object.keys(sample.entries).find((name) => name.includes("/texts/"))!;
    if (mode === "changed") sample.entries[selected] = Buffer.from("changed notice");
    if (mode === "missing") delete sample.entries[selected];
    if (mode === "extra") sample.entries[`${sample.root}unlisted`] = Buffer.from("extra");
    const bytes = Buffer.from(zipSync(sample.entries));
    assert.throws(() =>
      selectFoundryTidasDistribution(bytes, { ...sample.expectation, sha256: sha(bytes) }),
    );
  }
});
