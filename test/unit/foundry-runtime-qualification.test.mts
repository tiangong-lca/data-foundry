import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CLI_RUNTIME_EXPECTATION_SCHEMA, describeCliRuntime } from "@tiangong-lca/cli/runtime";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import { createFoundryFacade } from "../../scripts/foundry-facade.ts";
import {
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";
import {
  FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
  assertQualifiedFoundryRuntime,
  foundryRuntimeQualificationIdentity,
  qualifyFoundryRuntime,
} from "../../scripts/lib/foundry-runtime-qualification.ts";

const moduleUrl = new URL("../../scripts/runtime-entry.ts", import.meta.url).href;
const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const hasCode = (code: string) => (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === code);

test("runtime qualification binds exact public CLI and isolated TIDAS observations", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-runtime-qualification-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const initial = createFoundryRuntimeContext({
    moduleUrl,
    workspace,
    cacheBase: path.join(root, "cache"),
  });
  initializeFoundryWorkspace(initial);
  const context = createFoundryRuntimeContext({
    moduleUrl,
    workspace,
    cacheBase: path.join(root, "cache"),
  });
  const cli = describeCliRuntime();
  const cliExpectation = {
    schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
    package_version: cli.package.version,
    platform: cli.platform,
    content_sha256: cli.content_sha256,
    node_version: cli.node.version,
    node_sha256: cli.node.sha256,
  };
  const sourceTidas = path.resolve(import.meta.dirname, "../fixtures/fake-tidas.ts");
  const tidas = path.join(root, "tidas fixture.ts");
  fs.copyFileSync(sourceTidas, tidas);
  fs.chmodSync(tidas, 0o755);
  const stat = fs.statSync(tidas);
  const tidasExpectation = {
    schema: FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
    platform: context.platform,
    binary_version: "0.2.7",
    executable: { bytes: stat.size, sha256: sha(tidas) },
    validation: {
      schema_version: "tidas.validation-describe.v1",
      asset_fingerprint: "1".repeat(64),
      protocols: ["document-validation-batch.v1"],
      event_schema_versions: ["tidas.validation-final-event.v1", "tidas.validation-issue-event.v1"],
    },
  };
  const previous = process.env.FAKE_TIDAS_VERSION;
  process.env.FAKE_TIDAS_VERSION = "0.1.0";
  try {
    const qualification = qualifyFoundryRuntime(context, {
      cliExpectation,
      tidasExpectation,
      tidasExecutable: tidas,
    });
    assertQualifiedFoundryRuntime(context, qualification);
    assert.equal(Object.isFrozen(qualification), true);
    assert.equal(Object.isFrozen(qualification.tidas.expectation.validation.protocols), true);
    const identity = foundryRuntimeQualificationIdentity(context, qualification);
    assert.equal(identity.cli.package_version, "0.1.10");
    assert.equal(identity.tidas.binary_version, "0.2.7");
    assert.match(identity.qualification_sha256, /^[0-9a-f]{64}$/u);
    const described = createFoundryRuntime(context, qualification).describe();
    assert.equal(described.qualification.status, "ready");
    assert.equal(
      described.qualification.identity?.qualification_sha256,
      identity.qualification_sha256,
    );
    assert.deepEqual(createFoundryRuntime(context).describe().qualification, {
      status: "required",
      identity: null,
    });
    const facade = createFoundryFacade({
      moduleUrl,
      workspace,
      cacheBase: path.join(root, "cache"),
      runtimeSelection: { cliExpectation, tidasExpectation, tidasExecutable: tidas },
    });
    assert.equal(facade.doctor().status, "ready");
    assert.equal(
      (facade.doctor().runtime_identity as { qualification: { status: string } }).qualification
        .status,
      "ready",
    );
    const badDoctor = createFoundryFacade({
      moduleUrl,
      workspace,
      cacheBase: path.join(root, "cache"),
      runtimeSelection: {
        cliExpectation: { ...cliExpectation, content_sha256: "0".repeat(64) },
        tidasExpectation,
        tidasExecutable: tidas,
      },
    }).doctor();
    assert.equal(badDoctor.status, "blocked");
    assert.equal(badDoctor.blockers[0]?.code, "runtime_cli_unqualified");
    assert.throws(
      () => assertQualifiedFoundryRuntime(context, JSON.parse(JSON.stringify(qualification))),
      hasCode("runtime_qualification_unverified"),
    );
    assert.throws(
      () =>
        qualifyFoundryRuntime(context, {
          cliExpectation: { ...cliExpectation, content_sha256: "0".repeat(64) },
          tidasExpectation,
          tidasExecutable: tidas,
        }),
      hasCode("runtime_cli_unqualified"),
    );
    assert.throws(
      () =>
        qualifyFoundryRuntime(context, {
          cliExpectation,
          tidasExpectation: { ...tidasExpectation, binary_version: "0.2.8" },
          tidasExecutable: tidas,
        }),
      hasCode("runtime_tidas_unqualified"),
    );
    const diagnosticTidas = path.join(root, "tidas-diagnostic.ts");
    const diagnosticSource = fs
      .readFileSync(sourceTidas, "utf8")
      .replace(
        'if (command === "validate" && args.includes("--describe")) {',
        'if (command === "validate" && args.includes("--describe")) {\n  process.stderr.write("fixture diagnostic\\n");',
      );
    fs.writeFileSync(diagnosticTidas, diagnosticSource, { mode: 0o755 });
    assert.throws(
      () =>
        qualifyFoundryRuntime(context, {
          cliExpectation,
          tidasExpectation: {
            ...tidasExpectation,
            executable: {
              bytes: fs.statSync(diagnosticTidas).size,
              sha256: sha(diagnosticTidas),
            },
          },
          tidasExecutable: diagnosticTidas,
        }),
      hasCode("runtime_tidas_unqualified"),
    );
    fs.appendFileSync(tidas, "\n");
    assert.throws(
      () => assertQualifiedFoundryRuntime(context, qualification),
      hasCode("runtime_tidas_unqualified"),
    );
  } finally {
    if (previous === undefined) delete process.env.FAKE_TIDAS_VERSION;
    else process.env.FAKE_TIDAS_VERSION = previous;
  }
});

