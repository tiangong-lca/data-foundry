import fs from "node:fs";
import path from "node:path";
import { withBatchRunLock } from "@tiangong-lca/cli/batch";
import {
  assertWorkspaceCompatibility,
  ensureRuntimeComponents,
  type TrustedRuntimeManifest,
  type RuntimeManagerOptions,
} from "@tiangong-lca/cli/runtime";
import {
  assertFoundryRuntimeSelector,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  FOUNDRY_RUNTIME_SELECTION_SCHEMA,
  readFoundryRuntimeSelection,
  type FoundryRuntimeSelectionRecord,
} from "./foundry-runtime-selection-record.ts";
import {
  transferBytes,
  transferFail,
  transferPath,
  transferRead,
  transferWriteOnce,
} from "./foundry-migration-transfer-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

export type FoundryRuntimeManagerOptions = Omit<RuntimeManagerOptions, "lease">;
function componentCache(
  context: FoundryRuntimeContext,
  selected?: string,
  excludedRoots: readonly string[] = [],
): string {
  let current = path.resolve(
    selected ?? path.join(context.cacheBase, "tiangong-lca/managed-runtimes"),
  );
  const tail: string[] = [];
  while (!fs.existsSync(current)) {
    tail.unshift(path.basename(current));
    current = path.dirname(current);
  }
  const cache = path.join(fs.realpathSync(current), ...tail);
  for (const selectedRoot of [context.workspaceRoot, context.runtimeRoot, ...excludedRoots]) {
    const root = fs.existsSync(selectedRoot)
      ? fs.realpathSync(selectedRoot)
      : path.resolve(selectedRoot);
    for (const relative of [path.relative(root, cache), path.relative(cache, root)])
      if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
        transferFail(
          "runtime_cache_boundary",
          "Managed components must stay outside workspace, source and package data.",
        );
  }
  return cache;
}
export async function leaseFoundryRuntime(
  context: FoundryRuntimeContext,
  manifest: TrustedRuntimeManifest,
  workspaceId: string,
  manager: FoundryRuntimeManagerOptions,
  excludedRoots: readonly string[] = [],
): Promise<string> {
  if (manager.host && manager.host.platform !== context.platform)
    transferFail("runtime_host_mismatch", "Managed components must match the executing platform.");
  const lease = `foundry:${workspaceId}:${manifest.sha256}`;
  const report = await ensureRuntimeComponents(manifest, {
    ...manager,
    cacheDir: componentCache(context, manager.cacheDir, excludedRoots),
    lease: { id: lease, owner: `foundry-workspace:${context.workspaceRoot}` },
  });
  if (report.status !== "ready")
    transferFail(
      "runtime_components_required",
      "Every selected component must be verified before runtime selection.",
    );
  return lease;
}

export async function selectFoundryWorkspaceRuntime(
  context: FoundryRuntimeContext,
  current: TrustedRuntimeManifest,
  target: TrustedRuntimeManifest,
  input: {
    requestId: string;
    actorId: string;
    access: "read" | "write";
    manager: FoundryRuntimeManagerOptions;
  },
): Promise<{ record: FoundryRuntimeSelectionRecord; path: string }> {
  assertFoundryRuntimeSelector(context);
  if (
    current.sha256 !== context.workspaceManifestSha256 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(input.requestId) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(input.actorId)
  )
    transferFail(
      "runtime_selection_invalid",
      "Runtime selection requires explicit current-runtime and actor/request intent.",
    );
  try {
    assertWorkspaceCompatibility(
      target,
      { schema: context.workspaceSchema, features: context.workspaceFeatures },
      input.access,
    );
  } catch {
    transferFail(
      "workspace_runtime_incompatible",
      "The target manifest does not qualify the requested workspace access.",
    );
  }
  if (target.manifest.product.id !== "tiangong-foundry")
    transferFail("runtime_selection_invalid", "Select a Foundry product manifest.");
  const runPath = resolveFoundryOutput(context, "runtime-selection-lock", "state");
  return withBatchRunLock(
    {
      runPath,
      identity: {
        schema: "tiangong-foundry.runtime-selection-lock.v1",
        workspace_id: context.workspaceId,
      },
      reason: "Explicit runtime selection without schema downgrade",
    },
    async () => {
      assertFoundryRuntimeSelector(context);
      const previous = readFoundryRuntimeSelection(
        context.controlRoot,
        context.workspaceId!,
        context.accountIntent?.sessionReference,
      );
      const history = `state/runtime-selections/${sha256Json(input.requestId)}.json`;
      const historyPath = transferPath(context.controlRoot, history);
      if (fs.existsSync(historyPath)) {
        const existing = JSON.parse(
          transferRead(historyPath).toString("utf8"),
        ) as FoundryRuntimeSelectionRecord;
        const { record_sha256: digest, ...body } = existing;
        if (
          existing.schema !== FOUNDRY_RUNTIME_SELECTION_SCHEMA ||
          existing.workspace_id !== context.workspaceId ||
          digest !== sha256Json(body) ||
          existing.request_id !== input.requestId ||
          existing.actor_id !== input.actorId ||
          existing.selected_manifest_sha256 !== target.sha256 ||
          existing.access !== input.access ||
          existing.lease_ids[0] !== `foundry:${context.workspaceId}:${current.sha256}`
        )
          transferFail(
            "runtime_selection_conflict",
            "This selection request already names different intent.",
          );
        if (previous && previous.value.record_sha256 === existing.record_sha256) {
          await leaseFoundryRuntime(context, current, context.workspaceId, input.manager);
          await leaseFoundryRuntime(context, target, context.workspaceId, input.manager);
          return { record: previous.value, path: historyPath };
        }
        if (
          (previous?.value.selected_manifest_sha256 ?? current.sha256) !==
          existing.previous_manifest_sha256
        )
          transferFail(
            "runtime_selection_conflict",
            "A different selection won; the earlier request was preserved.",
          );
      }
      const leases = [
        await leaseFoundryRuntime(context, current, context.workspaceId!, input.manager),
        await leaseFoundryRuntime(context, target, context.workspaceId!, input.manager),
      ];
      const body = {
        schema: FOUNDRY_RUNTIME_SELECTION_SCHEMA,
        workspace_id: context.workspaceId!,
        request_id: input.requestId,
        actor_id: input.actorId,
        previous_manifest_sha256: previous?.value.selected_manifest_sha256 ?? current.sha256,
        selected_manifest_sha256: target.sha256,
        access: input.access,
        lease_ids: leases,
      };
      const record = { ...body, record_sha256: sha256Json(body) };
      transferWriteOnce(context.controlRoot, history, transferBytes(record));
      const actual = readFoundryRuntimeSelection(
        context.controlRoot,
        context.workspaceId!,
        context.accountIntent?.sessionReference,
      );
      if (
        (actual?.bytes.toString("base64") ?? null) !== (previous?.bytes.toString("base64") ?? null)
      )
        transferFail(
          "runtime_selection_conflict",
          "Runtime selection changed while components were verified.",
        );
      const next = `state/runtime-selections/${record.record_sha256}.next.json`;
      transferWriteOnce(context.controlRoot, next, transferBytes(record));
      fs.renameSync(
        transferPath(context.controlRoot, next),
        transferPath(context.controlRoot, "state/runtime-selection.json"),
      );
      return { record, path: historyPath };
    },
  );
}
