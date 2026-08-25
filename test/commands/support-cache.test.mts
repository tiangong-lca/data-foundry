import test from "node:test";
import {
  assert,
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  runFoundry,
  testTmpRoot,
  writeJsonLines,
} from "../fixtures/foundry-core.mjs";

const fixtureRoot = testTmpRoot("support-cache-test");

test("canonical support mapping autofill maps only proven units and reports unresolved units", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const templatePath = path.join(fixtureRoot, "canonical-support-mappings.template.jsonl");
  const outDir = path.join(fixtureRoot, "decisions");
  writeJsonLines(templatePath, [
    {
      schema_version: 1,
      support_type: "flowproperty",
      source_support_id: "11111111-1111-5111-8111-111111111111",
      source_support_version: "00.00.001",
      source_name: "Amount in unit",
    },
    {
      schema_version: 1,
      support_type: "unitgroup",
      source_support_id: "22222222-2222-5222-8222-222222222222",
      source_support_version: "00.00.001",
      source_name: "Units of p",
      source_units: [{ name: "p", mean_value: "1.0" }],
    },
    {
      schema_version: 1,
      support_type: "flowproperty",
      source_support_id: "33333333-3333-5333-8333-333333333333",
      source_support_version: "00.00.001",
      source_name: "Amount in m3y",
    },
    {
      schema_version: 1,
      support_type: "unitgroup",
      source_support_id: "44444444-4444-5444-8444-444444444444",
      source_support_version: "00.00.001",
      source_name: "Units of m3y",
      source_units: [{ name: "m3y", mean_value: "1.0" }],
    },
    {
      schema_version: 1,
      support_type: "flowproperty",
      source_support_id: "55555555-5555-5555-8555-555555555555",
      source_support_version: "00.00.001",
      source_name: "Amount in hr",
    },
    {
      schema_version: 1,
      support_type: "flowproperty",
      source_support_id: "66666666-6666-5666-8666-666666666666",
      source_support_version: "00.00.001",
      source_name: "Amount in personkm",
    },
  ]);

  const report = runFoundry([
    "dataset-canonical-support-mappings-autofill",
    "--template",
    rel(templatePath),
    "--out-dir",
    rel(outDir),
  ]);

  assert.equal(report.code, 0);
  assert.equal(report.json.status, "completed_with_manual_blocks");
  assert.equal(report.json.counts.mapped_rows, 4);
  assert.equal(report.json.counts.blocked_rows, 2);

  const mappings = readJsonLines(path.join(outDir, "canonical-support-mappings.jsonl"));
  assert.equal(
    mappings.find((row) => row.source_name === "Amount in unit").canonical_support_id,
    "01846770-4cfe-4a25-8ad9-919d8d378345",
  );
  assert.equal(
    mappings.find((row) => row.source_name === "Units of p").canonical_support_id,
    "5beb6eed-33a9-47b8-9ede-1dfe8f679159",
  );
  assert.equal(
    mappings.find((row) => row.source_name === "Amount in m3y").canonical_support_id,
    "441238a3-ba09-46ec-b35b-c30cfba746d1",
  );
  assert.equal(
    mappings.find((row) => row.source_name === "Units of m3y").canonical_support_id,
    "93a60a57-a3c8-23da-a746-0800200c9a66",
  );

  const blocked = readJsonLines(path.join(outDir, "canonical-support-blocked.manual-review.jsonl"));
  assert.deepEqual(blocked.map((row) => row.source_name).sort(), [
    "Amount in hr",
    "Amount in personkm",
  ]);
  const savedReport = readJson(path.join(outDir, "canonical-support-mappings-report.json"));
  assert.equal(
    savedReport.files.mappings,
    rel(path.join(outDir, "canonical-support-mappings.jsonl")),
  );
  assert.equal(savedReport.blocked_units.includes("hr"), true);
  assert.equal(savedReport.blocked_units.includes("personkm"), true);
});
