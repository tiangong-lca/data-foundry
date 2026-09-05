import fs from "node:fs";
import path from "node:path";
import type { TrustedRuntimeManifest } from "@tiangong-lca/cli/runtime";
import type { FoundryOperationResult } from "./foundry-operation-result.ts";
import type { FoundryRuntimeManagerOptions } from "./foundry-runtime-selection.ts";
import {
  assertFoundryWorkspaceWrite,
  withFoundryPendingAdoption,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertFoundryMigrationJson,
  revalidateFoundryMigrationPlan,
  type FoundryMigrationPlanningOptions,
} from "./foundry-migration-plan.ts";
import { auditFoundryMigration, withFoundryMigrationLock } from "./foundry-migration-transfer.ts";
import {
  planFoundryMigrationAdoption,
  materializeMigrationTaskSpec,
  type FoundryMigrationAdoptionPlan,
  type MigrationAdoptionSelection,
} from "./foundry-migration-adoption-plan.ts";
import {
  FOUNDRY_MIGRATION_ACTIVATION_SCHEMA,
  FOUNDRY_MIGRATED_WORKSPACE_SCHEMA,
  FOUNDRY_MIGRATED_WORKSPACE_FEATURES,
  readFoundryMigrationAuthority,
  type FoundryMigrationActivation,
  type MigrationProtectedFile,
} from "./foundry-migration-authority.ts";
import {
  transferBytes,
  transferFail,
  transferFileFact,
  transferHash,
  transferPath,
  transferRead,
  transferWriteOnce,
} from "./foundry-migration-transfer-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { leaseFoundryRuntime } from "./foundry-runtime-selection.ts";

export interface MigrationAdoptionExecutionOptions {
  readonly signal?: AbortSignal;
  readonly checkpoint?: (
    phase: "mapped" | "prepared" | "audited" | "activated",
    index: number,
  ) => void;
}
export interface MigrationAdoptionHost {
  readonly runtimeManager?: FoundryRuntimeManagerOptions;
  createTaskFacade(): {
    start(input: { specFile: string }): Promise<FoundryOperationResult>;
    resume(input: { taskId: string; actorId: string }): Promise<FoundryOperationResult>;
    status(input: { taskId: string; actorId: string }): Promise<FoundryOperationResult>;
  };
}
function check(options: MigrationAdoptionExecutionOptions): void {
  if (options.signal?.aborted)
    transferFail(
      "operation_interrupted",
      "Adoption was interrupted; preserved source and pending state remain available for recovery.",
    );
}
function sameAdoption(provided: unknown, current: FoundryMigrationAdoptionPlan): void {
  assertFoundryMigrationJson(provided);
  if (sha256Json(provided) !== sha256Json(current))
    transferFail(
      "migration_adoption_changed",
      "The supplied adoption differs from independent source, task, actor or runtime selections.",
    );
}
function protectedFact(context: FoundryRuntimeContext, relative: string): MigrationProtectedFile {
  const fact = transferFileFact(transferPath(context.controlRoot, relative));
  return { path: relative, bytes: fact.bytes, sha256: fact.sha256 };
}

