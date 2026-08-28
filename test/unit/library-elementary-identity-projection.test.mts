import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";

interface JsonRecord {
  [key: string]: unknown;
}

const jsonLines = (rows: readonly JsonRecord[]): string =>
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const acceptedCandidate = {
  id: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
  version: "03.00.004",
  names: ["methane"],
  fields: {
    type_of_dataset: "Elementary flow",
    cas: "74-82-8",
    flow_property: "Mass",
    categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
  },
};

const entityRows = [
  {
    entity_key: "flow:product:00.00.001",
    dataset_type: "flow",
    dataset_id: "product",
    dataset_version: "00.00.001",
    source_file: "product.json",
    flow_type: "Product flow",
    name: "Grid electricity",
    flow_property_refs: [{ short_description: "Energy in MJ" }],
  },
  {
    entity_key: "flow:ef-ambiguous:00.00.001",
    dataset_type: "flow",
    dataset_id: "ef-ambiguous",
    dataset_version: "00.00.001",
    source_file: "ambiguous.json",
    flow_type: "Elementary flow",
    name: "Water",
    flow_property_refs: [{ short_description: "Amount in kg" }],
  },
  {
    entity_key: "flow:ef-accepted:00.00.001",
    dataset_type: "flow",
    dataset_id: "ef-accepted",
    dataset_version: "00.00.001",
    source_file: "accepted.json",
    flow_type: "Elementary flow",
    name: "Methane",
    flow_property_refs: [{ short_description: "Amount in kg" }],
  },
  {
    entity_key: "flow:ef-rejected:00.00.001",
    dataset_type: "flow",
    dataset_id: "ef-rejected",
    dataset_version: "00.00.001",
    source_file: "rejected.json",
    flow_type: "Elementary flow",
    name: "Copper",
    flow_property_refs: [{ short_description: "Amount in kg" }],
  },
];

const projectionRows = [
  {
    process_id: "process-z",
    process_version: "00.00.001",
    process_entity_key: "process:process-z:00.00.001",
    dependency_ids: {
      flows: entityRows.map((row) => ({ entity_key: row.entity_key })),
      flowproperties: [],
      unitgroups: [],
    },
    usage_refs: {
      process_exchange_flow_refs: [
        {
          flow_id: "ef-accepted",
          flow_version: "00.00.001",
          exchange_index: 0,
          direction: "Input",
        },
        {
          flow_id: "ef-ambiguous",
          flow_version: "00.00.001",
          exchange_index: 1,
          direction: "Output",
        },
        {
          flow_id: "ef-rejected",
          flow_version: "00.00.001",
          exchange_index: 2,
          direction: "Unspecified",
        },
        {
          flow_id: "product",
          flow_version: "00.00.001",
          exchange_index: 3,
          direction: "Output",
        },
      ],
    },
  },
  {
    process_id: "process-a",
    process_version: "00.00.001",
    process_entity_key: "process:process-a:00.00.001",
    dependency_ids: {
      flows: [{ entity_key: "flow:ef-accepted:00.00.001" }],
      flowproperties: [],
      unitgroups: [],
    },
    usage_refs: {
      process_exchange_flow_refs: [
        {
          flow_id: "ef-accepted",
          flow_version: "00.00.001",
          exchange_index: 0,
          direction: "Input",
        },
      ],
    },
  },
];

const preflights = [
  {
    row: {
      dataset_type: "flow",
      dataset_id: "ef-accepted",
      dataset_version: "00.00.001",
    },
    report: null,
    reportPath: "/workspace/stale/accepted-report.json",
    candidatesPath: "/workspace/stale/accepted-candidates.jsonl",
  },
  {
    row: {
      dataset_type: "flow",
      dataset_id: "ef-rejected",
      dataset_version: "00.00.001",
    },
    reportPath: "/workspace/run/rejected/identity-decision.json",
    candidatesPath: "/workspace/run/rejected/identity-candidates.jsonl",
    report: {
      status: "needs_review",
      decision: "create_new",
      target: {
        names: ["Copper"],
        fields: {
          cas: "7440-50-8",
          flow_property: "Mass",
          categories: ["Resources", "Resources from ground"],
        },
      },
      candidates: [
        {
          id: "rejected-candidate",
          version: "03.00.004",
          names: ["copper"],
          fields: {
            type_of_dataset: "Product flow",
            cas: "111-11-1",
            flow_property: "Energy",
            categories: ["Emissions", "Emissions to water"],
          },
        },
      ],
    },
  },
  {
    row: {
      dataset_type: "flow",
      dataset_id: "ef-accepted",
      dataset_version: "00.00.001",
    },
    reportPath: "/workspace/run/accepted/identity-decision.json",
    candidatesPath: "/workspace/run/accepted/identity-candidates.jsonl",
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Methane"],
        fields: {
          cas: "00074-82-8",
          flow_property: "Amount in kg",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [acceptedCandidate],
    },
  },
  {
    row: {
      dataset_type: "flow",
      dataset_id: "ef-ambiguous",
      dataset_version: "00.00.001",
    },
    reportPath: "/workspace/run/ambiguous/identity-decision.json",
    candidatesPath: "/workspace/run/ambiguous/identity-candidates.jsonl",
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Water"],
        fields: { cas: null, flow_property: "Mass", categories: ["Emissions"] },
      },
      candidates: [
        {
          id: "water-air",
          version: "03.00.004",
          names: ["water"],
          fields: {
            type_of_dataset: "Elementary flow",
            cas: null,
            flow_property: "Mass",
            categories: ["Emissions", "Emissions to air"],
          },
        },
        {
          id: "water-water",
          version: "03.00.004",
          names: ["water"],
          fields: {
            type_of_dataset: "Elementary flow",
            cas: null,
            flow_property: "Mass",
            categories: ["Emissions", "Emissions to water"],
          },
        },
      ],
    },
  },
];

