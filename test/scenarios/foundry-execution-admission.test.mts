import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CLI_RUNTIME_EXPECTATION_SCHEMA, describeCliRuntime } from "@tiangong-lca/cli/runtime";
import { createFileArtifactFact, createFoundryCommandSpec } from "@tiangong-lca/cli/command-spec";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import {
  FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
  qualifyFoundryRuntime,
} from "../../scripts/lib/foundry-runtime-qualification.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { verifyFoundryRuntimeIdentity } from "../../scripts/lib/foundry-runtime-identity.ts";
import {
  assertFoundryExecutionAdmission,
  rehydrateFoundryExecutionAdmission,
} from "../../scripts/lib/foundry-execution-admission.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

const moduleUrl = new URL("../../scripts/runtime-entry.ts", import.meta.url).href;
const accountIntent = {
  projectRef: "aaaaaaaaaaaaaaaaaaaa",
  userId: "11111111-1111-4111-8111-111111111111",
};
const hasCode = (code: string) => (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === code);
const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

test("serialized child context rehydrates only through fresh runtime, identity, lineage and grant checks", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-execution-admission-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.jsonl");
  const originalSource = `${JSON.stringify({
    unitGroupDataSet: {
      unitGroupInformation: {
        dataSetInformation: {
          "common:UUID": "22222222-2222-4222-8222-222222222222",
          "common:other": {
            "@xmlns:tidasimport": "https://example.invalid/tidas-import",
            "tidasimport:sourceTrace": { source: "synthetic-fixture" },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  })}\n`;
  fs.writeFileSync(source, originalSource);
  const baseOptions = {
    moduleUrl,
    workspace: path.join(root, "workspace"),
    cacheBase: path.join(root, "cache"),
    taskId: "task",
    actorId: "agent",
    accountIntent,
  };
  initializeFoundryWorkspace(
    createFoundryRuntimeContext({
      moduleUrl,
      workspace: baseOptions.workspace,
      cacheBase: baseOptions.cacheBase,
    }),
  );
  const sourceContext = createFoundryRuntimeContext({
    ...baseOptions,
    inputs: [captureFoundryInput(source)],
  });
  const prepared = await createFoundryRuntime(sourceContext).cleanup({
    input: source,
    type: "unitgroup",
  });
  const finalRows = path.join(sourceContext.workspaceRoot, String(prepared.cleaned_rows_file));
  const contextOptions = {
    ...baseOptions,
    inputs: [captureFoundryInput(source), captureFoundryInput(finalRows)],
  };
  const context = createFoundryRuntimeContext(contextOptions);
  const cli = describeCliRuntime();
  const cliExpectation = {
    schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
    package_version: cli.package.version,
    platform: cli.platform,
    content_sha256: cli.content_sha256,
    node_version: cli.node.version,
    node_sha256: cli.node.sha256,
  };
  const tidas = path.join(root, "tidas.ts");
  fs.copyFileSync(path.resolve(import.meta.dirname, "../fixtures/fake-tidas.ts"), tidas);
  fs.chmodSync(tidas, 0o755);
  const tidasExpectation = {
    schema: FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
    platform: context.platform,
    binary_version: "0.2.7",
    executable: { bytes: fs.statSync(tidas).size, sha256: sha(tidas) },
    validation: {
      schema_version: "tidas.validation-describe.v1",
      asset_fingerprint: "1".repeat(64),
      protocols: ["document-validation-batch.v1"],
      event_schema_versions: ["tidas.validation-final-event.v1", "tidas.validation-issue-event.v1"],
    },
  };
  const qualify = (selectedContext: typeof context) =>
    qualifyFoundryRuntime(selectedContext, {
      cliExpectation,
      tidasExpectation,
      tidasExecutable: tidas,
    });
  const qualification = qualify(context);
  const originalSpawn = childProcess.spawnSync;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const argv = args[1];
    if (Array.isArray(argv) && argv.includes("identity-receipt")) {
      return {
        status: 0,
        signal: null,
        stdout: JSON.stringify(
          testAuthIdentityReceipt({
            capturedAtUtc: new Date().toISOString(),
            projectRef: accountIntent.projectRef,
            userId: accountIntent.userId,
          }),
        ),
        stderr: "",
        pid: 1,
        output: [],
      };
    }
    return Reflect.apply(originalSpawn, childProcess, args);
  });
  const identity = verifyFoundryRuntimeIdentity(
    context,
    { mode: "oauth" },
    { PATH: process.env.PATH },
    qualification,
  );
  const runtime = createFoundryRuntime(context, qualification);
  const evidenceFile = path.join(root, "approval.txt");
  fs.writeFileSync(evidenceFile, "Synthetic task-scoped user approval.\n");
  const evidence = captureFoundryInput(evidenceFile);
  const profile = JSON.parse(
    fs.readFileSync(path.join(context.taskRoot!, "profile-lock.json"), "utf8"),
  );
  const now = Date.now();
  const originalGrant = {
    schema: "tiangong-foundry.task-authorization.v1",
    binding: {
      workspace_id: context.workspaceId,
      task_id: context.taskId,
      actor_id: context.actorId,
      project_ref: accountIntent.projectRef,
      user_id: accountIntent.userId,
      profile_id: "generic",
      profile_sha256: profile.profile_sha256,
      input_scope_sha256: context.inputs[0].sha256,
    },
    issued_at_utc: new Date(now).toISOString(),
    expires_at_utc: new Date(now + 5 * 60_000).toISOString(),
    remote_state_code: 0,
    allowed_actions: ["unitgroup_write"],
    qa_waivers: [],
    evidence: [
      {
        id: "approval",
        kind: "user-decision",
        reference: evidence.path,
        sha256: evidence.sha256,
      },
    ],
  };
  await runtime.registerAuthorization(identity, {
    inputFile: source,
    grant: originalGrant,
    evidence: [{ id: "approval", kind: "user-decision", file: evidence }],
  });
  assert.equal(runtime.describe().command_policy.total, 63);
  assert.deepEqual(runtime.describe().command_policy.public_facade, ["init", "doctor"]);
  const derived = await runtime.prepareDerivedAuthorization(identity, {
    approvedInputFile: source,
    derivedInputFile: finalRows,
  });
  assert.equal(derived.grant.binding.input_scope_sha256, captureFoundryInput(finalRows).sha256);
  assert.deepEqual(derived.grant.allowed_actions, ["unitgroup_write"]);
  assert.equal(fs.existsSync(path.join(context.taskRoot!, derived.derivation.path)), true);
  await runtime.registerAuthorization(identity, {
    inputFile: finalRows,
    grant: derived.grant,
    evidence: derived.evidence,
    expectedPreviousSha256: derived.expected_previous_sha256,
  });
  const installedCli = resolveInstalledTiangongLcaCliPackage();
  const finalRowsArtifact = createFileArtifactFact({
    role: "final_rows",
    path: path.relative(context.workspaceRoot, finalRows).split(path.sep).join("/"),
    filePath: finalRows,
  });
  const spec = createFoundryCommandSpec({
    executable: process.execPath,
    argv: [
      installedCli.binPath,
      "dataset",
      "save-draft",
      "--type",
      "unitgroup",
      "--input",
      finalRows,
      "--out-dir",
      path.join(context.taskRoot!, "outputs", "remote-write"),
      "--allow-account-local-support",
      "--commit",
      "--json",
    ],
    binding: { artifacts: [finalRowsArtifact] },
  });
  const executionOptions = {
    command: "dataset-commit-handoff-plan",
    approvedInputFile: source,
    finalRowsFile: finalRows,
    requiredActions: ["unitgroup_write"],
    commandSpec: spec,
  } as const;
  await assert.rejects(
    async () => createFoundryRuntime(context).createExecutionCapsule(identity, executionOptions),
    hasCode("runtime_qualification_required"),
  );
  const capsule = await runtime.createExecutionCapsule(identity, executionOptions);
  const childContext = createFoundryRuntimeContext(contextOptions);
  const childQualification = qualify(childContext);
  const childIdentity = verifyFoundryRuntimeIdentity(
    childContext,
    { mode: "oauth" },
    { PATH: process.env.PATH },
    childQualification,
  );
  const childRuntime = createFoundryRuntime(childContext, childQualification);
  const admission = await childRuntime.rehydrateExecution(childIdentity, {
    capsuleFile: capsule.capsule_file,
    commandSpec: spec,
  });
  assert.equal((await childRuntime.admitExecution(childIdentity, admission)).sha256, spec.sha256);
  await assert.rejects(
    () =>
      rehydrateFoundryExecutionAdmission(
        childContext,
        childQualification,
        JSON.parse(JSON.stringify(childIdentity)),
        { capsuleFile: path.join(root, "must-not-be-read.json"), commandSpec: spec },
      ),
    hasCode("identity_context_mismatch"),
  );
  await assert.rejects(
    () =>
      assertFoundryExecutionAdmission(
        childContext,
        childQualification,
        childIdentity,
        JSON.parse(JSON.stringify(admission)),
      ),
    hasCode("execution_admission_unverified"),
  );
  const outsideCapsule = path.join(context.taskRoot!, path.basename(capsule.capsule_file));
  fs.copyFileSync(capsule.capsule_file, outsideCapsule);
  await assert.rejects(
    () =>
      rehydrateFoundryExecutionAdmission(childContext, childQualification, childIdentity, {
        capsuleFile: outsideCapsule,
        commandSpec: spec,
      }),
    hasCode("execution_capsule_outside_task"),
  );
  const unrelatedSpec = createFoundryCommandSpec({
    executable: process.execPath,
    argv: [
      installedCli.binPath,
      "auth",
      "logout",
      "--input",
      finalRows,
      "--out-dir",
      path.join(context.taskRoot!, "outputs", "unrelated"),
      "--commit",
      "--json",
    ],
    binding: { artifacts: [finalRowsArtifact] },
  });
  await assert.rejects(
    () =>
      runtime.createExecutionCapsule(identity, {
        ...executionOptions,
        commandSpec: unrelatedSpec,
      }),
    hasCode("execution_command_unadmitted"),
  );
  const wrongTypeSpec = createFoundryCommandSpec({
    executable: process.execPath,
    argv: [
      installedCli.binPath,
      "dataset",
      "save-draft",
      "--type",
      "contact",
      "--input",
      finalRows,
      "--out-dir",
      path.join(context.taskRoot!, "outputs", "wrong-type"),
      "--allow-account-local-support",
      "--commit",
      "--json",
    ],
    binding: { artifacts: [finalRowsArtifact] },
  });
  await assert.rejects(
    () =>
      runtime.createExecutionCapsule(identity, {
        ...executionOptions,
        commandSpec: wrongTypeSpec,
      }),
    hasCode("execution_action_command_mismatch"),
  );
  await assert.rejects(
    () =>
      runtime.createExecutionCapsule(identity, {
        command: "dataset-commit-handoff-plan",
        approvedInputFile: source,
        finalRowsFile: finalRows,
        requiredActions: ["flowproperty_write"],
        commandSpec: spec,
      }),
    hasCode("execution_action_unauthorized"),
  );
  await assert.rejects(
    () =>
      runtime.createExecutionCapsule(identity, {
        command: "dataset-commit-handoff-plan",
        approvedInputFile: source,
        finalRowsFile: finalRows,
        requiredActions: ["unitgroup_write"],
        requiredQaWaivers: ["process_material_balance_deviation"],
        commandSpec: spec,
      }),
    hasCode("execution_qa_waiver_required"),
  );
  fs.appendFileSync(finalRows, " ");
  await assert.rejects(
    () =>
      assertFoundryExecutionAdmission(childContext, childQualification, childIdentity, admission),
    hasCode("execution_input_changed"),
  );
  assert.equal(sha(source), createHash("sha256").update(originalSource).digest("hex"));
});
