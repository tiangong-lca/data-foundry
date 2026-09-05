import fs from "node:fs";
import path from "node:path";
import { captureFoundryInput, FoundryContextError } from "./foundry-runtime-context.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

export const FOUNDRY_WORKSPACE_MIGRATION_PLAN_SCHEMA =
  "tiangong-foundry.workspace-migration-plan.v1" as const;

export interface MigrationEntry {
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

const maxEntries = 10_000;
const maxDepth = 64;
const maxHashedFileBytes = 64 * 1024 * 1024;
const maxHashedTreeBytes = 256 * 1024 * 1024;

export { migrationCredentialPath } from "./foundry-private-path.ts";
import { migrationCredentialPath } from "./foundry-private-path.ts";

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

export interface FoundryMigrationTree {
  readonly exists: boolean;
  readonly entries: readonly Readonly<MigrationEntry>[];
  readonly tree_sha256: string;
}

export function inventoryFoundryMigrationTree(
  root: string,
  options: { sessionReference?: string } = {},
): FoundryMigrationTree {
  const selectedSession =
    options.sessionReference && fs.existsSync(options.sessionReference)
      ? fs.realpathSync(options.sessionReference)
      : options.sessionReference;
  if (!fs.existsSync(root))
    return Object.freeze({
      exists: false,
      entries: Object.freeze([]),
      tree_sha256: sha256Json([]),
    });
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new FoundryContextError(
      "migration_root_invalid",
      "Migration state must be a real directory.",
    );
  const entries: MigrationEntry[] = [];
  let hashedBytes = 0;
  const walk = (directory: string, depth: number) => {
    if (depth > maxDepth)
      throw new FoundryContextError(
        "migration_depth_limit",
        "Migration inventory exceeds its directory-depth limit.",
      );
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
        walk(file, depth + 1);
        continue;
      }
      if (!stat.isFile())
        throw new FoundryContextError(
          "migration_entry_unsupported",
          "Migration inventory supports only regular files and directories.",
        );
      const privateFile = migrationCredentialPath(relative) || file === selectedSession;
      const omitHash = privateFile || stat.size > maxHashedFileBytes;
      if (!omitHash) {
        hashedBytes += stat.size;
        if (hashedBytes > maxHashedTreeBytes)
          throw new FoundryContextError(
            "migration_byte_limit",
            "Migration inventory exceeds its total hashing byte limit.",
          );
      }
      const fact = omitHash ? null : captureFoundryInput(file);
      entries.push({
        path: relative,
        kind: "file",
        bytes: stat.size,
        sha256: fact?.sha256 ?? null,
        state_class: privateFile ? "authorization-or-account" : classify(relative),
      });
      if (entries.length > maxEntries)
        throw new FoundryContextError(
          "migration_inventory_limit",
          "Migration inventory exceeds its entry limit.",
        );
    }
  };
  walk(root, 0);
  const immutable = Object.freeze(entries.map((entry) => Object.freeze(entry)));
  return Object.freeze({ exists: true, entries: immutable, tree_sha256: sha256Json(immutable) });
}

/** Deterministic read-only inventory. W10 owns any application or rollback. */
export function inventoryFoundryWorkspace(
  workspace: string,
  options: { sessionReference?: string } = {},
): FoundryWorkspaceMigrationPlan {
  if (
    options.sessionReference !== undefined &&
    (typeof options.sessionReference !== "string" || !path.isAbsolute(options.sessionReference))
  )
    throw new FoundryContextError(
      "migration_session_reference_invalid",
      "A selected private session reference must be absolute.",
    );
  const selectedSession =
    options.sessionReference && fs.existsSync(options.sessionReference)
      ? fs.realpathSync(options.sessionReference)
      : options.sessionReference;
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
  const tree = inventoryFoundryMigrationTree(root, options);
  const schema = path.join(root, "workspace.json") === selectedSession ? null : markerSchema(root);
  const immutableEntries = tree.entries;
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
