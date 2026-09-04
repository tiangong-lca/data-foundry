import fs from "node:fs";
import path from "node:path";
import { captureFoundryInput, FoundryContextError } from "./foundry-runtime-context.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

export const FOUNDRY_WORKSPACE_MIGRATION_PLAN_SCHEMA =
  "tiangong-foundry.workspace-migration-plan.v1" as const;

interface MigrationEntry {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly bytes: number | null;
  readonly sha256: string | null;
  readonly state_class:
    | "workspace-control"
    | "local-preparation"
    | "terminal-success"
    | "attempted-or-unknown"
    | "authorization-or-account"
    | "unclassified";
}

export interface FoundryWorkspaceMigrationPlan {
  readonly schema: typeof FOUNDRY_WORKSPACE_MIGRATION_PLAN_SCHEMA;
  readonly workspace_root: string;
  readonly foundry_root_exists: boolean;
  readonly marker_schema: string | null;
  readonly disposition: "no_state" | "current_layout" | "explicit_migration_required";
  readonly write_allowed: false;
  readonly entries: readonly Readonly<MigrationEntry>[];
  readonly tree_sha256: string;
}

const maxEntries = 100_000;

function classify(relative: string): MigrationEntry["state_class"] {
  if (relative === "workspace.json" || relative.startsWith("state/")) return "workspace-control";
  if (/(?:^|\/)attempts?(?:\/|$)|UNKNOWN_DO_NOT_REPLAY|dispatch/iu.test(relative))
    return "attempted-or-unknown";
  if (/(?:^|\/)(?:authorization|account-intent)(?:\.|\/|$)/iu.test(relative))
    return "authorization-or-account";
  if (/(?:^|\/)(?:done|closeout|completion|success)(?:\.|\/|$)/iu.test(relative))
    return "terminal-success";
  if (/(?:^|\/)(?:outputs|checkpoints|artifact-index)(?:\.|\/|$)/iu.test(relative))
    return "local-preparation";
  return "unclassified";
}

function markerSchema(root: string): string | null {
  const file = path.join(root, "workspace.json");
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024)
    throw new FoundryContextError(
      "migration_marker_invalid",
      "Workspace marker must be a bounded regular file.",
    );
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.schema === "string"
      ? value.schema
      : null;
  } catch {
    return null;
  }
}

/** Deterministic read-only inventory. W10 owns any application or rollback. */
export function inventoryFoundryWorkspace(workspace: string): FoundryWorkspaceMigrationPlan {
  const workspaceRoot = fs.existsSync(workspace)
    ? fs.realpathSync(workspace)
    : path.resolve(workspace);
  if (fs.existsSync(workspaceRoot) && !fs.statSync(workspaceRoot).isDirectory())
    throw new FoundryContextError(
      "migration_workspace_invalid",
      "Migration workspace must be a directory.",
    );
  const root = path.join(workspaceRoot, ".foundry");
  if (!fs.existsSync(root))
    return Object.freeze({
      schema: FOUNDRY_WORKSPACE_MIGRATION_PLAN_SCHEMA,
      workspace_root: workspaceRoot,
      foundry_root_exists: false,
      marker_schema: null,
      disposition: "no_state",
      write_allowed: false,
      entries: Object.freeze([]),
      tree_sha256: sha256Json([]),
    });
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new FoundryContextError(
      "migration_root_invalid",
      "Foundry state root must be a real directory.",
    );
  const entries: MigrationEntry[] = [];
  const walk = (directory: string) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = path.relative(root, file).split(path.sep).join("/");
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink())
        throw new FoundryContextError(
          "migration_symlink_unsupported",
          "Migration inventory refuses symbolic links or junction-like state.",
        );
      if (stat.isDirectory()) {
        entries.push({
          path: relative,
          kind: "directory",
          bytes: null,
          sha256: null,
          state_class: classify(`${relative}/`),
        });
        if (entries.length > maxEntries)
          throw new FoundryContextError(
            "migration_inventory_limit",
            "Migration inventory exceeds its entry limit.",
          );
        walk(file);
        continue;
      }
      if (!stat.isFile())
        throw new FoundryContextError(
          "migration_entry_unsupported",
          "Migration inventory supports only regular files and directories.",
        );
      const fact = captureFoundryInput(file);
      entries.push({
        path: relative,
        kind: "file",
        bytes: fact.bytes,
        sha256: fact.sha256,
        state_class: classify(relative),
      });
      if (entries.length > maxEntries)
        throw new FoundryContextError(
          "migration_inventory_limit",
          "Migration inventory exceeds its entry limit.",
        );
    }
  };
  walk(root);
  const schema = markerSchema(root);
  const immutableEntries = Object.freeze(entries.map((entry) => Object.freeze(entry)));
  return Object.freeze({
    schema: FOUNDRY_WORKSPACE_MIGRATION_PLAN_SCHEMA,
    workspace_root: workspaceRoot,
    foundry_root_exists: true,
    marker_schema: schema,
    disposition:
      schema === "tiangong-foundry.workspace.v1" ? "current_layout" : "explicit_migration_required",
    write_allowed: false,
    entries: immutableEntries,
    tree_sha256: sha256Json(immutableEntries),
  });
}
