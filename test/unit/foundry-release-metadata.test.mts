import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createFoundryProductionFixture } from "../fixtures/foundry-release-production.ts";
import { materializeFoundryProductionPackages } from "../../scripts/lib/foundry-release-production-materialize.ts";
import {
  collectFoundryNpmMetadata,
  createFoundrySpdxDocument,
} from "../../scripts/lib/foundry-release-metadata.ts";

const context = {
  component: "fixture-runtime",
  version: "1.0.0",
  platform: "darwin-arm64",
  sourceCommit: "a".repeat(40),
  sourceDate: "2026-09-06T08:00:00.000Z",
} as const;

test("candidate SPDX uses NOASSERTION instead of inventing a download and native identity is intrinsic", () => {
  const packages = [
    {
      id: "candidate@1.0.0",
      name: "candidate",
      version: "1.0.0",
      download_url: "NOASSERTION",
      sha256: "b".repeat(64),
      declared_license: "MIT",
      license_files: ["LICENSE"],
      dependencies: [],
      source_info: "Unpublished source candidate.",
    },
  ];
  const candidate = createFoundrySpdxDocument(packages, [packages[0].id], context);
  assert.equal(candidate.packages[0].downloadLocation, "NOASSERTION");
  const intrinsic = createFoundrySpdxDocument(packages, [packages[0].id], {
    ...context,
    namespaceRepository: "https://github.com/nodejs/node",
    creator: "Tool: tiangong-foundry-component-v1",
  });
  assert.match(intrinsic.documentNamespace, /^https:\/\/github.com\/nodejs\/node\/spdx\//u);
  assert.deepEqual(intrinsic.creationInfo.creators, ["Tool: tiangong-foundry-component-v1"]);
  assert.throws(
    () =>
      createFoundrySpdxDocument(packages, [packages[0].id], {
        ...context,
        namespaceRepository: "https://user:secret@example.invalid/repo",
      }),
    /namespace/u,
  );
  assert.throws(
    () =>
      createFoundrySpdxDocument(
        [{ ...packages[0], download_url: "file:///unpublished" }],
        [packages[0].id],
        context,
      ),
    /source URL/u,
  );
});

test("metadata preserves license bytes and produces a deterministic SPDX document with every dependency", async () => {
  const f = createFoundryProductionFixture();
  try {
    const tree = await materializeFoundryProductionPackages(
      f.lock,
      path.join(f.root, "output"),
      async (url) => {
        const pkg = f.lock.packages.find((item) => item.download_url === url)!;
        return new Response(f.tarballs.get(pkg.name));
      },
    );
    const metadata = collectFoundryNpmMetadata(tree);
    assert.equal(metadata.packages.length, 2);
    assert.equal(metadata.license_index.length, 2);
    assert.equal(metadata.files.length, 1);
    assert.equal(metadata.files[0].bytes.toString("utf8"), "Fixture-only license text\n");
    const sbom = createFoundrySpdxDocument(metadata.packages, metadata.roots, context);
    assert.equal(sbom.spdxVersion, "SPDX-2.3");
    assert.equal(sbom.packages.length, 2);
    assert.equal(
      sbom.relationships.filter((item) => item.relationshipType === "DEPENDS_ON").length,
      1,
    );
    assert.equal(
      JSON.stringify(sbom),
      JSON.stringify(createFoundrySpdxDocument(metadata.packages, metadata.roots, context)),
    );
    assert.throws(
      () => createFoundrySpdxDocument(metadata.packages.slice(0, 1), metadata.roots, context),
      /dependency/u,
    );
    assert.throws(
      () =>
        createFoundrySpdxDocument(metadata.packages, metadata.roots, {
          ...context,
          sourceCommit: "main",
        }),
      /source/u,
    );
    fs.writeFileSync(path.join(tree.root, "node_modules/fixture-a/LICENSE"), "changed license");
    assert.throws(() => collectFoundryNpmMetadata(tree), /license.*changed/u);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
