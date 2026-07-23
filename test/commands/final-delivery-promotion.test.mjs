import test from "node:test";
import {
  assert,
  crypto,
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  spawnSync,
  testTmpRoot,
  writeJson,
} from "../fixtures/foundry-core.mjs";

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const content = Buffer.from(text, "utf8");
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function xmlText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function columnName(index) {
  let value = index;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function sheetXml(rows) {
  const rowXml = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (value, columnIndex) =>
              `<c r="${columnName(columnIndex + 1)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function workbookBuffer(summaryStatus = "ready") {
  return storedZip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Evidence" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="worksheet"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="worksheet"/></Relationships>',
    "xl/worksheets/sheet1.xml": sheetXml([
      ["id", "status", "proof_sha"],
      [
        "summary-1",
        summaryStatus,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ],
    ]),
    "xl/worksheets/sheet2.xml": sheetXml([
      ["id", "status", "proof_sha"],
      ["evidence-1", "ready", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    ]),
  });
}

function createFixture(name) {
  const root = testTmpRoot(`final-delivery-promotion-${name}`);
  const deliveryRoot = path.join(root, "delivery");
  const outDir = path.join(root, "promotion");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(deliveryRoot, { recursive: true });

  const paths = {
    summary: path.join(deliveryRoot, "summary.json"),
    evidence: path.join(deliveryRoot, "evidence.csv"),
    workbook: path.join(deliveryRoot, "review.xlsx"),
    reviewer: path.join(deliveryRoot, "reviewer.json"),
  };
  writeJson(paths.summary, {
    schema_version: "generic-summary.v1",
    declared_count: 2,
    rows: [
      { id: "item-1", status: "ready" },
      { id: "item-2", status: "ready" },
    ],
  });
  fs.writeFileSync(
    paths.evidence,
    "id,status,proof_sha\nitem-1,ready,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nitem-2,ready,bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
  );
  fs.writeFileSync(paths.workbook, workbookBuffer());
  writeJson(paths.reviewer, {
    schema_version: "generic-independent-review.v1",
    status: "PASS",
    reviewer_id: "independent-reviewer",
    reviewed_artifact_ids: ["summary", "evidence", "workbook"],
    findings: { p0: 0, p1: 0 },
  });

  function descriptor(artifactId, filePath, schema, rows, rowCount) {
    const buffer = fs.readFileSync(filePath);
    return {
      artifact_id: artifactId,
      path: path.basename(filePath),
      sha256: hashBuffer(buffer),
      bytes: buffer.byteLength,
      rows,
      schema,
      row_count: rowCount,
    };
  }

  const manifest = {
    schema_version: "foundry-final-delivery-manifest.v1",
    delivery_id: `generic-${name}`,
    producer_id: "generic-producer",
    delivery_root: ".",
    promotion_mode: "OFFLINE_ONLY",
    production_authority: false,
    findings: { p0: 0, p1: 0 },
    artifacts: [
      descriptor("summary", paths.summary, "generic-summary.v1", 2, {
        kind: "json-object-rows",
      }),
      descriptor("evidence", paths.evidence, "csv.generic-evidence.v1", 2, {
        kind: "csv",
        required_columns: ["id", "status", "proof_sha"],
      }),
      descriptor("workbook", paths.workbook, "xlsx.generic-review.v1", 2, {
        kind: "xlsx",
      }),
      descriptor("reviewer", paths.reviewer, "generic-independent-review.v1", 1, {
        kind: "json-object",
      }),
    ],
    algebra: [
      {
        check_id: "summary_equals_evidence",
        left: { artifact_rows: "summary" },
        operator: "eq",
        right: { artifact_rows: "evidence" },
      },
      {
        check_id: "workbook_rows",
        left: { artifact_rows: "workbook" },
        operator: "eq",
        right: { sum: [{ literal: 1 }, { literal: 1 }] },
      },
      {
        check_id: "declared_count_equals_summary_rows",
        left: {
          artifact_json: { artifact_id: "summary", pointer: "/declared_count" },
        },
        operator: "eq",
        right: { artifact_rows: "summary" },
      },
    ],
    workbooks: [
      {
        artifact_id: "workbook",
        exact_sheet_names: ["Summary", "Evidence"],
        sheets: [
          {
            name: "Summary",
            header_row: 1,
            required_columns: ["id", "status", "proof_sha"],
            required_cells: [{ cell: "B2", equals: "ready" }],
          },
          {
            name: "Evidence",
            header_row: 1,
            required_columns: ["id", "status", "proof_sha"],
            required_cells: [{ cell: "B2", equals: "ready" }],
          },
        ],
      },
    ],
    redaction: {
      artifact_ids: ["summary", "evidence", "workbook", "reviewer"],
      forbidden_literals: ["DO_NOT_SHIP_MARKER"],
    },
    reviewers: [
      {
        reviewer_id: "independent-reviewer",
        artifact_id: "reviewer",
        required_artifact_ids: ["summary", "evidence", "workbook"],
      },
    ],
  };
  const manifestPath = path.join(deliveryRoot, "final-delivery-manifest.json");

  function refreshArtifact(artifactId) {
    const artifact = manifest.artifacts.find((entry) => entry.artifact_id === artifactId);
    const buffer = fs.readFileSync(path.join(deliveryRoot, artifact.path));
    artifact.sha256 = hashBuffer(buffer);
    artifact.bytes = buffer.byteLength;
  }

  function writeManifest() {
    writeJson(manifestPath, manifest);
  }

  writeManifest();
  return {
    deliveryRoot,
    manifest,
    manifestPath,
    outDir,
    paths,
    refreshArtifact,
    root,
    writeManifest,
  };
}

function promote(fixture) {
  return runFoundry([
    "final-delivery-promote",
    "--manifest",
    rel(fixture.manifestPath),
    "--out-dir",
    rel(fixture.outDir),
  ]);
}

test("final delivery promotion command has no dispatch surface", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "scripts", "commands", "final-delivery-promotion.mjs"),
    "utf8",
  );
  for (const forbidden of [
    "node:child_process",
    "node:http",
    "node:https",
    "node:net",
    "fetch(",
    "spawn(",
    "exec(",
  ]) {
    assert.equal(source.includes(forbidden), false, `unexpected dispatch surface: ${forbidden}`);
  }
});

test("final delivery promotion emits a detached immutable seal for exact evidence", () => {
  const fixture = createFixture("pass");
  const result = promote(fixture);
  assert.equal(result.code, 0);
  assert.equal(result.json.status, "promoted");
  assert.equal(result.json.counts.p0, 0);
  assert.equal(result.json.counts.p1, 0);
  assert.equal(result.json.counts.network_dispatches, 0);
  assert.equal(result.json.counts.database_dispatches, 0);
  assert.equal(result.json.counts.cli_write_dispatches, 0);
  assert.equal(result.json.counts.mutations, 0);

  const report = readJson(path.join(fixture.outDir, "final-delivery-promotion-report.json"));
  const seal = readJson(path.join(fixture.outDir, "final-delivery-promotion-seal.json"));
  const ledger = readJsonLines(path.join(fixture.outDir, "final-delivery-promotion-ledger.jsonl"));
  assert.equal(report.status, "promoted");
  assert.equal(report.remote_write_mode, "read-only");
  assert.deepEqual(
    report.stage_pipeline.map((stage) => stage.stage),
    ["prepare", "gate_validate", "report"],
  );
  assert.ok(
    report.stage_pipeline.every((stage) => stage.report_contract.remote_write_mode === "read-only"),
  );
  assert.ok(ledger.length > 35);
  assert.ok(ledger.every((row) => row.status === "PASS"));
  assert.equal(seal.schema_version, "foundry-final-delivery-promotion-seal.v1");
  assert.equal(seal.production_authority, false);
  assert.match(seal.seal_payload_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    fs.readFileSync(path.join(fixture.outDir, "final-delivery-manifest-snapshot.json"), "utf8"),
    fs.readFileSync(fixture.manifestPath, "utf8"),
  );
});

const rejectionVectors = [
  {
    name: "delivery-root-traversal",
    expected: "delivery_root",
    mutate(fixture) {
      fixture.manifest.delivery_root = "../..";
      fixture.writeManifest();
    },
  },
  {
    name: "artifact-hash-drift",
    expected: "artifact_hash:summary",
    mutate(fixture) {
      fs.appendFileSync(fixture.paths.summary, " ");
    },
  },
  {
    name: "artifact-byte-count-drift",
    expected: "artifact_bytes:summary",
    mutate(fixture) {
      fixture.manifest.artifacts.find((entry) => entry.artifact_id === "summary").bytes += 1;
      fixture.writeManifest();
    },
  },
  {
    name: "artifact-path-not-normalized",
    expected: "artifact_path:summary",
    mutate(fixture) {
      fixture.manifest.artifacts.find((entry) => entry.artifact_id === "summary").path =
        "./summary.json";
      fixture.writeManifest();
    },
  },
  {
    name: "artifact-symlink",
    expected: "artifact_file_safe:summary",
    mutate(fixture) {
      const link = path.join(fixture.deliveryRoot, "summary-link.json");
      fs.symlinkSync(path.basename(fixture.paths.summary), link);
      fixture.manifest.artifacts.find((entry) => entry.artifact_id === "summary").path =
        path.basename(link);
      fixture.writeManifest();
    },
  },
  {
    name: "row-count-mismatch",
    expected: "artifact_rows:summary",
    mutate(fixture) {
      fixture.manifest.artifacts.find((entry) => entry.artifact_id === "summary").rows = 3;
      fixture.writeManifest();
    },
  },
  {
    name: "algebra-mismatch",
    expected: "algebra:summary_equals_evidence",
    mutate(fixture) {
      fixture.manifest.algebra[0].right = { literal: 3 };
      fixture.writeManifest();
    },
  },
  {
    name: "missing-workbook-sheet",
    expected: "workbook_sheet_names:workbook",
    mutate(fixture) {
      fixture.manifest.workbooks[0].exact_sheet_names = ["Summary", "Missing"];
      fixture.manifest.workbooks[0].sheets[1].name = "Missing";
      fixture.writeManifest();
    },
  },
  {
    name: "extra-workbook-sheet",
    expected: "workbook_sheet_names:workbook",
    mutate(fixture) {
      fixture.manifest.workbooks[0].exact_sheet_names = ["Summary"];
      fixture.manifest.workbooks[0].sheets = [fixture.manifest.workbooks[0].sheets[0]];
      fixture.writeManifest();
    },
  },
  {
    name: "missing-proof-column",
    expected: "workbook_required_columns:workbook:Summary",
    mutate(fixture) {
      fixture.manifest.workbooks[0].sheets[0].required_columns.push("review_proof");
      fixture.writeManifest();
    },
  },
  {
    name: "secret-like-content",
    expected: "redaction:evidence",
    mutate(fixture) {
      fs.writeFileSync(
        fixture.paths.evidence,
        "id,status,proof_sha\nitem-1,ready,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nitem-2,\"password='supersecretvalue'\",bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
      );
      fixture.refreshArtifact("evidence");
      fixture.writeManifest();
    },
  },
  {
    name: "secret-like-workbook-cell",
    expected: "redaction:workbook",
    mutate(fixture) {
      const secret = "password='supersecretvalue'";
      fs.writeFileSync(fixture.paths.workbook, workbookBuffer(secret));
      fixture.manifest.workbooks[0].sheets[0].required_cells[0].equals = secret;
      fixture.refreshArtifact("workbook");
      fixture.writeManifest();
    },
  },
  {
    name: "redaction-coverage-omission",
    expected: "redaction_coverage",
    mutate(fixture) {
      fixture.manifest.redaction.artifact_ids = fixture.manifest.redaction.artifact_ids.filter(
        (artifactId) => artifactId !== "evidence",
      );
      fixture.writeManifest();
    },
  },
  {
    name: "reviewer-coverage-unknown-artifact",
    expected: "reviewer_coverage:independent-reviewer",
    mutate(fixture) {
      fixture.manifest.reviewers[0].required_artifact_ids.push("not-a-delivery-artifact");
      const reviewer = readJson(fixture.paths.reviewer);
      reviewer.reviewed_artifact_ids.push("not-a-delivery-artifact");
      writeJson(fixture.paths.reviewer, reviewer);
      fixture.refreshArtifact("reviewer");
      fixture.writeManifest();
    },
  },
  {
    name: "reviewer-failure",
    expected: "reviewer_pass:independent-reviewer",
    mutate(fixture) {
      const reviewer = readJson(fixture.paths.reviewer);
      reviewer.status = "FAIL";
      reviewer.findings.p1 = 1;
      writeJson(fixture.paths.reviewer, reviewer);
      fixture.refreshArtifact("reviewer");
      fixture.writeManifest();
    },
  },
  {
    name: "workbook-crc-drift",
    expected: "artifact_parse:workbook",
    mutate(fixture) {
      const workbook = fs.readFileSync(fixture.paths.workbook);
      const centralOffset = workbook.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      assert.ok(centralOffset >= 0);
      workbook.writeUInt32LE(
        (workbook.readUInt32LE(centralOffset + 16) + 1) >>> 0,
        centralOffset + 16,
      );
      fs.writeFileSync(fixture.paths.workbook, workbook);
      fixture.refreshArtifact("workbook");
      fixture.writeManifest();
    },
  },
  {
    name: "invalid-workbook",
    expected: "artifact_parse:workbook",
    mutate(fixture) {
      fs.writeFileSync(fixture.paths.workbook, "not-a-zip");
      fixture.refreshArtifact("workbook");
      fixture.writeManifest();
    },
  },
];

for (const vector of rejectionVectors) {
  test(`final delivery promotion rejects ${vector.name}`, () => {
    const fixture = createFixture(vector.name);
    vector.mutate(fixture);
    const result = promote(fixture);
    assert.equal(result.code, 1);
    assert.equal(result.json.status, "rejected");
    assert.equal(result.json.seal, null);
    assert.equal(
      fs.existsSync(path.join(fixture.outDir, "final-delivery-promotion-seal.json")),
      false,
    );
    const report = readJson(path.join(fixture.outDir, "final-delivery-promotion-report.json"));
    assert.ok(report.failed_checks.includes(vector.expected), report.failed_checks.join("\n"));
    assert.ok(report.counts.p0 + report.counts.p1 > 0);
    assert.equal(report.counts.network_dispatches, 0);
    assert.equal(report.counts.database_dispatches, 0);
    assert.equal(report.counts.mutations, 0);
  });
}

test("final delivery promotion refuses to overwrite immutable output", () => {
  const fixture = createFixture("immutable-output");
  assert.equal(promote(fixture).code, 0);
  const second = spawnSync(
    process.execPath,
    [
      "scripts/foundry.mjs",
      "final-delivery-promote",
      "--manifest",
      rel(fixture.manifestPath),
      "--out-dir",
      rel(fixture.outDir),
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(second.status, 1);
  assert.match(second.stderr, /already exists and is immutable/u);
});
