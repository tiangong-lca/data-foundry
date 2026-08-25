import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as decisionContext from "../../scripts/lib/import-curation/internal/workflow-decision-apply-context.mjs";
import { sha256Json, sha256Text } from "../../scripts/lib/import-curation/internal/hash-utils.ts";

type JsonRecord = Record<string, unknown>;

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeText(filePath, text);
  return text;
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function withTempRoot(name: string, body: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("classification apply context preserves null and empty report envelopes", () => {
  withTempRoot("decision-apply-empty", (root) => {
    assert.equal(decisionContext.readClassificationDecisionApplyContext(root, null), null);
    assert.deepEqual(
      decisionContext.readClassificationDecisionApplyContext(root, {
        path: "reports/apply.json",
        value: { status: " applied ", counts: { applied: "3" } },
      }),
      {
        status: "applied",
        reportPath: "reports/apply.json",
        decisionsFile: null,
        decisions: [],
        decisionTaskProof: null,
        decisionTaskProofs: [],
        inputRows: [],
        outputRows: [],
        inputPayloadSha256ByIdentity: new Map(),
        outputPayloadSha256ByIdentity: new Map(),
        applied: 3,
      },
    );
    const nullValue = decisionContext.readClassificationDecisionApplyContext(root, {
      path: "reports/null.json",
      value: null,
    });
    assert.equal(nullValue.status, "");
    assert.equal(nullValue.applied, 0);
  });
});

test("decision aliases, flow precedence, task proof, paths, payload hashes and last-write order stay stable", () => {
  withTempRoot("decision-apply-flow", (root) => {
    const decisionsPath = path.join(root, "decisions", "flow.json");
    writeJson(decisionsPath, {
      decisions: [
        null,
        { category_type: "process", marker: "process-first" },
        { categoryType: " flow-elementary ", marker: "flow-second" },
      ],
    });

    const inputFirstPayload = { marker: "input-first" };
    const inputOldDuplicate = { marker: "input-old-duplicate" };
    const inputNewDuplicate = { marker: "input-new-duplicate" };
    const inputFirstPath = path.join(root, "rows", "input-first.jsonl");
    const inputSecondPath = path.join(root, "rows", "input-second.json");
    writeJsonLines(inputFirstPath, [
      { id: "first", version: "01.00.000", payload: inputFirstPayload },
      { id: "duplicate", version: "01.00.000", payload: inputOldDuplicate },
    ]);
    writeJson(inputSecondPath, {
      rows: [
        { id: "duplicate", version: "01.00.000", payload: inputNewDuplicate },
        { id: "last", version: "01.00.000", payload: { marker: "last" } },
      ],
    });

    const outputPayload = { marker: "output" };
    const outputPath = path.join(root, "rows", "output.jsonl");
    writeJsonLines(outputPath, [{ id: "output", version: "02.00.000", payload: outputPayload }]);

    const taskPayload = {
      status: "ready_for_ai_classification_decisions",
      task_kind: "classification_decision_authoring",
      context_bundle: { sha256: "context-sha" },
      contract_context_files: [],
      missing_context_files: [],
    };
    const taskPath = path.join(root, "tasks", "classification.json");
    const taskText = writeJson(taskPath, taskPayload);

    const context = decisionContext.readClassificationDecisionApplyContext(
      root,
      {
        path: "reports/flow-apply.json",
        value: {
          status: " complete ",
          decisionsFile: "decisions/flow.json",
          decisionTasks: [
            {
              decisionTask: "tasks/classification.json",
              sha256: sha256Text(taskText),
              contextBundleSha256: "context-sha",
            },
          ],
          files: {
            input_rows: [
              "rows/missing.json",
              null,
              "rows/input-first.jsonl",
              "rows/input-second.json",
            ],
            output_rows: "rows/output.jsonl",
          },
          counts: { applied: "4" },
        },
      },
      "custom_apply",
    );

    assert.equal(context.status, "complete");
    assert.equal(context.decisionsFile, decisionsPath);
    assert.deepEqual(
      context.decisions.map((decision: JsonRecord) => decision.marker),
      ["process-first", "flow-second"],
    );
    assert.equal(context.decisionTaskProofs.length, 1);
    assert.equal(context.decisionTaskProof, context.decisionTaskProofs[0]);
    assert.equal(context.decisionTaskProof.source, "custom_apply");
    assert.equal(context.decisionTaskProof.sha256, sha256Text(taskText));
    assert.deepEqual(context.decisionTaskProof.blockers, []);
    assert.deepEqual(context.inputRows, [
      path.join(root, "rows", "missing.json"),
      inputFirstPath,
      inputSecondPath,
    ]);
    assert.deepEqual(context.outputRows, [outputPath]);
    assert.deepEqual(
      [...context.inputPayloadSha256ByIdentity.keys()],
      ["flow:first@@01.00.000", "flow:duplicate@@01.00.000", "flow:last@@01.00.000"],
    );
    assert.equal(
      context.inputPayloadSha256ByIdentity.get("flow:first@@01.00.000"),
      sha256Json(inputFirstPayload),
    );
    assert.equal(
      context.inputPayloadSha256ByIdentity.get("flow:duplicate@@01.00.000"),
      sha256Json(inputNewDuplicate),
    );
    assert.deepEqual(
      [...context.outputPayloadSha256ByIdentity],
      [["flow:output@@02.00.000", sha256Json(outputPayload)]],
    );
    assert.equal(context.applied, 4);
  });
});

test("process fallback, plural proof order, missing decision files and numeric counts preserve behavior", () => {
  withTempRoot("decision-apply-process", (root) => {
    writeJson(path.join(root, "decisions", "process.json"), {
      rows: [{ category_type: "process", marker: "process" }],
    });
    const processPayload = { processDataSet: { marker: "process-row" } };
    writeJsonLines(path.join(root, "rows", "process.jsonl"), [
      { id: "process", version: "01.00.000", payload: processPayload },
    ]);
    const firstTaskText = writeJson(path.join(root, "tasks", "first.json"), {
      status: "ready_for_ai_classification_decisions",
      task_kind: "classification_decision_authoring",
      context_bundle: { sha256: "first" },
    });
    const secondTaskText = writeJson(path.join(root, "tasks", "second.json"), {
      status: "ready_for_ai_classification_decisions",
      task_kind: "classification_decision_authoring",
      context_bundle: { sha256: "second" },
    });

    const context = decisionContext.readClassificationDecisionApplyContext(root, {
      path: "reports/process.json",
      value: {
        decisions_file: "decisions/process.json",
        decision_tasks: [
          { path: "tasks/first.json", sha256: sha256Text(firstTaskText) },
          { task: "tasks/second.json", sha256: sha256Text(secondTaskText) },
        ],
        files: { input_rows: "rows/process.jsonl" },
        counts: { applied: -2 },
      },
    });
    assert.equal(context.decisionTaskProof, null);
    assert.deepEqual(
      context.decisionTaskProofs.map((proof: JsonRecord) => proof.path),
      ["tasks/first.json", "tasks/second.json"],
    );
    assert.deepEqual(
      [...context.inputPayloadSha256ByIdentity],
      [["process:process@@01.00.000", sha256Json(processPayload)]],
    );
    assert.equal(context.applied, -2);

    const missing = decisionContext.readClassificationDecisionApplyContext(root, {
      path: "reports/missing.json",
      value: {
        decisions_file: "decisions/missing.json",
        counts: { applied: "not-a-number" },
      },
    });
    assert.deepEqual(missing.decisions, []);
    assert.equal(missing.decisionsFile, path.join(root, "decisions", "missing.json"));
    assert.equal(missing.applied, 0);
  });
});

test("decision and row input failures retain native parse and path TypeErrors", () => {
  withTempRoot("decision-apply-errors", (root) => {
    writeText(path.join(root, "decisions", "invalid.jsonl"), '{"ok":true}\n{bad}\n');
    assert.throws(
      () =>
        decisionContext.readClassificationDecisionApplyContext(root, {
          value: { decisions_file: "decisions/invalid.jsonl" },
        }),
      (error: unknown) => error instanceof SyntaxError,
    );
    assert.throws(
      () =>
        decisionContext.readClassificationDecisionApplyContext(root, {
          value: { files: { input_rows: [42] } },
        }),
      (error: unknown) => error instanceof TypeError,
    );
  });
});

test("decision apply context retains its exact export surface", () => {
  assert.deepEqual(Object.keys(decisionContext), ["readClassificationDecisionApplyContext"]);
});
