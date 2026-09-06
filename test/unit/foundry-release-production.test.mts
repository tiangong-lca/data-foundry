import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseDocument, stringify } from "yaml";
import { projectFoundryProductionLock } from "../../scripts/lib/foundry-release-production.ts";

const root = path.resolve(import.meta.dirname, "../..");
const lockBytes = fs.readFileSync(path.join(root, "pnpm-lock.yaml"));
const direct = { "@tiangong-lca/cli": "0.1.11" };
interface Fixture {
  importers: Record<
    string,
    { dependencies: Record<string, { specifier: string; version: string }> }
  >;
  packages: Record<string, { resolution: Record<string, unknown> }>;
  snapshots: Record<string, { dependencies?: Record<string, string> }>;
}
function changed(mutate: (value: Fixture) => void): Buffer {
  const value = parseDocument(lockBytes.toString("utf8")).toJS() as Fixture;
  mutate(value);
  return Buffer.from(stringify(value));
}

test("the actual frozen lock yields the full sixteen-package C1 production closure", () => {
  const result = projectFoundryProductionLock(lockBytes, direct);
  assert.equal(result.schema, "tiangong-foundry.production-lock.v1");
  assert.equal(result.source.sha256, createHash("sha256").update(lockBytes).digest("hex"));
  assert.equal(result.packages.length, 16);
  const cli = result.packages.find((item) => item.id === "@tiangong-lca/cli@0.1.11");
  assert(cli);
  assert.equal(cli.dependencies["@tiangong-lca/tidas-sdk"], "@tiangong-lca/tidas-sdk@0.2.0");
  assert.equal(
    Buffer.from(cli.integrity.slice(7), "base64").toString("hex"),
    "bb08aba6db8f70290a5bbcbda9bac8ff45fb442735d410aea3734e74cda44af1d41de5de85c56d9ff7250b6f2e6a7bccdc930453898401508f805250686189a3",
  );
  assert(
    result.packages.every((item) => item.download_url.startsWith("https://registry.npmjs.org/")),
  );
  for (const excluded of ["sigstore", "tar", "yaml", "typescript"])
    assert.equal(
      result.packages.some((item) => item.name === excluded),
      false,
    );
  assert(Object.isFrozen(result.packages));
  assert(Object.isFrozen(cli.dependencies));
  const supabase = result.packages.find((item) => item.name === "@supabase/supabase-js");
  assert(supabase);
  assert.deepEqual(supabase.peer_dependencies["@opentelemetry/api"], {
    range: ">=1.0.0",
    optional: true,
    target: null,
  });
});

test("root dependency drift and missing transitive snapshots cannot produce a lock projection", () => {
  assert.throws(
    () => projectFoundryProductionLock(lockBytes, { "@tiangong-lca/cli": "0.1.9" }),
    /root dependency/u,
  );
  assert.throws(
    () =>
      projectFoundryProductionLock(
        changed((value) => {
          delete value.snapshots["tslib@2.8.1"];
        }),
        direct,
      ),
    /snapshot/u,
  );
  assert.throws(
    () =>
      projectFoundryProductionLock(
        changed((value) => {
          value.importers["."].dependencies["@tiangong-lca/cli"].specifier = "^0.1.11";
        }),
        direct,
      ),
    /root dependency/u,
  );
});

test("non-registry resolutions, unbound package bytes and unsupported dependency locators fail", () => {
  for (const mutate of [
    (value: Fixture) => {
      value.packages["@tiangong-lca/cli@0.1.11"].resolution.integrity = "sha512-bad";
    },
    (value: Fixture) => {
      value.packages["@tiangong-lca/cli@0.1.11"].resolution.tarball =
        "https://elsewhere.invalid/cli.tgz";
    },
    (value: Fixture) => {
      value.snapshots["@tiangong-lca/cli@0.1.11"].dependencies = { unsafe: "file:../outside" };
    },
  ])
    assert.throws(
      () => projectFoundryProductionLock(changed(mutate), direct),
      /integrity|resolution|locator/u,
    );
});

test("lock parsing rejects duplicate keys, aliases, multiple documents and invalid UTF-8", () => {
  for (const bytes of [
    Buffer.concat([lockBytes, Buffer.from('\nlockfileVersion: "9.0"\n')]),
    Buffer.concat([lockBytes, Buffer.from("\nextra: &extra { key: value }\ncopy: *extra\n")]),
    Buffer.concat([lockBytes, Buffer.from("\n---\nsecond: document\n")]),
    Buffer.concat([lockBytes, Buffer.from([0xff])]),
  ])
    assert.throws(() => projectFoundryProductionLock(bytes, direct), /lock|UTF-8/u);
});
