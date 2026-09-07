import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { create } from "tar";
import { stringify } from "yaml";
import { projectFoundryProductionLock } from "../../scripts/lib/foundry-release-production.ts";

export function createFoundryProductionFixture(wrongManifest = false, optionalPeer = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-production-fixture-"));
  const tarballs = new Map<string, Buffer>();
  const packages: Record<string, unknown> = {},
    snapshots: Record<string, unknown> = {};
  for (const name of ["fixture-a", "fixture-b"]) {
    const payload = path.join(root, name);
    fs.mkdirSync(path.join(payload, "package"), { recursive: true });
    const dependencies =
      name === "fixture-a" ? { [wrongManifest ? "unbound" : "fixture-b"]: "1.0.0" } : {};
    const peer =
      optionalPeer && name === "fixture-a"
        ? {
            peerDependencies: { "fixture-optional": ">=1.0.0" },
            peerDependenciesMeta: { "fixture-optional": { optional: true } },
          }
        : {};
    fs.writeFileSync(
      path.join(payload, "package/package.json"),
      JSON.stringify({ name, version: "1.0.0", license: "MIT", dependencies, ...peer }),
    );
    fs.writeFileSync(path.join(payload, "package/LICENSE"), "Fixture-only license text\n");
    const archive = path.join(root, `${name}.tgz`);
    create({ cwd: payload, file: archive, gzip: true, portable: true, sync: true }, [
      "package/package.json",
      "package/LICENSE",
    ]);
    const bytes = fs.readFileSync(archive);
    tarballs.set(name, bytes);
    packages[`${name}@1.0.0`] = {
      ...peer,
      resolution: { integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` },
    };
    snapshots[`${name}@1.0.0`] = {
      dependencies: name === "fixture-a" ? { "fixture-b": "1.0.0" } : {},
    };
  }
  const lock = projectFoundryProductionLock(
    Buffer.from(
      stringify({
        lockfileVersion: "9.0",
        importers: {
          ".": { dependencies: { "fixture-a": { specifier: "1.0.0", version: "1.0.0" } } },
        },
        packages,
        snapshots,
      }),
    ),
    { "fixture-a": "1.0.0" },
  );
  return { root, lock, tarballs };
}
