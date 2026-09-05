import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { TrustedRuntimeManifest } from "@tiangong-lca/cli/runtime";
import { assertWorkspaceCompatibility } from "@tiangong-lca/cli/runtime";
import { createFoundryRuntime } from "../foundry-runtime.ts";
import {
  createFoundryRuntimeContext,
  captureFoundryInput,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  parseFoundryTaskStartSpec,
  taskStartSpecFingerprint,
  type FoundryTaskStartSpec,
} from "./foundry-task-start-spec.ts";
import { loadFoundryFacadeTaskRecord } from "./foundry-facade-store.ts";
import {
  auditFoundryMigration,
  type FoundryMigrationTransferReceipt,
} from "./foundry-migration-transfer.ts";
import {
  revalidateFoundryMigrationPlan,
  type FoundryMigrationPlanningOptions,
  type FoundryMigrationTransferPlan,
} from "./foundry-migration-plan.ts";
import { migrationCredentialPath } from "./foundry-migration-inventory.ts";
import {
  FOUNDRY_MIGRATED_WORKSPACE_SCHEMA,
  FOUNDRY_MIGRATED_WORKSPACE_FEATURES,
  migrationDatasetScope,
  readFoundryMigrationAuthority,
  type MigrationTaskAuthority,
} from "./foundry-migration-authority.ts";
import {
  transferRead,
  transferHash,
  transferPath,
  transferFail,
} from "./foundry-migration-transfer-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

export const FOUNDRY_MIGRATION_ADOPTION_PLAN_SCHEMA =
  "tiangong-foundry.migration-adoption-plan.v1" as const;
export interface MigrationAdoptionSelection {
  readonly sourceTask: string;
  readonly specFile: string;
}
export type MigrationTaskTemplate = Omit<FoundryTaskStartSpec, "schema" | "account_intent"> & {
  readonly account_intent: { readonly project_ref: string; readonly user_id: string } | null;
};
export function materializeMigrationTaskSpec(
  template: MigrationTaskTemplate,
): FoundryTaskStartSpec {
  return parseFoundryTaskStartSpec({
    ...template,
    schema: "tiangong-foundry.task-start.v1",
    account_intent: template.account_intent
      ? { ...template.account_intent, session_reference: null }
      : null,
  });
}
export function migrationTaskTemplate(spec: FoundryTaskStartSpec): MigrationTaskTemplate {
  const { schema: _schema, account_intent: account, ...fields } = spec;
  return {
    ...fields,
    account_intent: account ? { project_ref: account.project_ref, user_id: account.user_id } : null,
  };
}
export interface MigrationAdoptionRow {
  readonly authority: MigrationTaskAuthority;
  readonly source_spec: FoundryInputFact | null;
  readonly target_spec: MigrationTaskTemplate | null;
  readonly inputs: readonly FoundryInputFact[];
  readonly evidence_paths: readonly string[];
  readonly reasons: readonly string[];
  readonly scope_inputs: readonly string[];
}
export interface FoundryMigrationAdoptionPlan {
  readonly schema: typeof FOUNDRY_MIGRATION_ADOPTION_PLAN_SCHEMA;
  readonly workspace_id: string;
  readonly plan_sha256: string;
  readonly actor_id: string;
  readonly runtime_manifest_sha256: string;
  readonly selections: readonly { readonly source_task: string; readonly spec_file: string }[];
  readonly tasks: readonly MigrationAdoptionRow[];
  readonly remote_write_allowed: false;
  readonly adoption_sha256: string;
}
type CopiedFile = FoundryMigrationTransferReceipt["files"][number];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    transferFail("migration_adoption_invalid", "Legacy task evidence must be a JSON object.");
  return value as Record<string, unknown>;
}
function archiveJson(
  context: FoundryRuntimeContext,
  file: CopiedFile | undefined,
): Record<string, unknown> {
  if (!file || file.bytes > 8 * 1024 * 1024)
    transferFail("migration_adoption_invalid", "Task evidence is missing or exceeds its limit.");
  const data = transferRead(transferPath(context.controlRoot, file.destination), 8 * 1024 * 1024);
  if (transferHash(data) !== file.sha256)
    transferFail("migration_authority_changed", "Archived task evidence changed.");
  return object(JSON.parse(data.toString("utf8")));
}
function selectedSource(
  sourceWorkspace: string,
  requested: string,
  copied: readonly CopiedFile[],
): CopiedFile {
  const candidate = path.resolve(sourceWorkspace, requested);
  if (migrationCredentialPath(candidate))
    transferFail(
      "migration_credential_forbidden",
      "Private storage cannot be adopted as a source.",
    );
  const selected = copied.find(
    (file) => file.source === candidate || file.source === fs.realpathSync(candidate),
  );
  if (!selected)
    transferFail(
      "migration_source_unaccounted",
      "Every legacy source must be independently included in the transfer.",
    );
  return selected;
}