export async function applyFoundryMigrationAdoption(
  context: FoundryRuntimeContext,
  planning: FoundryMigrationPlanningOptions,
  transfer: unknown,
  selections: readonly MigrationAdoptionSelection[],
  provided: unknown,
  manifest: TrustedRuntimeManifest,
  host: MigrationAdoptionHost,
  options: MigrationAdoptionExecutionOptions = {},
): Promise<{ activation: FoundryMigrationActivation; path: string }> {
  assertFoundryWorkspaceWrite(context);
  check(options);
  assertFoundryMigrationJson(provided);
  if (context.migration) {
    revalidateFoundryMigrationPlan(context, planning, transfer, context.migration.plan_sha256);
    const base = `migrations/${context.migration.plan_sha256}`;
    const saved = JSON.parse(
      transferRead(transferPath(context.controlRoot, `${base}/adoption.json`)).toString("utf8"),
    ) as FoundryMigrationAdoptionPlan;
    sameAdoption(provided, saved);
    const selected = selections
      .map((item) => ({ source_task: item.sourceTask, spec_file: path.resolve(item.specFile) }))
      .sort((a, b) => (a.source_task < b.source_task ? -1 : a.source_task > b.source_task ? 1 : 0));
    if (
      saved.runtime_manifest_sha256 !== manifest.sha256 ||
      sha256Json(saved.selections) !== sha256Json(selected)
    )
      transferFail(
        "migration_adoption_changed",
        "Repeated application requires the same independent task and runtime selections.",
      );
    const activation = readFoundryMigrationAuthority(
      context.controlRoot,
      context.workspaceId!,
      context.migration,
    );
    return { activation, path: transferPath(context.controlRoot, `${base}/activation.json`) };
  }
  const planned = await planFoundryMigrationAdoption(
    context,
    planning,
    transfer,
    selections,
    manifest,
  );
  sameAdoption(provided, planned);
  return withFoundryMigrationLock(context, planning.sourceWorkspace, async () => {
    check(options);
    const plan = await planFoundryMigrationAdoption(
      context,
      planning,
      transfer,
      selections,
      manifest,
    );
    sameAdoption(provided, plan);
    if (host.runtimeManager)
      await leaseFoundryRuntime(context, manifest, plan.workspace_id, host.runtimeManager, [
        planning.sourceWorkspace,
      ]);
    const base = `migrations/${plan.plan_sha256}`;
    const scratch = `${base}/scratch`;
    transferWriteOnce(context.controlRoot, `${base}/adoption.json`, transferBytes(plan), scratch);
    for (const row of plan.tasks) {
      if (row.source_spec) {
        const selected = transferRead(row.source_spec.path, 1024 * 1024);
        if (
          selected.length !== row.source_spec.bytes ||
          transferHash(selected) !== row.source_spec.sha256
        )
          transferFail(
            "migration_source_changed",
            "Selected current task specification changed before adoption.",
          );
        transferWriteOnce(
          context.controlRoot,
          `${base}/specs/source-${row.source_spec.sha256}.json`,
          selected,
          scratch,
        );
      }
      if (row.target_spec)
        transferWriteOnce(
          context.controlRoot,
          `${base}/specs/${row.authority.task_id}.json`,
          transferBytes(materializeMigrationTaskSpec(row.target_spec)),
          scratch,
        );
    }
    options.checkpoint?.("mapped", 0);
    check(options);
    await withFoundryPendingAdoption(context, async () => {
      const facade = host.createTaskFacade();
      let index = 0;
      for (const row of plan.tasks) {
        if (!row.target_spec || !row.authority.task_id) continue;
        check(options);
        const started = await facade.start({
          specFile: transferPath(
            context.controlRoot,
            `${base}/specs/${row.authority.task_id}.json`,
          ),
        });
        if (
          started.task_id !== row.authority.task_id ||
          !["ready", "blocked"].includes(started.status)
        )
          transferFail(
            "migration_preparation_failed",
            `Current task registration did not complete: ${started.blockers[0]?.code ?? started.status}.`,
          );
        if (row.target_spec.preparation) {
          const prepared = await facade.resume({
            taskId: row.authority.task_id,
            actorId: row.authority.actor_id,
          });
          if (
            !["ready", "blocked"].includes(prepared.status) ||
            prepared.blockers.some((item) => /attempt|readback|predecessor/u.test(item.code))
          )
            transferFail(
              "migration_preparation_failed",
              `Current local preparation did not complete: ${prepared.blockers[0]?.code ?? prepared.status}.`,
            );
        }
        const inspected = await facade.status({
          taskId: row.authority.task_id,
          actorId: row.authority.actor_id,
        });
        if (
          !["ready", "blocked"].includes(inspected.status) ||
          inspected.blockers.some((item) => /attempt|readback|predecessor/u.test(item.code))
        )
          transferFail(
            "migration_preparation_failed",
            "Adopted task cannot pass independent current-owner inspection.",
          );
        options.checkpoint?.("prepared", ++index);
      }
    });
    check(options);
    const original = auditFoundryMigration(context, planning, transfer);
    sameAdoption(
      provided,
      await planFoundryMigrationAdoption(context, planning, transfer, selections, manifest),
    );
    const pending = transferRead(transferPath(context.controlRoot, "workspace.json"), 64 * 1024);
    transferWriteOnce(context.controlRoot, `${base}/pending-marker.json`, pending, scratch);
    const names = new Set([
      `${base}/plan.json`,
      `${base}/receipt.json`,
      `${base}/adoption.json`,
      `${base}/pending-marker.json`,
      ...original.receipt.files.map((file) => file.destination),
    ]);
    for (const row of plan.tasks) {
      if (row.source_spec) names.add(`${base}/specs/source-${row.source_spec.sha256}.json`);
      const id = row.authority.task_id;
      if (!id) continue;
      names.add(`${base}/specs/${id}.json`);
      for (const name of [
        "foundry-job.json",
        "source-manifest.json",
        "profile-lock.json",
        "seed-manifest.json",
        "account-intent.json",
      ]) {
        const relative = `workspaces/${id}/${name}`;
        if (fs.existsSync(transferPath(context.controlRoot, relative))) names.add(relative);
      }
      for (const area of [
        "task-registrations",
        "task-publications",
        "task-accounts",
        "facade-tasks",
      ]) {
        const relative = `state/${area}/${id}.json`;
        if (fs.existsSync(transferPath(context.controlRoot, relative))) names.add(relative);
      }
    }
    const protectedFiles = [...names].sort().map((name) => protectedFact(context, name));
    const activationPath = transferPath(context.controlRoot, `${base}/activation.json`);
    const previous = fs.existsSync(activationPath)
      ? (JSON.parse(transferRead(activationPath).toString("utf8")) as FoundryMigrationActivation)
      : null;
    const payload = {
      schema: FOUNDRY_MIGRATION_ACTIVATION_SCHEMA,
      workspace_id: plan.workspace_id,
      plan_sha256: plan.plan_sha256,
      adoption_sha256: plan.adoption_sha256,
      created_at_utc: previous?.created_at_utc ?? new Date().toISOString(),
      tasks: plan.tasks.map((row) => row.authority),
      protected_files: protectedFiles,
      remote_write_allowed: false as const,
    };
    const activation: FoundryMigrationActivation = {
      ...payload,
      activation_sha256: sha256Json(payload),
    };
    transferWriteOnce(
      context.controlRoot,
      `${base}/activation.json`,
      transferBytes(activation),
      scratch,
    );
    const binding = {
      plan_sha256: plan.plan_sha256,
      activation_sha256: transferHash(transferBytes(activation)),
    };
    readFoundryMigrationAuthority(context.controlRoot, plan.workspace_id, binding);
    options.checkpoint?.("audited", plan.tasks.length);
    check(options);
    auditFoundryMigration(context, planning, transfer);
    sameAdoption(
      provided,
      await planFoundryMigrationAdoption(context, planning, transfer, selections, manifest),
    );
    readFoundryMigrationAuthority(context.controlRoot, plan.workspace_id, binding);
    const marker = transferBytes({
      schema: FOUNDRY_MIGRATED_WORKSPACE_SCHEMA,
      layout_version: 2,
      workspace_id: plan.workspace_id,
      created_at_utc: activation.created_at_utc,
      required_features: FOUNDRY_MIGRATED_WORKSPACE_FEATURES,
      migration: binding,
      extensions: {},
    });
    transferWriteOnce(context.controlRoot, `${base}/workspace-next.json`, marker, scratch);
    if (
      !transferRead(transferPath(context.controlRoot, "workspace.json"), 64 * 1024).equals(pending)
    )
      transferFail(
        "migration_destination_conflict",
        "Workspace marker changed before activation; all state was preserved.",
      );
    fs.renameSync(
      transferPath(context.controlRoot, `${base}/workspace-next.json`),
      transferPath(context.controlRoot, "workspace.json"),
    );
    options.checkpoint?.("activated", plan.tasks.length);
    return { activation, path: activationPath };
  });
}
