import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { testAuthIdentityReceipt } from "../fixtures/identity-fixtures.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = path.join(repoRoot, "tmp", "bundle-sample-rows-test");
const oldContactId = "a6db11f5-1cb4-579a-b503-bd17c361b8c2";
const newContactId = "11111111-2222-5333-8444-555555555555";
const processId = "22222222-3333-5444-8555-666666666666";
const sourceId = "33333333-4444-5555-8666-777777777777";
const formatSourceId = "66666666-7777-5888-8999-aaaaaaaaaaaa";
const complianceSourceId = "77777777-8888-5999-8aaa-bbbbbbbbbbbb";
const placeholderCitationSourceId = "88888888-9999-5aaa-8bbb-cccccccccccc";
const genericUnrepairableSourceId = "99999999-aaaa-5bbb-8ccc-dddddddddddd";
const flowId = "44444444-5555-5666-8777-888888888888";
const flowpropertyId = "aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee";
const unitgroupId = "bbbbbbbb-cccc-5ddd-8eee-ffffffffffff";
const lifecyclemodelId = "55555555-6666-5777-8888-999999999999";
const canonicalIlcdFormatSourceId = "a97a0155-0234-4b87-b4ce-a45da52f2a40";
const canonicalComplianceSourceId = "d92a1a12-2545-49e2-a585-55c259997756";
const canonicalMassFlowPropertyId = "93a60a56-a3c8-11da-a746-0800200b9a66";
const canonicalMassUnitGroupId = "93a60a57-a4c8-11da-a746-0800200c9a66";

function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function ml(text) {
  return { "@xml:lang": "en", "#text": text };
}

function contactRef(id, text) {
  return {
    "@type": "contact data set",
    "@refObjectId": id,
    "@version": "00.00.001",
    "@uri": `../contacts/${id}.json`,
    "common:shortDescription": ml(text),
  };
}

function sourceRef(id, text) {
  return {
    "@type": "source data set",
    "@refObjectId": id,
    "@version": "00.00.001",
    "@uri": `../sources/${id}.json`,
    "common:shortDescription": ml(text),
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function readJsonLines(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runFoundry(args, expectedStatus = 0, env = {}) {
  const result = spawnSync(process.execPath, ["scripts/foundry.mjs", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function createBundleFixture() {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);

  writeJson(path.join(bundleDir, "tidas", "contacts", `${oldContactId}.json`), {
    contactDataSet: {
      "@version": "1.1",
      "@xmlns": "http://lca.jrc.it/ILCD/Contact",
      "@xmlns:common": "http://lca.jrc.it/ILCD/Common",
      contactInformation: {
        dataSetInformation: {
          "common:UUID": oldContactId,
          "common:shortName": ml("TianGong LCA import tooling"),
          "common:name": ml("TianGong LCA import tooling"),
        },
      },
      administrativeInformation: {
        dataEntryBy: { "common:timeStamp": "2026-06-01T00:00:00+00:00" },
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
          "common:referenceToOwnershipOfDataSet": contactRef(
            oldContactId,
            "TianGong LCA import tooling",
          ),
        },
      },
    },
  });
  writeJson(path.join(bundleDir, "tidas", "sources", `${sourceId}.json`), {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": sourceId,
          "common:shortName": ml("Fixture source"),
          sourceCitation: "Fixture source report, 2026",
          classificationInformation: {
            "common:classification": {
              "common:class": {
                "@level": "0",
                "@classId": "6",
                "#text": "Other source types",
              },
            },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
          "common:referenceToOwnershipOfDataSet": contactRef(
            oldContactId,
            "TianGong LCA import tooling",
          ),
        },
      },
    },
  });
  writeJson(path.join(bundleDir, "tidas", "processes", `${processId}.json`), {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: { baseName: ml("Fixture process") },
        },
        geography: {
          locationOfOperationSupplyOrProduction: {
            "@location": "CH",
            descriptionOfRestrictions: ml(
              "Fixture geography description should not be in search query.",
            ),
          },
        },
      },
      administrativeInformation: {
        dataEntryBy: {
          "common:referenceToPersonOrEntityEnteringTheData": contactRef(
            oldContactId,
            "TianGong LCA import tooling",
          ),
        },
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
          "common:referenceToOwnershipOfDataSet": contactRef(
            oldContactId,
            "TianGong LCA import tooling",
          ),
        },
      },
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: {
          referenceToDataSource: sourceRef(sourceId, "Fixture source"),
        },
      },
    },
  });
  writeJson(path.join(bundleDir, "manifest.json"), {
    schema_version: 1,
    process_id: processId,
    files: {
      contacts: [`tidas/contacts/${oldContactId}.json`],
      sources: [`tidas/sources/${sourceId}.json`],
      unitgroups: [],
      flowproperties: [],
      flows: [],
      processes: [`tidas/processes/${processId}.json`],
    },
    unresolved_references: [],
  });
}

test("dataset-bundle-sample-rows creates one shared library contact and rewrites refs", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out");
  const report = runFoundry([
    "dataset-bundle-sample-rows",
    "--bundles-dir",
    path.join(fixtureRoot, "process-bundles"),
    "--process-id",
    processId,
    "--out-dir",
    outDir,
    "--contact-id",
    newContactId,
  ]);

  assert.equal(report.status, "ready");
  assert.equal(report.counts.contact_rows, 1);
  assert.equal(report.counts.source_rows, 1);
  assert.equal(report.counts.support_rows, 2);
  assert.equal(report.counts.process_rows, 1);
  assert.equal(report.counts.process_scopes_ready, 1);
  assert.equal(report.counts.process_scopes_needs_ai_authoring, 0);
  assert.equal(report.counts.process_scopes_blocked_deferred, 0);
  assert.equal(report.counts.rewritten_contact_refs, 3);
  assert.equal(report.counts.true_source_rows, 1);
  assert.equal(report.counts.true_source_classification_repairs, 1);
  assert.equal(report.counts.true_source_description_repairs, 1);
  assert.equal(report.counts.source_classification_repair_rows, 2);
  assert.equal(report.counts.process_source_reference_rows, 1);
  assert.deepEqual(report.library_contact.replaced_contact_ids, [oldContactId]);

  const contacts = readJsonLines(path.join(repoRoot, report.files.rows.contact));
  const processes = readJsonLines(path.join(repoRoot, report.files.rows.process));
  const sources = readJsonLines(path.join(repoRoot, report.files.rows.source));
  const support = readJsonLines(path.join(repoRoot, report.files.rows.support));
  assert.equal(contacts.length, 1);
  assert.equal(support.length, contacts.length + sources.length);
  assert.match(report.commands.support.cleanup, /dataset-curation-cleanup/u);
  assert.match(report.commands.support.dry_run, /--type auto/u);
  assert.match(report.commands.support.commit, /--type auto/u);
  assert.equal(
    contacts[0].contactDataSet.contactInformation.dataSetInformation["common:name"]["#text"],
    "Swiss Federal Administration - Federal Office for the Environment (FOEN)",
  );
  assert.equal(
    contacts[0].contactDataSet.contactInformation.dataSetInformation["common:shortName"]["#text"],
    "Federal Office for the Environment FOEN (BAFU)",
  );
  assert.deepEqual(
    contacts[0].contactDataSet.contactInformation.dataSetInformation.classificationInformation[
      "common:classification"
    ]["common:class"].map((item) => item["#text"]),
    ["Organisations", "Governmental organisations"],
  );
  assert.equal(JSON.stringify(processes).includes(newContactId), true);
  assert.equal(JSON.stringify(sources).includes(newContactId), true);
  assert.equal(JSON.stringify(processes).includes(oldContactId), false);
  assert.equal(JSON.stringify(sources).includes(oldContactId), false);
  const processScopeLedger = readJsonLines(path.join(repoRoot, report.files.process_scope_ledger));
  assert.equal(processScopeLedger.length, 1);
  assert.equal(processScopeLedger[0].process_id, processId);
  assert.equal(processScopeLedger[0].status, "ready");
  assert.match(processScopeLedger[0].rerun_command, /--process-id/u);
  assert.equal(
    sources[0].sourceDataSet.sourceInformation.dataSetInformation.classificationInformation[
      "common:classification"
    ]["common:class"]["#text"],
    "Publications and communications",
  );
  assert.equal(
    sources[0].sourceDataSet.sourceInformation.dataSetInformation.sourceDescriptionOrComment[
      "#text"
    ],
    "Report/publication: Fixture source report, 2026.",
  );

  const sourceClassificationRepairs = readJsonLines(
    path.join(repoRoot, report.files.source_classification_repairs),
  );
  assert.equal(sourceClassificationRepairs.length, 2);
  assert.equal(
    sourceClassificationRepairs.some(
      (row) => row.relation === "true_source_publication_classification",
    ),
    true,
  );
  assert.equal(
    sourceClassificationRepairs.some(
      (row) => row.relation === "true_source_description_from_citation",
    ),
    true,
  );

  const sourceSemantics = readJsonLines(path.join(repoRoot, report.files.source_semantics));
  assert.equal(sourceSemantics[0].kind, "true_source");
  assert.equal(sourceSemantics[0].source_citation, "Fixture source report, 2026");
  assert.equal(
    sourceSemantics[0].source_description,
    "Report/publication: Fixture source report, 2026.",
  );
  const processSourceReferences = readJsonLines(
    path.join(repoRoot, report.files.process_source_references),
  );
  assert.equal(processSourceReferences[0].relation, "process_data_source");
  assert.equal(processSourceReferences[0].referenced_source_kind, "true_source");
});

