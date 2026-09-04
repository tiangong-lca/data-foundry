import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createFoundryRuntime } from "./foundry-runtime.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  FoundryContextError,
  initializeFoundryWorkspace,
  type FoundryInputFact,
  type FoundryAccountIntent,
  type FoundryRuntimeContextOptions,
} from "./lib/foundry-runtime-context.ts";
import {
  createFoundryOperationResult,
  type FoundryOperationArtifact,
  type FoundryOperationNextAction,
  type FoundryOperationPermissions,
  type FoundryOperationResult,
  type FoundryPublicOperation,
} from "./lib/foundry-operation-result.ts";
import {
  loadFoundryFacadeTaskRecord,
  registerFoundryFacadeTask,
  type FoundryFacadeTaskRecord,
} from "./lib/foundry-facade-store.ts";
import {
  parseFoundryTaskStartSpec,
  type FoundryTaskStartSpec,
} from "./lib/foundry-task-start-spec.ts";
import {
  qualifyFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./lib/foundry-runtime-qualification.ts";
import { sha256Json } from "./lib/identity-preflight-proof.ts";
import { inventoryFoundryWorkspace } from "./lib/foundry-migration-inventory.ts";

export interface FoundryFacadeRuntimeSelection {
  readonly cliExpectation: unknown;
  readonly tidasExpectation: unknown;
  readonly tidasExecutable: string;
}

export interface FoundryFacadeOptions {
  readonly moduleUrl: string;
  readonly workspace: string;
  readonly cacheBase?: string;
  readonly cwd?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runtimeSelection?: FoundryFacadeRuntimeSelection;
  readonly accountIntent?: FoundryAccountIntent;
}

const maxSpecBytes = 1024 * 1024;
const maxSeedBytes = 8 * 1024 * 1024;

function readCaptured(fact: FoundryInputFact, maxBytes: number, code: string): Buffer {
  if (fact.bytes > maxBytes)
    throw new FoundryContextError(code, "Selected facade input exceeds its byte limit.");
  const fd = fs.openSync(fact.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    const bytes = fs.readFileSync(fd);
    if (
      !opened.isFile() ||
      opened.size !== fact.bytes ||
      bytes.length !== fact.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== fact.sha256
    )
      throw new FoundryContextError(code, "Selected facade input changed while it was read.");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function fileArtifact(role: string, file: string): FoundryOperationArtifact {
  const fact = captureFoundryInput(file);
  return Object.freeze({ kind: "file", role, ...fact });
}

function inlineArtifact(role: string, value: unknown): FoundryOperationArtifact {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  return Object.freeze({
    kind: "inline",
    role,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value,
  });
}

function human(code: string, instructions: string): FoundryOperationNextAction {
  return Object.freeze({ kind: "human", code, instructions });
}

function resumeCommand(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  record: FoundryFacadeTaskRecord,
): FoundryOperationNextAction {
  const binding = sha256Json({
    workspace_id: context.workspaceId,
    task_id: record.task_id,
    actor_id: record.spec.actor_id,
    revision: record.revision,
    fingerprint_sha256: record.fingerprint_sha256,
    runtime_entry_sha256: context.runtime.entrySha256,
    cwd: context.workspaceRoot,
  });
  return Object.freeze({
    kind: "command",
    code: "resume_local_preparation",
    executable: process.execPath,
    argv: Object.freeze([
      context.runtime.entryPath,
      "task",
      "resume",
      "--workspace",
      context.workspaceRoot,
      "--task",
      record.task_id,
      "--actor",
      record.spec.actor_id,
      "--json",
    ]),
    cwd: context.workspaceRoot,
    purpose: "Resume the content-bound deterministic local preparation for this task revision.",
    binding_sha256: binding,
  });
}

function noPermission(): FoundryOperationPermissions {
  return Object.freeze({
    state: "not_required",
    requested_actions: Object.freeze([]),
    approval_reference: null,
  });
}

function contextOptions(options: FoundryFacadeOptions): FoundryRuntimeContextOptions {
  return {
    moduleUrl: options.moduleUrl,
    workspace: options.workspace,
    cacheBase: options.cacheBase,
    cwd: options.cwd,
    environment: options.environment,
    accountIntent: options.accountIntent,
  };
}

function accountReadiness(context: ReturnType<typeof createFoundryRuntimeContext>) {
  const intent = context.accountIntent;
  if (!intent) return Object.freeze({ status: "not_requested", reference_selected: false });
  if (!intent.sessionReference)
    return Object.freeze({ status: "needs_auth", reference_selected: false });
  try {
    const stat = fs.lstatSync(intent.sessionReference);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 8 * 1024 * 1024)
      return Object.freeze({ status: "needs_auth", reference_selected: true });
  } catch {
    return Object.freeze({ status: "needs_auth", reference_selected: true });
  }
  return Object.freeze({ status: "configured_unverified", reference_selected: true });
}

function qualification(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  selected: FoundryFacadeRuntimeSelection | undefined,
): QualifiedFoundryRuntime | undefined {
  return selected
    ? qualifyFoundryRuntime(context, {
        cliExpectation: selected.cliExpectation,
        tidasExpectation: selected.tidasExpectation,
        tidasExecutable: selected.tidasExecutable,
      })
    : undefined;
}

function runtimeIdentity(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  selected?: QualifiedFoundryRuntime,
) {
  const described = createFoundryRuntime(context, selected).describe();
  return Object.freeze({
    foundry: Object.freeze({
      package_name: context.runtime.packageName,
      package_version: context.runtime.packageVersion,
      package_manifest_sha256: context.runtime.packageManifestSha256,
      entry_sha256: context.runtime.entrySha256,
    }),
    platform: context.platform,
    qualification: described.qualification,
    account_readiness: accountReadiness(context),
  });
}

function failure(
  operation: FoundryPublicOperation,
  taskId: string | null,
  error: unknown,
  identity: unknown = null,
): FoundryOperationResult {
  const code = error instanceof FoundryContextError ? error.code : "runtime_operation_failed";
  const message =
    error instanceof FoundryContextError
      ? error.message
      : "Foundry could not complete this operation; selected state was preserved.";
  const needsAuth = code === "needs_auth" || code.startsWith("identity_");
  const needsInput =
    code === "task_not_found" ||
    code.startsWith("argument_") ||
    code.startsWith("task_spec_") ||
    code.startsWith("task_seed_") ||
    code === "task_seed_required" ||
    code === "workspace_not_initialized" ||
    code === "input_not_selected";
  const blocked =
    !needsAuth &&
    !needsInput &&
    (code.includes("mismatch") ||
      code.includes("changed") ||
      code.includes("legacy") ||
      code.includes("unsupported") ||
      code.includes("unqualified") ||
      code.includes("required") ||
      code.includes("invalid") ||
      code.includes("conflict"));
  return createFoundryOperationResult({
    operation,
    status: needsAuth ? "needs_auth" : needsInput ? "needs_input" : blocked ? "blocked" : "failed",
    taskId,
    artifacts: [],
    blockers: [{ code, message, scope: taskId }],
    nextActions: [],
    runtimeIdentity: identity,
    permissions: noPermission(),
  });
}

function readSpec(file: string): { fact: FoundryInputFact; spec: FoundryTaskStartSpec } {
  const fact = captureFoundryInput(file);
  let value: unknown;
  try {
    value = JSON.parse(readCaptured(fact, maxSpecBytes, "task_spec_invalid").toString("utf8"));
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    throw new FoundryContextError("task_spec_invalid", "Task-start spec is not complete JSON.");
  }
  return { fact, spec: parseFoundryTaskStartSpec(value) };
}

function selectedInputs(
  workspaceRoot: string,
  spec: FoundryTaskStartSpec,
): readonly FoundryInputFact[] {
  return Object.freeze(
    spec.sources.map((source) => captureFoundryInput(path.resolve(workspaceRoot, source.path))),
  );
}

function accountIntent(spec: FoundryTaskStartSpec) {
  return spec.account_intent
    ? {
        projectRef: spec.account_intent.project_ref,
        userId: spec.account_intent.user_id,
        ...(spec.account_intent.session_reference
          ? { sessionReference: spec.account_intent.session_reference }
          : {}),
      }
    : undefined;
}

function seed(spec: FoundryTaskStartSpec, inputs: readonly FoundryInputFact[]) {
  if (!spec.seed) return undefined;
  const index = spec.sources.findIndex((source) => source.path === spec.seed?.path);
  const fact = inputs[index];
  if (!fact)
    throw new FoundryContextError("task_seed_invalid", "Selected task seed exceeds its limit.");
  let value: unknown;
  try {
    value = JSON.parse(readCaptured(fact, maxSeedBytes, "task_seed_invalid").toString("utf8"));
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    throw new FoundryContextError("task_seed_invalid", "Selected task seed is not complete JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FoundryContextError("task_seed_invalid", "Selected task seed must be a JSON object.");
  return value as Record<string, unknown>;
}

function taskContext(
  options: FoundryFacadeOptions,
  base: ReturnType<typeof createFoundryRuntimeContext>,
  record: FoundryFacadeTaskRecord,
) {
  return createFoundryRuntimeContext({
    ...contextOptions(options),
    workspace: base.workspaceRoot,
    taskId: record.task_id,
    actorId: record.spec.actor_id,
    accountIntent: accountIntent(record.spec),
    inputs: record.inputs,
  });
}

function sourcePath(record: FoundryFacadeTaskRecord, selected: string): string {
  const index = record.spec.sources.findIndex((source) => source.path === selected);
  const fact = record.inputs[index];
  if (!fact)
    throw new FoundryContextError(
      "task_spec_preparation_invalid",
      "Preparation input has no registered source fact.",
    );
  return fact.path;
}

function taskArtifacts(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  inspected: Awaited<ReturnType<ReturnType<typeof createFoundryRuntime>["inspectTask"]>>,
): FoundryOperationArtifact[] {
  return inspected.artifacts.map((entry) =>
    Object.freeze({
      kind: "file" as const,
      role: path.basename(entry.path).replace(/[^a-zA-Z0-9._-]/gu, "_"),
      path: path.join(context.taskRoot!, entry.path),
      bytes: entry.bytes,
      sha256: entry.sha256,
    }),
  );
}

function completionProven(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  record: FoundryFacadeTaskRecord,
  inspected: Awaited<ReturnType<ReturnType<typeof createFoundryRuntime>["inspectTask"]>>,
): boolean {
  for (const entry of inspected.artifacts) {
    if (entry.command !== "dataset-import-completion-report") continue;
    const file = path.join(context.taskRoot!, entry.path);
    let value: unknown;
    try {
      value = JSON.parse(
        readCaptured(
          { path: file, bytes: entry.bytes, sha256: entry.sha256 },
          maxSeedBytes,
          "task_completion_invalid",
        ).toString("utf8"),
      );
    } catch {
      return false;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const report = value as Record<string, unknown>;
      if (
        report.status === "completed" &&
        report.task_id === record.task_id &&
        (!Array.isArray(report.blockers) || report.blockers.length === 0)
      )
        return true;
    }
  }
  return false;
}

function taskProjection(
  operation: "task.start" | "task.status" | "task.resume",
  context: ReturnType<typeof createFoundryRuntimeContext>,
  record: FoundryFacadeTaskRecord,
  inspected: Awaited<ReturnType<ReturnType<typeof createFoundryRuntime>["inspectTask"]>>,
  identity: unknown,
): FoundryOperationResult {
  const artifacts = taskArtifacts(context, inspected);
  if (completionProven(context, record, inspected))
    return createFoundryOperationResult({
      operation,
      status: "completed",
      taskId: record.task_id,
      artifacts,
      blockers: [],
      nextActions: [],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  if (inspected.attempts_present)
    return createFoundryOperationResult({
      operation,
      status: "blocked",
      taskId: record.task_id,
      artifacts,
      blockers: [
        {
          code: "mutation_readback_required",
          message:
            "Existing attempt evidence requires its owner readback recovery and cannot replay.",
          scope: record.task_id,
        },
      ],
      nextActions: [
        human(
          "resume_owner_readback",
          "Use the retained owner attempt and readback evidence; do not dispatch another mutation.",
        ),
      ],
      runtimeIdentity: identity,
      permissions: {
        state: inspected.authorization_present ? "required" : "not_required",
        requested_actions: [],
        approval_reference: inspected.authorization_present ? "authorization.json" : null,
      },
    });
  const prepared = inspected.artifacts.some(
    (entry) => entry.command === "dataset-curation-cleanup",
  );
  const nextActions = prepared
    ? [
        human(
          "review_prepared_rows",
          "Review the current prepared artifacts and continue the returned task workflow.",
        ),
      ]
    : record.spec.preparation
      ? [resumeCommand(context, record)]
      : [
          human(
            "continue_task_authoring",
            "Continue authoring from the frozen task sources and seed evidence.",
          ),
        ];
  return createFoundryOperationResult({
    operation,
    status: "ready",
    taskId: record.task_id,
    artifacts,
    blockers: [],
    nextActions,
    runtimeIdentity: identity,
    permissions: noPermission(),
  });
}

export function createFoundryFacade(options: FoundryFacadeOptions) {
  const base = () => createFoundryRuntimeContext(contextOptions(options));
  return Object.freeze({
    initialize(): FoundryOperationResult {
      try {
        const initial = base();
        initializeFoundryWorkspace(initial);
        const current = base();
        const marker = path.join(current.controlRoot, "workspace.json");
        return createFoundryOperationResult({
          operation: "workspace.init",
          status: "ready",
          taskId: null,
          artifacts: [fileArtifact("workspace_marker", marker)],
          blockers: [],
          nextActions: [],
          runtimeIdentity: runtimeIdentity(current),
          permissions: noPermission(),
        });
      } catch (error) {
        return failure("workspace.init", null, error);
      }
    },
    doctor(): FoundryOperationResult {
      try {
        const current = base();
        const qualified = qualification(current, options.runtimeSelection);
        const readiness = accountReadiness(current);
        const nextActions = [
          ...(current.workspaceId
            ? []
            : [human("initialize_workspace", "Initialize the selected user workspace.")]),
          ...(qualified
            ? []
            : [
                human(
                  "provide_qualified_runtime",
                  "Launch through the trusted CLI runtime manager before a child-required stage.",
                ),
              ]),
          ...(readiness.status === "needs_auth"
            ? [
                human(
                  "authenticate_cli",
                  "Complete the trusted CLI OAuth flow, then resume with the same account intent.",
                ),
              ]
            : []),
        ];
        return createFoundryOperationResult({
          operation: "doctor",
          status: readiness.status === "needs_auth" ? "needs_auth" : "ready",
          taskId: null,
          artifacts: [],
          blockers:
            readiness.status === "needs_auth"
              ? [
                  {
                    code: "needs_auth",
                    message:
                      "The selected account intent needs a CLI-owned OAuth session before restricted work.",
                    scope: null,
                  },
                ]
              : [],
          nextActions,
          runtimeIdentity: runtimeIdentity(current, qualified),
          permissions: noPermission(),
        });
      } catch (error) {
        return failure("doctor", null, error);
      }
    },
    migrationDryRun(): FoundryOperationResult {
      try {
        const plan = inventoryFoundryWorkspace(options.workspace);
        return createFoundryOperationResult({
          operation: "workspace.migrate",
          status: "ready",
          taskId: null,
          artifacts: [inlineArtifact("workspace_migration_plan", plan)],
          blockers: [],
          nextActions:
            plan.disposition === "explicit_migration_required"
              ? [
                  human(
                    "review_workspace_migration",
                    "Review this content-bound inventory before a separately authorized W10 apply.",
                  ),
                ]
              : [],
          runtimeIdentity: null,
          permissions: noPermission(),
        });
      } catch (error) {
        return failure("workspace.migrate", null, error);
      }
    },
    async start(input: { specFile: string }): Promise<FoundryOperationResult> {
      let current: ReturnType<typeof createFoundryRuntimeContext> | null = null;
      try {
        current = base();
        if (!current.workspaceId)
          throw new FoundryContextError(
            "workspace_not_initialized",
            "Initialize the selected workspace before starting a task.",
          );
        const selectedSpec = readSpec(path.resolve(current.workspaceRoot, input.specFile));
        const inputs = selectedInputs(current.workspaceRoot, selectedSpec.spec);
        const selectedSeed = seed(selectedSpec.spec, inputs);
        const record = await registerFoundryFacadeTask(current, {
          specSource: selectedSpec.fact,
          spec: selectedSpec.spec,
          inputs,
          createOrLoad: (taskId) => {
            const context = createFoundryRuntimeContext({
              ...contextOptions(options),
              workspace: current!.workspaceRoot,
              taskId,
              actorId: selectedSpec.spec.actor_id,
              accountIntent: accountIntent(selectedSpec.spec),
              inputs,
            });
            const task = createFoundryRuntime(context).startTask({
              requestId: selectedSpec.spec.request_id,
              lane: selectedSpec.spec.lane,
              profileId: selectedSpec.spec.profile_id,
              targetEntities: [...selectedSpec.spec.target_entities],
              seed: selectedSeed,
            });
            return { created_at_utc: task.job.created_at_utc };
          },
        });
        const context = taskContext(options, current, record);
        const inspected = await createFoundryRuntime(context).inspectTask();
        const result = taskProjection(
          "task.start",
          context,
          record,
          inspected,
          runtimeIdentity(context),
        );
        const requestIndex = path.join(
          current.stateRoot,
          "facade-requests",
          `${record.request_sha256}.json`,
        );
        return createFoundryOperationResult({
          ...result,
          operation: "task.start",
          taskId: record.task_id,
          artifacts: [
            fileArtifact("facade_request_index", requestIndex),
            fileArtifact("foundry_job", path.join(context.taskRoot!, "foundry-job.json")),
          ],
          nextActions: result.next_actions,
          runtimeIdentity: result.runtime_identity,
          permissions: result.permissions,
        });
      } catch (error) {
        return failure("task.start", null, error, current ? runtimeIdentity(current) : null);
      }
    },
    async status(input: { taskId: string; actorId: string }): Promise<FoundryOperationResult> {
      let current: ReturnType<typeof createFoundryRuntimeContext> | null = null;
      try {
        current = base();
        const record = loadFoundryFacadeTaskRecord(current, input.taskId, input.actorId);
        const context = taskContext(options, current, record);
        const qualified = qualification(context, options.runtimeSelection);
        const inspected = await createFoundryRuntime(context, qualified).inspectTask();
        return taskProjection(
          "task.status",
          context,
          record,
          inspected,
          runtimeIdentity(context, qualified),
        );
      } catch (error) {
        return failure(
          "task.status",
          input.taskId,
          error,
          current ? runtimeIdentity(current) : null,
        );
      }
    },
    async resume(input: { taskId: string; actorId: string }): Promise<FoundryOperationResult> {
      let current: ReturnType<typeof createFoundryRuntimeContext> | null = null;
      try {
        current = base();
        const record = loadFoundryFacadeTaskRecord(current, input.taskId, input.actorId);
        const context = taskContext(options, current, record);
        const qualified = qualification(context, options.runtimeSelection);
        const runtime = createFoundryRuntime(context, qualified);
        const before = await runtime.inspectTask();
        if (before.attempts_present)
          return taskProjection(
            "task.resume",
            context,
            record,
            before,
            runtimeIdentity(context, qualified),
          );
        const preparation = record.spec.preparation;
        if (preparation) {
          await runtime.cleanup({
            input: sourcePath(record, preparation.input),
            type: preparation.type,
            outputDirectory: preparation.output_directory,
            sourceInput: preparation.source_input
              ? sourcePath(record, preparation.source_input)
              : undefined,
            profileId: record.spec.profile_id,
          });
        }
        const inspected = await runtime.inspectTask();
        const projected = taskProjection(
          "task.resume",
          context,
          record,
          inspected,
          runtimeIdentity(context, qualified),
        );
        if (!preparation) return projected;
        const artifacts = taskArtifacts(context, inspected);
        const cleaned = artifacts.find((artifact) =>
          artifact.kind === "file" ? /\.cleaned\.jsonl$/u.test(artifact.path) : false,
        );
        return createFoundryOperationResult({
          operation: "task.resume",
          status: "ready",
          taskId: record.task_id,
          artifacts: cleaned
            ? [
                Object.freeze({ ...cleaned, role: "cleaned_rows" }),
                ...artifacts.filter((item) => item !== cleaned),
              ]
            : artifacts,
          blockers: [],
          nextActions: projected.next_actions,
          runtimeIdentity: projected.runtime_identity,
          permissions: projected.permissions,
        });
      } catch (error) {
        return failure(
          "task.resume",
          input.taskId,
          error,
          current ? runtimeIdentity(current) : null,
        );
      }
    },
    requestBinding(input: { taskId: string; actorId: string }): string {
      const current = base();
      const record = loadFoundryFacadeTaskRecord(current, input.taskId, input.actorId);
      return sha256Json({
        workspace_id: current.workspaceId,
        task_id: record.task_id,
        revision: record.revision,
        fingerprint_sha256: record.fingerprint_sha256,
        cwd: current.workspaceRoot,
      });
    },
  });
}
