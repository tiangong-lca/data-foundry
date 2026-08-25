import assert from "node:assert/strict";
import test from "node:test";
import { namePlanQualityFindings } from "../../scripts/lib/import-curation/internal/workflow-semantic-actions.ts";

test("name-plan QA treats season-year scope as temporal, not a source citation", () => {
  const seasonScopedFindings = namePlanQualityFindings({
    baseName: "Electricity",
    treatmentStandardsRoutes: "hydropower, at pumped storage plant, ENTSO, summer 2018",
  });
  assert.equal(
    seasonScopedFindings.some((finding) => finding.code === "semantic_name_source_locator_in_name"),
    false,
  );

  const citationFindings = namePlanQualityFindings({
    baseName: "Steel sheet, Frischknecht 2012, at plant",
  });
  const sourceLocatorFindings = citationFindings.filter(
    (finding) => finding.code === "semantic_name_source_locator_in_name",
  );
  assert.equal(sourceLocatorFindings.length, 1);
  assert.equal(sourceLocatorFindings[0].field, "baseName");
  assert.ok(sourceLocatorFindings[0].detected_segments.includes("latin-author-year"));
});

test("name-plan QA ignores a trailing location brace that restates mixAndLocationTypes", () => {
  // "{RER}" merely restates the dataset location (already carried in mixAndLocationTypes),
  // so it must NOT raise an unsplit-segment finding — otherwise the name-split step is forced
  // to split "Tyre wear emissions, passenger car" and fails (bafu_name_split_unsupported).
  const redundantLocationFindings = namePlanQualityFindings({
    baseName: "Tyre wear emissions, passenger car {RER}",
    mixAndLocationTypes: "RER",
  });
  assert.equal(
    redundantLocationFindings.some(
      (finding) => finding.code === "semantic_name_base_contains_unsplit_segments",
    ),
    false,
  );

  // A trailing brace whose code does NOT match the dataset location is still flagged.
  const mismatchedLocationFindings = namePlanQualityFindings({
    baseName: "Tyre wear emissions, passenger car {GLO}",
    mixAndLocationTypes: "RER",
  });
  assert.ok(
    mismatchedLocationFindings.some(
      (finding) =>
        finding.code === "semantic_name_base_contains_unsplit_segments" &&
        finding.detected_segments.includes("braced_location_or_qualifier"),
    ),
  );

  // Without mixAndLocationTypes there is nothing to compare against, so the brace stays flagged.
  const noMixFindings = namePlanQualityFindings({
    baseName: "Tyre wear emissions, passenger car {RER}",
  });
  assert.ok(
    noMixFindings.some(
      (finding) => finding.code === "semantic_name_base_contains_unsplit_segments",
    ),
  );
});
