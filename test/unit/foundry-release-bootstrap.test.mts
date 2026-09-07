import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  RUNTIME_PLATFORMS,
  trustRuntimeManifest,
  describeCliRuntime,
  type RuntimeManifest,
} from "@tiangong-lca/cli/runtime";
import {
  createFoundryBootstrapIntegrity,
  createFoundryBootstrapLock,
  FOUNDRY_BOOTSTRAP_CLI,
} from "../../scripts/lib/foundry-release-bootstrap.ts";
import inputs from "../../specs/release/runtime-inputs.json" with { type: "json" };

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const files = [
  {
    path: "node_modules/@tiangong-lca/cli/bin/tiangong-lca.js",
    bytes: 3,
    sha256: sha("cli"),
    mode: 0o644 as const,
  },
  { path: "bin/node", bytes: 4, sha256: sha("node"), mode: 0o755 as const },
];

test("bootstrap integrity covers every original file exactly once in stable path order", () => {
  const value = createFoundryBootstrapIntegrity(files);
  assert.equal(value.fileCount, 2);
  assert.equal(value.path, "metadata/bootstrap-sha256.txt");
  assert.equal(
    value.bytes.toString(),
    `${sha("node")}  bin/node\n${sha("cli")}  node_modules/@tiangong-lca/cli/bin/tiangong-lca.js\n`,
  );
  assert.deepEqual(createFoundryBootstrapIntegrity([...files].reverse()), value);
});

test("bootstrap checksum inventories reject aliases, control characters and their own checksum file", () => {
  for (const bad of [
    "../escape",
    "bin/../node",
    "-option",
    "bin/-option",
    "line\nbreak",
    "a\\b",
    "metadata/bootstrap-sha256.txt",
    "metadata/BOOTSTRAP-SHA256.txt",
  ]) {
    assert.throws(
      () => createFoundryBootstrapIntegrity([{ ...files[0], path: bad }]),
      /bootstrap/iu,
    );
  }
  assert.throws(() => createFoundryBootstrapIntegrity([...files, files[0]]), /bootstrap/iu);
  assert.throws(() => createFoundryBootstrapIntegrity([]), /bootstrap/iu);
});

function fixtureManifest(): RuntimeManifest {
  const components = RUNTIME_PLATFORMS.map((platform) => {
    const selected = [
      { ...files[1], path: `bin/node${platform === "win32-x64" ? ".exe" : ""}` },
      { ...files[0], path: FOUNDRY_BOOTSTRAP_CLI },
    ];
    const checksum = createFoundryBootstrapIntegrity(selected);
    selected.push({
      path: checksum.path,
      bytes: checksum.bytes.length,
      sha256: sha(checksum.bytes.toString()),
      mode: 0o644,
    });
    selected.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    return {
      id: "node",
      version: inputs.node.version,
      platform,
      files: selected,
      archive: {
        format: "tar-gzip-ustar-v1" as const,
        url: `https://github.com/tiangong-lca/data-foundry/releases/download/foundry-v0.1.0/node-${inputs.node.version}-${platform}.tar.gz`,
        bytes: 100,
        sha256: sha(platform),
      },
      content_sha256: sha(JSON.stringify(selected)),
      production_lock: checksum.path,
      sbom: checksum.path,
      licenses: [checksum.path],
      provenance: [checksum.path],
      protocols: ["tiangong-lca.runtime-bootstrap.v1"],
      asset_fingerprints: {},
    };
  });
  return {
    schema: "tiangong-lca.runtime-manifest.v1",
    bootstrap_protocol: "tiangong-lca.runtime-bootstrap.v1",
    product: { id: "tiangong-foundry", version: "0.1.0" },
    minimum_hosts: inputs.minimum_hosts,
    workspace: {
      read: [{ schema: "workspace.v1", features: [] }],
      write: [{ schema: "workspace.v1", features: [] }],
    },
    components,
    launches: RUNTIME_PLATFORMS.map((platform) => ({
      id: "foundry",
      platform,
      executable: { component: "node", path: `bin/node${platform === "win32-x64" ? ".exe" : ""}` },
      environment: "isolated",
      argv: [],
    })),
  };
}
function trust(manifest: RuntimeManifest) {
  const bytes = Buffer.from(JSON.stringify(manifest));
  return trustRuntimeManifest(bytes, sha(bytes.toString()));
}

test("bootstrap lock matches the released C1 schema and binds existing complete base components", () => {
  const trusted = trust(fixtureManifest());
  const url =
    "https://github.com/tiangong-lca/data-foundry/releases/download/foundry-runtime-v0.1.0/runtime-manifest.json";
  const lock = createFoundryBootstrapLock(trusted, url);
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(
        describeCliRuntime().package.root,
        "assets/runtime/runtime-bootstrap-lock.schema.json",
      ),
      "utf8",
    ),
  ) as { required: string[] };
  assert.deepEqual(Object.keys(lock).sort(), [...schema.required].sort());
  assert.equal(lock.manifest_sha256, trusted.sha256);
  assert.equal(lock.win32_x64_node_path, "bin/node.exe");
  assert.equal(lock.darwin_arm64_cli_path, FOUNDRY_BOOTSTRAP_CLI);
  assert.equal(lock.linux_x64_file_count, 2);
  assert.throws(() =>
    createFoundryBootstrapLock(trusted, "https://unreviewed.example/manifest.json"),
  );
});

test("a bootstrap lock cannot hide missing CLI bytes or a mismatched checksum inventory", () => {
  for (const mode of ["cli", "checksum"]) {
    const manifest = fixtureManifest();
    const first = manifest.components[0];
    const changed = first.files
      .filter((file) => mode !== "cli" || file.path !== FOUNDRY_BOOTSTRAP_CLI)
      .map((file) =>
        mode === "checksum" && file.path.includes("bootstrap-sha256")
          ? { ...file, sha256: sha("changed") }
          : file,
      );
    const broken = {
      ...manifest,
      components: [
        { ...first, files: changed, content_sha256: sha(JSON.stringify(changed)) },
        ...manifest.components.slice(1),
      ],
    };
    assert.throws(
      () =>
        createFoundryBootstrapLock(
          trust(broken),
          "https://github.com/tiangong-lca/data-foundry/releases/download/foundry-v0.1.0/runtime-candidate.json",
        ),
      /Bootstrap/u,
    );
  }
});
