import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  bundledCategorySchemaFileNames,
  collectBundledSchemaContextFiles,
  collectContextDirFiles,
  collectExplicitContextFiles,
  contextFileDetails,
  contextHasFilePattern,
  firstTidasSchemaDir,
  fullContextAiCompletionRequirement,
  fullContextGateItems,
  loadTidasSchema,
  normalizeFullContextAiCompletion,
  readContextFiles,
  tidasSchemaPath,
  tidasSchemaSearchRoots,
} from "../../scripts/lib/import-curation/internal/context-inputs.ts";

function withFixture<T>(callback: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-context-inputs-"));
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

test("installed TIDAS schema resolution is exact, pinned, sorted, and missing-safe", () => {
  assert.deepEqual(tidasSchemaSearchRoots, ["@tiangong-lca/cli@0.1.10/assets/tidas-schemas"]);
  const schemaDir = firstTidasSchemaDir("ignored-root");
  assert.ok(schemaDir);
  assert.equal(fs.statSync(schemaDir).isDirectory(), true);
  const contactsPath = tidasSchemaPath("ignored-root", "tidas_contacts.json");
  assert.equal(contactsPath, path.join(schemaDir, "tidas_contacts.json"));
  assert.equal(tidasSchemaPath("ignored-root", "missing.json"), null);
  assert.equal(loadTidasSchema("ignored-root", "missing.json"), null);
  const contacts = loadTidasSchema("ignored-root", "tidas_contacts.json") as Record<
    string,
    unknown
  >;
  assert.equal(typeof contacts, "object");

  const categoryNames = bundledCategorySchemaFileNames("ignored-root");
  assert.deepEqual(categoryNames, [...categoryNames].sort());
  assert.deepEqual(categoryNames, [
    "tidas_contacts_category.json",
    "tidas_flowproperties_category.json",
    "tidas_flows_elementary_category.json",
    "tidas_flows_product_category.json",
    "tidas_lciamethods_category.json",
    "tidas_locations_category.json",
    "tidas_processes_category.json",
    "tidas_sources_category.json",
    "tidas_unitgroups_category.json",
  ]);
  const bundled = collectBundledSchemaContextFiles("ignored-root");
  assert.deepEqual(
    bundled.map(([kind, filePath]) => [kind, path.basename(filePath)]),
    [
      ...categoryNames
        .filter((name) => name !== "tidas_locations_category.json")
        .map((name) => ["classification_schema", name]),
      ["location_schema", "tidas_locations_category.json"],
    ],
  );
});

test("explicit and directory context discovery preserve kinds, filtering, and lexical order", () => {
  assert.deepEqual(
    collectExplicitContextFiles({
      contractContext: "contract-context.json",
      contextFile: "ignored-by-precedence.json",
      schemaFile: "schema.json",
      yamlFile: "methodology.yaml",
      rulesetFile: "rules.json",
      contractFile: "contract.md",
    }),
    [
      ["contract_context", "contract-context.json"],
      ["schema", "schema.json"],
      ["methodology_yaml", "methodology.yaml"],
      ["ruleset", "rules.json"],
      ["contract", "contract.md"],
    ],
  );
  assert.deepEqual(collectExplicitContextFiles({}), []);

  withFixture((root) => {
    const contextDir = path.join(root, "context");
    write(path.join(contextDir, "b.yaml"), "b");
    write(path.join(contextDir, "a.JSON"), "a");
    write(path.join(contextDir, "c.md"), "c");
    write(path.join(contextDir, "d.txt"), "d");
    write(path.join(contextDir, "ignored.bin"), "x");
    fs.mkdirSync(path.join(contextDir, "nested"));
    assert.deepEqual(
      collectContextDirFiles(root, "context").map(([kind, filePath]) => [
        kind,
        path.basename(filePath),
      ]),
      [
        ["context_dir_file", "a.JSON"],
        ["context_dir_file", "b.yaml"],
        ["context_dir_file", "c.md"],
        ["context_dir_file", "d.txt"],
      ],
    );
    assert.deepEqual(collectContextDirFiles(root, "missing"), []);
    assert.deepEqual(collectContextDirFiles(root, null), []);
  });
});

test("context file reading deduplicates resolved paths and reports missing inputs in encounter order", () => {
  withFixture((root) => {
    const schema = path.join(root, "context", "schema.json");
    const methodology = path.join(root, "context", "methodology.yaml");
    write(schema, '{"type":"object"}\n');
    write(methodology, "methodology: exact\n");
    assert.deepEqual(
      readContextFiles(root, [
        ["schema", "context/schema.json"],
        ["duplicate", schema],
        ["methodology_yaml", "context/methodology.yaml"],
        ["missing", "context/missing.json"],
        ["missing-duplicate", "context/missing.json"],
        ["empty", null],
      ]),
      {
        files: [
          {
            kind: "schema",
            path: "context/schema.json",
            text: '{"type":"object"}\n',
          },
          {
            kind: "methodology_yaml",
            path: "context/methodology.yaml",
            text: "methodology: exact\n",
          },
        ],
        missing: [{ kind: "missing", path: "context/missing.json" }],
      },
    );
  });
});

test("full-context normalization preserves aliases, arrays, defaults, and proof", () => {
  assert.deepEqual(normalizeFullContextAiCompletion(null), {
    required: false,
    datasetTypes: [],
    requiredContextKinds: [],
    requiredContextFilePatterns: [],
    proof:
      "dataset-authoring-patch-collect plus dataset-patch-apply with authoring package closure",
  });
  assert.deepEqual(
    normalizeFullContextAiCompletion({
      require: 1,
      datasetTypes: [" Flow ", "PROCESS", ""],
      required_context_kinds: [" schema ", "ruleset"],
      requiredContextFilePatterns: [" schema.json ", "methodology.yaml"],
      proof: " exact proof ",
    }),
    {
      required: true,
      datasetTypes: ["flow", "process"],
      requiredContextKinds: ["schema", "ruleset"],
      requiredContextFilePatterns: ["schema.json", "methodology.yaml"],
      proof: "exact proof",
    },
  );
});

test("full-context requirements preserve disabled/type filtering, defaults, custom order, and schema union", () => {
  assert.equal(
    fullContextAiCompletionRequirement(
      { fullContextAiCompletion: normalizeFullContextAiCompletion(null) },
      "flow",
      "ignored-root",
    ),
    null,
  );
  const flowOnly = normalizeFullContextAiCompletion({
    required: true,
    dataset_types: ["flow"],
  });
  assert.equal(
    fullContextAiCompletionRequirement({ fullContextAiCompletion: flowOnly }, "process", ""),
    null,
  );
  const defaulted = fullContextAiCompletionRequirement(
    { fullContextAiCompletion: flowOnly },
    "flow",
    "ignored-root",
  );
  assert.ok(defaulted);
  assert.deepEqual(defaulted.requiredContextKinds, [
    "schema",
    "methodology_yaml",
    "ruleset",
    "classification_schema",
    "location_schema",
  ]);
  assert.ok(defaulted.requiredContextFilePatterns.includes("schema.json"));
  for (const name of bundledCategorySchemaFileNames("ignored-root")) {
    assert.ok(defaulted.requiredContextFilePatterns.includes(name));
  }

  const custom = fullContextAiCompletionRequirement(
    {
      fullContextAiCompletion: normalizeFullContextAiCompletion({
        required: true,
        required_context_kinds: ["custom"],
        required_context_file_patterns: ["custom.txt", "tidas_contacts_category.json"],
      }),
    },
    "process",
    "ignored-root",
  );
  assert.ok(custom);
  assert.deepEqual(custom.requiredContextKinds, ["custom"]);
  assert.deepEqual(custom.requiredContextFilePatterns.slice(0, 2), [
    "custom.txt",
    "tidas_contacts_category.json",
  ]);
  assert.equal(
    custom.requiredContextFilePatterns.filter(
      (name: string) => name === "tidas_contacts_category.json",
    ).length,
    1,
  );
});

test("context facts preserve exact UTF-8 bytes, hashes, pattern matching, and drift", () => {
  const files = [
    { kind: "schema", path: "Context/Schema.JSON", text: "中" },
    { kind: "ruleset", path: null, text: "" },
  ];
  const details = contextFileDetails(files);
  assert.deepEqual(details, [
    {
      kind: "schema",
      path: "Context/Schema.JSON",
      sha256: crypto.createHash("sha256").update("中").digest("hex"),
      bytes: 3,
    },
    {
      kind: "ruleset",
      path: null,
      sha256: crypto.createHash("sha256").update("").digest("hex"),
      bytes: 0,
    },
  ]);
  assert.equal(contextHasFilePattern(files, "schema.json"), true);
  assert.equal(contextHasFilePattern(files, "missing"), false);
  assert.equal(contextHasFilePattern(files, ""), true);
  assert.notEqual(contextFileDetails([{ ...files[0], text: "中文" }])[0].sha256, details[0].sha256);
});

test("full-context gate items preserve missing-kind then missing-file ordering and envelopes", () => {
  const requirement = {
    requiredContextKinds: ["schema", "ruleset"],
    requiredContextFilePatterns: ["schema.json", "methodology.yaml"],
  };
  const items = fullContextGateItems({
    contractContext: {
      files: [{ kind: "schema", path: "context/schema.json", text: "{}" }],
    },
    requirement,
  });
  assert.deepEqual(
    items.map((item) => ({
      code: item.code,
      required_kind: item.required_kind,
      required_file_pattern: item.required_file_pattern,
    })),
    [
      {
        code: "full_context_required_kind_missing",
        required_kind: "ruleset",
        required_file_pattern: undefined,
      },
      {
        code: "full_context_required_file_missing",
        required_kind: undefined,
        required_file_pattern: "methodology.yaml",
      },
    ],
  );
  for (const item of items) {
    assert.equal(item.source, "full_context");
    assert.equal(item.path, null);
    assert.equal(item.action_kind, "context_pack_required");
    assert.equal(item.required_owner, "foundry_context_pack");
    assert.equal(item.ai_required, false);
    assert.match(item.instruction, /Regenerate the SDK\/CLI dataset context pack/u);
  }
  assert.deepEqual(fullContextGateItems({ contractContext: { files: [] }, requirement: null }), []);
});
