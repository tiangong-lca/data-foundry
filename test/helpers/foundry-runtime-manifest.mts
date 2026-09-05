import { createHash } from "node:crypto";
import {
  trustRuntimeManifest,
  type RuntimeManifest,
  type RuntimePlatform,
} from "@tiangong-lca/cli/runtime";

/** Synthetic independent host policy; no fixture component is downloaded or executed. */
export function workspaceManifestFixture(
  options: {
    read?: readonly string[];
    write?: readonly string[];
    schema?: string;
    schemas?: readonly string[];
    version?: string;
  } = {},
) {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const files = ["bin/tool", "license.txt", "lock.json", "provenance.json", "sbom.json"].map(
    (file) => ({
      path: file,
      bytes: 2,
      sha256: hash("{}"),
      mode: file === "bin/tool" ? (493 as const) : (420 as const),
    }),
  );
  const platform = `${process.platform}-${process.arch}` as RuntimePlatform;
  const schema = options.schema ?? "tiangong-foundry.workspace.v1";
  const manifest: RuntimeManifest = {
    schema: "tiangong-lca.runtime-manifest.v1",
    bootstrap_protocol: "tiangong-lca.runtime-bootstrap.v1",
    product: { id: "tiangong-foundry", version: options.version ?? "0.1.0" },
    minimum_hosts: {
      [platform]: { os_release: "0.0.0", glibc: platform.startsWith("linux") ? "0.0" : null },
    },
    workspace: {
      read: (options.schemas ?? [schema]).map((selected) => ({
        schema: selected,
        features: options.read ?? ["migration-adoption-v1", "registered-tasks-v2"],
      })),
      write: options.write
        ? (options.schemas ?? [schema]).map((selected) => ({
            schema: selected,
            features: options.write!,
          }))
        : [],
    },
    components: [
      {
        id: "fixture",
        version: "1.0.0",
        platform,
        archive: {
          format: "tar-gzip-ustar-v1",
          url: "https://github.com/tiangong-lca/runtime-fixture/releases/download/v1.0.0/fixture.tar.gz",
          bytes: 100,
          sha256: hash("fixture"),
        },
        files,
        content_sha256: hash(JSON.stringify(files)),
        production_lock: "lock.json",
        sbom: "sbom.json",
        licenses: ["license.txt"],
        provenance: ["provenance.json"],
        protocols: ["fixture.v1"],
        asset_fingerprints: {},
      },
    ],
    launches: [
      {
        id: "tool",
        platform,
        executable: { component: "fixture", path: "bin/tool" },
        environment: "isolated",
        argv: [],
      },
    ],
  };
  const bytes = Buffer.from(JSON.stringify(manifest));
  return trustRuntimeManifest(bytes, hash(bytes.toString()));
}