test("dataset-bundle-sample-rows rewrites flow property refs to canonical support and does not write unitgroup or flowproperty support", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-canonical-support");
  const cachePath = path.join(fixtureRoot, "canonical-support-cache.json");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  writeJson(cachePath, {
    schema_version: 1,
    flow_properties: [
      {
        id: canonicalMassFlowPropertyId,
        version: "03.00.003",
        name: "Mass",
        short_description: "Mass",
        reference_unit_group: {
          id: canonicalMassUnitGroupId,
          version: "03.00.003",
          short_description: "Units of mass",
        },
      },
    ],
    unit_groups: [
      {
        id: canonicalMassUnitGroupId,
        version: "03.00.003",
        name: "Units of mass",
      },
    ],
    flow_property_mappings: [
      {
        source_units: ["kg"],
        canonical_flow_property_id: canonicalMassFlowPropertyId,
        reason: "Fixture mass support mapping.",
      },
    ],
  });

  writeJson(path.join(bundleDir, "tidas", "unitgroups", `${unitgroupId}.json`), {
    unitGroupDataSet: {
      unitGroupInformation: {
        dataSetInformation: {
          "common:UUID": unitgroupId,
          "common:name": ml("Units of kg"),
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });
  writeJson(path.join(bundleDir, "tidas", "flowproperties", `${flowpropertyId}.json`), {
    flowPropertyDataSet: {
      flowPropertiesInformation: {
        dataSetInformation: {
          "common:UUID": flowpropertyId,
          "common:name": ml("Amount in kg"),
        },
        quantitativeReference: {
          referenceToReferenceUnitGroup: {
            "@type": "unit group data set",
            "@refObjectId": unitgroupId,
            "@version": "00.00.001",
            "@uri": `../unitgroups/${unitgroupId}.json`,
            "common:shortDescription": ml("Units of kg"),
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });
  writeJson(path.join(bundleDir, "tidas", "flows", `${flowId}.json`), {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          name: { baseName: ml("Fixture product flow") },
        },
      },
      flowProperties: {
        flowProperty: {
          "@dataSetInternalID": "1",
          referenceToFlowPropertyDataSet: {
            "@type": "flow property data set",
            "@refObjectId": flowpropertyId,
            "@version": "00.00.001",
            "@uri": `../flowproperties/${flowpropertyId}.json`,
            "common:shortDescription": ml("Amount in kg"),
          },
          meanValue: 1,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });
  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.unitgroups.push(`tidas/unitgroups/${unitgroupId}.json`);
  manifest.files.flowproperties.push(`tidas/flowproperties/${flowpropertyId}.json`);
  manifest.files.flows.push(`tidas/flows/${flowId}.json`);
  writeJson(manifestPath, manifest);

  const report = runFoundry([
    "dataset-bundle-sample-rows",
    "--bundles-dir",
    path.join(fixtureRoot, "process-bundles"),
    "--process-id",
    processId,
    "--out-dir",
    outDir,
    "--contact-id",
    newContactId,
    "--canonical-support-cache",
    cachePath,
  ]);

  assert.equal(report.status, "ready");
  assert.equal(report.counts.unitgroup_rows, 1);
  assert.equal(report.counts.flowproperty_rows, 1);
  assert.equal(report.counts.support_rows, 2);
  assert.equal(report.counts.reference_only_unitgroup_rows, 1);
  assert.equal(report.counts.reference_only_flowproperty_rows, 1);
  assert.equal(report.counts.canonical_flow_property_reference_rewrites, 1);
  assert.equal(report.counts.canonical_unit_group_reference_proofs, 1);
  assert.equal(report.commands.unitgroup.dry_run, null);
  assert.equal(report.commands.unitgroup.commit, null);
  assert.equal(report.commands.flowproperty.dry_run, null);
  assert.equal(report.commands.flowproperty.commit, null);

  const support = readJsonLines(path.join(repoRoot, report.files.rows.support));
  assert.equal(
    support.some((row) => row.unitGroupDataSet || row.flowPropertyDataSet),
    false,
  );
  const flows = readJsonLines(path.join(repoRoot, report.files.rows.flow));
  const flowPropertyReference =
    flows[0].flowDataSet.flowProperties.flowProperty.referenceToFlowPropertyDataSet;
  assert.equal(flowPropertyReference["@refObjectId"], canonicalMassFlowPropertyId);
  assert.equal(flowPropertyReference["@version"], "03.00.003");

  const rewrites = readJsonLines(path.join(repoRoot, report.files.canonical_support_rewrites));
  assert.equal(rewrites.length, 1);
  assert.equal(rewrites[0].relation, "flow_property_reference_to_canonical_support");
  assert.equal(rewrites[0].original.ref_object_id, flowpropertyId);
  assert.equal(rewrites[0].canonical.ref_object_id, canonicalMassFlowPropertyId);
  assert.equal(rewrites[0].canonical_reference_unit_group.ref_object_id, canonicalMassUnitGroupId);
});

test("dataset-bundle-sample-rows retains and blocks canonical amount scaling requirements", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-canonical-scaling-required");
  const cachePath = path.join(fixtureRoot, "canonical-scaling-cache.json");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  writeJson(cachePath, {
    schema_version: 1,
    flow_properties: [
      {
        id: canonicalMassFlowPropertyId,
        version: "03.00.003",
        name: "mass*distance",
        short_description: "mass*distance",
        reference_unit_group: {
          id: canonicalMassUnitGroupId,
          version: "03.00.003",
          short_description: "Unit of kg*km",
        },
      },
    ],
    unit_groups: [
      {
        id: canonicalMassUnitGroupId,
        version: "03.00.003",
        name: "Unit of kg*km",
      },
    ],
    flow_property_mappings: [
      {
        source_units: ["tkm", "t*km", "kg*km"],
        canonical_flow_property_id: canonicalMassFlowPropertyId,
        canonical_reference_unit: "kg*km",
        source_unit_scales: { tkm: 1000, "t*km": 1000, "kg*km": 1 },
        reason: "Mass-distance units reuse canonical kg*km support.",
      },
    ],
  });

  writeJson(path.join(bundleDir, "tidas", "unitgroups", `${unitgroupId}.json`), {
    unitGroupDataSet: {
      unitGroupInformation: {
        dataSetInformation: {
          "common:UUID": unitgroupId,
          "common:name": ml("Units of tkm"),
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  });
  writeJson(path.join(bundleDir, "tidas", "flowproperties", `${flowpropertyId}.json`), {
    flowPropertyDataSet: {
      flowPropertiesInformation: {
        dataSetInformation: {
          "common:UUID": flowpropertyId,
          "common:name": ml("Amount in tkm"),
        },
        quantitativeReference: {
          referenceToReferenceUnitGroup: {
            "@type": "unit group data set",
            "@refObjectId": unitgroupId,
            "@version": "00.00.001",
            "common:shortDescription": ml("Units of tkm"),
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  });
  writeJson(path.join(bundleDir, "tidas", "flows", `${flowId}.json`), {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          name: { baseName: ml("Fixture freight flow") },
        },
      },
      flowProperties: {
        flowProperty: {
          "@dataSetInternalID": "1",
          referenceToFlowPropertyDataSet: {
            "@type": "flow property data set",
            "@refObjectId": flowpropertyId,
            "@version": "00.00.001",
            "common:shortDescription": ml("Amount in tkm"),
          },
          meanValue: 7,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  });
  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.unitgroups.push(`tidas/unitgroups/${unitgroupId}.json`);
  manifest.files.flowproperties.push(`tidas/flowproperties/${flowpropertyId}.json`);
  manifest.files.flows.push(`tidas/flows/${flowId}.json`);
  writeJson(manifestPath, manifest);

  const result = spawnSync(
    process.execPath,
    [
      "scripts/foundry.mjs",
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      path.join(fixtureRoot, "process-bundles"),
      "--process-id",
      processId,
      "--out-dir",
      outDir,
      "--contact-id",
      newContactId,
      "--canonical-support-cache",
      cachePath,
      "--block-on-unscaled-canonical-support",
    ],
    { cwd: repoRoot, env: process.env, encoding: "utf8" },
  );
  assert.notEqual(result.stdout.trim(), "", result.stderr);
  const report = JSON.parse(result.stdout);

  const flows = readJsonLines(path.join(repoRoot, report.files.rows.flow));
  const flowProperty = flows[0].flowDataSet.flowProperties.flowProperty;
  assert.equal(
    flowProperty.referenceToFlowPropertyDataSet["@refObjectId"],
    canonicalMassFlowPropertyId,
  );
  assert.equal(flowProperty.meanValue, 7, "bundle sampling must never silently scale amounts");
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(report.status, "blocked");
  assert.equal(report.counts.canonical_support_rewrite_rows, 1);
  assert.equal(report.counts.canonical_support_amount_scaling_rows, 1);
  assert.equal(report.counts.amount_scaling_required_rewrites, 1);
  assert.equal(report.counts.amount_scaling_blocked, 1);
  assert.equal(report.process_scope_summary.needs_ai_authoring, 1);
  assert.equal(report.amount_scaling_requirements.length, 1);
  assert.match(report.policy.canonical_support_amount_scaling, /never convert amounts/u);
  assert.deepEqual(
    report.blockers.map((blocker) => blocker.code),
    ["canonical_support_amount_scaling_required"],
  );
  assert.equal(report.blockers[0].amount_scale_to_canonical_reference, 1000);
  assert.equal(
    report.files.canonical_support_amount_scaling,
    rel(path.join(outDir, "canonical-support-amount-scaling.jsonl")),
  );
  const requirements = readJsonLines(
    path.join(repoRoot, report.files.canonical_support_amount_scaling),
  );
  assert.equal(requirements.length, 1);
  assert.equal(requirements[0].source_unit, "tkm");
  assert.equal(requirements[0].canonical_reference_unit, "kg*km");
  assert.equal(requirements[0].amount_scale_to_canonical_reference, 1000);
  const scopeLedger = readJsonLines(path.join(repoRoot, report.files.process_scope_ledger));
  assert.equal(scopeLedger[0].status, "needs_ai_authoring");
  assert.deepEqual(scopeLedger[0].blocker_counts_by_code, {
    canonical_support_amount_scaling_required: 1,
  });

  const unresolvedCache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  delete unresolvedCache.flow_property_mappings[0].source_unit_scales;
  writeJson(cachePath, unresolvedCache);
  const unresolvedOutDir = path.join(fixtureRoot, "out-canonical-scaling-unresolved");
  const unresolvedResult = spawnSync(
    process.execPath,
    [
      "scripts/foundry.mjs",
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      path.join(fixtureRoot, "process-bundles"),
      "--process-id",
      processId,
      "--out-dir",
      unresolvedOutDir,
      "--contact-id",
      newContactId,
      "--canonical-support-cache",
      cachePath,
      "--block-on-unscaled-canonical-support",
    ],
    { cwd: repoRoot, env: process.env, encoding: "utf8" },
  );
  assert.notEqual(unresolvedResult.stdout.trim(), "", unresolvedResult.stderr);
  const unresolvedReport = JSON.parse(unresolvedResult.stdout);
  const unresolvedFlows = readJsonLines(path.join(repoRoot, unresolvedReport.files.rows.flow));
  const unresolvedProperty = unresolvedFlows[0].flowDataSet.flowProperties.flowProperty;
  assert.equal(
    unresolvedProperty.referenceToFlowPropertyDataSet["@refObjectId"],
    canonicalMassFlowPropertyId,
  );
  assert.equal(unresolvedProperty.meanValue, 7);
  assert.equal(unresolvedResult.status, 1, unresolvedResult.stderr || unresolvedResult.stdout);
  assert.equal(unresolvedReport.status, "blocked");
  assert.equal(unresolvedReport.counts.amount_scaling_unresolved, 1);
  assert.deepEqual(
    unresolvedReport.blockers.map((blocker) => blocker.code),
    ["canonical_support_amount_scale_unresolved"],
  );
  const unresolvedLedger = readJsonLines(
    path.join(repoRoot, unresolvedReport.files.process_scope_ledger),
  );
  assert.deepEqual(unresolvedLedger[0].blocker_counts_by_code, {
    canonical_support_amount_scale_unresolved: 1,
  });
});

test("dataset-bundle-sample-rows blocks canonical flow property mappings when the cached unit group proof is missing", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-canonical-support-missing-unitgroup");
  const cachePath = path.join(fixtureRoot, "canonical-support-cache-missing-unitgroup.json");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  writeJson(cachePath, {
    schema_version: 1,
    flow_properties: [
      {
        id: canonicalMassFlowPropertyId,
        version: "03.00.003",
        name: "Mass",
        short_description: "Mass",
        reference_unit_group: {
          id: canonicalMassUnitGroupId,
          version: "03.00.003",
          short_description: "Units of mass",
        },
      },
    ],
    unit_groups: [],
    flow_property_mappings: [
      {
        source_units: ["kg"],
        canonical_flow_property_id: canonicalMassFlowPropertyId,
        reason: "Fixture mass support mapping.",
      },
    ],
  });

  writeJson(path.join(bundleDir, "tidas", "flows", `${flowId}.json`), {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          name: { baseName: ml("Fixture product flow") },
        },
      },
      flowProperties: {
        flowProperty: {
          "@dataSetInternalID": "1",
          referenceToFlowPropertyDataSet: {
            "@type": "flow property data set",
            "@refObjectId": flowpropertyId,
            "@version": "00.00.001",
            "@uri": `../flowproperties/${flowpropertyId}.json`,
            "common:shortDescription": ml("Amount in kg"),
          },
          meanValue: 1,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });
  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.flows.push(`tidas/flows/${flowId}.json`);
  writeJson(manifestPath, manifest);

  const result = runFoundry(
    [
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      path.join(fixtureRoot, "process-bundles"),
      "--process-id",
      processId,
      "--out-dir",
      outDir,
      "--contact-id",
      newContactId,
      "--canonical-support-cache",
      cachePath,
    ],
    1,
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.counts.canonical_flow_property_reference_rewrites, 0);
  assert.equal(result.counts.canonical_unit_group_reference_proofs, 0);
  assert.equal(
    result.blockers.some(
      (blocker) =>
        blocker.code === "canonical_flow_property_unit_group_unproven" &&
        blocker.canonical_flow_property_id === canonicalMassFlowPropertyId &&
        blocker.canonical_reference_unit_group_id === canonicalMassUnitGroupId,
    ),
    true,
  );
});

test("dataset-bundle-sample-rows writes executable identity preflight requests for process and elementary flow matching", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-identity-preflight");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  const processPath = path.join(bundleDir, "tidas", "processes", `${processId}.json`);
  const processPayload = JSON.parse(fs.readFileSync(processPath, "utf8"));
  processPayload.processDataSet.processInformation.quantitativeReference = {
    referenceToReferenceFlow: "1",
  };
  processPayload.processDataSet.exchanges = {
    exchange: {
      "@dataSetInternalID": "1",
      exchangeDirection: "Output",
      meanAmount: "1",
      referenceToFlowDataSet: {
        "@type": "flow data set",
        "@refObjectId": flowId,
        "@version": "00.00.001",
        "@uri": `../flows/${flowId}.json`,
        "common:shortDescription": ml("Methane"),
      },
    },
  };
  writeJson(processPath, processPayload);
  writeJson(path.join(bundleDir, "tidas", "flows", `${flowId}.json`), {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          name: {
            baseName: ml("Methane"),
          },
          classificationInformation: {
            "common:elementaryFlowCategorization": {
              "common:category": [
                { "@level": "0", "#text": "Emissions" },
                { "@level": "1", "#text": "Emissions to air" },
                { "@level": "2", "#text": "low population density, long-term" },
              ],
            },
          },
          CASNumber: "74-82-8",
        },
      },
      modellingAndValidation: {
        LCIMethod: {
          typeOfDataSet: "Elementary flow",
        },
      },
      flowProperties: {
        flowProperty: {
          referenceToFlowPropertyDataSet: {
            "common:shortDescription": ml("Mass"),
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });
  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.flows.push(`tidas/flows/${flowId}.json`);
  writeJson(manifestPath, manifest);

  const report = runFoundry(
    [
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      path.join(fixtureRoot, "process-bundles"),
      "--process-id",
      processId,
      "--out-dir",
      outDir,
      "--contact-id",
      newContactId,
    ],
    1,
  );

  assert.equal(report.status, "blocked");
  assert.equal(report.counts.identity_preflight_request_rows, 2);
  assert.equal(report.counts.elementary_flow_reuse_queue_rows, 1);
  assert.match(
    report.policy.identity_preflight_search_policy,
    /process_hybrid_search or flow_hybrid_search/u,
  );

  const indexRows = readJsonLines(path.join(repoRoot, report.files.identity_preflight_requests));
  assert.deepEqual(indexRows.map((row) => row.dataset_type).sort(), ["flow", "process"]);
  const processRequest = indexRows.find((row) => row.dataset_type === "process");
  assert.match(processRequest.command, /process identity-preflight/u);
  assert.equal(processRequest.remote_search.edge_request.endpoint, "process_hybrid_search");
  assert.match(processRequest.remote_search.query, /process name: Fixture process/u);
  assert.match(processRequest.remote_search.query, /reference flow: Methane/u);
  assert.match(processRequest.remote_search.query, /geography: CH/u);
  assert.doesNotMatch(processRequest.remote_search.query, /Fixture geography description/u);
  assert.doesNotMatch(processRequest.remote_search.query, new RegExp(flowId, "u"));
  assert.doesNotMatch(processRequest.remote_search.query, new RegExp(processId, "u"));
  assert.doesNotMatch(processRequest.remote_search.query, /reference flow:[^\n]*; 1(?:\n|$)/u);
  assert.doesNotMatch(processRequest.remote_search.query, /quantitative reference: 1(?:\n|$)/u);

  const elementaryQueue = readJsonLines(
    path.join(repoRoot, report.files.elementary_flow_reuse_queue),
  );
  assert.equal(
    elementaryQueue[0].identity_preflight_request_file,
    indexRows.find((row) => row.dataset_type === "flow").request_file,
  );
  assert.match(elementaryQueue[0].identity_preflight_command, /flow identity-preflight/u);
  assert.equal(elementaryQueue[0].remote_search.edge_request.endpoint, "flow_hybrid_search");
  assert.deepEqual(elementaryQueue[0].remote_search.edge_request.body.filter, {
    flowType: "Elementary flow",
  });
  assert.match(elementaryQueue[0].remote_search.query, /flow name: Methane/u);
  assert.match(elementaryQueue[0].remote_search.query, /flow type: Elementary flow/u);
  assert.doesNotMatch(elementaryQueue[0].remote_search.query, new RegExp(flowId, "u"));
  assert.match(
    elementaryQueue[0].remote_search.query,
    /category or compartment: Emissions > Emissions to air/u,
  );
  assert.match(elementaryQueue[0].remote_search.query, /CAS: 74-82-8/u);

  const request = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, elementaryQueue[0].identity_preflight_request_file),
      "utf8",
    ),
  );
  assert.equal(
    request.target.flowDataSet.flowInformation.dataSetInformation["common:UUID"],
    flowId,
  );
  assert.equal(request.remote_candidate_search.data_source, "tg");
  assert.equal(request.remote_candidate_search.limit, 80);
  assert.equal(request.remote_candidate_search.match_threshold, 0.15);
  assert.equal(request.remote_candidate_search.lexical_weight, 0.8);
  assert.equal(request.remote_candidate_search.semantic_weight, 0.2);
  assert.equal(request.remote_candidate_search.rrf_k, 30);
  assert.equal(elementaryQueue[0].remote_search.edge_request.body.match_threshold, 0.15);
  assert.equal(elementaryQueue[0].remote_search.edge_request.body.lexical_weight, 0.8);
  assert.equal("profile_hints" in elementaryQueue[0].remote_search.edge_request.body, false);
  assert.equal(request.remote_candidate_search.profile_hints.type_of_dataset, "Elementary flow");
  assert.equal(request.remote_candidate_search.profile_hints.flow_property[0], "Mass");
  assert.ok(request.remote_candidate_search.profile_hints);
});

test("dataset-bundle-sample-rows projects process geography into referenced flow location evidence", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-flow-location-context");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  const processPath = path.join(bundleDir, "tidas", "processes", `${processId}.json`);
  const processPayload = JSON.parse(fs.readFileSync(processPath, "utf8"));
  processPayload.processDataSet.exchanges = {
    exchange: {
      "@dataSetInternalID": "1",
      exchangeDirection: "Output",
      meanAmount: "1",
      referenceToFlowDataSet: {
        "@type": "flow data set",
        "@refObjectId": flowId,
        "@version": "00.00.001",
        "@uri": `../flows/${flowId}.json`,
        "common:shortDescription": ml("Fixture heat"),
      },
    },
  };
  writeJson(processPath, processPayload);
  writeJson(path.join(bundleDir, "tidas", "flows", `${flowId}.json`), {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          name: { baseName: ml("Fixture heat") },
          classificationInformation: {
            "common:classification": {
              "common:class": [{ "@level": "0", "@classId": "D", "#text": "Energy" }],
            },
          },
          "common:other": {
            "@xmlns:tidasimport": "https://tiangong.earth/tidas/import-trace/1.0",
            "tidasimport:sourceTrace": {
              "@marker": "TIDAS_IMPORT_TRACE_V1",
              payload: {
                source: {
                  name: "source",
                  attributes: [{ name: "citation", value: "Fixture source" }],
                },
              },
            },
          },
        },
      },
      modellingAndValidation: {
        LCIMethod: { typeOfDataSet: "Product flow" },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });
  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.flows.push(`tidas/flows/${flowId}.json`);
  writeJson(manifestPath, manifest);

  const report = runFoundry(
    [
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      path.join(fixtureRoot, "process-bundles"),
      "--process-id",
      processId,
      "--out-dir",
      outDir,
      "--contact-id",
      newContactId,
    ],
    1,
  );

  assert.equal(report.counts.flow_location_context_traces, 1);
  assert.equal(report.counts.flow_location_of_supply_missing_with_evidence, 1);
  assert.equal(report.counts.location_authoring_queue_rows, 1);
  const flows = readJsonLines(path.join(repoRoot, report.files.rows.flow));
  const trace =
    flows[0].flowDataSet.flowInformation.dataSetInformation["common:other"][
      "tidasimport:sourceTrace"
    ];
  const locationPayload = trace.payload.flowLocationEvidence ?? trace.payload;
  assert.equal(
    locationPayload.geography.attributes[0].name,
    "locationOfOperationSupplyOrProduction",
  );
  assert.equal(locationPayload.geography.attributes[0].value, "CH");
  assert.equal(locationPayload.exchange.attributes[0].value, flowId);
  const locationQueue = readJsonLines(path.join(repoRoot, report.files.location_authoring_queue));
  assert.equal(locationQueue[0].path, "flowDataSet.flowInformation.geography.locationOfSupply");
  assert.equal(locationQueue[0].suggested_location_code, "CH");
  assert.equal(
    locationQueue[0].evidence.candidates[0].evidence_source,
    "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
  );
});

test("dataset-identity-preflight-requests-build creates a fresh exact-row request index", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const outDir = path.join(fixtureRoot, "identity-preflight-requests-build");
  const rowsFile = path.join(fixtureRoot, "rows", "flows.jsonl");
  const row = {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          name: {
            baseName: ml("Mercury"),
          },
          classificationInformation: {
            "common:elementaryFlowCategorization": {
              "common:category": [
                { "@level": "0", "#text": "Emissions" },
                { "@level": "1", "#text": "Emissions to air" },
                { "@level": "2", "#text": "low population" },
              ],
            },
          },
        },
      },
      modellingAndValidation: {
        LCIMethod: {
          typeOfDataSet: "Elementary flow",
        },
      },
      flowProperties: {
        flowProperty: {
          referenceToFlowPropertyDataSet: {
            "common:shortDescription": ml("Mass"),
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
  writeJsonLines(rowsFile, [row]);

  const report = runFoundry([
    "dataset-identity-preflight-requests-build",
    "--type",
    "flow",
    "--rows-file",
    rowsFile,
    "--out-dir",
    outDir,
  ]);

  assert.equal(report.status, "ready");
  assert.equal(report.counts.request_rows, 1);
  const indexRows = readJsonLines(path.join(repoRoot, report.files.identity_preflight_requests));
  assert.equal(indexRows.length, 1);
  assert.equal(indexRows[0].dataset_type, "flow");
  assert.equal(indexRows[0].dataset_id, flowId);
  assert.match(indexRows[0].target_sha256, /^[a-f0-9]{64}$/u);
  assert.match(indexRows[0].request_bytes_sha256, /^[a-f0-9]{64}$/u);
  assert.match(indexRows[0].request_json_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(indexRows[0].command_spec.schema, "tiangong-foundry.command-spec.v1");
  assert.equal(typeof indexRows[0].command_spec.executable, "string");
  assert.equal(Array.isArray(indexRows[0].command_spec.argv), true);
  assert.match(indexRows[0].command_spec.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(indexRows[0].command_spec.binding.artifacts[0].role, "identity_preflight_request");
  assert.equal(indexRows[0].remote_search.edge_request.endpoint, "flow_hybrid_search");
  assert.deepEqual(indexRows[0].remote_search.edge_request.body.filter, {
    flowType: "Elementary flow",
  });
  assert.match(indexRows[0].remote_search.query, /flow name: Mercury/u);
  const request = JSON.parse(
    fs.readFileSync(path.join(repoRoot, indexRows[0].request_file), "utf8"),
  );
  assert.deepEqual(request.target, row);
  assert.equal(request.remote_candidate_search.limit, 80);
});

test("dataset-identity-preflight-query-audit passes complete fielded edge queries", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const outDir = path.join(fixtureRoot, "identity-preflight-query-audit-pass");
  const rowsFile = path.join(fixtureRoot, "rows", "flows.jsonl");
  const row = {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          name: {
            baseName: ml("Mercury"),
          },
          classificationInformation: {
            "common:elementaryFlowCategorization": {
              "common:category": [
                { "@level": "0", "#text": "Emissions" },
                { "@level": "1", "#text": "Emissions to air" },
                { "@level": "2", "#text": "low population" },
              ],
            },
          },
        },
      },
      modellingAndValidation: {
        LCIMethod: {
          typeOfDataSet: "Elementary flow",
        },
      },
      flowProperties: {
        flowProperty: {
          referenceToFlowPropertyDataSet: {
            "common:shortDescription": ml("Mass"),
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
  writeJsonLines(rowsFile, [row]);

  const build = runFoundry([
    "dataset-identity-preflight-requests-build",
    "--type",
    "flow",
    "--rows-file",
    rowsFile,
    "--out-dir",
    outDir,
  ]);
  const audit = runFoundry([
    "dataset-identity-preflight-query-audit",
    "--index",
    path.join(repoRoot, build.files.identity_preflight_requests),
    "--out-dir",
    path.join(fixtureRoot, "identity-preflight-query-audit-pass-report"),
  ]);

  assert.equal(audit.status, "passed");
  assert.equal(audit.counts.rows, 1);
  assert.equal(audit.counts.blockers, 0);
  assert.equal(audit.counts.warnings, 0);
  const rows = readJsonLines(path.join(repoRoot, audit.files.rows));
  assert.equal(rows[0].status, "passed");
  assert.deepEqual(rows[0].edge_request.filter, { flowType: "Elementary flow" });
});

test("dataset-identity-preflight-query-audit blocks incomplete or noisy search briefs", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const root = path.join(fixtureRoot, "identity-preflight-query-audit-block");
  const requestFile = path.join(root, "requests", "processes", `${processId}.json`);
  const indexFile = path.join(root, "identity-preflight-requests.jsonl");
  const query = [
    "process name: xx Li salt, hydrometallurgical processing Li-ion batteries, at plant {GLO}",
    "geography: GLO",
    "classification or sector: Not specified by the BAFU ecoSpold1 source.",
  ].join("\n");
  writeJson(requestFile, {
    schema_version: 1,
    target: { id: processId },
    remote_candidate_search: {
      enabled: true,
      query,
      data_source: "tg",
      limit: 20,
    },
  });
  writeJsonLines(indexFile, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      request_file: rel(requestFile),
      remote_search: {
        edge_request: {
          endpoint: "process_hybrid_search",
          body: {
            query,
            data_source: "tg",
            match_count: 20,
            page_size: 20,
          },
        },
      },
    },
  ]);

  const audit = runFoundry(
    [
      "dataset-identity-preflight-query-audit",
      "--index",
      rel(indexFile),
      "--out-dir",
      rel(path.join(root, "audit")),
    ],
    1,
  );

  assert.equal(audit.status, "blocked");
  assert.equal(audit.counts.rows, 1);
  assert.equal(audit.counts.blocked_rows, 1);
  assert.ok(
    audit.blockers.some(
      (blocker) =>
        blocker.code === "identity_preflight_query_required_label_missing" &&
        blocker.label === "reference flow",
    ),
  );
  assert.ok(
    audit.blockers.some(
      (blocker) =>
        blocker.code === "identity_preflight_query_noise" &&
        blocker.noise_code === "ecospold_location_in_name",
    ),
  );
  assert.ok(
    audit.blockers.some(
      (blocker) =>
        blocker.code === "identity_preflight_query_noise" &&
        blocker.noise_code === "not_specified_source_phrase",
    ),
  );
});

test("dataset-identity-preflight-run retains nonzero identity findings but fails the batch", () => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const runRoot = path.join(fixtureRoot, "identity-preflight-run");
  const fakeCli = path.join(runRoot, "fake-tiangong-lca.cjs");
  const requestRoot = path.join(runRoot, "identity-preflight-requests");
  const outputRoot = path.join(runRoot, "identity-preflight");
  const authReceiptFile = path.join(runRoot, "auth-identity-receipt.json");
  writeJson(authReceiptFile, testAuthIdentityReceipt());
  const processRequest = path.join(requestRoot, "processes", `${processId}.json`);
  const flowRequest = path.join(requestRoot, "flows", `${flowId}.json`);
  writeJson(processRequest, {
    schema_version: 1,
    target: { id: processId, name_en: "Process target" },
    remote_candidate_search: {
      enabled: true,
      query: "process name: Process target",
    },
  });
  writeJson(flowRequest, {
    schema_version: 1,
    target: {
      id: flowId,
      name_en: "Methane",
      type_of_dataset: "Elementary flow",
    },
    remote_candidate_search: {
      enabled: true,
      query: "flow name: Methane\nflow type: Elementary flow",
      filter: { flowType: "Elementary flow" },
    },
  });
  fs.mkdirSync(path.dirname(fakeCli), { recursive: true });
  fs.writeFileSync(
    fakeCli,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const kind = args[0];
const input = args[args.indexOf("--input") + 1];
const outDir = args[args.indexOf("--out-dir") + 1];
const request = JSON.parse(fs.readFileSync(input, "utf8"));
const outputs = path.join(outDir, "outputs");
fs.mkdirSync(outputs, { recursive: true });
const blocked = kind === "flow";
const report = {
  schema_version: 1,
  kind,
  status: blocked ? "blocked" : "passed",
  decision: blocked ? "block_duplicate" : "create_new",
  confidence: blocked ? "high" : "medium",
  target: {
    id: request.target.id,
    version: "00.00.001",
    names: [request.target.name_en],
    fields: { type_of_dataset: request.target.type_of_dataset || null },
    exchange_signature: [],
    schema_validation: { status: "passed", issue_count: 0, issues: [] }
  },
  candidates: blocked ? [{
    index: 0,
    id: "existing-flow",
    version: "00.00.001",
    state_code: 100,
    names: ["Methane"],
    fields: { type_of_dataset: "Elementary flow" },
    exchange_signature: [],
    identity_key: "methane|elementary",
    match_score: 100,
    match_reasons: ["equivalent_flow_core_fields"],
    decision_hint: "block_duplicate"
  }] : [],
  candidate_sources: [{ kind: "remote_search", row_count: blocked ? 1 : 0, scanned_files: [] }],
  findings: blocked ? [{ code: "flow_duplicate_candidate", severity: "blocker", message: "duplicate" }] : [],
  blockers: blocked ? [{ code: "flow_duplicate_candidate", severity: "blocker", message: "duplicate" }] : [],
  next_action: blocked ? "stop_duplicate" : "materialize_new_payload",
  files: {
    identity_decision: path.join(outputs, "identity-decision.json"),
    candidates: path.join(outputs, "identity-candidates.jsonl"),
    candidate_sources: path.join(outputs, "identity-candidate-sources.json")
  }
};
fs.writeFileSync(report.files.identity_decision, JSON.stringify(report, null, 2) + "\\n");
fs.writeFileSync(report.files.candidates, report.candidates.map((row) => JSON.stringify(row)).join("\\n") + (report.candidates.length ? "\\n" : ""));
fs.writeFileSync(report.files.candidate_sources, JSON.stringify(report.candidate_sources, null, 2) + "\\n");
console.log(JSON.stringify(report));
process.exit(blocked ? 1 : 0);
`,
  );
  fs.chmodSync(fakeCli, 0o755);
  const indexPath = path.join(requestRoot, "identity-preflight-requests.jsonl");
  writeJsonLines(indexPath, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      request_file: rel(processRequest),
      output_dir: rel(path.join(outputRoot, "processes", processId)),
      expected_report_file: rel(
        path.join(outputRoot, "processes", processId, "outputs", "identity-decision.json"),
      ),
    },
    {
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: "00.00.001",
      request_file: rel(flowRequest),
      output_dir: rel(path.join(outputRoot, "flows", flowId)),
      expected_report_file: rel(
        path.join(outputRoot, "flows", flowId, "outputs", "identity-decision.json"),
      ),
    },
  ]);

  const report = runFoundry(
    [
      "dataset-identity-preflight-run",
      "--index",
      rel(indexPath),
      "--out-dir",
      rel(path.join(runRoot, "batch-report")),
      "--timeout-ms",
      "45000",
      "--auth-receipt",
      rel(authReceiptFile),
      "--expected-project-ref",
      "qgzvkongdjqiiamzbbts",
      "--expected-user-id",
      "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    ],
    1,
    {
      TIANGONG_LCA_CLI_BIN: fakeCli,
      FOUNDRY_VERIFIED_PROJECT_REF: "qgzvkongdjqiiamzbbts",
      FOUNDRY_VERIFIED_USER_ID: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
    },
  );

  assert.equal(report.status, "failed");
  assert.equal(report.counts.selected_rows, 2);
  assert.equal(report.counts.completed, 1);
  assert.equal(report.counts.failed, 1);
  assert.equal(report.counts.identity_blocked, 1);
  assert.equal(report.counts.cli_exit_nonzero, 1);
  assert.equal(report.runtime_options.timeout_ms, 45000);
  assert.equal(
    report.results.every((row) => row.command.includes("--timeout-ms 45000")),
    true,
  );
  assert.equal(
    report.results.find((row) => row.dataset_type === "flow").decision,
    "block_duplicate",
  );
  assert.equal(
    report.results.find((row) => row.dataset_type === "flow").failure_code,
    "identity_preflight_cli_exit_nonzero",
  );
  assert.equal(
    fs.existsSync(path.join(outputRoot, "flows", flowId, "outputs", "identity-decision.json")),
    true,
  );
});

test("dataset-bundle-sample-rows repairs generic EcoSpold source identity from report metadata", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-source-identity");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  const sourcePath = path.join(bundleDir, "tidas", "sources", `${sourceId}.json`);
  const sourcePayload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const sourceInfo = sourcePayload.sourceDataSet.sourceInformation.dataSetInformation;
  sourceInfo["common:shortName"] = ml("Created for EcoSpold 1 compatibility");
  sourceInfo.sourceCitation = "Created for EcoSpold 1 compatibility";
  sourceInfo.sourceDescriptionOrComment = ml(
    "Steiner, R., Frischknecht, R. (2007) Life Cycle Inventories of Metal Processing and Compressed Air Supply. Final report ecoinvent Data v2.0.\\nFirst author: Steiner, R.\\nYear: 2007\\nOriginal title: Life Cycle Inventories of Metal Processing and Compressed Air Supply\\n",
  );
  writeJson(sourcePath, sourcePayload);

  const processPath = path.join(bundleDir, "tidas", "processes", `${processId}.json`);
  const processPayload = JSON.parse(fs.readFileSync(processPath, "utf8"));
  processPayload.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.referenceToDataSource =
    sourceRef(sourceId, "Created for EcoSpold 1 compatibility");
  writeJson(processPath, processPayload);

  const report = runFoundry([
    "dataset-bundle-sample-rows",
    "--bundles-dir",
    path.join(fixtureRoot, "process-bundles"),
    "--process-id",
    processId,
    "--out-dir",
    outDir,
    "--contact-id",
    newContactId,
  ]);

  assert.equal(report.status, "ready");
  assert.equal(report.counts.true_source_identity_repairs, 1);
  assert.equal(report.counts.true_source_reference_description_repairs, 1);

  const sources = readJsonLines(path.join(repoRoot, report.files.rows.source));
  const repairedSourceInfo = sources[0].sourceDataSet.sourceInformation.dataSetInformation;
  assert.equal(
    repairedSourceInfo["common:shortName"]["#text"],
    "2007 - Life Cycle Inventories of Metal Processing and Compressed Air Supply - Steiner",
  );
  assert.match(repairedSourceInfo.sourceCitation, /Life Cycle Inventories of Metal Processing/u);

  const processes = readJsonLines(path.join(repoRoot, report.files.rows.process));
  const processSourceRef =
    processes[0].processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness
      .referenceToDataSource;
  assert.equal(
    processSourceRef["common:shortDescription"]["#text"],
    repairedSourceInfo["common:shortName"]["#text"],
  );

  const repairRows = readJsonLines(path.join(repoRoot, report.files.source_classification_repairs));
  assert.equal(
    repairRows.some((row) => row.relation === "true_source_identity_from_description"),
    true,
  );
  const rewriteRows = readJsonLines(path.join(repoRoot, report.files.source_reference_rewrites));
  assert.equal(
    rewriteRows.some((row) => row.relation === "process_data_source_short_description"),
    true,
  );
});

test("dataset-bundle-sample-rows uses process Original source context over converted package source", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-process-source-context");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  const sourcePath = path.join(bundleDir, "tidas", "sources", `${sourceId}.json`);
  const sourcePayload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const sourceInfo = sourcePayload.sourceDataSet.sourceInformation.dataSetInformation;
  sourceInfo["common:shortName"] = ml("2023 - LCI on-road vehicles - Sacchi");
  sourceInfo.sourceCitation = "Sacchi R., 2023 - LCI on-road vehicles - Sacchi, 2023";
  sourceInfo.sourceDescriptionOrComment = ml("doi: 10.5281/ZENODO.5156043");
  writeJson(sourcePath, sourcePayload);

  const processPath = path.join(bundleDir, "tidas", "processes", `${processId}.json`);
  const processPayload = JSON.parse(fs.readFileSync(processPath, "utf8"));
  const originalSource =
    "Datasets for mobility applications. Original source: Tobias S. Schmidt, Martin Beuse, Xiaojin Zhang, Bjarne Steffen, Simon F. Schneider, Alejandro Pena-Bello, Christian Bauer, and David Parra, Additional Emissions and Cost from Storing Electricity in Stationary Battery Systems, Environmental Science & Technology 2019 53 (7), 3379-3390, doi: 10.1021/acs.est.8b05314.";
  processPayload.processDataSet.processInformation.dataSetInformation["common:generalComment"] = ml(
    `${originalSource} UUID: ${processId}`,
  );
  processPayload.processDataSet.processInformation.technology = {
    technologyDescriptionAndIncludedProcesses: ml(originalSource),
  };
  processPayload.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.dataCutOffAndCompletenessPrinciples =
    ml(originalSource);
  writeJson(processPath, processPayload);

  const report = runFoundry([
    "dataset-bundle-sample-rows",
    "--bundles-dir",
    path.join(fixtureRoot, "process-bundles"),
    "--process-id",
    processId,
    "--out-dir",
    outDir,
    "--contact-id",
    newContactId,
  ]);

  assert.equal(report.status, "ready");
  assert.equal(report.counts.source_rows, 1);
  assert.equal(report.counts.materialized_true_source_rows, 1);
  assert.equal(report.counts.process_source_context_rewrites, 1);
  assert.equal(report.counts.omitted_unreferenced_true_source_rows, 1);

  const sources = readJsonLines(path.join(repoRoot, report.files.rows.source));
  assert.equal(sources[0].sourceDataSet["@xmlns:xsi"], "http://www.w3.org/2001/XMLSchema-instance");
  assert.equal(
    sources[0].sourceDataSet["@xsi:schemaLocation"],
    "http://lca.jrc.it/ILCD/Source ../../schemas/ILCD_SourceDataSet.xsd",
  );
  const sourceInfoOut = sources[0].sourceDataSet.sourceInformation.dataSetInformation;
  assert.notEqual(sourceInfoOut["common:UUID"], sourceId);
  assert.equal(
    sourceInfoOut["common:shortName"]["#text"],
    "2019 - Additional Emissions and Cost from Storing Electricity in Stationary Battery Systems - Schmidt",
  );
  assert.match(sourceInfoOut.sourceCitation, /10\.1021\/acs\.est\.8b05314/u);
  assert.match(sourceInfoOut.sourceDescriptionOrComment["#text"], /Environmental Science/u);

  const processes = readJsonLines(path.join(repoRoot, report.files.rows.process));
  const processSourceRef =
    processes[0].processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness
      .referenceToDataSource;
  assert.equal(processSourceRef["@refObjectId"], sourceInfoOut["common:UUID"]);
  assert.equal(
    processSourceRef["common:shortDescription"]["#text"],
    sourceInfoOut["common:shortName"]["#text"],
  );

  const rewrites = readJsonLines(path.join(repoRoot, report.files.source_reference_rewrites));
  assert.equal(
    rewrites.some(
      (row) =>
        row.relation === "process_data_source_context_source" &&
        row.original.ref_object_id === sourceId &&
        row.canonical.ref_object_id === sourceInfoOut["common:UUID"],
    ),
    true,
  );
  const semantics = readJsonLines(path.join(repoRoot, report.files.source_semantics));
  assert.equal(
    semantics.some(
      (row) =>
        row.dataset_id === sourceId &&
        row.omitted_reason === "unreferenced_by_selected_process_scope",
    ),
    true,
  );
});

test("dataset-bundle-sample-rows omits format and compliance placeholder sources", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-source-semantics");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  const formatSourcePath = path.join(bundleDir, "tidas", "sources", `${formatSourceId}.json`);
  const complianceSourcePath = path.join(
    bundleDir,
    "tidas",
    "sources",
    `${complianceSourceId}.json`,
  );
  writeJson(formatSourcePath, {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": formatSourceId,
          "common:shortName": ml("ILCD format"),
          classificationInformation: {
            "common:classification": {
              "common:class": {
                "@level": "0",
                "@classId": "1",
                "#text": "Data set formats",
              },
            },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });
  writeJson(complianceSourcePath, {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": complianceSourceId,
          "common:shortName": ml("Not specified"),
          classificationInformation: {
            "common:classification": {
              "common:class": {
                "@level": "0",
                "@classId": "3",
                "#text": "Compliance systems",
              },
            },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });

  const processPath = path.join(bundleDir, "tidas", "processes", `${processId}.json`);
  const processPayload = JSON.parse(fs.readFileSync(processPath, "utf8"));
  processPayload.processDataSet.administrativeInformation.dataEntryBy[
    "common:referenceToDataSetFormat"
  ] = sourceRef(formatSourceId, "ILCD format");
  processPayload.processDataSet.modellingAndValidation.complianceDeclarations = {
    compliance: {
      "common:referenceToComplianceSystem": sourceRef(complianceSourceId, "Not specified"),
    },
  };
  writeJson(processPath, processPayload);

  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.sources.push(
    `tidas/sources/${formatSourceId}.json`,
    `tidas/sources/${complianceSourceId}.json`,
  );
  writeJson(manifestPath, manifest);

  const report = runFoundry([
    "dataset-bundle-sample-rows",
    "--bundles-dir",
    path.join(fixtureRoot, "process-bundles"),
    "--process-id",
    processId,
    "--out-dir",
    outDir,
    "--contact-id",
    newContactId,
  ]);

  assert.equal(report.status, "ready");
  assert.equal(report.counts.source_semantics_rows, 3);
  assert.equal(report.counts.source_rows, 1);
  assert.equal(report.counts.support_rows, 2);
  assert.equal(report.counts.true_source_rows, 1);
  assert.equal(report.counts.format_support_source_rows, 1);
  assert.equal(report.counts.compliance_support_source_rows, 1);
  assert.equal(report.counts.omitted_non_true_source_rows, 2);
  assert.equal(report.counts.source_reference_rewrite_rows, 3);

  const sources = readJsonLines(path.join(repoRoot, report.files.rows.source));
  assert.equal(sources.length, 1);
  assert.equal(
    sources[0].sourceDataSet.sourceInformation.dataSetInformation["common:UUID"],
    sourceId,
  );
  assert.equal(JSON.stringify(sources).includes("ILCD format"), false);
  assert.equal(JSON.stringify(sources).includes("Not specified"), false);

  const contacts = readJsonLines(path.join(repoRoot, report.files.rows.contact));
  assert.equal(
    contacts[0].contactDataSet.administrativeInformation.dataEntryBy["common:timeStamp"],
    "2025-01-01T00:00:00.000Z",
  );
  assert.equal(
    contacts[0].contactDataSet.administrativeInformation.dataEntryBy[
      "common:referenceToDataSetFormat"
    ]["@refObjectId"],
    canonicalIlcdFormatSourceId,
  );

  const processes = readJsonLines(path.join(repoRoot, report.files.rows.process));
  const dataEntryBy = processes[0].processDataSet.administrativeInformation.dataEntryBy;
  assert.equal(
    dataEntryBy["common:referenceToDataSetFormat"]["@refObjectId"],
    canonicalIlcdFormatSourceId,
  );
  assert.equal(dataEntryBy["common:referenceToDataSetFormat"]["@version"], "03.00.003");
  const compliance =
    processes[0].processDataSet.modellingAndValidation.complianceDeclarations.compliance;
  assert.equal(
    compliance["common:referenceToComplianceSystem"]["@refObjectId"],
    canonicalComplianceSourceId,
  );
  assert.equal(compliance["common:referenceToComplianceSystem"]["@version"], "20.20.002");

  const sourceSemantics = readJsonLines(path.join(repoRoot, report.files.source_semantics));
  assert.deepEqual(
    sourceSemantics.map((row) => [row.dataset_id, row.kind, row.materialized_as_source_row]),
    [
      [sourceId, "true_source", true],
      [formatSourceId, "format_support_source", false],
      [complianceSourceId, "compliance_support_source", false],
    ],
  );
  const rewrites = readJsonLines(path.join(repoRoot, report.files.source_reference_rewrites));
  assert.deepEqual(
    rewrites.map((row) => [row.relation, row.original.ref_object_id, row.canonical.ref_object_id]),
    [
      [
        "dataset_format_source",
        "16938856-0a35-5654-8aff-56c17e61da4d",
        canonicalIlcdFormatSourceId,
      ],
      ["dataset_format_source", formatSourceId, canonicalIlcdFormatSourceId],
      ["compliance_system_source", complianceSourceId, canonicalComplianceSourceId],
    ],
  );
});

// FIX C (support closure): under the account-local override (USLCI), a non-true_source
// referenced by the process via a path with no canonical mapping
// (validation/review/referenceToCompleteReviewReport) must be RETAINED in the
// materialized support set so it commits as account-local support before the process
// finalize, instead of being dropped and leaving a dangling reference that blocks
// process.finalize on reference_closure_unproven. BAFU (override off) is exercised by
// the "omits format and compliance placeholder sources" test above and stays unchanged.
test("dataset-bundle-sample-rows retains a referenced review-report support source under the account-local override", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-review-report-retention");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);

  // A "Data set formats" source cited by the process as its complete review report.
  // referenceToCompleteReviewReport is NOT one of the canonical-rewritten relations,
  // so the reference survives and the source must be committed account-local.
  const reviewReportSourcePath = path.join(bundleDir, "tidas", "sources", `${formatSourceId}.json`);
  writeJson(reviewReportSourcePath, {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": formatSourceId,
          "common:shortName": ml("External LCA source metadata"),
          classificationInformation: {
            "common:classification": {
              "common:class": {
                "@level": "0",
                "@classId": "1",
                "#text": "Data set formats",
              },
            },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });

  const processPath = path.join(bundleDir, "tidas", "processes", `${processId}.json`);
  const processPayload = JSON.parse(fs.readFileSync(processPath, "utf8"));
  processPayload.processDataSet.modellingAndValidation.validation = {
    review: {
      "@type": "Independent internal review",
      "common:referenceToCompleteReviewReport": sourceRef(
        formatSourceId,
        "External LCA source metadata",
      ),
    },
  };
  writeJson(processPath, processPayload);

  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.sources.push(`tidas/sources/${formatSourceId}.json`);
  writeJson(manifestPath, manifest);

  const report = runFoundry([
    "dataset-bundle-sample-rows",
    "--bundles-dir",
    path.join(fixtureRoot, "process-bundles"),
    "--process-id",
    processId,
    "--out-dir",
    outDir,
    "--contact-id",
    newContactId,
    "--profile",
    "uslci",
  ]);

  assert.equal(report.status, "ready");
  // The fixture true source (referenceToDataSource) plus the retained review-report
  // format source both materialize as source rows.
  assert.equal(report.counts.retained_referenced_account_local_support_source_rows, 1);

  const sources = readJsonLines(path.join(repoRoot, report.files.rows.source));
  const sourceIds = sources.map(
    (row) => row.sourceDataSet.sourceInformation.dataSetInformation["common:UUID"],
  );
  assert.ok(
    sourceIds.includes(formatSourceId),
    "review-report format source must be retained in the materialized source/support set",
  );
  assert.ok(sourceIds.includes(sourceId), "the true data source must still materialize");

  // The process keeps its hard reference to the retained review-report source — it is
  // NOT rewritten to a canonical id, so it must travel as account-local support.
  const processes = readJsonLines(path.join(repoRoot, report.files.rows.process));
  assert.equal(
    processes[0].processDataSet.modellingAndValidation.validation.review[
      "common:referenceToCompleteReviewReport"
    ]["@refObjectId"],
    formatSourceId,
  );

  const sourceSemantics = readJsonLines(path.join(repoRoot, report.files.source_semantics));
  const reviewSemantics = sourceSemantics.find((row) => row.dataset_id === formatSourceId);
  assert.equal(reviewSemantics.materialized_as_source_row, true);
  assert.equal(reviewSemantics.retained_reason, "referenced_account_local_support_source");
});

test("dataset-bundle-sample-rows rewrites placeholder process data sources to the unique true source", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-process-source-placeholder");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  const complianceSourcePath = path.join(
    bundleDir,
    "tidas",
    "sources",
    `${complianceSourceId}.json`,
  );
  writeJson(complianceSourcePath, {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": complianceSourceId,
          "common:shortName": ml("Not specified"),
          classificationInformation: {
            "common:classification": {
              "common:class": {
                "@level": "0",
                "@classId": "3",
                "#text": "Compliance systems",
              },
            },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });

  const processPath = path.join(bundleDir, "tidas", "processes", `${processId}.json`);
  const processPayload = JSON.parse(fs.readFileSync(processPath, "utf8"));
  processPayload.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.referenceToDataSource =
    sourceRef(complianceSourceId, "Not specified");
  writeJson(processPath, processPayload);

  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.sources.push(`tidas/sources/${complianceSourceId}.json`);
  writeJson(manifestPath, manifest);

  const report = runFoundry([
    "dataset-bundle-sample-rows",
    "--bundles-dir",
    path.join(fixtureRoot, "process-bundles"),
    "--process-id",
    processId,
    "--out-dir",
    outDir,
    "--contact-id",
    newContactId,
  ]);

  assert.equal(report.status, "ready");
  assert.equal(report.counts.source_rows, 1);
  assert.equal(report.counts.compliance_support_source_rows, 1);
  assert.equal(report.counts.omitted_non_true_source_rows, 1);
  assert.equal(report.counts.process_source_reference_rewrites, 1);
  assert.equal(report.counts.process_source_reference_fallback_rewrites, 0);
  assert.equal(report.blockers.length, 0);

  const sources = readJsonLines(path.join(repoRoot, report.files.rows.source));
  assert.deepEqual(
    sources.map((row) => row.sourceDataSet.sourceInformation.dataSetInformation["common:UUID"]),
    [sourceId],
  );
  const sourceReferences = readJsonLines(
    path.join(repoRoot, report.files.process_source_references),
  );
  assert.equal(sourceReferences[0].referenced_source_kind, "true_source");
  assert.equal(sourceReferences[0].ref_object_id, sourceId);
  const sourceReferenceRewrites = readJsonLines(
    path.join(repoRoot, report.files.source_reference_rewrites),
  );
  assert.equal(
    sourceReferenceRewrites.some(
      (row) =>
        row.relation === "process_data_source_true_source" &&
        row.original.ref_object_id === complianceSourceId &&
        row.canonical.ref_object_id === sourceId,
    ),
    true,
  );
});

test("dataset-bundle-sample-rows creates a BAFU database fallback source when no true source evidence exists", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-process-source-fallback");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  const sourcePath = path.join(bundleDir, "tidas", "sources", `${sourceId}.json`);
  const sourcePayload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const sourceInfo = sourcePayload.sourceDataSet.sourceInformation.dataSetInformation;
  sourceInfo["common:shortName"] = ml("Not specified");
  sourceInfo.sourceCitation = "Not specified";
  sourceInfo.sourceDescriptionOrComment = ml("No source metadata available.");
  writeJson(sourcePath, sourcePayload);

  const report = runFoundry([
    "dataset-bundle-sample-rows",
    "--bundles-dir",
    path.join(fixtureRoot, "process-bundles"),
    "--process-id",
    processId,
    "--out-dir",
    outDir,
    "--contact-id",
    newContactId,
  ]);

  assert.equal(report.status, "ready");
  assert.equal(report.counts.source_rows, 1);
  assert.equal(report.counts.true_source_rows, 1);
  assert.equal(report.counts.placeholder_or_unspecified_source_rows, 1);
  assert.equal(report.counts.process_source_reference_rewrites, 1);
  assert.equal(report.counts.process_source_reference_fallback_rewrites, 1);

  const sources = readJsonLines(path.join(repoRoot, report.files.rows.source));
  assert.equal(sources[0].sourceDataSet["@xmlns:xsi"], "http://www.w3.org/2001/XMLSchema-instance");
  assert.equal(
    sources[0].sourceDataSet["@xsi:schemaLocation"],
    "http://lca.jrc.it/ILCD/Source ../../schemas/ILCD_SourceDataSet.xsd",
  );
  const sourceInfoOut = sources[0].sourceDataSet.sourceInformation.dataSetInformation;
  assert.equal(sourceInfoOut["common:shortName"]["#text"], "BAFU 2025 Version 2 LCA database");
  assert.equal(sourceInfoOut.sourceCitation.includes("FOEN"), true);
  assert.equal(
    sourceInfoOut.classificationInformation["common:classification"]["common:class"]["#text"],
    "Databases",
  );
  const sourceReferences = readJsonLines(
    path.join(repoRoot, report.files.process_source_references),
  );
  assert.equal(sourceReferences[0].short_description, "BAFU 2025 Version 2 LCA database");
  const sourceReferenceRewrites = readJsonLines(
    path.join(repoRoot, report.files.source_reference_rewrites),
  );
  assert.equal(
    sourceReferenceRewrites.some((row) => row.relation === "process_data_source_fallback_database"),
    true,
  );
});

test("dataset-bundle-sample-rows omits placeholder source identities even when citation-like fields exist", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-source-placeholders");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  const placeholderPath = path.join(
    bundleDir,
    "tidas",
    "sources",
    `${placeholderCitationSourceId}.json`,
  );
  const genericPath = path.join(
    bundleDir,
    "tidas",
    "sources",
    `${genericUnrepairableSourceId}.json`,
  );
  writeJson(placeholderPath, {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": placeholderCitationSourceId,
          "common:shortName": ml("Not specified"),
          classificationInformation: {
            "common:classification": {
              "common:class": {
                "@level": "0",
                "@classId": "5",
                "#text": "Other source types",
              },
            },
          },
          sourceCitation: "Not specified",
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });
  writeJson(genericPath, {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": genericUnrepairableSourceId,
          "common:shortName": ml("Created for EcoSpold 1 compatibility"),
          classificationInformation: {
            "common:classification": {
              "common:class": {
                "@level": "0",
                "@classId": "5",
                "#text": "Other source types",
              },
            },
          },
          sourceCitation: "Created for EcoSpold 1 compatibility",
          sourceDescriptionOrComment: ml("No report metadata available."),
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });

  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.sources.push(
    `tidas/sources/${placeholderCitationSourceId}.json`,
    `tidas/sources/${genericUnrepairableSourceId}.json`,
  );
  writeJson(manifestPath, manifest);

  const report = runFoundry([
    "dataset-bundle-sample-rows",
    "--bundles-dir",
    path.join(fixtureRoot, "process-bundles"),
    "--process-id",
    processId,
    "--out-dir",
    outDir,
    "--contact-id",
    newContactId,
  ]);

  assert.equal(report.status, "ready");
  assert.equal(report.counts.source_semantics_rows, 3);
  assert.equal(report.counts.source_rows, 1);
  assert.equal(report.counts.omitted_non_true_source_rows, 2);

  const sources = readJsonLines(path.join(repoRoot, report.files.rows.source));
  assert.deepEqual(
    sources.map((row) => row.sourceDataSet.sourceInformation.dataSetInformation["common:UUID"]),
    [sourceId],
  );

  const sourceSemantics = readJsonLines(path.join(repoRoot, report.files.source_semantics));
  const byId = new Map(sourceSemantics.map((row) => [row.dataset_id, row]));
  assert.equal(byId.get(placeholderCitationSourceId).kind, "placeholder_or_unspecified_source");
  assert.equal(byId.get(placeholderCitationSourceId).materialized_as_source_row, false);
  assert.equal(byId.get(genericUnrepairableSourceId).kind, "unresolved_source_semantics");
  assert.equal(byId.get(genericUnrepairableSourceId).materialized_as_source_row, false);
});

test("dataset-bundle-sample-rows blocks converted default process classification and cleans reference names", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-quality");
  const processPath = path.join(
    fixtureRoot,
    "process-bundles",
    processId,
    "tidas",
    "processes",
    `${processId}.json`,
  );
  const processPayload = JSON.parse(fs.readFileSync(processPath, "utf8"));
  const dataSetInformation = processPayload.processDataSet.processInformation.dataSetInformation;
  dataSetInformation.classificationInformation = {
    "common:classification": {
      "common:class": [
        { "@level": "0", "@classId": "T", "#text": "Other service activities" },
        {
          "@level": "1",
          "@classId": "94",
          "#text": "Activities of membership organizations",
        },
        {
          "@level": "2",
          "@classId": "949",
          "#text": "Activities of other membership organizations",
        },
        {
          "@level": "3",
          "@classId": "9499",
          "#text": "Activities of other membership organizations n.e.c.",
        },
      ],
    },
  };
  dataSetInformation["common:other"] = {
    "@xmlns:tidasimport": "https://tiangong.earth/tidas/import-trace/1.0",
    "tidasimport:sourceTrace": {
      payload: {
        sourceClassification: {
          category: "material, obsolete",
          subCategory:
            "agricultural, obsolete\\animal production, obsolete\\animal foods, obsolete",
        },
        dataset: {
          name: "dataset",
          attributes: [
            { name: "name", value: "xx Fava beans IP, at feed mill {GLO}" },
            { name: "unit", value: "kg" },
          ],
        },
      },
    },
  };
  processPayload.processDataSet.processInformation.geography = {
    locationOfOperationSupplyOrProduction: {
      "@location": "Invalid region",
    },
  };
  processPayload.processDataSet.exchanges = {
    exchange: {
      referenceToFlowDataSet: {
        "@type": "flow data set",
        "@refObjectId": "flow-1",
        "@version": "00.00.001",
        "common:shortDescription": ml("xx Fava beans IP, at feed mill {GLO}"),
      },
    },
  };
  writeJson(processPath, processPayload);
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  const flowPath = path.join(bundleDir, "tidas", "flows", `${flowId}.json`);
  writeJson(flowPath, {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          typeOfDataSet: "Product flow",
          name: { baseName: ml("Fixture flow") },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                {
                  "@level": "0",
                  "@classId": "0",
                  "#text": "Community, social and personal services",
                },
                {
                  "@level": "1",
                  "@classId": "90",
                  "#text":
                    "Sewage and waste collection, treatment and disposal and other environmental protection services",
                },
                {
                  "@level": "2",
                  "@classId": "9000",
                  "#text": "Other environmental protection services n.e.c.",
                },
              ],
            },
          },
        },
        geography: {
          locationOfSupply: "Invalid supply region",
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });
  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.flows = [`tidas/flows/${flowId}.json`];
  writeJson(manifestPath, manifest);

  const report = runFoundry(
    [
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      path.join(fixtureRoot, "process-bundles"),
      "--process-id",
      processId,
      "--out-dir",
      outDir,
      "--contact-id",
      newContactId,
    ],
    1,
  );

  assert.equal(report.status, "blocked");
  assert.equal(report.counts.default_process_classification_blockers, 1);
  assert.equal(report.counts.default_flow_classification_blockers, 1);
  assert.equal(report.counts.classification_authoring_queue_rows, 2);
  assert.equal(report.counts.location_code_blockers, 2);
  assert.equal(report.counts.location_authoring_queue_rows, 2);
  assert.equal(report.counts.process_scopes_ready, 0);
  assert.equal(report.counts.process_scopes_needs_ai_authoring, 1);
  assert.equal(report.counts.process_scopes_blocked_deferred, 0);
  assert.ok(
    report.blockers.some((blocker) => blocker.code === "process_classification_requires_authoring"),
  );
  assert.ok(
    report.blockers.some((blocker) => blocker.code === "flow_classification_requires_authoring"),
  );
  assert.ok(report.blockers.some((blocker) => blocker.code === "location_code_requires_authoring"));

  const queue = readJsonLines(path.join(repoRoot, report.files.classification_authoring_queue));
  const processScopeLedger = readJsonLines(path.join(repoRoot, report.files.process_scope_ledger));
  assert.equal(processScopeLedger[0].status, "needs_ai_authoring");
  assert.equal(
    processScopeLedger[0].blocker_counts_by_code.process_classification_requires_authoring,
    1,
  );
  const processQueueRow = queue.find((row) => row.dataset_type === "process");
  const flowQueueRow = queue.find((row) => row.dataset_type === "flow");
  assert.equal(processQueueRow.source_classification.category, "material, obsolete");
  assert.match(
    processQueueRow.classification_workflow.commands.children_root,
    /dataset classification children --type process/u,
  );
  assert.match(
    processQueueRow.classification_workflow.commands.apply,
    /dataset classification apply/u,
  );
  assert.equal(flowQueueRow.classification_workflow.schema_type, "flow-product");
  assert.equal(flowQueueRow.classification_workflow.row_type, "flow");
  assert.match(
    flowQueueRow.classification_workflow.commands.children_root,
    /dataset classification children --type flow-product/u,
  );
  assert.match(
    flowQueueRow.classification_workflow.commands.apply,
    /dataset classification apply .* --type flow-product/u,
  );
  assert.match(flowQueueRow.classification_workflow.commands.input_rows, /rows\/flows\.jsonl$/u);
  assert.match(
    flowQueueRow.classification_workflow.commands.output_rows,
    /rows\/flows\.classified\.jsonl$/u,
  );

  const locationQueue = readJsonLines(path.join(repoRoot, report.files.location_authoring_queue));
  assert.ok(locationQueue.some((row) => row.current_location === "Invalid region"));
  assert.ok(
    locationQueue.some(
      (row) =>
        row.dataset_type === "flow" &&
        row.path === "flowDataSet.flowInformation.geography.locationOfSupply" &&
        row.current_location === "Invalid supply region",
    ),
  );
  assert.match(
    locationQueue[0].location_workflow.commands.audit,
    /dataset classification audit --type location/u,
  );
  assert.match(locationQueue[0].location_workflow.commands.apply, /dataset classification apply/u);

  const processes = readJsonLines(path.join(repoRoot, report.files.rows.process));
  const shortDescription =
    processes[0].processDataSet.exchanges.exchange.referenceToFlowDataSet[
      "common:shortDescription"
    ]["#text"];
  assert.equal(shortDescription, "Fava beans IP, at feed mill");
});

test("dataset-bundle-sample-rows materializes lifecyclemodels and queues location coding", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-lifecyclemodel-location");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  const lifecyclemodelPath = path.join(
    bundleDir,
    "tidas",
    "lifecyclemodels",
    `${lifecyclemodelId}.json`,
  );
  writeJson(lifecyclemodelPath, {
    lifeCycleModelDataSet: {
      lifeCycleModelInformation: {
        dataSetInformation: {
          "common:UUID": lifecyclemodelId,
          name: { baseName: ml("Fixture lifecycle model") },
        },
        technology: {
          processes: {
            processInstance: {
              connections: {
                outputExchange: {
                  downstreamProcess: {
                    "@location": "Invalid lifecycle region",
                  },
                },
              },
            },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });
  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.lifecyclemodels = [`tidas/lifecyclemodels/${lifecyclemodelId}.json`];
  writeJson(manifestPath, manifest);

  const report = runFoundry(
    [
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      path.join(fixtureRoot, "process-bundles"),
      "--process-id",
      processId,
      "--out-dir",
      outDir,
      "--contact-id",
      newContactId,
    ],
    1,
  );

  assert.equal(report.status, "blocked");
  assert.equal(report.counts.lifecyclemodel_rows, 1);
  assert.equal(report.counts.location_code_blockers, 1);
  assert.equal(report.counts.location_authoring_queue_rows, 1);
  assert.match(report.commands.lifecyclemodel.dry_run, /lifecyclemodel save-draft/u);
  assert.doesNotMatch(
    report.commands.lifecyclemodel.dry_run,
    /dataset save-draft --input .* --type lifecyclemodel/u,
  );

  const lifecyclemodels = readJsonLines(path.join(repoRoot, report.files.rows.lifecyclemodel));
  assert.equal(lifecyclemodels.length, 1);
  assert.equal(
    lifecyclemodels[0].lifeCycleModelDataSet.lifeCycleModelInformation.dataSetInformation[
      "common:UUID"
    ],
    lifecyclemodelId,
  );

  const locationQueue = readJsonLines(path.join(repoRoot, report.files.location_authoring_queue));
  assert.equal(locationQueue[0].dataset_type, "lifecyclemodel");
  assert.equal(locationQueue[0].dataset_id, lifecyclemodelId);
  assert.equal(locationQueue[0].dataset_version, "00.00.001");
  assert.equal(
    locationQueue[0].path,
    "lifeCycleModelDataSet.lifeCycleModelInformation.technology.processes.processInstance.connections.outputExchange.downstreamProcess.@location",
  );
  assert.equal(locationQueue[0].current_location, "Invalid lifecycle region");
});

test("dataset-bundle-sample-rows queues missing flow locationOfSupply from name mix location code", () => {
  createBundleFixture();
  const outDir = path.join(fixtureRoot, "out-flow-location-saturation");
  const bundleDir = path.join(fixtureRoot, "process-bundles", processId);
  writeJson(path.join(bundleDir, "tidas", "flows", `${flowId}.json`), {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          typeOfDataSet: "Product flow",
          name: {
            baseName: ml("Fixture market flow"),
            mixAndLocationTypes: ml("CH"),
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                {
                  "@level": "0",
                  "@classId": "0",
                  "#text": "Community, social and personal services",
                },
                {
                  "@level": "1",
                  "@classId": "90",
                  "#text":
                    "Sewage and waste collection, treatment and disposal and other environmental protection services",
                },
              ],
            },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  });
  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.flows = [`tidas/flows/${flowId}.json`];
  writeJson(manifestPath, manifest);

  const report = runFoundry(
    [
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      path.join(fixtureRoot, "process-bundles"),
      "--process-id",
      processId,
      "--out-dir",
      outDir,
      "--contact-id",
      newContactId,
    ],
    1,
  );

  assert.equal(report.status, "blocked");
  assert.equal(report.counts.flow_location_of_supply_missing_with_evidence, 1);
  assert.equal(report.counts.flow_location_of_supply_auto_decision_candidates, 1);
  assert.equal(report.counts.location_authoring_queue_rows, 1);
  assert.ok(
    report.blockers.some(
      (blocker) =>
        blocker.code === "flow_location_of_supply_requires_authoring" &&
        blocker.suggested_location_code === "CH",
    ),
  );

  const locationQueue = readJsonLines(path.join(repoRoot, report.files.location_authoring_queue));
  assert.equal(locationQueue.length, 1);
  assert.equal(locationQueue[0].dataset_type, "flow");
  assert.equal(locationQueue[0].dataset_id, flowId);
  assert.equal(locationQueue[0].path, "flowDataSet.flowInformation.geography.locationOfSupply");
  assert.equal(locationQueue[0].suggested_location_code, "CH");
  assert.equal(locationQueue[0].evidence.reason, "single_valid_location_candidate");
  assert.equal(
    locationQueue[0].evidence.candidates[0].evidence_source,
    "flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes",
  );
});
