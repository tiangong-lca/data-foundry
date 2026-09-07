import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { runBoundedBatch, withBatchRunLock, type BatchJsonValue } from "@tiangong-lca/cli/batch";
import { commandSpecOptionValue } from "@tiangong-lca/cli/command-spec";
import {
  captureFoundryInput,
  FoundryContextError,
  resolveFoundryOutput,
  writeFoundryArtifact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import {
  verifyFoundryRuntimeIdentity,
  type FoundryAuthentication,
} from "./foundry-runtime-identity.ts";
import {
  rehydrateFoundryExecutionAdmission,
  assertFoundryExecutionAdmission,
} from "./foundry-execution-admission.ts";
import { createFoundryAuthenticationEnvironment } from "./foundry-authentication-environment.ts";
import { createFoundryFinalizeOwners } from "./foundry-finalize-owners.ts";
import {
  inspectOwnerExecutions,
  ownerAttemptStore,
  markOwnerAttemptConsumed,
  type readOwnerExecutionRequests,
} from "./foundry-owner-execution-store.ts";
import { readbackFoundryOwner } from "./foundry-owner-readback.ts";
import { runFoundryTaskOperation, withFoundryTaskMetadata } from "./foundry-task-store.ts";
import { registerWorkflowStageFiles } from "./foundry-workflow-io.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { canonicalPayloadSha256 } from "./post-write-root-proof.ts";
import { summarizeSameIdentityCommitFailures } from "./same-identity-commit-recovery.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";

type RequestArtifact = ReturnType<typeof readOwnerExecutionRequests>[number];
type Readback = Awaited<ReturnType<typeof readbackFoundryOwner>>;
export async function executeFoundryOwnerScope(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  requested: RequestArtifact,
  authentication: FoundryAuthentication = { mode: "oauth" },
) {
  const request = requested.request;
  if (
    !entries.some(
      (entry) => entry.path === requested.entry.path && entry.sha256 === requested.entry.sha256,
    )
  )
    throw new FoundryContextError(
      "execution_request_unregistered",
      "Select a registered owner execution request.",
    );
  const lock = resolveFoundryOutput(
    context,
    `owner-locks/${context.taskId}-${request.scope_id}.json`,
    "state",
  );
  return withBatchRunLock(
    {
      runPath: lock,
      identity: { task: context.taskId, scope: request.scope_id },
      reason: "Foundry owner execution and readback",
    },
    async () => {
      assertQualifiedFoundryRuntime(context, qualified);
      const inspected = await withFoundryTaskMetadata(context, (_, index) =>
        inspectOwnerExecutions(context, index),
      );
      const consumed = inspected.consumed.get(request.scope_id);
      if (consumed && consumed.entry.sha256 !== requested.entry.sha256)
        throw new FoundryContextError(
          "execution_request_changed",
          "A consumed scope must recover its original request.",
        );
      if (inspected.verified.has(request.scope_id))
        return inspected.verified.get(request.scope_id)!.value;
      const observationDir = resolveFoundryOutput(
        context,
        `outputs/owner-dispatch/${requested.entry.sha256}`,
      );
      const observationFile = path.join(observationDir, "dispatch-observation.json");
      let observationRegistered = entries.some(
        (entry) => path.resolve(context.taskRoot!, entry.path) === observationFile,
      );
      let observation: Record<string, unknown> | null = fs.existsSync(observationFile)
        ? workflowObject(JSON.parse(fs.readFileSync(observationFile, "utf8")))
        : null;
      if (observation && observation.request_sha256 !== requested.entry.sha256)
        throw new FoundryContextError(
          "execution_observation_invalid",
          "Dispatch observation belongs to another request.",
        );
      let identity: ReturnType<typeof verifyFoundryRuntimeIdentity> | null = null;
      let admission: Awaited<ReturnType<typeof rehydrateFoundryExecutionAdmission>> | null = null;
      if (!consumed) {
        identity = verifyFoundryRuntimeIdentity(context, authentication, process.env, qualified);
        admission = await rehydrateFoundryExecutionAdmission(context, qualified, identity, {
          capsuleFile: request.content.capsule.path,
          commandSpec: request.content.commit,
        });
        await assertFoundryExecutionAdmission(context, qualified, identity, admission);
        if (observation)
          throw new FoundryContextError(
            "execution_observation_invalid",
            "Existing dispatch evidence cannot be treated as unattempted.",
          );
        const out = commandSpecOptionValue(request.content.commit, "--out-dir")!;
        resolveFoundryOutput(context, out);
        if (fs.existsSync(out) && fs.readdirSync(out).length)
          throw new FoundryContextError(
            "execution_output_not_empty",
            "An unattempted command cannot adopt existing output artifacts.",
          );
      }
      const attemptStore = ownerAttemptStore(context, request.scope_id, {
        path: requested.file,
        sha256: requested.entry.sha256,
      });
      let lastRead: Readback | null = null;
      const readResult = (): Readback | null => lastRead;
      const readback = async () => {
        if (observation?.disposition === "failed") return null;
        const commitReport =
          observation?.disposition === "confirmed" && observation.report
            ? String(workflowObject(observation.report).path)
            : undefined;
        lastRead = await readbackFoundryOwner(
          context,
          qualified,
          request,
          authentication,
          commitReport,
        );
        return lastRead.proof.status === "verified" ? lastRead : null;
      };
      const batch = await runBoundedBatch({
        contract: request.contract,
        items: [request],
        getItemIdentity: (item) => item.scope_id,
        projectItemContent: (item) => JSON.parse(JSON.stringify(item.content)) as BatchJsonValue,
        projectItemPolicy: (item) => item.policy,
        mode: "mutation",
        maxConcurrency: 1,
        ...(consumed
          ? {
              resume: {
                contract: request.contract,
                items: [{ ...request.item_contract, state: "attempted" as const, attempts: 1 }],
              },
            }
          : {}),
        eventSink: async (event) => {
          if (event.type === "attempt_started") await markOwnerAttemptConsumed(context, requested);
          attemptStore.record(event, request.item_contract);
        },
        execute: async () => {
          if (!identity || !admission)
            throw new FoundryContextError(
              "execution_admission_required",
              "Mutation requires fresh process-local admission.",
            );
          const command = request.content.commit;
          const environment = createFoundryAuthenticationEnvironment(
            authentication,
            context.accountIntent?.sessionReference,
            process.env,
          );
          environment.FOUNDRY_VERIFIED_PROJECT_REF = request.policy.project_ref;
          environment.FOUNDRY_VERIFIED_USER_ID = request.policy.user_id;
          environment.FOUNDRY_ACCOUNT_MODE = request.policy.account_mode;
          fs.mkdirSync(observationDir, { recursive: true, mode: 0o700 });
          const commitOutput = commandSpecOptionValue(command, "--out-dir")!;
          resolveFoundryOutput(context, commitOutput);
          let result: SpawnSyncReturns<string>;
          try {
            result = spawnSync(command.executable, [...command.argv], {
              cwd: observationDir,
              env: environment,
              shell: false,
              windowsHide: true,
              encoding: "utf8",
              timeout: 120_000,
              maxBuffer: 16 * 1024 * 1024,
            });
          } finally {
            delete environment.TIANGONG_LCA_ACCESS_TOKEN;
          }
          writeFoundryArtifact(
            context,
            path.join(observationDir, "stdout.json"),
            result.stdout ?? "",
          );
          writeFoundryArtifact(
            context,
            path.join(observationDir, "stderr.log"),
            result.stderr ?? "",
          );
          let report: Record<string, unknown> | null = null,
            reportFile: string | null = null;
          try {
            report = workflowObject(JSON.parse(result.stdout));
            const files = workflowObject(report.files);
            const candidate = files.report ?? files.summary_json;
            if (typeof candidate === "string") {
              const file = resolveFoundryOutput(context, candidate);
              if (path.relative(commitOutput, file).startsWith(".."))
                throw new Error("Commit report is outside its output root.");
              if (
                canonicalPayloadSha256(JSON.parse(fs.readFileSync(file, "utf8"))) !==
                canonicalPayloadSha256(report)
              )
                throw new Error("Commit stdout/report mismatch.");
              reportFile = file;
            }
          } catch {
            report = null;
            reportFile = null;
          }
          const commitBlockers: Record<string, unknown>[] = [];
          if (report && reportFile) {
            createFoundryFinalizeOwners(context, qualified, observationDir, {
              environment: {},
              tidasExecutable: qualified.tidas.executable_path,
            }).closeout.validateCommitReportForCloseout({
              commitReport: report,
              commitReportPath: reportFile,
              datasetType: request.policy.dataset_type,
              finalRowsFile: request.content.input.path,
              expectedRows: readRows(request.content.input.path).length,
              blockers: commitBlockers,
            });
          }
          const disposition =
            result.error || result.signal || !report || !reportFile
              ? "unknown"
              : result.status === 0 && !commitBlockers.length
                ? "confirmed"
                : summarizeSameIdentityCommitFailures([report]).accepted
                  ? "same_identity_conflict"
                  : "failed";
          observation = {
            schema: "tiangong-foundry.dispatch-observation.v1",
            request_sha256: requested.entry.sha256,
            disposition,
            exit_code: result.status,
            signal: result.signal,
            report: reportFile ? captureFoundryInput(reportFile) : null,
            blockers: commitBlockers,
          };
          writeFoundryArtifact(
            context,
            observationFile,
            JSON.stringify(observation, null, 2) + "\n",
          );
          await runFoundryTaskOperation(
            context,
            {
              command: "dataset-workflow-execution-observation",
              options: { request: requested.entry.sha256 },
            },
            (operation) => {
              registerWorkflowStageFiles(context, operation, observationDir);
              if (fs.existsSync(commitOutput))
                registerWorkflowStageFiles(context, operation, commitOutput);
              operation.writeJson(observationFile, observation);
              return observation!;
            },
          );
          observationRegistered = true;
          if (disposition !== "confirmed")
            throw new Error("Owner dispatch requires retained-state recovery.");
          const verified = await readback();
          if (!verified) throw new Error("Owner write is not independently verified.");
          return verified.proof;
        },
        recoverMutation: async () => {
          const verified = lastRead
            ? lastRead.proof.status === "verified"
              ? lastRead
              : null
            : await readback();
          return verified
            ? { status: "recovered" as const, value: verified.proof }
            : { status: "unresolved" as const };
        },
      });
      const item = batch.results_input_order[0];
      const successful = item?.status === "succeeded" || item?.status === "recovered";
      const read = readResult();
      const output = resolveFoundryOutput(context, `outputs/owner-results/${randomUUID()}`);
      return runFoundryTaskOperation(
        context,
        {
          command: "dataset-workflow-execution-result",
          options: { request: requested.entry.sha256, nonce: path.basename(output) },
        },
        (operation) => {
          if (!observationRegistered) {
            if (fs.existsSync(observationDir))
              registerWorkflowStageFiles(context, operation, observationDir);
            const commitDir = commandSpecOptionValue(request.content.commit, "--out-dir");
            if (commitDir && fs.existsSync(commitDir))
              registerWorkflowStageFiles(context, operation, commitDir);
          }
          if (read) registerWorkflowStageFiles(context, operation, read.output);
          const result = {
            schema: "tiangong-foundry.owner-execution-result.v1",
            status: successful
              ? item.status === "recovered"
                ? "recovered"
                : "verified"
              : "unresolved",
            request_sha256: requested.entry.sha256,
            scope_id: request.scope_id,
            dataset_type: request.policy.dataset_type,
            input: request.content.input,
            attempt_consumed: item?.attempt_consumed ?? Boolean(consumed),
            observation,
            readback: read?.proof ?? null,
            batch_item_status: item?.status ?? "missing",
            failure_code:
              item?.status === "failed"
                ? item.error instanceof FoundryContextError
                  ? item.error.code
                  : "owner_execution_unresolved"
                : null,
            batch_status: batch.status,
          };
          operation.writeJson(path.join(output, "owner-execution-result.json"), result);
          return result;
        },
      );
    },
  );
}
