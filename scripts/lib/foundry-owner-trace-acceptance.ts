import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { acceptTraceHashOnlyRemoteVerificationMismatch } from "./remote-verification-accepted-diff.ts";
import {
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import { createFoundryCommandSpec } from "./foundry-command-spec.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { unwrapDatasetPayload } from "./import-curation/internal/dataset-payload.ts";
import type { OwnerExecutionRequest } from "./foundry-owner-execution-store.ts";

export function acceptFoundryOwnerTraceDifference(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  request: OwnerExecutionRequest,
  verifyReportPath: string,
  output: string,
  environment: NodeJS.ProcessEnv,
) {
  if (
    request.policy.account_mode !== "ordinary" ||
    (context.accountIntent?.accountMode ?? "ordinary") !== "ordinary"
  )
    return { accepted: false as const, reason: "production_test_requires_exact_payload" };
  return acceptTraceHashOnlyRemoteVerificationMismatch({
    verifyReportPath,
    outDir: output,
    repoRoot: context.assetRoot,
    runCliGet({ table, id, version, outDir }) {
      assertQualifiedFoundryRuntime(context, qualified);
      readFoundryInput(context, request.content.input.path);
      const type = table === "flows" ? "flow" : table === "processes" ? "process" : null;
      if (!type) return { ok: false, error: "Unsupported root table." };
      const directory = resolveFoundryOutput(context, outDir);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const stem = path.join(directory, randomUUID()),
        cli = resolveInstalledTiangongLcaCliPackage();
      const command = createFoundryCommandSpec({
        executable: process.execPath,
        argv: [cli.binPath, type, "get", "--id", id, "--version", version, "--json"],
        binding: { artifacts: [{ ...request.content.input, role: "final_rows" }] },
      });
      fs.writeFileSync(`${stem}.command.json`, JSON.stringify(command, null, 2) + "\n");
      const result = spawnSync(command.executable, [...command.argv], {
        cwd: directory,
        env: environment,
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      fs.writeFileSync(`${stem}.stdout.json`, result.stdout ?? "");
      fs.writeFileSync(`${stem}.stderr.log`, result.stderr ?? "");
      readFoundryInput(context, request.content.input.path);
      let payload: Record<string, unknown> | null = null;
      try {
        const parsed = workflowObject(JSON.parse(result.stdout));
        const candidate = workflowObject(
          unwrapDatasetPayload(parsed[type] ?? parsed.payload ?? parsed, type),
        );
        if (Object.hasOwn(candidate, `${type}DataSet`)) payload = candidate;
      } catch {
        /* Retain the unsuccessful fresh get as diagnostic evidence. */
      }
      return {
        ok: !result.error && !result.signal && result.status === 0 && Boolean(payload),
        payload,
        command: command.display,
        executable: command.executable,
        exit_code: result.status ?? 1,
        stdout_log: `${stem}.stdout.json`,
        stderr_log: `${stem}.stderr.log`,
      };
    },
  });
}