function archivedScope(
  context: FoundryRuntimeContext,
  plan: FoundryMigrationTransferPlan,
  root: string,
  copied: readonly CopiedFile[],
): { keys: string[]; complete: boolean; inputs: string[] } {
  try {
    const prefix = path.join(plan.source_inventory.workspace_root, ".foundry", root);
    const manifest = archiveJson(
      context,
      copied.find((file) => file.source === path.join(prefix, "source-manifest.json")),
    );
    const job = archiveJson(
      context,
      copied.find((file) => file.source === path.join(prefix, "foundry-job.json")),
    );
    if (
      !Array.isArray(manifest.source_paths) ||
      !manifest.source_paths.length ||
      !Array.isArray(job.target_entities)
    )
      return { keys: [], complete: false, inputs: [] };
    const keys = new Set<string>(),
      inputs: string[] = [];
    let complete = true;
    for (const item of manifest.source_paths) {
      const source = object(item);
      if (typeof source.path !== "string" || typeof source.sha256 !== "string")
        return { keys: [], complete: false, inputs: [] };
      const file = selectedSource(plan.source_inventory.workspace_root, source.path, copied);
      if (file.sha256 !== source.sha256) return { keys: [], complete: false, inputs: [] };
      const bytes = transferRead(
        transferPath(context.controlRoot, file.destination),
        64 * 1024 * 1024,
      );
      if (transferHash(bytes) !== file.sha256)
        transferFail("migration_authority_changed", "Archived scope input changed.");
      const scope = migrationDatasetScope(file.source, bytes);
      complete = complete && scope.complete;
      inputs.push(file.destination);
      for (const key of scope.keys) keys.add(key);
    }
    for (const file of copied) {
      if (
        !file.source.startsWith(prefix + path.sep) ||
        inputs.includes(file.destination) ||
        !/\.jsonl?$/iu.test(file.source)
      )
        continue;
      const data = transferRead(
        transferPath(context.controlRoot, file.destination),
        64 * 1024 * 1024,
      );
      const scope = migrationDatasetScope(file.source, data);
      if (!scope.keys.length) continue;
      complete = complete && scope.complete;
      inputs.push(file.destination);
      for (const key of scope.keys) keys.add(key);
    }
    const types = new Set([...keys].map((key) => key.split(":")[0]));
    if (job.target_entities.some((type) => typeof type !== "string" || !types.has(type)))
      complete = false;
    return { keys: [...keys].sort(), complete, inputs: [...new Set(inputs)].sort() };
  } catch {
    return { keys: [], complete: false, inputs: [] };
  }
}

