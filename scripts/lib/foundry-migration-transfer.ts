import fs from "node:fs";
import path from "node:path";
import { withBatchRunLock } from "@tiangong-lca/cli/batch";
import {
  assertFoundryRuntimeContext,
  pendingFoundryMigration,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import {
  revalidateFoundryMigrationPlan,
  type FoundryMigrationTransferPlan,
  type FoundryMigrationPlanningOptions,
} from "./foundry-migration-plan.ts";
import {
  transferBytes,
  transferCopy,
  transferFail,
  transferFileFact,
  transferPath,
  transferRead,
  transferTree,
  transferWriteOnce,
} from "./foundry-migration-transfer-io.ts";

export const FOUNDRY_MIGRATION_TRANSFER_RECEIPT_SCHEMA =
  "tiangong-foundry.migration-transfer-receipt.v1" as const;
const pendingSchema = "tiangong-foundry.workspace-migration-pending.v1";
const temporaryFilePattern = /^(?:copy|write)-[0-9a-f-]{36}\.tmp$/u;
interface CopiedFile {
  readonly source: string;
  readonly destination: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface FoundryMigrationTransferReceipt {
  readonly schema: typeof FOUNDRY_MIGRATION_TRANSFER_RECEIPT_SCHEMA;
  readonly state: "staged";
  readonly activated: false;
  readonly remote_write_allowed: false;
  readonly plan_sha256: string;
  readonly workspace_id: string;
  readonly actor_id: string;
  readonly files: readonly CopiedFile[];
  readonly directories: readonly string[];
  readonly files_sha256: string;
  readonly receipt_sha256: string;
}
interface Claim {
  schema: "tiangong-foundry.migration-transfer-claim.v1";
  plan_sha256: string;
  workspace_id: string;
  actor_id: string;
  request_id: string;
  source_workspace: string;
  destination_workspace: string;
}
export interface MigrationTransferOptions {
  readonly signal?: AbortSignal;
  readonly checkpoint?: (phase: "claimed" | "copied" | "audited", index: number) => void;
}
function check(options: MigrationTransferOptions) {
  if (options.signal?.aborted)
    transferFail(
      "operation_interrupted",
      "Migration transfer interrupted; source and staged evidence are preserved.",
    );
}
function prefix(plan: FoundryMigrationTransferPlan) {
  return `migrations/${plan.plan_sha256}`;
}
function workspaceId(plan: FoundryMigrationTransferPlan): string {
  const hex = sha256Json(["migration-workspace", plan.plan_sha256]);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function mapping(plan: FoundryMigrationTransferPlan): {
  files: CopiedFile[];
  directories: string[];
} {
  const files: CopiedFile[] = [],
    directories = new Set<string>();
  const base = prefix(plan);
  for (const [kind, root, entries] of [
    [
      "foundry",
      path.join(plan.source_inventory.workspace_root, ".foundry"),
      plan.source_inventory.entries,
    ],
    ["tasks", path.join(plan.source_inventory.workspace_root, "tasks"), plan.source_queue.entries],
  ] as const) {
    for (const entry of entries) {
      const destination = `${base}/original/${kind}/${entry.path}`;
      if (entry.kind === "directory") directories.add(destination);
      else if (entry.sha256 !== null && entry.bytes !== null)
        files.push({
          source: path.join(root, entry.path),
          destination,
          bytes: entry.bytes,
          sha256: entry.sha256,
        });
    }
  }
  for (const input of plan.external_inputs)
    files.push({
      source: input.path,
      destination: `${base}/original/inputs/${sha256Json(input.path)}/${path.basename(input.path)}`,
      bytes: input.bytes,
      sha256: input.sha256,
    });
  for (const file of files) {
    let parent = path.posix.dirname(file.destination);
    while (parent !== ".") {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  for (const directory of [...directories]) {
    let parent = path.posix.dirname(directory);
    while (parent !== ".") {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  directories.add(base);
  directories.add("migrations");
  directories.add(`${base}/scratch`);
  return {
    files: files.sort((a, b) =>
      a.destination < b.destination ? -1 : a.destination > b.destination ? 1 : 0,
    ),
    directories: [...directories].sort(),
  };
}
function readClaim(context: FoundryRuntimeContext, plan: FoundryMigrationTransferPlan): Claim {
  const value = JSON.parse(
    transferRead(transferPath(context.controlRoot, "migration-claim.json")).toString("utf8"),
  ) as Claim;
  if (
    value.schema !== "tiangong-foundry.migration-transfer-claim.v1" ||
    value.plan_sha256 !== plan.plan_sha256 ||
    value.actor_id !== plan.actor_id ||
    value.request_id !== plan.request_id ||
    value.source_workspace !== plan.source_inventory.workspace_root ||
    value.destination_workspace !== context.workspaceRoot ||
    value.workspace_id !== workspaceId(plan) ||
    Object.keys(value).length !== 7
  )
    transferFail(
      "migration_claim_invalid",
      "Pending transfer claim differs from the explicit plan and intent.",
    );
  const saved = transferRead(transferPath(context.controlRoot, `${prefix(plan)}/plan.json`));
  if (!saved.equals(transferBytes(plan)))
    transferFail("migration_claim_invalid", "Pending transfer plan bytes differ.");
  if (pendingFoundryMigration(context) !== plan.plan_sha256)
    transferFail("migration_claim_invalid", "Pending marker is not bound to this transfer.");
  return value;
}
function assertOwnedTree(
  context: FoundryRuntimeContext,
  plan: FoundryMigrationTransferPlan,
  allowScratch: boolean,
) {
  const expected = mapping(plan),
    base = prefix(plan),
    allowedFiles = new Set([
      "workspace.json",
      "migration-claim.json",
      `${base}/plan.json`,
      `${base}/receipt.json`,
      ...expected.files.map((f) => f.destination),
    ]);
  const allowedDirectories = new Set(expected.directories);
  const tree = transferTree(context.controlRoot);
  for (const file of tree.files) {
    if (allowedFiles.has(file)) continue;
    if (
      allowScratch &&
      file.startsWith(`${base}/scratch/`) &&
      temporaryFilePattern.test(path.posix.basename(file))
    )
      continue;
    transferFail(
      "migration_destination_conflict",
      "Unexpected transfer files were preserved; activation is refused.",
    );
  }
  if (tree.directories.some((d) => !allowedDirectories.has(d)))
    transferFail(
      "migration_destination_conflict",
      "Unexpected transfer directories were preserved.",
    );
  return tree;
}
function auditFiles(
  context: FoundryRuntimeContext,
  plan: FoundryMigrationTransferPlan,
): ReturnType<typeof mapping> {
  assertOwnedTree(context, plan, false);
  const expected = mapping(plan);
  for (const directory of expected.directories) {
    const stat = fs.lstatSync(transferPath(context.controlRoot, directory));
    if (!stat.isDirectory() || stat.isSymbolicLink())
      transferFail(
        "migration_audit_failed",
        "A required transfer directory is missing or invalid.",
      );
  }
  for (const file of expected.files) {
    const actual = transferFileFact(transferPath(context.controlRoot, file.destination));
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
      transferFail(
        "migration_audit_failed",
        "Archived bytes do not match the bound source inventory.",
      );
  }
  return expected;
}
function result(
  context: FoundryRuntimeContext,
  plan: FoundryMigrationTransferPlan,
  claim: Claim,
): FoundryMigrationTransferReceipt {
  const { files, directories } = auditFiles(context, plan);
  const payload = {
    schema: FOUNDRY_MIGRATION_TRANSFER_RECEIPT_SCHEMA,
    state: "staged" as const,
    activated: false as const,
    remote_write_allowed: false as const,
    plan_sha256: plan.plan_sha256,
    workspace_id: claim.workspace_id,
    actor_id: claim.actor_id,
    files,
    directories,
    files_sha256: sha256Json({ files, directories }),
  };
  const receipt = Object.freeze({
    ...payload,
    files: Object.freeze(files.map((f) => Object.freeze(f))),
    directories: Object.freeze(directories),
    receipt_sha256: sha256Json(payload),
  });
  if (transferBytes(receipt).length > 16 * 1024 * 1024)
    transferFail("migration_receipt_limit", "Transfer receipt exceeds its metadata limit.");
  return receipt;
}

export async function stageFoundryMigration(
  context: FoundryRuntimeContext,
  planning: FoundryMigrationPlanningOptions,
  provided: unknown,
  options: MigrationTransferOptions = {},
): Promise<{ receipt: FoundryMigrationTransferReceipt; path: string }> {
  assertFoundryRuntimeContext(context);
  check(options);
  const prior = revalidateFoundryMigrationPlan(
    context,
    planning,
    provided,
    pendingFoundryMigration(context) ?? undefined,
  );
  if (prior.blockers.length)
    transferFail("migration_plan_blocked", "Resolve every migration plan blocker before staging.");
  const proposed = mapping(prior);
  for (const file of proposed.files) transferPath(context.controlRoot, file.destination);
  for (const directory of proposed.directories) transferPath(context.controlRoot, directory);
  const lock = path.join(
    // Version-independent destination lock; no source workspace state is written.
    context.cacheBase,
    "tiangong-lca",
    "migration-locks",
    `${sha256Json(context.workspaceRoot)}.json`,
  );
  const sourceRelative = path.relative(prior.source_inventory.workspace_root, lock);
  if (
    !path.isAbsolute(sourceRelative) &&
    sourceRelative !== ".." &&
    !sourceRelative.startsWith(`..${path.sep}`)
  )
    transferFail(
      "migration_cache_invalid",
      "Migration locks must remain outside the source workspace.",
    );
  resolveFoundryOutput(context, "migration-lock-boundary", "cache");
  return withBatchRunLock(
    {
      runPath: lock,
      identity: {
        schema: "tiangong-foundry.migration-lock.v1",
        workspace_root: context.workspaceRoot,
      },
      reason: "Explicit workspace migration staging",
    },
    () => {
      check(options);
      const pending = pendingFoundryMigration(context);
      const plan = revalidateFoundryMigrationPlan(
        context,
        planning,
        provided,
        pending ?? undefined,
      );
      if (plan.blockers.length)
        transferFail(
          "migration_plan_blocked",
          "Resolve every migration plan blocker before staging.",
        );
      if (
        fs.existsSync(context.workspaceRoot) &&
        fs.realpathSync(context.workspaceRoot) !== context.workspaceRoot
      )
        transferFail("migration_destination_conflict", "Destination root changed.");
      if (!pending) {
        resolveFoundryOutput(context, "migration-publication-boundary", "state");
        fs.mkdirSync(context.workspaceRoot, { recursive: true, mode: 0o700 });
        resolveFoundryOutput(context, "migration-publication-boundary", "state");
        const temp = fs.mkdtempSync(path.join(context.workspaceRoot, ".migration-control-"));
        try {
          const claim: Claim = {
            schema: "tiangong-foundry.migration-transfer-claim.v1",
            plan_sha256: plan.plan_sha256,
            workspace_id: workspaceId(plan),
            actor_id: plan.actor_id,
            request_id: plan.request_id,
            source_workspace: plan.source_inventory.workspace_root,
            destination_workspace: context.workspaceRoot,
          };
          transferWriteOnce(
            temp,
            "workspace.json",
            transferBytes({ schema: pendingSchema, plan_sha256: plan.plan_sha256 }),
          );
          transferWriteOnce(temp, "migration-claim.json", transferBytes(claim));
          transferWriteOnce(temp, `${prefix(plan)}/plan.json`, transferBytes(plan));
          revalidateFoundryMigrationPlan(context, planning, provided);
          if (fs.existsSync(context.controlRoot))
            transferFail(
              "migration_destination_conflict",
              "Destination state appeared before publication.",
            );
          fs.renameSync(temp, context.controlRoot);
        } finally {
          if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });
        }
      }
      const claim = readClaim(context, plan),
        base = prefix(plan),
        receiptFile = transferPath(context.controlRoot, `${base}/receipt.json`);
      assertOwnedTree(context, plan, true);
      const scratch = transferPath(context.controlRoot, `${base}/scratch`);
      if (fs.existsSync(scratch)) {
        for (const file of fs.readdirSync(scratch)) {
          if (!temporaryFilePattern.test(file) || !fs.lstatSync(path.join(scratch, file)).isFile())
            transferFail("migration_destination_conflict", "Unknown scratch data was preserved.");
          fs.unlinkSync(path.join(scratch, file));
        }
      }
      if (fs.existsSync(receiptFile)) {
        const audited = result(context, plan, claim);
        if (!transferRead(receiptFile).equals(transferBytes(audited)))
          transferFail(
            "migration_audit_failed",
            "Stored transfer receipt differs from the independent audit.",
          );
        return { receipt: audited, path: receiptFile };
      }
      options.checkpoint?.("claimed", 0);
      check(options);
      const expected = mapping(plan);
      for (const directory of expected.directories) {
        fs.mkdirSync(transferPath(context.controlRoot, directory), {
          recursive: true,
          mode: 0o700,
        });
        transferPath(context.controlRoot, directory);
      }
      for (const [index, file] of expected.files.entries()) {
        check(options);
        transferCopy(
          context.controlRoot,
          file.destination,
          { path: file.source, bytes: file.bytes, sha256: file.sha256 },
          scratch,
        );
        options.checkpoint?.("copied", index + 1);
      }
      check(options);
      revalidateFoundryMigrationPlan(context, planning, provided, plan.plan_sha256);
      const receipt = result(context, plan, claim);
      options.checkpoint?.("audited", expected.files.length);
      check(options);
      revalidateFoundryMigrationPlan(context, planning, provided, plan.plan_sha256);
      auditFiles(context, plan);
      transferWriteOnce(
        context.controlRoot,
        `${base}/receipt.json`,
        transferBytes(receipt),
        `${base}/scratch`,
      );
      return { receipt, path: receiptFile };
    },
  );
}

export function auditFoundryMigration(
  context: FoundryRuntimeContext,
  planning: FoundryMigrationPlanningOptions,
  provided: unknown,
): { receipt: FoundryMigrationTransferReceipt; path: string } {
  const pending = pendingFoundryMigration(context);
  if (!pending) transferFail("migration_not_staged", "No pending transfer is available to audit.");
  const plan = revalidateFoundryMigrationPlan(context, planning, provided, pending);
  const claim = readClaim(context, plan);
  const receipt = result(context, plan, claim),
    file = transferPath(context.controlRoot, `${prefix(plan)}/receipt.json`);
  if (!transferRead(file).equals(transferBytes(receipt)))
    transferFail(
      "migration_audit_failed",
      "Transfer receipt and independently observed files differ.",
    );
  revalidateFoundryMigrationPlan(context, planning, provided, pending);
  return { receipt, path: file };
}
