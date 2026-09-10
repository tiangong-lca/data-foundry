import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFoundryApplication } from "../../scripts/foundry.ts";
import { createFoundryRuntimeUtils } from "../../scripts/lib/foundry-runtime-utils.ts";
import { parseScalar } from "../../scripts/lib/foundry-args.ts";
import { selectFinalizeReferenceInputs } from "../../scripts/lib/finalize-owners/finalize-reference-inputs.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");

test("explicit reference selections fail before finalizer outputs or owner CLI calls", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-reference-inputs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = path.join(root, "rows.json");
  fs.writeFileSync(rows, "[]");
  let calls = 0;
  const app = createFoundryApplication({
    repoRoot,
    utilities: {
      ...createFoundryRuntimeUtils({ repoRoot, parseScalar }),
      runTiangongJsonStage: () => {
        calls++;
        throw new Error("Unexpected owner CLI stage");
      },
    },
  });
  for (const [index, selection] of [
    { qaReferenceRows: path.join(root, "missing-qa.json") },
    { referenceIntentFile: path.join(root, "missing-intent.json"), verifyRemote: true },
    { referenceIntentFile: path.join(root, "missing-intent.json") },
  ].entries()) {
    const outDir = path.join(root, `out-${index}`);
    await assert.rejects(
      app.execute("dataset-post-authoring-finalize", {
        type: "process",
        rowsFile: rows,
        outDir,
        ...selection,
      }),
      /--(?:qa-reference-rows|reference-intent-file)/u,
    );
    assert.equal(fs.existsSync(outDir), false);
    assert.equal(calls, 0);
  }
});

test("explicit reference selection preserves ordered files and rejects inactive or malformed choices", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-reference-selection-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ["flows.json", "support.json"]) fs.writeFileSync(path.join(root, file), "[]");
  fs.writeFileSync(
    path.join(root, "intent.json"),
    JSON.stringify({ schema_version: "dataset-exact-reference-intent.v1" }),
  );
  const select = (options: Record<string, unknown>, datasetType = "process", verifyRemote = true) =>
    selectFinalizeReferenceInputs({
      options,
      datasetType,
      verifyRemote,
      resolveFile: (file) => (typeof file === "string" ? path.resolve(root, file) : null),
    });
  assert.deepEqual(
    select({
      qaReferenceRows: ["flows.json", "support.json", "flows.json"],
      referenceIntentFile: "intent.json",
    }),
    {
      qaFiles: [path.join(root, "flows.json"), path.join(root, "support.json")],
      intentFile: path.join(root, "intent.json"),
    },
  );
  assert.deepEqual(select({}), { qaFiles: [], intentFile: null });
  for (const value of [true, "", [], ["flows.json", false]])
    assert.throws(() => select({ qaReferenceRows: value }), /--qa-reference-rows/u);
  assert.throws(() => select({ qaReferenceRows: "flows.json" }, "flow"), /Process QA/u);
  for (const value of [true, "", ["intent.json", "intent.json"]])
    assert.throws(() => select({ referenceIntentFile: value }), /--reference-intent-file/u);
  assert.throws(
    () => select({ referenceIntentFile: "intent.json" }, "process", false),
    /requires remote/u,
  );
  assert.throws(() => select({ referenceIntent: "intent.json" }), /Unsupported/u);
  fs.writeFileSync(path.join(root, "intent.json"), "{}");
  assert.throws(() => select({ referenceIntentFile: "intent.json" }), /valid CLI intent/u);
});