async function inspectLocalHistory(
  context: FoundryRuntimeContext,
  plan: FoundryMigrationTransferPlan,
  root: string,
  files: readonly CopiedFile[],
  allFiles: readonly CopiedFile[],
  manifest: TrustedRuntimeManifest,
): Promise<{ job: Record<string, unknown>; sources: CopiedFile[]; allowed: Set<string> }> {
  const originalRoot = path.join(plan.source_inventory.workspace_root, ".foundry", root);
  const byName = new Map(
    files.map((file) => [path.relative(originalRoot, file.source).split(path.sep).join("/"), file]),
  );
  const job = archiveJson(context, byName.get("foundry-job.json")),
    source = archiveJson(context, byName.get("source-manifest.json"));
  const profile = archiveJson(context, byName.get("profile-lock.json"));
  if (
    !["external-dataset-curated-import", "source-evidence-dataset-development"].includes(
      String(job.lane),
    ) ||
    typeof job.target_profile !== "string" ||
    !Array.isArray(job.target_entities) ||
    !job.target_entities.length ||
    (profile.profile_id !== undefined && profile.profile_id !== job.target_profile) ||
    !Array.isArray(source.source_paths) ||
    !source.source_paths.length
  )
    transferFail("migration_adoption_invalid", "Legacy source/profile/task intent is incomplete.");
  const sources = source.source_paths.map((value) => {
    const ref = object(value);
    if (typeof ref.path !== "string" || typeof ref.sha256 !== "string")
      transferFail("migration_source_unaccounted", "Legacy source facts are incomplete.");
    const file = selectedSource(plan.source_inventory.workspace_root, ref.path, allFiles);
    if (ref.sha256 !== file.sha256 || (ref.bytes !== undefined && ref.bytes !== file.bytes))
      transferFail(
        "migration_source_changed",
        "Legacy source hashes do not match the transferred bytes.",
      );
    return file;
  });
  const allowed = new Set([
    "foundry-job.json",
    "source-manifest.json",
    "profile-lock.json",
    "seed-manifest.json",
  ]);
  for (const stage of plan.stages.filter(
    (item) =>
      item.path.startsWith(root + "/") && item.migration_action === "rebuild-local-preparation",
  ))
    allowed.add(stage.path.slice(root.length + 1));
  if (job.schema === "tiangong-foundry.job.v2") {
    if (typeof job.task_id !== "string" || typeof job.actor_id !== "string")
      transferFail("migration_adoption_invalid", "Registered legacy task identity is incomplete.");
    const options = {
      moduleUrl: pathToFileURL(context.runtime.entryPath).href,
      workspace: plan.source_inventory.workspace_root,
      cacheBase: context.cacheBase,
      workspaceAccess: { manifest, access: "read" as const },
    };
    const base = createFoundryRuntimeContext(options);
    const taskContext = createFoundryRuntimeContext({
      ...options,
      taskId: job.task_id,
      actorId: job.actor_id,
      inputs: sources.map((file) => ({
        path: file.source,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
    });
    if (fs.existsSync(path.join(base.stateRoot, "facade-tasks", `${job.task_id}.json`)))
      loadFoundryFacadeTaskRecord(base, job.task_id, job.actor_id);
    const inspected = await createFoundryRuntime(taskContext).inspectTask();
    if (inspected.attempts_present)
      transferFail(
        "migration_attempt_history",
        "Retained task attempts require original-owner readback.",
      );
    allowed.add("artifact-index.jsonl");
    allowed.add("account-intent.json");
    allowed.add("authorization.json");
    for (const entry of inspected.artifacts) {
      allowed.add(entry.path);
      allowed.add(entry.receipt.path);
      const receipt = archiveJson(context, byName.get(entry.receipt.path));
      for (const ref of [receipt.plan, receipt.result]) {
        const item = object(ref);
        if (typeof item.path !== "string")
          transferFail("migration_adoption_invalid", "Local operation evidence is incomplete.");
        allowed.add(item.path);
      }
      if (entry.path.endsWith("dataset-import-completion-report.json")) {
        const completion = archiveJson(context, byName.get(entry.path));
        if (
          completion.status === "completed" &&
          completion.task_id === job.task_id &&
          Array.isArray(completion.blockers) &&
          completion.blockers.length === 0
        )
          transferFail(
            "migration_terminal_retained",
            "The registered terminal report remains historical completion evidence.",
          );
      }
    }
  } else {
    if (
      job.schema_version !== 1 ||
      source.schema_version !== 1 ||
      job.task_id !== path.posix.basename(root)
    )
      transferFail(
        "migration_adoption_invalid",
        "Legacy task schema or directory identity is unsupported.",
      );
    if (
      typeof job.workspace_dir !== "string" ||
      fs.realpathSync(path.resolve(plan.source_inventory.workspace_root, job.workspace_dir)) !==
        fs.realpathSync(originalRoot)
    )
      transferFail(
        "migration_task_binding_mismatch",
        "Legacy job layout differs from its selected task directory.",
      );
    if (byName.has("artifact-index.jsonl")) {
      const index = byName.get("artifact-index.jsonl")!;
      if (index.bytes !== 0)
        transferFail(
          "migration_history_unclassified",
          "Legacy artifact lineage requires owner verification.",
        );
      allowed.add("artifact-index.jsonl");
    }
    for (const [name, file] of byName) {
      if (!/^checkpoints\/[^/]+\.json$/u.test(name)) continue;
      const checkpoint = archiveJson(context, file);
      if (
        checkpoint.schema_version !== 1 ||
        checkpoint.stage_id !== "dataset-curation-cleanup" ||
        !["passed", "blocked"].includes(String(checkpoint.status))
      )
        transferFail(
          "migration_history_unclassified",
          "A legacy checkpoint is outside deterministic local preparation.",
        );
      for (const [relative, digest] of Object.entries(object(checkpoint.output_hashes))) {
        const output = byName.get(relative);
        if (!output || output.sha256 !== digest)
          transferFail(
            "migration_authority_changed",
            "Legacy local output does not match its checkpoint.",
          );
        allowed.add(relative);
      }
      allowed.add(name);
    }
  }
  for (const name of byName.keys())
    if (!allowed.has(name) && !name.startsWith("evidence/authorizations/"))
      transferFail(
        "migration_history_unclassified",
        "Unclassified task evidence remains with the original owner.",
      );
  return { job, sources, allowed };
}

export async function planFoundryMigrationAdoption(
  context: FoundryRuntimeContext,
  planning: FoundryMigrationPlanningOptions,
  transfer: unknown,
  selections: readonly MigrationAdoptionSelection[],
  manifest: TrustedRuntimeManifest,
): Promise<FoundryMigrationAdoptionPlan> {
  assertWorkspaceCompatibility(
    manifest,
    { schema: FOUNDRY_MIGRATED_WORKSPACE_SCHEMA, features: FOUNDRY_MIGRATED_WORKSPACE_FEATURES },
    "write",
  );
  if (
    manifest.manifest.product.id !== "tiangong-foundry" ||
    manifest.manifest.product.version !== context.runtime.packageVersion
  )
    transferFail(
      "workspace_runtime_incompatible",
      "Adoption requires the intended current Foundry writer.",
    );
  const audited = auditFoundryMigration(context, planning, transfer);
  const plan = revalidateFoundryMigrationPlan(
    context,
    planning,
    transfer,
    audited.receipt.plan_sha256,
  );
  if (
    selections.length > 1000 ||
    new Set(selections.map((item) => item.sourceTask)).size !== selections.length
  )
    transferFail("migration_adoption_invalid", "Adoption selections must be unique and bounded.");
  const sourceControl = path.join(plan.source_inventory.workspace_root, ".foundry");
  let inheritedRows: readonly MigrationAdoptionRow[] = [];
  const inheritedFiles = new Set<string>();
  if (plan.source_inventory.marker_schema === FOUNDRY_MIGRATED_WORKSPACE_SCHEMA) {
    const markerFile = audited.receipt.files.find(
      (file) => file.source === path.join(sourceControl, "workspace.json"),
    );
    const marker = archiveJson(context, markerFile);
    const binding = marker.migration as { plan_sha256: string; activation_sha256: string };
    const authority = readFoundryMigrationAuthority(
      sourceControl,
      String(marker.workspace_id),
      binding,
      true,
      context.accountIntent?.sessionReference,
    );
    const oldAdoption = archiveJson(
      context,
      audited.receipt.files.find(
        (file) =>
          file.source ===
          path.join(sourceControl, "migrations", binding.plan_sha256, "adoption.json"),
      ),
    );
    inheritedRows = oldAdoption.tasks as MigrationAdoptionRow[];
    for (const file of authority.protected_files) inheritedFiles.add(file.path);
    inheritedFiles.add(`migrations/${binding.plan_sha256}/activation.json`);
    inheritedFiles.add("migration-claim.json");
  }
  const unaccountedGlobal = audited.receipt.files.some((file) => {
    if (!file.source.startsWith(sourceControl + path.sep)) return false;
    const name = path.relative(sourceControl, file.source).split(path.sep).join("/");
    return (
      !name.startsWith("workspaces/") &&
      name !== "workspace.json" &&
      !inheritedFiles.has(name) &&
      !/^state\/(?:task-registrations|task-publications|task-accounts|facade-requests|facade-tasks)\/[^/]+\.json$/u.test(
        name,
      )
    );
  });
  const roots = new Set(
    plan.source_inventory.entries
      .map((entry) => /^workspaces\/[^/]+/u.exec(entry.path)?.[0])
      .filter((entry): entry is string => Boolean(entry)),
  );
  for (const selection of selections) {
    if (
      !roots.has(selection.sourceTask) ||
      !path.isAbsolute(selection.specFile) ||
      migrationCredentialPath(selection.specFile)
    )
      transferFail(
        "migration_adoption_invalid",
        "Select an inventoried task and an explicit non-private task specification.",
      );
    if (
      context.accountIntent?.sessionReference &&
      fs.existsSync(context.accountIntent.sessionReference) &&
      fs.realpathSync(selection.specFile) ===
        fs.realpathSync(context.accountIntent.sessionReference)
    )
      transferFail(
        "migration_credential_forbidden",
        "An OAuth session reference cannot be an adoption specification.",
      );
  }
  const rows: MigrationAdoptionRow[] = [];
  const requestIds = new Set<string>();
  for (const root of [...roots].sort()) {
    const sourceRoot = path.join(sourceControl, root);
    const files = audited.receipt.files.filter((file) =>
      file.source.startsWith(sourceRoot + path.sep),
    );
    const stages = plan.stages.filter((stage) => stage.path.startsWith(root + "/"));
    const selection = selections.find((item) => item.sourceTask === root);
    const inherited = inheritedRows.find(
      (row) => row.authority.task_id === path.posix.basename(root),
    );
    const origin =
      inherited?.authority.origin_sha256 ??
      sha256Json({
        source: plan.source_inventory.workspace_root,
        task: root,
        files: files.map((file) => ({
          source: file.source,
          bytes: file.bytes,
          sha256: file.sha256,
        })),
      });
    const scope = archivedScope(context, plan, root, audited.receipt.files);
    let disposition: MigrationTaskAuthority["disposition"] = "owner-readback-only";
    let sourceSpec: FoundryInputFact | null = null,
      target: FoundryTaskStartSpec | null = null,
      inputs: FoundryInputFact[] = [],
      reason = selection ? "history_unverified" : "not_selected_for_local_adoption";
    if (stages.some((stage) => stage.migration_action === "owner-readback-only"))
      disposition = "owner-readback-only";
    const laterHistory = files.some(
      (file) =>
        /(?:^|\/)(?:attempts?|events?|.*ledger.*|.*readback.*|.*mutation.*)(?:\/|\.|$)/iu.test(
          path.relative(sourceRoot, file.source).split(path.sep).join("/"),
        ) && !stages.some((stage) => file.source === path.join(sourceControl, stage.path)),
    );
    if (unaccountedGlobal || laterHistory) {
      disposition = "owner-readback-only";
      reason = "later_or_unclassified_owner_history";
    }
    if (
      selection &&
      !unaccountedGlobal &&
      !laterHistory &&
      !stages.some((stage) => stage.migration_action !== "rebuild-local-preparation")
    ) {
      try {
        const inspected = await inspectLocalHistory(
          context,
          plan,
          root,
          files,
          audited.receipt.files,
          manifest,
        );
        const selectedFact = captureFoundryInput(selection.specFile);
        if (selectedFact.bytes > 1024 * 1024)
          transferFail("migration_adoption_invalid", "Task specification exceeds its limit.");
        const specBytes = transferRead(selectedFact.path, 1024 * 1024);
        if (transferHash(specBytes) !== selectedFact.sha256)
          transferFail("migration_source_changed", "Selected task specification changed.");
        const spec = parseFoundryTaskStartSpec(JSON.parse(specBytes.toString("utf8")));
        if (
          plan.account_intent &&
          (!spec.account_intent ||
            spec.account_intent.project_ref !== plan.account_intent.project_ref ||
            spec.account_intent.user_id !== plan.account_intent.user_id)
        )
          transferFail(
            "migration_account_mismatch",
            "Adoption account intent differs from the independently selected transfer account.",
          );
        if (
          files.some((file) =>
            path.relative(sourceRoot, file.source).split(path.sep).join("/").startsWith("outputs/"),
          ) &&
          !spec.preparation
        )
          transferFail(
            "migration_preparation_required",
            "Retained derived outputs require an explicit current-owner preparation step.",
          );
        if (
          spec.actor_id !== plan.actor_id ||
          spec.lane !== inspected.job.lane ||
          spec.profile_id !== inspected.job.target_profile ||
          sha256Json([...spec.target_entities].sort()) !==
            sha256Json([...(inspected.job.target_entities as string[])].sort()) ||
          requestIds.has(spec.request_id)
        )
          transferFail(
            "migration_task_binding_mismatch",
            "Current task intent differs from the selected legacy scope or actor.",
          );
        const selected = spec.sources.map((item) =>
          selectedSource(plan.source_inventory.workspace_root, item.path, audited.receipt.files),
        );
        if (
          sha256Json(selected.map((item) => item.source).sort()) !==
          sha256Json(inspected.sources.map((item) => item.source).sort())
        )
          transferFail(
            "migration_source_unaccounted",
            "Current task sources do not cover the retained source manifest exactly.",
          );
        const remap = (value: string) => {
          const file = selectedSource(plan.source_inventory.workspace_root, value, selected);
          return transferPath(context.controlRoot, file.destination);
        };
        target = parseFoundryTaskStartSpec({
          ...spec,
          account_intent: spec.account_intent
            ? {
                project_ref: spec.account_intent.project_ref,
                user_id: spec.account_intent.user_id,
                session_reference: null,
              }
            : null,
          sources: spec.sources.map((item) => ({ ...item, path: remap(item.path) })),
          seed: spec.seed ? { ...spec.seed, path: remap(spec.seed.path) } : null,
          preparation: spec.preparation
            ? {
                ...spec.preparation,
                input: remap(spec.preparation.input),
                source_input: spec.preparation.source_input
                  ? remap(spec.preparation.source_input)
                  : null,
              }
            : null,
        });
        inputs = selected.map((file) => ({
          path: transferPath(context.controlRoot, file.destination),
          bytes: file.bytes,
          sha256: file.sha256,
        }));
        sourceSpec = selectedFact;
        disposition = "local-unattempted";
        reason = "current_owner_rebuild_required";
        requestIds.add(spec.request_id);
      } catch (error) {
        reason =
          error instanceof Error && "code" in error
            ? String(error.code)
            : "legacy_history_unverified";
        if (reason === "migration_terminal_retained") disposition = "terminal-retained";
        else if (!/attempt|history|predecessor/u.test(reason)) disposition = "blocked-evidence";
        target = null;
        inputs = [];
        sourceSpec = null;
      }
    }
    const request = target?.request_id ?? null;
    rows.push({
      authority: {
        source_task: root,
        origin_sha256: origin,
        disposition,
        task_id: request
          ? `task-${sha256Json({ workspace_id: audited.receipt.workspace_id, request_id: request })}-r0001`
          : null,
        request_id: request,
        actor_id: plan.actor_id,
        spec_fingerprint_sha256: target ? taskStartSpecFingerprint(target, inputs) : null,
        scope_keys: scope.keys,
        scope_complete: scope.complete && !unaccountedGlobal,
      },
      source_spec: sourceSpec,
      target_spec: target ? migrationTaskTemplate(target) : null,
      inputs,
      evidence_paths: files.map((file) => file.destination).sort(),
      scope_inputs: scope.inputs,
      reasons: [reason],
    });
  }
  for (const old of inheritedRows) {
    if (old.authority.task_id && roots.has(`workspaces/${old.authority.task_id}`)) continue;
    if (old.authority.task_id)
      transferFail(
        "migration_source_authority_invalid",
        "A previously adopted task is missing; it cannot be reconstructed as empty history.",
      );
    const remap = (relative: string) => {
      const copied = audited.receipt.files.find(
        (file) => file.source === path.join(sourceControl, relative),
      );
      if (!copied)
        transferFail(
          "migration_source_authority_invalid",
          "Inherited migration evidence was omitted from the new archive.",
        );
      return copied.destination;
    };
    rows.push({
      ...old,
      source_spec: null,
      target_spec: null,
      inputs: [],
      evidence_paths: old.evidence_paths.map(remap),
      scope_inputs: old.scope_inputs.map(remap),
      reasons: [...old.reasons, "immutable_prior_migration_authority_retained"],
    });
  }
  for (const file of audited.receipt.files.filter((file) =>
    file.destination.startsWith(`migrations/${plan.plan_sha256}/original/tasks/`),
  ))
    rows.push({
      authority: {
        source_task: `queue:${path.relative(plan.source_inventory.workspace_root, file.source).split(path.sep).join("/")}`,
        origin_sha256: sha256Json(file),
        disposition: "owner-readback-only",
        task_id: null,
        request_id: null,
        actor_id: plan.actor_id,
        spec_fingerprint_sha256: null,
        scope_keys: [],
        scope_complete: false,
      },
      source_spec: null,
      target_spec: null,
      inputs: [],
      evidence_paths: [file.destination],
      scope_inputs: [],
      reasons: ["retained_queue_is_not_current_task_authority"],
    });
  const payload = {
    schema: FOUNDRY_MIGRATION_ADOPTION_PLAN_SCHEMA,
    workspace_id: audited.receipt.workspace_id,
    plan_sha256: plan.plan_sha256,
    actor_id: plan.actor_id,
    runtime_manifest_sha256: manifest.sha256,
    selections: selections
      .map((item) => ({ source_task: item.sourceTask, spec_file: path.resolve(item.specFile) }))
      .sort((a, b) => a.source_task.localeCompare(b.source_task)),
    tasks: rows,
    remote_write_allowed: false as const,
  };
  const result = { ...payload, adoption_sha256: sha256Json(payload) };
  if (Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 * 1024)
    transferFail("migration_adoption_invalid", "Adoption plan exceeds its bound.");
  revalidateFoundryMigrationPlan(context, planning, transfer, audited.receipt.plan_sha256);
  return result;
}
