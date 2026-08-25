import assert from "node:assert/strict";
import test from "node:test";
import { createLibraryScopeWorkflowCommands } from "../../scripts/commands/library-scope-workflow.ts";
import { fs, path, testTmpRoot } from "../fixtures/foundry-core.mjs";

const fixtureRoot = testTmpRoot("library-scope-workflow-elementary-identity-test");
type DependencyFactory = (dependencies: never) => unknown;
type TestHook = (...args: never[]) => unknown;

function bindFactory<Factory extends DependencyFactory>(
  factory: Factory,
  dependencies: unknown,
): ReturnType<Factory> {
  return factory(dependencies as never) as ReturnType<Factory>;
}

function invokeHook<Hook extends TestHook>(hook: Hook, input: unknown): ReturnType<Hook> {
  return hook(input as never) as ReturnType<Hook>;
}

interface CandidateView {
  names: string[];
  fields: { categories: string[] };
}

interface SelectedCandidateView {
  categories: string[];
  flow_property_label_overridden?: boolean;
}

function candidateView(value: unknown): CandidateView {
  const evaluation = value as { candidate?: unknown };
  assert.ok(evaluation.candidate);
  return evaluation.candidate as CandidateView;
}

function selectedCandidateView(value: unknown): SelectedCandidateView {
  const evaluation = value as { evidence?: { selected_candidate?: unknown } };
  assert.ok(evaluation.evidence?.selected_candidate);
  return evaluation.evidence.selected_candidate as SelectedCandidateView;
}

const ensureArray = (value: unknown) =>
  Array.isArray(value) ? value : value == null ? [] : [value];
const asText = (value: unknown) => (value == null ? "" : String(value).trim());

const { libraryScopeWorkflowTestHooks } = bindFactory(createLibraryScopeWorkflowCommands, {
  asText,
  booleanOption: (value: unknown) => Boolean(value),
  bundleClassificationPath: () => null,
  cloneJson: <T,>(value: T): T => JSON.parse(JSON.stringify(value)),
  datasetIdentity: () => ({}),
  directoryExists: (p: string | null) =>
    Boolean(p) && fs.existsSync(p!) && fs.statSync(p!).isDirectory(),
  ensureArray,
  fileExists: (p: string | null) => Boolean(p) && fs.existsSync(p!),
  flowTypeOfDataSet: () => "",
  jsonSha256: () => "",
  nowIso: () => "2026-01-01T00:00:00Z",
  positiveIntegerOption: (value: unknown, fallback: number | null) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  },
  readJson: (p: string) => JSON.parse(fs.readFileSync(p, "utf8")),
  readJsonLines: () => [],
  repoRelativeMaybe: (p: string | null) => p ?? null,
  repoRelativePath: (p: string) => p,
  resolveRepoPath: (p: string | null) => (p ? p : null),
  profileFor: () => ({}),
  repoRoot: fixtureRoot,
  sha256Text: () => "",
  textValue: asText,
  writeJson: () => {},
  writeJsonLines: () => {},
});

const { evaluateElementaryIdentityDecision, openLcaCompartmentClassification } =
  libraryScopeWorkflowTestHooks;

function sourceFileWithOpenLcaTrace(categoryPath: string) {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const file = path.join(
    fixtureRoot,
    `olca-flow-${categoryPath.replace(/[^a-z]/giu, "")}-${Math.abs(
      [...categoryPath].reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7) % 99991,
    )}.json`,
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:other": {
              "tidasimport:sourceTrace": {
                payload: {
                  format: "openlca-jsonld",
                  payload: { entity: { category: categoryPath } },
                },
              },
            },
          },
        },
      },
    }),
  );
  return file;
}

function sourceFileWithTrace({ category, subCategory }: { category: string; subCategory: string }) {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const file = path.join(
    fixtureRoot,
    `flow-${category.replace(/[^a-z]/gu, "")}-${subCategory.replace(/[^a-z.]/gu, "")}-${Math.abs(
      [...`${category}|${subCategory}`].reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7) % 99991,
    )}.json`,
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:other": {
              "tidasimport:sourceTrace": {
                payload: { sourceClassification: { category, subCategory } },
              },
            },
          },
        },
      },
    }),
  );
  return file;
}