test("qualification rechecks immutable TIDAS bytes without replaying its handshake", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-runtime-recheck-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  initializeFoundryWorkspace(createFoundryRuntimeContext({ moduleUrl, workspace }));
  const context = createFoundryRuntimeContext({ moduleUrl, workspace });
  const cli = describeCliRuntime();
  const counter = path.join(root, "handshake-count.txt");
  const source = fs
    .readFileSync(path.resolve(import.meta.dirname, "../fixtures/fake-tidas.ts"), "utf8")
    .replace(
      "const args = process.argv.slice(2);",
      `const args = process.argv.slice(2);\nconst counterFile = ${JSON.stringify(counter)};\nconst count = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, "utf8")) + 1 : 1;\nfs.writeFileSync(counterFile, String(count));\nif (count > 2) process.exit(70);`,
    );
  const tidas = path.join(root, "stateful-tidas.ts");
  fs.writeFileSync(tidas, source, { mode: 0o755 });
  const qualification = qualifyFoundryRuntime(context, {
    cliExpectation: {
      schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
      package_version: cli.package.version,
      platform: cli.platform,
      content_sha256: cli.content_sha256,
      node_version: cli.node.version,
      node_sha256: cli.node.sha256,
    },
    tidasExpectation: {
      schema: FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
      platform: context.platform,
      binary_version: "0.2.7",
      executable: { bytes: fs.statSync(tidas).size, sha256: sha(tidas) },
      validation: {
        schema_version: "tidas.validation-describe.v1",
        asset_fingerprint: "1".repeat(64),
        protocols: ["document-validation-batch.v1"],
        event_schema_versions: [
          "tidas.validation-final-event.v1",
          "tidas.validation-issue-event.v1",
        ],
      },
    },
    tidasExecutable: tidas,
  });
  assert.equal(fs.readFileSync(counter, "utf8"), "2");
  assertQualifiedFoundryRuntime(context, qualification);
  foundryRuntimeQualificationIdentity(context, qualification);
  createFoundryRuntime(context, qualification).describe();
  assert.equal(fs.readFileSync(counter, "utf8"), "2");
  fs.appendFileSync(tidas, "\n");
  assert.throws(
    () => assertQualifiedFoundryRuntime(context, qualification),
    hasCode("runtime_tidas_unqualified"),
  );
});