const expectedDecisionRows: JsonRecord[] = [
  {
    schema_version: 1,
    dataset_type: "flow",
    source_dataset_id: "ef-accepted",
    source_dataset_version: "00.00.001",
    dataset_id: "ef-accepted",
    dataset_version: "00.00.001",
    source_entity_key: "flow:ef-accepted:00.00.001",
    decision: "reuse_existing_reference",
    identity_decision: "reuse_existing_reference",
    decision_status: "completed",
    canonical_flow_id: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
    canonical_flow_version: "03.00.004",
    canonical_short_description: "methane",
    canonical: {
      table: "flows",
      ref_object_id: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
      version: "03.00.004",
      short_description: "methane",
    },
    basis:
      "Selected from identity-preflight candidates because exactly one existing elementary flow passed physical-equivalence guardrails.",
    confidence: "high",
    used_context_kinds: ["library_index", "scope_projection", "identity_preflight"],
    closes_action_items: ["elementary_flow_identity_manual_review"],
    physical_equivalence_evidence: "single_candidate_passed_physical_guardrails",
    evidence: {
      preflight_status: "needs_review",
      preflight_decision: "manual_review",
      target_names: ["Methane", "Methane"],
      target_cas: "74-82-8",
      target_dimension: "mass",
      target_categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
      inferred_category_kind: "emission_air",
      source_trace_compartment: null,
      usage: { input: 2, output: 0, other: 0, process_count: 2 },
      selected_candidate: {
        id: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
        version: "03.00.004",
        names: ["methane"],
        cas: "74-82-8",
        flow_property: "Mass",
        categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        score: 149,
        name_tier: 3,
        compartment_matched: false,
      },
      guardrails: [
        "same elementary flow type",
        "compatible flow property dimension",
        "compatible compartment/resource meaning",
        "same CAS",
      ],
      identity_preflight_report: "run/accepted/identity-decision.json",
      identity_preflight_candidates: "run/accepted/identity-candidates.jsonl",
    },
  },
];

const expectedManualReviewRows: JsonRecord[] = [
  {
    schema_version: 1,
    dataset_type: "flow",
    source_dataset_id: "ef-ambiguous",
    source_dataset_version: "00.00.001",
    dataset_id: "ef-ambiguous",
    dataset_version: "00.00.001",
    source_entity_key: "flow:ef-ambiguous:00.00.001",
    source_name: "Water",
    decision: "block_unresolved",
    identity_decision: "block_unresolved",
    decision_status: "blocked_manual_review",
    reason: "multiple_plausible_candidates",
    required_human_action:
      "Review identity-preflight candidates and provide reuse_existing_reference only when physical equivalence is proven; otherwise keep dependent process scopes deferred.",
    evidence: {
      preflight_status: "needs_review",
      preflight_decision: "manual_review",
      target_dimension: "mass",
      inferred_category_kind: "emission",
      source_trace_compartment: null,
      best_score: 85,
      best_candidate: {
        id: "water-air",
        version: "03.00.004",
        names: ["water"],
        categories: ["Emissions", "Emissions to air"],
        flow_property: "Mass",
      },
      competing_candidates: [
        {
          id: "water-water",
          version: "03.00.004",
          names: ["water"],
          categories: ["Emissions", "Emissions to water"],
          score: 85,
        },
      ],
      identity_preflight_report: "run/ambiguous/identity-decision.json",
      identity_preflight_candidates: "run/ambiguous/identity-candidates.jsonl",
    },
  },
  {
    schema_version: 1,
    dataset_type: "flow",
    source_dataset_id: "ef-rejected",
    source_dataset_version: "00.00.001",
    dataset_id: "ef-rejected",
    dataset_version: "00.00.001",
    source_entity_key: "flow:ef-rejected:00.00.001",
    source_name: "Copper",
    decision: "block_unresolved",
    identity_decision: "block_unresolved",
    decision_status: "blocked_manual_review",
    reason: "elementary_flow_create_new_forbidden",
    required_human_action:
      "Review identity-preflight candidates and provide reuse_existing_reference only when physical equivalence is proven; otherwise keep dependent process scopes deferred.",
    evidence: {
      preflight_status: "needs_review",
      preflight_decision: "create_new",
      target_dimension: "mass",
      inferred_category_kind: "resource",
      source_trace_compartment: null,
      candidate_count: 1,
      rejected_candidate_examples: [
        {
          index: 0,
          id: "rejected-candidate",
          version: "03.00.004",
          names: ["copper"],
          fields: {
            type_of_dataset: "Product flow",
            cas: "111-11-1",
            flow_property: "Energy",
            categories: ["Emissions", "Emissions to water"],
          },
          blocker_codes: [
            "candidate_not_elementary_flow",
            "cas_conflict",
            "flow_property_dimension_conflict",
            "category_or_compartment_conflict",
          ],
          name_tier: 3,
          same_cas: false,
          score: -30,
        },
      ],
      identity_preflight_report: "run/rejected/identity-decision.json",
      identity_preflight_candidates: "run/rejected/identity-candidates.jsonl",
    },
  },
];