function candidate({
  names,
  cas = null,
  flowProperty = "Mass",
  categories,
}: {
  names: string[];
  cas?: string | null;
  flowProperty?: string;
  categories: string[];
}) {
  return {
    id: `cand-${names[0].replace(/[^a-z0-9]/giu, "")}-${categories.join("").length}`,
    version: "03.00.004",
    names,
    fields: {
      type_of_dataset: "Elementary flow",
      cas,
      flow_property: flowProperty,
      reference_unit: null,
      categories,
    },
  };
}

test("elementary identity evaluator recovers compartment from the source trace", () => {
  const sourceFile = sourceFileWithTrace({ category: "emissions to water", subCategory: "river" });
  const evaluation = invokeHook(evaluateElementaryIdentityDecision, {
    entity: {
      dataset_id: "t1",
      name: "Beryllium; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Amount in kg" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Beryllium"],
        fields: {
          cas: "007440-41-7",
          flow_property: "Amount in kg",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["beryllium"],
          cas: "7440-41-7",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        }),
        candidate({
          names: ["beryllium"],
          cas: "7440-41-7",
          categories: ["Emissions", "Emissions to water", "Emissions to fresh water"],
        }),
      ],
    },
    usage: null,
  });
  assert.equal(evaluation.decision, "reuse_existing_reference");
  assert.deepEqual(candidateView(evaluation).fields.categories, [
    "Emissions",
    "Emissions to water",
    "Emissions to fresh water",
  ]);
});

test("elementary identity evaluator refuses a candidate that extends the target name without CAS", () => {
  const sourceFile = sourceFileWithTrace({
    category: "emissions to air",
    subCategory: "unspecified",
  });
  const evaluation = invokeHook(evaluateElementaryIdentityDecision, {
    entity: {
      dataset_id: "t2",
      name: "Ethane; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Amount in kg" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Ethane"],
        fields: {
          cas: null,
          flow_property: "Amount in kg",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["1,2-dibromoethane"],
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        }),
        candidate({
          names: ["ethane"],
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        }),
      ],
    },
    usage: null,
  });
  assert.equal(evaluation.decision, "reuse_existing_reference");
  assert.deepEqual(candidateView(evaluation).names, ["ethane"]);
});

test("elementary identity evaluator matches inverted chemical names via token permutation", () => {
  const sourceFile = sourceFileWithTrace({
    category: "emissions to air",
    subCategory: "unspecified",
  });
  const evaluation = invokeHook(evaluateElementaryIdentityDecision, {
    entity: {
      dataset_id: "t3",
      name: "Ethane, 1,1,2,2-tetrachloro-; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Amount in kg" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Ethane, 1,1,2,2-tetrachloro-"],
        fields: {
          cas: null,
          flow_property: "Amount in kg",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["1,1,2,2-tetrachloroethane"],
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        }),
      ],
    },
    usage: null,
  });
  assert.equal(evaluation.decision, "reuse_existing_reference");
  assert.deepEqual(candidateView(evaluation).names, ["1,1,2,2-tetrachloroethane"]);
});

test("elementary identity evaluator keeps mid-name token runs on manual review", () => {
  const sourceFile = sourceFileWithTrace({ category: "resource, land", subCategory: "" });
  const evaluation = invokeHook(evaluateElementaryIdentityDecision, {
    entity: {
      dataset_id: "t4",
      name: "Occupation, dump site, benthos; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Area*time" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Occupation, dump site, benthos"],
        fields: {
          cas: null,
          flow_property: "Area*time",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["dump site"],
          flowProperty: "Area*time",
          categories: ["Land use", "Land occupation"],
        }),
      ],
    },
    usage: { input: 1, output: 0, other: 0, process_ids: [] },
  });
  assert.equal(evaluation.decision, "block_unresolved");
});

