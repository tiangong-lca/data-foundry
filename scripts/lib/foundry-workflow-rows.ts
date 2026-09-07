import {
  FoundryContextError,
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import {
  detectDatasetType,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";
import { supportedDatasetTypes } from "./import-curation/internal/dataset-types.ts";

export function materializeFoundryWorkflowRows(
  context: FoundryRuntimeContext,
  sources: readonly string[],
) {
  if (!sources.length)
    throw new FoundryContextError(
      "workflow_rows_missing",
      "No selected or converted dataset rows are available.",
    );
  return runFoundryTaskOperation(
    context,
    { command: "dataset-workflow-rows", options: { sources } },
    (operation) => {
      const grouped = new Map<string, unknown[]>();
      for (const source of sources) {
        const rows = readRows(source, (file) => readFoundryInput(context, file).toString("utf8"));
        for (const row of rows) {
          const type =
            detectDatasetType(row) ??
            [...supportedDatasetTypes]
              .map((candidate) => detectDatasetType(unwrapDatasetPayload(row, candidate)))
              .find((candidate) => candidate !== null);
          if (!type)
            throw new FoundryContextError(
              "workflow_row_type_unknown",
              "A selected row has no recognized TIDAS dataset type.",
            );
          const values = grouped.get(type) ?? [];
          const payload = unwrapDatasetPayload(row, type);
          if (payload !== row && row && typeof row === "object" && !Array.isArray(row)) {
            const normalized = { ...(row as Record<string, unknown>) };
            for (const key of [type, "json_ordered", "jsonOrdered", "json", "payload"])
              delete normalized[key];
            normalized.json = payload;
            values.push(normalized);
          } else values.push(row);
          grouped.set(type, values);
        }
      }
      if (!grouped.size)
        throw new FoundryContextError(
          "workflow_rows_missing",
          "The selected input contains no dataset rows.",
        );
      const sets = [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([type, rows]) => {
          const file = resolveFoundryOutput(
            context,
            `outputs/rows/${operation.operationId}/${type}.rows.json`,
          );
          operation.writeJson(file, rows);
          return { type, file, count: rows.length };
        });
      const report = { schema: "tiangong-foundry.rows-stage.v1", status: "completed", sets };
      operation.writeJson(`outputs/rows/${operation.operationId}/foundry-rows.json`, report);
      return report;
    },
  );
}
