import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildQueueAuthoringContext,
  readCurationQueueContext,
} from "../../scripts/lib/import-curation/internal/workflow-queue-context.ts";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("queue traversal retains array tasks and fails closed on a null dependency", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "queue-native-errors-"));
  try {
    const closureFile = path.join(root, "queue", "tasks", "process", "closure.json");
    writeJson(closureFile, { dependencies: { local_tasks: [null] } });
    writeJson(path.join(root, "queue", "outputs", "curation-queue-manifest.json"), {
      tasks: [
        [],
        {
          task_id: "process",
          entity_type: "process",
          entity_id: "process-id",
          version: "01.00.000",
          closure_file: "tasks/process/closure.json",
        },
      ],
    });

    const context = readCurationQueueContext(root, { queueDir: "queue" });
    assert.ok(context);
    assert.equal(context.tasks.length, 2);
    assert.ok(Array.isArray(context.tasks[0]));
    assert.equal(context.tasksById.get(""), context.tasks[0]);
    assert.throws(
      () =>
        buildQueueAuthoringContext(root, context, "process", {
          id: "process-id",
          version: "01.00.000",
        }),
      (error: unknown) => error instanceof TypeError,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