test("elementary identity evaluator overrides a mislabeled flow-property text on exact name and compartment", () => {
  const sourceFile = sourceFileWithTrace({
    category: "emissions to air",
    subCategory: "low. pop.",
  });
  const evaluation = invokeHook(evaluateElementaryIdentityDecision, {
    entity: {
      dataset_id: "t5",
      name: "Heat, waste; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Amount in MJ" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Heat, waste"],
        fields: {
          cas: null,
          flow_property: "Amount in MJ",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["waste heat"],
          flowProperty: "Radioactivity",
          categories: ["Emissions", "Emissions to non-urban air or from high stacks"],
        }),
        candidate({
          names: ["waste heat"],
          flowProperty: "Radioactivity",
          categories: ["Emissions", "Emissions to water", "Emissions to water, unspecified"],
        }),
      ],
    },
    usage: null,
  });
  assert.equal(evaluation.decision, "reuse_existing_reference");
  assert.match(candidateView(evaluation).fields.categories.join(" "), /non-urban air/u);
  assert.equal(selectedCandidateView(evaluation).flow_property_label_overridden, true);
});

test("openLcaCompartmentClassification maps FEDEFL paths to ecoinvent-style tokens", () => {
  assert.deepEqual(openLcaCompartmentClassification("Elementary flows/emission/ground"), {
    category: "emissions to soil",
    subCategory: "",
  });
  assert.deepEqual(
    openLcaCompartmentClassification(
      "Elementary flows/emission/ground/human-dominated/agricultural",
    ),
    { category: "emissions to soil", subCategory: "agricultural" },
  );
  assert.deepEqual(
    openLcaCompartmentClassification("Elementary flows/emission/air/troposphere/urban"),
    { category: "emissions to air", subCategory: "high. pop." },
  );
  assert.deepEqual(
    openLcaCompartmentClassification("Elementary flows/emission/air/troposphere/rural"),
    { category: "emissions to air", subCategory: "low. pop." },
  );
  assert.deepEqual(
    openLcaCompartmentClassification("Elementary flows/emission/water/saline water body/ocean"),
    { category: "emissions to water", subCategory: "ocean" },
  );
  assert.deepEqual(
    openLcaCompartmentClassification("Elementary flows/resource/ground/subterranean"),
    { category: "resource, ground", subCategory: "" },
  );
  assert.equal(openLcaCompartmentClassification(""), null);
});

test("elementary identity evaluator recovers the openLCA compartment and picks the right one", () => {
  // The converter writes a uniform "Emissions to air, unspecified" default on every
  // openLCA elementary flow; the real compartment (emission/ground = soil) lives only in
  // the trace. With CAS-equal candidates spread across air/soil compartments, the soil
  // source path must steer the match to the soil candidate, not the air default.
  const sourceFile = sourceFileWithOpenLcaTrace("Elementary flows/emission/ground");
  const evaluation = invokeHook(evaluateElementaryIdentityDecision, {
    entity: {
      dataset_id: "olca1",
      name: "Propanoic acid, ...; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Mass" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Propanoic acid, ..."],
        fields: {
          cas: "111479-05-1",
          flow_property: "Mass",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["propaquizafop"],
          cas: "111479-05-1",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        }),
        candidate({
          names: ["propaquizafop"],
          cas: "111479-05-1",
          categories: ["Emissions", "Emissions to soil", "Emissions to soil, unspecified"],
        }),
      ],
    },
    usage: null,
  });
  assert.equal(evaluation.decision, "reuse_existing_reference");
  assert.match(selectedCandidateView(evaluation).categories.join(" "), /to soil/u);
});

test("elementary identity evaluator rejects the long-term variant via the openLCA compartment", () => {
  // A non-long-term openLCA air flow must not be deferred just because the remote also
  // has a "(long-term)" sibling: the recovered compartment excludes it from competing.
  const sourceFile = sourceFileWithOpenLcaTrace("Elementary flows/emission/air");
  const evaluation = invokeHook(evaluateElementaryIdentityDecision, {
    entity: {
      dataset_id: "olca2",
      name: "Propaquizafop; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Mass" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Propaquizafop"],
        fields: {
          cas: "111479-05-1",
          flow_property: "Mass",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["propaquizafop"],
          cas: "111479-05-1",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        }),
        candidate({
          names: ["propaquizafop"],
          cas: "111479-05-1",
          categories: [
            "Emissions",
            "Emissions to air",
            "Emissions to air, unspecified (long-term)",
          ],
        }),
      ],
    },
    usage: null,
  });
  assert.equal(evaluation.decision, "reuse_existing_reference");
  assert.doesNotMatch(selectedCandidateView(evaluation).categories.join(" "), /long-term/u);
});
