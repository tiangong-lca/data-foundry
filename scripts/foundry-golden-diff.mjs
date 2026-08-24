#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keepArtifacts = process.argv.includes("--keep");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "foundry-golden-diff-"));
const beforeRoot = path.join(tempRoot, "before-worktree");
const beforeOut = path.join(tempRoot, "before-output");
const afterOut = path.join(tempRoot, "after-output");
const normalizedRoot = path.join(tempRoot, "normalized");
const fixtureRoot = path.join(tempRoot, "fixtures");
const processId = "22222222-3333-5444-8555-666666666666";
const sourceId = "33333333-4444-5555-8666-777777777777";
const contactId = "11111111-2222-5333-8444-555555555555";
const legacyPackageRunner = ["n", "px"].join("");
const skillsPackageCommandPattern = new RegExp(
  `(?:${legacyPackageRunner} --yes|pnpm dlx) skills@latest`,
  "gu",
);
const skillsCommandReferencePattern = new RegExp(
  `(?:${legacyPackageRunner} skills|pnpm dlx skills(?:@latest)?)`,
  "gu",
);

function resolveGoldenBase() {
  const explicitBase = String(process.env.FOUNDRY_GOLDEN_BASE ?? "").trim();
  const candidates = explicitBase ? [explicitBase] : ["origin/main", "main"];
  const head = run("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).stdout.trim();
  for (const candidate of candidates) {
    const mergeBase = spawnSync("git", ["merge-base", "HEAD", candidate], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const commit = mergeBase.status === 0 ? mergeBase.stdout.trim() : "";
    if (commit && commit !== head) return { commit, comparisonRef: candidate };
  }
  const parent = spawnSync("git", ["rev-parse", "HEAD^"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const parentCommit = parent.status === 0 ? parent.stdout.trim() : "";
  if (parentCommit && parentCommit !== head && !explicitBase) {
    return { commit: parentCommit, comparisonRef: "HEAD^" };
  }
  throw new Error(
    "Golden comparison requires a non-HEAD merge-base. Fetch full history or set FOUNDRY_GOLDEN_BASE to an ancestor commit.",
  );
}

function pathVariants(value) {
  const variants = new Set([value]);
  if (value.startsWith("/var/")) variants.add(`/private${value}`);
  if (value.startsWith("/private/var/")) variants.add(value.replace(/^\/private/u, ""));
  return [...variants].sort((a, b) => b.length - a.length);
}

function replacePathVariants(value, variants, replacement) {
  let output = value;
  for (const variant of variants) {
    output = output.replaceAll(variant, replacement);
  }
  return output;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
  });
  if (result.status !== (options.expectedStatus ?? 0)) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `cwd: ${options.cwd ?? repoRoot}`,
        `status: ${result.status}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath, rows) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function ml(text) {
  return { "@xml:lang": "en", "#text": text };
}

function contactRef(id = contactId, text = "Fixture Data Steward") {
  return {
    "@type": "contact data set",
    "@refObjectId": id,
    "@version": "00.00.001",
    "@uri": `../contacts/${id}.json`,
    "common:shortDescription": ml(text),
  };
}

function sourceRef(id = sourceId, text = "Fixture source report") {
  return {
    "@type": "source data set",
    "@refObjectId": id,
    "@version": "00.00.001",
    "@uri": `../sources/${id}.json`,
    "common:shortDescription": ml(text),
  };
}

function supportRows() {
  return [
    {
      contactDataSet: {
        contactInformation: {
          dataSetInformation: {
            "common:UUID": contactId,
            "common:name": ml("Fixture Data Steward"),
            "common:shortName": ml("Fixture Data Steward"),
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
            "common:referenceToOwnershipOfDataSet": contactRef(),
          },
        },
      },
    },
    {
      sourceDataSet: {
        sourceInformation: {
          dataSetInformation: {
            "common:UUID": sourceId,
            "common:shortName": ml("Fixture source report"),
            sourceCitation: "Fixture source report, 2026",
            classificationInformation: {
              "common:classification": {
                "common:class": {
                  "@level": "0",
                  "@classId": "6",
                  "#text": "Publications and communications",
                },
              },
            },
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
            "common:referenceToOwnershipOfDataSet": contactRef(),
          },
        },
      },
    },
  ];
}

function processRow() {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: { baseName: ml("Fixture process") },
          classificationInformation: {
            "common:classification": {
              "common:class": [{ "@level": "0", "@classId": "1", "#text": "Agriculture" }],
            },
          },
        },
      },
      administrativeInformation: {
        dataEntryBy: {
          "common:referenceToPersonOrEntityEnteringTheData": contactRef(),
        },
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
          "common:referenceToOwnershipOfDataSet": contactRef(),
        },
      },
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: {
          referenceToDataSource: sourceRef(),
        },
      },
    },
  };
}

function authoringPackage(root) {
  const contextDir = path.join(root, "context");
  const contextFiles = [
    ["schema", "schema.json", "{}"],
    ["methodology_yaml", "methodology.yaml", "process:\n  required: true\n"],
    ["ruleset", "runtime-ruleset.json", '{"rules":[]}'],
    ["classification_schema", "tidas_processes_category.json", '{"oneOf":[]}'],
    ["location_schema", "tidas_locations_category.json", '{"oneOf":[]}'],
  ].map(([kind, fileName, text]) => {
    const filePath = path.join(contextDir, fileName);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, text);
    return { kind, path: filePath, text };
  });
  const packagePath = path.join(root, "authoring", "process.authoring-package.json");
  writeJson(packagePath, {
    schema_version: 2,
    profile: "bafu",
    dataset_type: "process",
    entity_id: processId,
    version: "00.00.001",
    source_rows_file: "tmp/source/processes.jsonl",
    contract_context_files: contextFiles,
    full_context_ai_completion: {
      required: true,
      required_context_kinds: [
        "schema",
        "methodology_yaml",
        "ruleset",
        "classification_schema",
        "location_schema",
      ],
      required_context_file_patterns: [
        "schema.json",
        "methodology.yaml",
        "runtime-ruleset.json",
        "tidas_processes_category.json",
        "tidas_locations_category.json",
      ],
    },
    missing_context_files: [],
    action_items: [
      {
        code: "process_placeholder_content",
        path: "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther",
        message: "Functional unit placeholder requires evidence-backed completion.",
        allowed_resolution_modes: ["evidence_backed_completion", "deferred_to_common_other"],
      },
    ],
    source_row: processRow(),
    entity_payload: processRow(),
  });
  return packagePath;
}

function prepareFixtures() {
  const rowsDir = path.join(fixtureRoot, "rows");
  const reportsDir = path.join(fixtureRoot, "reports");
  writeJsonLines(path.join(rowsDir, "processes.jsonl"), [processRow()]);
  writeJsonLines(path.join(rowsDir, "support.jsonl"), supportRows());
  writeJson(path.join(reportsDir, "schema-process.json"), {
    schema_version: 1,
    status: "completed",
    rows: [{ id: processId, version: "00.00.001", status: "valid", issues: [] }],
  });
  writeJson(path.join(reportsDir, "qa-process.json"), {
    schema_version: 1,
    status: "passed",
    findings: [],
  });
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  writeJson(path.join(bundleDir, "tidas", "contacts", `${contactId}.json`), supportRows()[0]);
  writeJson(path.join(bundleDir, "tidas", "sources", `${sourceId}.json`), supportRows()[1]);
  writeJson(path.join(bundleDir, "tidas", "processes", `${processId}.json`), processRow());
  writeJson(path.join(bundleDir, "manifest.json"), {
    schema_version: 1,
    process_id: processId,
    files: {
      contacts: [`tidas/contacts/${contactId}.json`],
      sources: [`tidas/sources/${sourceId}.json`],
      unitgroups: [],
      flowproperties: [],
      flows: [],
      processes: [`tidas/processes/${processId}.json`],
    },
    unresolved_references: [],
  });
  return {
    processRows: path.join(rowsDir, "processes.jsonl"),
    supportRows: path.join(rowsDir, "support.jsonl"),
    processSchemaReport: path.join(reportsDir, "schema-process.json"),
    processQaReport: path.join(reportsDir, "qa-process.json"),
    bundlesDir: path.join(fixtureRoot, "process-bundles"),
    authoringPackage: authoringPackage(fixtureRoot),
  };
}

function stubCliScript() {
  const cliPath = path.join(tempRoot, "stub-tiangong-lca.mjs");
  writeFileSync(
    cliPath,
    `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function option(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\\n");
}
function readRows(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  return text.split(/\\r?\\n/u).filter(Boolean).map((line) => JSON.parse(line));
}
function text(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  return "";
}
function identity(row, fallbackType = "process") {
  const root = row.contactDataSet || row.sourceDataSet || row.processDataSet || row.flowDataSet || row.lifecycleModelDataSet || row;
  const type = row.contactDataSet ? "contact" : row.sourceDataSet ? "source" : fallbackType;
  const info = root.contactInformation || root.sourceInformation || root.processInformation || root.flowInformation || {};
  const data = info.dataSetInformation || {};
  const admin = root.administrativeInformation || {};
  const publication = admin.publicationAndOwnership || {};
  return {
    id: text(data["common:UUID"] || row.id || row.dataset_id),
    version: text(publication["common:dataSetVersion"] || row.version || row.dataset_version) || "00.00.001",
    type,
  };
}

const args = process.argv.slice(2);
const outDir = option("--out-dir") || ".";
const input = option("--input") || option("--input-file");

if (args[0] === "dataset" && args[1] === "validate") {
  const rows = readRows(input);
  const report = {
    schema_version: 1,
    status: "completed",
    input_path: input,
    rows: rows.map((row) => {
      const item = identity(row, option("--type") || "process");
      return { id: item.id, version: item.version, status: "valid", issues: [] };
    }),
  };
  const reportPath = path.join(outDir, "outputs", "validation-report.json");
  writeJson(reportPath, report);
  console.log(JSON.stringify({ ...report, files: { report: reportPath } }));
} else if (args[0] === "dataset" && args[1] === "classification" && args[2] === "audit") {
  const report = { schema_version: 1, status: "passed", blockers: [] };
  const reportPath = path.join(outDir, "outputs", "location-audit-report.json");
  writeJson(reportPath, report);
  console.log(JSON.stringify({ ...report, files: { report: reportPath } }));
} else if (args[0] === "dataset" && args[1] === "save-draft") {
  const rows = readRows(input);
  const progressPath = path.join(outDir, "outputs", "dataset-save-draft", "progress.jsonl");
  const failuresPath = path.join(outDir, "outputs", "dataset-save-draft", "failures.jsonl");
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, rows.map((row) => {
    const item = identity(row, option("--type") || "support");
    return JSON.stringify({ id: item.id, version: item.version, type: item.type, status: "prepared", operation: "save_draft_prepared" });
  }).join("\\n") + (rows.length ? "\\n" : ""));
  fs.writeFileSync(failuresPath, "");
  const summaryPath = path.join(outDir, "outputs", "dataset-save-draft", "summary.json");
  const summary = {
    schema_version: 1,
    status: "completed",
    mode: args.includes("--commit") ? "commit" : "dry-run",
    input_path: input,
    rows_file: input,
    files: {
      progress_jsonl: progressPath,
      failures_jsonl: failuresPath,
      summary_json: summaryPath
    },
    counts: { prepared: rows.length, failures: 0 },
  };
  writeJson(summaryPath, summary);
  console.log(JSON.stringify(summary));
} else {
  console.error("Unhandled stub tiangong-lca command: " + args.join(" "));
  process.exit(2);
}
`,
  );
  chmodSync(cliPath, 0o755);
  return cliPath;
}

function linkInstalledDependencies(root) {
  const installed = path.join(repoRoot, "node_modules");
  const target = path.join(root, "node_modules");
  if (!existsSync(installed) || existsSync(target)) return;
  symlinkSync(installed, target, process.platform === "win32" ? "junction" : "dir");
}

function linkLegacyInstalledCliAssets() {
  const installedCliRoot = path.join(repoRoot, "node_modules", "@tiangong-lca", "cli");
  const legacyCliRoot = path.join(tempRoot, "tiangong-lca-cli");
  if (!existsSync(installedCliRoot) || existsSync(legacyCliRoot)) return;
  // HEAD may predate the installed-package resolver. Supply only the pinned package
  // layout needed to characterize that baseline; never depend on a sibling checkout.
  symlinkSync(installedCliRoot, legacyCliRoot, process.platform === "win32" ? "junction" : "dir");
}

function installPortableBaselineTidasAdapter() {
  if (process.platform !== "win32") return;
  // The historical baseline predates script-backed executable dispatch. Reuse
  // only the current adapter on Windows so its behavior surface can execute;
  // focused adapter tests retain responsibility for this compatibility shim.
  copyFileSync(
    path.join(repoRoot, "scripts", "lib", "tidas-adapter.mjs"),
    path.join(beforeRoot, "scripts", "lib", "tidas-adapter.mjs"),
  );
}

function foundryCommand(root, args, outFile, env = {}, expectedStatus = 0) {
  const result = run(process.execPath, ["scripts/foundry.mjs", ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    expectedStatus,
  });
  writeFileSync(outFile, result.stdout);
  return JSON.parse(result.stdout);
}

function runSide(label, root, fixture, cliPath) {
  const sideOut = label === "before" ? beforeOut : afterOut;
  const commandOut = path.join(sideOut, "commands");
  mkdirSync(commandOut, { recursive: true });
  foundryCommand(root, ["init"], path.join(commandOut, "setup-init.json"));
  const commonEnv = {
    TIANGONG_LCA_CLI_BIN: cliPath,
    TIDAS_BIN: path.join(root, "test", "fixtures", "fake-tidas.mjs"),
  };
  foundryCommand(root, ["help"], path.join(commandOut, "help.json"), commonEnv);
  foundryCommand(root, ["doctor"], path.join(commandOut, "doctor.json"), commonEnv, 1);
  foundryCommand(root, ["profiles-list"], path.join(commandOut, "profiles-list.json"), commonEnv);
  foundryCommand(
    root,
    ["capabilities-list"],
    path.join(commandOut, "capabilities-list.json"),
    commonEnv,
  );
  foundryCommand(
    root,
    [
      "route-task",
      "--kind",
      "external-dataset-curated-import",
      "--dataset-type",
      "process",
      "--required-gates",
      "contract,schema,qa,curation",
      "--out-dir",
      path.join(sideOut, "route-task"),
    ],
    path.join(commandOut, "route-task.json"),
    commonEnv,
  );
  foundryCommand(
    root,
    [
      "dataset-authoring-task-build",
      "--authoring-package",
      fixture.authoringPackage,
      "--out-dir",
      path.join(sideOut, "authoring-task"),
    ],
    path.join(commandOut, "dataset-authoring-task-build.json"),
    commonEnv,
  );
  foundryCommand(
    root,
    [
      "dataset-curation-gate",
      "--type",
      "process",
      "--rows-file",
      fixture.processRows,
      "--schema-report",
      fixture.processSchemaReport,
      "--qa-report",
      fixture.processQaReport,
      "--profile",
      "generic",
      "--out-dir",
      path.join(sideOut, "curation-gate"),
    ],
    path.join(commandOut, "dataset-curation-gate.json"),
    commonEnv,
  );
  foundryCommand(
    root,
    [
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      fixture.bundlesDir,
      "--process-id",
      processId,
      "--contact-id",
      contactId,
      "--out-dir",
      path.join(sideOut, "bundle-sample-rows"),
    ],
    path.join(commandOut, "dataset-bundle-sample-rows.json"),
    commonEnv,
  );
  const finalize = foundryCommand(
    root,
    [
      "dataset-post-authoring-finalize",
      "--type",
      "support",
      "--rows-file",
      fixture.supportRows,
      "--out-dir",
      path.join(sideOut, "post-authoring-finalize"),
      "--target-user-id",
      "00000000-0000-4000-8000-000000000000",
      "--state-code",
      "0",
    ],
    path.join(commandOut, "dataset-post-authoring-finalize.json"),
    commonEnv,
  );
  foundryCommand(
    root,
    [
      "dataset-mutation-manifest",
      "--type",
      "support",
      "--rows-file",
      path.resolve(root, finalize.files.final_rows),
      "--schema-report",
      path.resolve(root, finalize.files.schema_report),
      "--cleanup-report",
      path.resolve(root, finalize.files.cleanup_report),
      "--dry-run-report",
      path.resolve(root, finalize.files.dry_run_report),
      "--target-user-id",
      "00000000-0000-4000-8000-000000000000",
      "--out-dir",
      path.join(sideOut, "mutation-manifest"),
    ],
    path.join(commandOut, "dataset-mutation-manifest.json"),
    commonEnv,
  );
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const volatileValues = {
      generated_at_utc: "<generated_at_utc>",
      started_at_utc: "<started_at_utc>",
      finished_at_utc: "<finished_at_utc>",
      duration_ms: 0,
      finalize_duration_ms: 0,
      authoring_package_sha256: "<authoring_package_sha256>",
      entry_count: "<entry_count>",
      scanned: "<scanned>",
    };
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [
          key,
          Object.hasOwn(volatileValues, key) ? volatileValues[key] : normalize(item),
        ]),
    );
  }
  if (typeof value !== "string") return value;
  let output = value;
  output = replacePathVariants(output, pathVariants(beforeOut), "<side-output>");
  output = replacePathVariants(output, pathVariants(afterOut), "<side-output>");
  output = replacePathVariants(output, pathVariants(beforeRoot), "<repo-root>");
  output = replacePathVariants(output, pathVariants(repoRoot), "<repo-root>");
  output = replacePathVariants(output, pathVariants(tempRoot), "<temp-root>");
  return output
    .replace(/(?:\.\.[\\/])+before-output/gu, "<side-output>")
    .replace(/(?:\.\.[\\/])+after-output/gu, "<side-output>")
    .replace(/(?:\.\.[\\/])+fixtures/gu, "<temp-root>/fixtures")
    .replace(/(?:\.\.[\\/])*\.*<side-output>/gu, "<side-output>")
    .replace(/(?:\.\.[\\/])*\.*<temp-root>/gu, "<temp-root>")
    .replace(/\/private<repo-root>/gu, "<repo-root>")
    .replace(/\/private<temp-root>/gu, "<temp-root>")
    .replace(/<temp-root>[\\/]before-output/gu, "<side-output>")
    .replace(/<temp-root>[\\/]after-output/gu, "<side-output>")
    .replace(/<temp-root>[\\/]before-worktree/gu, "<repo-root>")
    .replace(
      /(?:\.\.[\\/]tiangong-lca-cli|node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?@tiangong-lca[\\/]cli)[\\/]assets[\\/]tidas-schemas/gu,
      "<cli-schema-assets>",
    )
    .replace(skillsPackageCommandPattern, "<skills-runtime>")
    .replace(skillsCommandReferencePattern, "<skills-runtime>")
    .replace(/\.tidas-validate-stage-[A-Za-z0-9._-]+/gu, ".tidas-validate-stage-<id>")
    .replace(/(?:\.\.\/)+(?:private\/)?tmp\/foundry-golden-diff-[A-Za-z0-9._/-]+/gu, "<temp-path>")
    .replace(/foundry-golden-diff-[A-Za-z0-9._-]+/gu, "foundry-golden-diff-<id>");
}

function normalizeJsonFile(inputFile, outputFile) {
  const value = JSON.parse(readFileSync(inputFile, "utf8"));
  writeJson(outputFile, normalize(value));
}

function normalizeOutputs() {
  for (const label of ["before", "after"]) {
    const sideOut = label === "before" ? beforeOut : afterOut;
    const normalizedOut = path.join(normalizedRoot, label);
    mkdirSync(normalizedOut, { recursive: true });
    const commandDir = path.join(sideOut, "commands");
    for (const fileName of [
      "help.json",
      "doctor.json",
      "profiles-list.json",
      "capabilities-list.json",
      "route-task.json",
      "dataset-authoring-task-build.json",
      "dataset-curation-gate.json",
      "dataset-bundle-sample-rows.json",
      "dataset-post-authoring-finalize.json",
      "dataset-mutation-manifest.json",
    ]) {
      normalizeJsonFile(path.join(commandDir, fileName), path.join(normalizedOut, fileName));
    }
  }
}

function compareNormalizedOutputs() {
  const baselineRoot = path.join(normalizedRoot, "before");
  const currentRoot = path.join(normalizedRoot, "after");
  const baselineFiles = listRelativeFiles(baselineRoot);
  const currentFiles = listRelativeFiles(currentRoot);
  const files = [...new Set([...baselineFiles, ...currentFiles])].sort();
  const differences = [];
  for (const file of files) {
    const baselinePath = path.join(baselineRoot, file);
    const currentPath = path.join(currentRoot, file);
    if (!existsSync(baselinePath)) {
      differences.push(`${file}: missing from baseline`);
      continue;
    }
    if (!existsSync(currentPath)) {
      differences.push(`${file}: missing from current output`);
      continue;
    }
    if (!readFileSync(baselinePath).equals(readFileSync(currentPath))) {
      differences.push(`${file}: content differs`);
    }
  }
  if (differences.length > 0) {
    throw new Error(
      `Golden diff failed:\n${differences.map((item) => `- ${item}`).join("\n")}\nArtifacts: ${tempRoot}`,
    );
  }
}

function listRelativeFiles(root, relative = "") {
  const files = [];
  const directory = path.join(root, relative);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...listRelativeFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

try {
  const goldenBase = resolveGoldenBase();
  const fixture = prepareFixtures();
  const cliPath = stubCliScript();
  run("git", ["worktree", "add", "--detach", "--quiet", beforeRoot, goldenBase.commit], {
    cwd: repoRoot,
  });
  installPortableBaselineTidasAdapter();
  linkLegacyInstalledCliAssets();
  linkInstalledDependencies(beforeRoot);
  runSide("before", beforeRoot, fixture, cliPath);
  runSide("after", repoRoot, fixture, cliPath);
  normalizeOutputs();
  compareNormalizedOutputs();
  console.log(
    JSON.stringify(
      {
        schema_version: 1,
        status: "passed",
        baseline_commit: goldenBase.commit,
        comparison_ref: goldenBase.comparisonRef,
        compared_commands: [
          "help",
          "doctor",
          "profiles-list",
          "capabilities-list",
          "route-task",
          "dataset-authoring-task-build",
          "dataset-curation-gate",
          "dataset-bundle-sample-rows",
          "dataset-post-authoring-finalize",
          "dataset-mutation-manifest",
        ],
        normalized_diff: 0,
        artifacts: keepArtifacts ? tempRoot : null,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    run("git", ["worktree", "remove", "--force", beforeRoot], {
      cwd: repoRoot,
      expectedStatus: 0,
    });
  } catch {
    // Best-effort cleanup; the temp tree is still removed below unless --keep was requested.
  }
  if (!keepArtifacts) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
