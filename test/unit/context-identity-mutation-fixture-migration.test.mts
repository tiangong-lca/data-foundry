import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fixtureRoot, mutationFixtureRoot } from "../fixtures/fixture-roots.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const names = ["full-context-fixtures", "identity-fixtures", "mutation-fixtures"] as const;

function fixturePath(name: (typeof names)[number], extension: "ts" | "mjs"): string {
  return path.join(repoRoot, `test/fixtures/${name}.${extension}`);
}

async function loadFixture(name: (typeof names)[number]) {
  const typedPath = fixturePath(name, "ts");
  const activePath = fs.existsSync(typedPath) ? typedPath : fixturePath(name, "mjs");
  return import(pathToFileURL(activePath).href);
}

const fullContext = await loadFixture("full-context-fixtures");
const identity = await loadFixture("identity-fixtures");
const mutation = await loadFixture("mutation-fixtures");

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

test("context, identity, and mutation fixtures exist only as native TypeScript", () => {
  for (const name of names) {
    const typedPath = fixturePath(name, "ts");
    assert.equal(fs.existsSync(typedPath), true, name);
    assert.equal(fs.existsSync(fixturePath(name, "mjs")), false, name);
    const source = fs.readFileSync(typedPath, "utf8");
    assert.doesNotMatch(source, /(?:[:<>,(|]\s*any\b|\bas\s+any\b)/u, name);
    assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u, name);
  }
});

test("workflow fixture namespaces remain exact", () => {
  assert.deepEqual(Object.keys(fullContext).sort(), [
    "contextFile",
    "createFixture",
    "writeContextPackFiles",
    "writeDecisionTaskFixture",
  ]);
  assert.deepEqual(Object.keys(identity).sort(), [
    "testAuthIdentityReceipt",
    "writeCompletedIdentityPreflightIndex",
    "writeIdentityPreflightExecutionFixture",
  ]);
  assert.deepEqual(Object.keys(mutation), ["createMutationManifestFixture"]);
});

test("full-context fixture preserves artifact order, bytes, hashes, and isolated roots", () => {
  try {
    const result = fullContext.createFixture();
    assert.equal(result.rowsFile.startsWith(fixtureRoot), true);
    assert.deepEqual(Object.keys(result), [
      "rowsFile",
      "finalizeReport",
      "mutationWithProof",
      "patchApplyReport",
      "patchEvidenceFile",
      "commitReport",
      "verifyReport",
      "handoffMissingProof",
      "handoffWithProof",
      "oldCloseoutMissingProof",
    ]);
    const rowsText = fs.readFileSync(result.rowsFile, "utf8");
    assert.equal(Buffer.byteLength(rowsText, "utf8"), 360);
    assert.equal(
      sha256(rowsText),
      "a5b2dbbc2633a35841ea755bbcb48c685c6227292db22415a5f3e8d56298b2df",
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("identity receipt bytes and native missing-file errors remain exact", () => {
  const receipt = identity.testAuthIdentityReceipt({
    capturedAtUtc: "2026-08-25T00:00:00.000Z",
  });
  assert.equal(receipt.cli.package_version, "0.1.11");
  const receiptText = JSON.stringify(receipt);
  assert.equal(Buffer.byteLength(receiptText, "utf8"), 1073);
  assert.equal(
    sha256(receiptText),
    "94b40d16e49b484076037e9e361f309600645aa866e300df7444b217baf143c4",
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-identity-fixture-"));
  try {
    assert.throws(
      () =>
        identity.writeIdentityPreflightExecutionFixture({
          datasetType: "flow",
          id: "missing",
          requestFile: path.join(tempRoot, "missing-request.json"),
          reportFile: path.join(tempRoot, "missing-report.json"),
        }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("mutation fixture preserves dependency order and stable row bytes", () => {
  try {
    const result = mutation.createMutationManifestFixture();
    assert.equal(result.rowsFile.startsWith(mutationFixtureRoot), true);
    assert.deepEqual(Object.keys(result), [
      "rowsFile",
      "schemaReport",
      "qaReport",
      "dryRunReport",
      "cleanupReport",
      "curationGateReport",
      "patchCollectReport",
      "patchApplyReport",
      "sourceReferenceRewritesFile",
      "contractContextFiles",
      "processId",
    ]);
    assert.deepEqual(
      result.contractContextFiles.map((file: { path: string }) => path.basename(file.path)),
      [
        "schema.json",
        "methodology.yaml",
        "runtime-ruleset.json",
        "tidas_contacts_category.json",
        "tidas_flowproperties_category.json",
        "tidas_flows_elementary_category.json",
        "tidas_flows_product_category.json",
        "tidas_lciamethods_category.json",
        "tidas_processes_category.json",
        "tidas_sources_category.json",
        "tidas_unitgroups_category.json",
        "tidas_locations_category.json",
      ],
    );
    const rowsText = fs.readFileSync(result.rowsFile, "utf8");
    assert.equal(Buffer.byteLength(rowsText, "utf8"), 800);
    assert.equal(
      sha256(rowsText),
      "67d68461269990d8f1a5b7a59f8cc3d4141252e9bb91fd2c68bf53f7cb80fe0d",
    );
  } finally {
    fs.rmSync(mutationFixtureRoot, { recursive: true, force: true });
  }
});

test("context path construction retains its native TypeError", () => {
  assert.throws(() => fullContext.contextFile(null, "text"), TypeError);
});