test("library elementary identity projection freezes exact rows, order, bytes, SHA and blockers", async () => {
  const decisionsBytes = jsonLines(expectedDecisionRows);
  const manualReviewBytes = jsonLines(expectedManualReviewRows);
  assert.equal(
    sha256(decisionsBytes),
    "3a6a29d00a3321c33cf0ac5df3a3266b2aedbe72c860cce4fdd094bd66226292",
  );
  assert.equal(
    sha256(manualReviewBytes),
    "a3c5671ed11730a429d08fba8a3889df874b5e50b0d547e1d6519f53af4e9c56",
  );

  const { projectLibraryElementaryIdentityDecisions } =
    await import("../../scripts/lib/library-orchestration/identity-preflight-projection.ts");
  const projection = projectLibraryElementaryIdentityDecisions({
    entityRows,
    projectionRows,
    preflights,
    sourceClassificationForEntity: () => null,
    repoRelativeMaybe: (filePath: string | null | undefined) =>
      filePath?.replace(/^\/workspace\//u, "") ?? null,
  });

  assert.deepEqual(
    projection.elementaryRows.map((row: { dataset_id: string }) => row.dataset_id),
    ["ef-ambiguous", "ef-accepted", "ef-rejected"],
  );
  assert.equal(jsonLines(projection.decisions), decisionsBytes);
  assert.equal(jsonLines(projection.manualReviewRows), manualReviewBytes);
  assert.deepEqual(projection.reasonCounts, {
    elementary_flow_create_new_forbidden: 1,
    multiple_plausible_candidates: 1,
    single_candidate_passed_physical_guardrails: 1,
  });
  assert.deepEqual(
    (projection.manualReviewRows[1].evidence as JsonRecord).rejected_candidate_examples,
    (expectedManualReviewRows[1].evidence as JsonRecord).rejected_candidate_examples,
  );
});

test("identity preflight aliases preserve exact precedence, defaults and key bytes", async () => {
  const { identityPreflightArtifactPaths, identityPreflightKey } =
    await import("../../scripts/lib/library-orchestration/identity-preflight-projection.ts");
  const fakeRoot = path.resolve(path.sep, "repo");
  const resolveRepoPath = (value: unknown): string | null =>
    value ? path.join(fakeRoot, String(value)) : null;

  assert.deepEqual(
    identityPreflightArtifactPaths(
      {
        expected_report_file: "expected-report.json",
        identity_decision_file: "lower-report.json",
        expected_candidates_file: "expected-candidates.jsonl",
        candidates_file: "lower-candidates.jsonl",
        output_dir: "ignored-output",
      },
      resolveRepoPath,
    ),
    {
      reportPath: path.join(fakeRoot, "expected-report.json"),
      candidatesPath: path.join(fakeRoot, "expected-candidates.jsonl"),
    },
  );
  assert.deepEqual(identityPreflightArtifactPaths({ outputDir: "flow-run" }, resolveRepoPath), {
    reportPath: path.join(fakeRoot, "flow-run", "outputs", "identity-decision.json"),
    candidatesPath: path.join(fakeRoot, "flow-run", "outputs", "identity-candidates.jsonl"),
  });
  assert.equal(
    identityPreflightKey({ type: "flow", source_dataset_id: "ef", version: "" }),
    "flow:ef:00.00.001",
  );
});
