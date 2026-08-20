#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0];
const exitCodes = {
  success: 0,
  "data-issues": 2,
  usage: 64,
  unavailable: 69,
  internal: 70,
  io: 74,
  cancelled: 130,
};

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function baseReport(commandName, status = "succeeded", exitClass = "success") {
  return {
    schema_version: "tidas.operation-report.v1",
    command: commandName,
    status,
    exit_class: exitClass,
    completeness: status === "cancelled" ? "partial" : "complete",
    invocation: {
      schema_version: "tidas.invocation-context.v1",
      config_source: option("--config") ? "cli" : "none",
      config_path: option("--config"),
      log_level: "warn",
      progress_mode: "never",
      progress_enabled: false,
      memory_budget_bytes: 536870912,
      queue_capacity: 256,
      input_policy: "explicit-path-or-dash",
      report_destination: "stdout",
      diagnostic_destination: "stderr",
    },
    summary: {},
    diagnostics: [],
    artifacts: [],
    next_actions: [],
  };
}

if (command === "version") {
  const report = baseReport("version");
  report.summary = {
    binary_version: process.env.FAKE_TIDAS_VERSION || "0.2.7",
    operation_report_schema: "tidas.operation-report.v1",
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(0);
}

if (command === "validate" && args.includes("--describe")) {
  const report = baseReport("validate");
  report.summary.validation_describe = {
    schema_version: "tidas.validation-describe.v1",
    package: { name: "tidas", version: process.env.FAKE_TIDAS_VERSION || "0.2.7" },
    protocols: ["document-validation-batch.v1"],
    profiles: ["tidas-document-conformance.v1"],
    report_schema_versions: ["tidas.validation-report.v1"],
    event_schema_versions: ["tidas.validation-issue-event.v1", "tidas.validation-final-event.v1"],
    engines: {
      rust_minimum: "1.88",
      jsonschema: "0.40",
      xml: "libxml2/libxslt",
    },
    asset_fingerprint: "1".repeat(64),
    ruleset_catalog: {
      schema_version: "tidas.ruleset-description.v1",
      ruleset_version: "fixture",
      catalog_sha256: "2".repeat(64),
      ruleset_count: 0,
      rule_count: 0,
      ruleset_ids: [],
      methodology_file_count: 0,
      methodology_warning_count: 0,
    },
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(0);
}

const requestedExit = process.env.FAKE_TIDAS_EXIT_CLASS;
if (requestedExit && requestedExit !== "success") {
  const status =
    requestedExit === "cancelled"
      ? "cancelled"
      : requestedExit === "data-issues"
        ? "completed-with-issues"
        : "failed";
  const report = baseReport(command, status, requestedExit);
  report.diagnostics.push({
    schema_version: "tidas.diagnostic.v1",
    code: `fixture_${requestedExit}`,
    message: `fixture ${requestedExit}`,
    path: null,
    details: {},
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(exitCodes[requestedExit]);
}

if (command === "import") {
  const output = option("--output");
  fs.mkdirSync(path.join(output, "tidas", "processes"), { recursive: true });
  fs.mkdirSync(path.join(output, "process-bundles"), { recursive: true });
  fs.writeFileSync(path.join(output, "issues.jsonl"), "");
  fs.writeFileSync(path.join(output, "process-bundles", "index.json"), '{"processes":[]}\n');
  const importSummary = {
    schema_version: "tidas.import-execution-report.v1",
    source_path: path.resolve(args[1]),
    detected_format: option("--from-format") || "openlca-jsonld",
    detection_evidence: ["fixture"],
    target: option("--target") || "tidas",
    object_counts: { processes: 0 },
    warning_count: 0,
    error_count: 0,
    issues_spooled: 0,
    issues_file: "issues.jsonl",
    tidas_package: {},
    ilcd_conversion: null,
    mapping: null,
    process_bundles: {},
    tidas_validation_issue_count: 0,
    ilcd_validation_issue_count: null,
    peak_accounted_memory_bytes: 1024,
  };
  fs.writeFileSync(path.join(output, "import-report.json"), `${JSON.stringify(importSummary)}\n`);
  const report = baseReport("import");
  report.summary.import = importSummary;
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(0);
}

if (command === "validate" && args.includes("--protocol")) {
  const manifestPath = option("--input-manifest");
  const eventsPath = option("--events");
  const manifest = fs
    .readFileSync(manifestPath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const events = [];
  if (process.env.FAKE_TIDAS_INVALID === "1" && manifest.length > 0) {
    events.push({
      type: "issue",
      schema_version: "tidas.validation-issue-event.v1",
      protocol: "document-validation-batch.v1",
      profile: "tidas-document-conformance.v1",
      document_key: manifest[0].document_key,
      document_ordinal: 0,
      issue_ordinal: 0,
      identity: manifest[0].identity,
      issue: {
        issue_code: "fixture_invalid",
        severity: "error",
        category: manifest[0].category,
        file_path: manifest[0].relative_path,
        location: "/",
        message: "fixture invalid row",
        context: {},
      },
    });
  }
  const final = {
    type: "final",
    schema_version: "tidas.validation-final-event.v1",
    protocol: "document-validation-batch.v1",
    profile: "tidas-document-conformance.v1",
    completed: true,
    summary: {
      document_count: manifest.length,
      issue_count: events.length,
      error_count: events.length,
      warning_count: 0,
      info_count: 0,
    },
    logical_issue_stream_sha256: "0".repeat(64),
    fingerprints: { asset_fingerprint: "1".repeat(64) },
  };
  events.push(final);
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.writeFileSync(eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  const report = baseReport("validate");
  report.summary.validation_batch_final = final;
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(0);
}

if (command === "validate") {
  const report = baseReport("validate");
  report.summary.validation = {
    schema_version: "tidas.validation-summary.v1",
    input_format: option("--input-format") || "tidas-json",
    ok: true,
    category_count: 0,
    document_count: 0,
    issue_count: 0,
    error_count: 0,
    warning_count: 0,
    info_count: 0,
    categories: [],
    asset_fingerprint: "1".repeat(64),
    issue_spool: null,
    peak_accounted_memory_bytes: 0,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(0);
}

process.stderr.write(`unsupported fake tidas invocation: ${args.join(" ")}\n`);
process.exit(64);
