import assert from "node:assert/strict";
import test from "node:test";
import * as authoring from "../../scripts/lib/import-curation/internal/workflow-authoring-tasks.mjs";
import * as evidence from "../../scripts/lib/import-curation/internal/workflow-patch-evidence.mjs";
import * as semantic from "../../scripts/lib/import-curation/internal/workflow-semantic-actions.mjs";

test("authoring patch-set and operation helpers preserve aliases, evidence, resolution, context, and native cycle errors", () => {
  const operations = [{ op: "replace", path: "/field" }];
  assert.equal(authoring.patchSetOperations({ operations }), operations);
  assert.equal(authoring.patchSetOperations({ patches: operations }), operations);
  assert.equal(authoring.patchSetOperations({ operations: [null] }), null);
  assert.equal(authoring.patchSetOperations([]), null);
  assert.deepEqual(authoring.patchPayloadPatchSets({ patchSets: [{ id: 1 }] }), [{ id: 1 }]);
  assert.deepEqual(authoring.patchPayloadPatchSets({ operations }), [{ operations }]);
  assert.equal(authoring.patchSetDatasetId({ dataset_id: " id ", id: "ignored" }), "id");
  assert.equal(authoring.patchSetDatasetVersion({ version: "" }), "00.00.001");
  assert.equal(
    authoring.patchSetAuthoringPackage({ authoringPackage: " package.json " }),
    "package.json",
  );
  assert.equal(authoring.operationHasEvidence({ basis: " source " }), true);
  assert.equal(authoring.operationHasEvidence({ evidence: { source: "x" } }), true);
  assert.equal(authoring.operationHasEvidence({ evidence: {} }), false);
  assert.equal(
    authoring.operationResolution({ resolution: { mode: "source_trace_verified" } }).mode,
    "source_trace_verified",
  );
  assert.equal(authoring.operationResolution({ resolution: [] }), null);
  assert.equal(
    authoring.operationResolutionMode({ resolution: { mode: " verified " } }),
    "verified",
  );
  assert.deepEqual(
    authoring.operationUsedContextKinds({
      resolution: { usedContextKinds: [" schema ", "", "schema"] },
    }),
    ["schema", "schema"],
  );
  const task = {
    context: {
      contract_context_files: [{ kind: "schema" }, { kind: "ruleset" }],
      full_context_ai_completion: { required_context_kinds: ["schema", "methodology_yaml"] },
    },
  };
  assert.deepEqual(authoring.taskRequiredContextKinds(task), ["schema", "methodology_yaml"]);
  assert.equal(
    authoring.taskRequiresFullContextEvidence({
      context: { fullContextAiCompletion: { required: true } },
    }),
    true,
  );
  assert.equal(authoring.operationTouchesCommonOther({ path: "/common:other/value" }), true);
  assert.equal(
    authoring.operationTouchesCommonOther({ value: { "tiangongfoundry:trace": true } }),
    true,
  );
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(
    () => authoring.operationTouchesCommonOther({ value: circular }),
    (error: unknown) => error instanceof TypeError,
  );
  assert.equal(authoring.shellQuote("a'b"), "'a'\\''b'");
});

