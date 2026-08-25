import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  entityIdFromFinding,
  idFromArtifactFile,
  qaFindingCode,
  qaFindingCurationAction,
  qaFindingInstruction,
  qaFindingPath,
  qaFindingPathDefaults,
  readJsonLinesIfExists,
  readQaFindings,
  resolveArtifactPath,
} from "../../scripts/lib/import-curation/internal/artifact-inputs.ts";

function withFixture<T>(callback: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-artifact-inputs-"));
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function write(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

test("artifact filenames and findings preserve exact entity-id precedence", () => {
  assert.equal(idFromArtifactFile("/tmp/process-id__00.00.001.json"), "process-id");
  assert.equal(idFromArtifactFile("flow-id__draft.jsonl"), "flow-id");
  assert.equal(idFromArtifactFile("plain"), "plain");
  assert.equal(idFromArtifactFile(".json"), "");
  assert.equal(idFromArtifactFile(null), "");

  assert.equal(
    entityIdFromFinding(
      {
        process_id: " process-specific ",
        entity_id: "entity",
        file: "file-id.json",
      },
      "process",
    ),
    "process-specific",
  );
  assert.equal(entityIdFromFinding({ entity_id: "entity", id: "id" }, "flow"), "entity");
  assert.equal(
    entityIdFromFinding({ process_file: "process-from-file__v1.jsonl" }, "flow"),
    "process-from-file",
  );
  assert.equal(entityIdFromFinding({ file: "/tmp/fallback.json" }, "flow"), "fallback");
  assert.equal(entityIdFromFinding(null, "flow"), "");
  assert.equal(entityIdFromFinding("invalid", "flow"), "");
});

test("optional JSON/JSONL artifact readers preserve arrays, envelopes, missing, and errors", () => {
  withFixture((root) => {
    const arrayFile = path.join(root, "array.json");
    const findingsFile = path.join(root, "findings.json");
    const rowsFile = path.join(root, "rows.json");
    const linesFile = path.join(root, "lines.jsonl");
    const objectFile = path.join(root, "object.json");
    const invalidFile = path.join(root, "invalid.jsonl");
    write(arrayFile, '[{"id":1}]\n');
    write(findingsFile, '{"findings":[{"id":2}]}\n');
    write(rowsFile, '{"rows":[{"id":3}]}\n');
    write(linesFile, '{"id":4}\n{"id":5}\n');
    write(objectFile, '{"value":1}\n');
    write(invalidFile, "{invalid}\n");

    assert.deepEqual(readJsonLinesIfExists(arrayFile), [{ id: 1 }]);
    assert.deepEqual(readJsonLinesIfExists(findingsFile), [{ id: 2 }]);
    assert.deepEqual(readJsonLinesIfExists(rowsFile), [{ id: 3 }]);
    assert.deepEqual(readJsonLinesIfExists(linesFile), [{ id: 4 }, { id: 5 }]);
    assert.deepEqual(readJsonLinesIfExists(objectFile), []);
    assert.deepEqual(readJsonLinesIfExists(path.join(root, "missing.json")), []);
    assert.deepEqual(readJsonLinesIfExists(null), []);
    assert.throws(() => readJsonLinesIfExists(invalidFile), SyntaxError);
  });
});

test("artifact path resolution preserves absolute, base-first, repo fallback, and missing inputs", () => {
  withFixture((root) => {
    const baseDir = path.join(root, "reports");
    const baseFile = path.join(baseDir, "facts.json");
    const repoFile = path.join(root, "repo-fact.json");
    write(baseFile, "{}\n");
    write(repoFile, "{}\n");

    assert.equal(resolveArtifactPath(root, "facts.json", baseDir), baseFile);
    assert.equal(resolveArtifactPath(root, "repo-fact.json", baseDir), repoFile);
    assert.equal(
      resolveArtifactPath(root, "not-created.json", baseDir),
      path.join(root, "not-created.json"),
    );
    assert.equal(resolveArtifactPath(root, baseFile, baseDir), baseFile);
    assert.equal(resolveArtifactPath(root, null, baseDir), null);
  });
});

test("QA finding code, path, instruction, and curation action preserve stable aliases", () => {
  assert.equal(qaFindingCode({ code: "code" }), "code");
  assert.equal(qaFindingCode({ rule_code: "rule-code" }), "rule-code");
  assert.equal(qaFindingCode({ rule_id: "rule-id" }), "rule-id");
  assert.equal(qaFindingCode({ id: "id" }), "id");
  assert.equal(qaFindingCode(null), "qa_finding");
  assert.equal(
    qaFindingPath({ code: "process_missing_functional_unit" }, "process"),
    qaFindingPathDefaults.process.process_missing_functional_unit,
  );
  assert.equal(qaFindingPath({ fieldPath: "custom.path" }, "process"), "custom.path");
  assert.equal(qaFindingPath({ code: "unknown" }, "process"), null);
  assert.match(
    qaFindingInstruction({ code: "process_missing_functional_unit" }, "process") ?? "",
    /Do not invent a value/u,
  );
  assert.match(
    qaFindingInstruction({ code: "process_missing_source_base_name" }, "process") ?? "",
    /Preserve the source-language variant/u,
  );
  assert.match(
    qaFindingInstruction({ code: "process_missing_geography" }, "process") ?? "",
    /TIDAS location code workflow/u,
  );
  assert.match(
    qaFindingInstruction({ code: "process_missing_time" }, "process") ?? "",
    /source-backed year/u,
  );
  assert.equal(qaFindingInstruction({ instruction: " custom " }, "flow"), "custom");
  assert.equal(qaFindingInstruction({}, "flow"), null);

  assert.deepEqual(
    qaFindingCurationAction(
      {
        code: "flow_missing_base_name",
        message: "missing",
        evidence: { source: "fixture" },
        instruction: "repair",
      },
      "flow",
    ),
    {
      source: "flow_qa",
      code: "flow_missing_base_name",
      path: qaFindingPathDefaults.flow.flow_missing_base_name,
      message: "missing",
      evidence: { source: "fixture" },
      instruction: "repair",
      action_kind: "ai_authoring",
      required_owner: "foundry_ai_authoring",
      ai_required: true,
    },
  );
});

test("QA report aggregation preserves source order and exact deduplication identity", () => {
  withFixture((root) => {
    const reportDir = path.join(root, "reports");
    const fileFindings = path.join(reportDir, "rule-findings.jsonl");
    const repoFindings = path.join(root, "repo-findings.json");
    write(
      fileFindings,
      [
        { process_id: "p1", code: "one", path: "a", message: "m", evidence: { n: 1 } },
        { process_id: "p1", code: "one", path: "a", message: "m", evidence: { n: 1 } },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );
    write(repoFindings, '{"findings":[{"process_id":"p2","code":"two"}]}\n');
    const reportPath = path.join(reportDir, "qa.json");
    const report = {
      files: {
        rule_findings: "rule-findings.jsonl",
        findings: "repo-findings.json",
        llm_findings: "missing.jsonl",
      },
      ruleset_gate: { blockers: [{ process_id: "p3", code: "three" }] },
      blockers: [{ process_id: "p4", rule_code: "four" }],
      findings: [null, "invalid", { process_file: "p5.json", code: "five" }],
    };

    assert.deepEqual(
      readQaFindings(root, report, reportPath, "process").map((finding) => [
        entityIdFromFinding(finding, "process"),
        qaFindingCode(finding),
      ]),
      [
        ["p1", "one"],
        ["p2", "two"],
        ["p3", "three"],
        ["p4", "four"],
        ["p5", "five"],
      ],
    );
  });
});