test("semantic pointer, action closure, resolution modes, text and shared-context helpers preserve order", () => {
  assert.equal(semantic.jsonPointerToken("a~/b"), "a~0~1b");
  assert.equal(semantic.dotPathToJsonPointer("root.items.0.#text"), "/root/items/0/#text");
  assert.deepEqual(semantic.actionItemClosure({ ruleId: " code ", path: " /field " }), {
    code: "code",
    path: "/field",
  });
  assert.equal(semantic.allowedPatchResolutionModes.has("deferred_to_common_other"), true);
  assert.deepEqual(semantic.actionItemResolutionModes({ code: "classification_missing" }), [
    "classification_decision",
  ]);
  assert.deepEqual(semantic.actionItemResolutionModes({ code: "location_missing" }), [
    "location_decision",
  ]);
  assert.equal(
    semantic.actionItemAllowsCommonOtherDeferral({
      code: "annual_supply_or_production_volume_missing",
    }),
    true,
  );
  assert.equal(semantic.isPlaceholderishText("unknown"), true);
  assert.equal(semantic.hasMeaningfulFieldValue({ "#text": " value " }), true);
  assert.deepEqual(semantic.multiLangSuggestion(" text ", "ZH"), {
    "@xml:lang": "zh",
    "#text": "text",
  });
  assert.equal(semantic.markdownList(["a", "b"]), "- a\n- b");
  assert.equal(semantic.markdownList([], "fallback"), "fallback");
  assert.deepEqual(
    semantic.requiredFullContextKinds({ requiredContextKinds: [" schema ", "schema"] }),
    ["schema", "schema"],
  );
  assert.equal(semantic.contextSummaryHasKind([{ kind: "schema", text: "{}" }], "schema"), true);
  assert.equal(
    semantic.contextSummaryHasPattern([{ path: "Context/Schema.JSON", text: "{}" }], "schema.json"),
    true,
  );
  const findings = semantic.namePlanQualityFindings({
    baseName: { "#text": "steel production mix" },
  });
  assert.equal(
    findings.some(
      (finding: { code?: string }) =>
        finding.code === "semantic_name_base_contains_unsplit_segments",
    ),
    true,
  );
});

test("patch evidence helpers preserve trace recursion, closure order, placeholders, class aliases, and location targets", () => {
  const trace = { source: "source", quote_or_trace: "/field" };
  assert.equal(evidence.hasStructuredTraceEvidence(trace), true);
  assert.equal(evidence.hasStructuredTraceEvidence({ source: "source" }), false);
  assert.deepEqual(
    evidence.objectTraceEntries(
      {
        "common:other": {
          "tiangongfoundry:unresolvedTrace": [trace, { source: "two", path: "/two" }],
        },
      },
      "tiangongfoundry:unresolvedTrace",
    ),
    [trace, { source: "two", path: "/two" }, trace, { source: "two", path: "/two" }],
  );
  const operation = {
    closesActionItems: [
      "first",
      { actionItemCode: "second", jsonPath: "/field" },
      { rule_id: "third" },
    ],
  };
  assert.deepEqual(evidence.operationClosureKeys(operation), [
    "first\u0000",
    "second\u0000/field",
    "third\u0000",
  ]);
  assert.deepEqual(evidence.operationClosureCodes(operation), ["first", "second", "third"]);
  assert.equal(evidence.containsAiTemplatePlaceholder({ nested: ["__AI_FILL_VALUE__"] }), true);
  assert.equal(evidence.classCode({ "@classId": " code " }), "code");
  assert.equal(evidence.classText({ "#text": " text " }), "text");
  assert.equal(evidence.classLevel({ "@level": "2" }), 2);
  assert.equal(
    evidence.operationTargetsLocationCode({
      path: "/flowDataSet/geography/locationOfSupply",
    }),
    true,
  );
  assert.equal(evidence.operationTargetsLocationCode({ path: "/name/locationOfSupply" }), false);
  const task = {
    action_items: [
      { code: "first", path: "/field" },
      { code: "second", path: "/other" },
    ],
    files: { authoring_package: "/tmp/package.json" },
  };
  assert.deepEqual(evidence.taskActionItemKeys(task), ["first\u0000/field", "second\u0000/other"]);
  assert.deepEqual(evidence.taskActionItemsForOperation(task, operation), [task.action_items[0]]);
  assert.equal(evidence.taskAuthoringPackageName("/repo", task), "package.json");
});

test("authoring SCC retains exact runtime export counts", () => {
  assert.equal(Object.keys(authoring).length, 29);
  assert.equal(Object.keys(semantic).length, 66);
  assert.equal(Object.keys(evidence).length, 26);
});
