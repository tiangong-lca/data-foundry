import test from "node:test";
import { referenceKey } from "../../scripts/lib/import-curation/internal/workflow-reference-closure.ts";
import {
  sourceContactSupportCanonicalUnitGroupProofKeys,
  sourceContactSupportTrueSourceProofKeys,
} from "../../scripts/lib/import-curation/internal/workflow-source-reference-context.ts";
import { assert } from "../fixtures/foundry-core.mjs";

// CLASS 1: a minted (account-local) Flow Property whose reference Unit Group is a public
// canonical UG is NOT written; its referenceToReferenceUnitGroup is rewritten to the
// canonical published version and the canonical UG id@version is surfaced as a reusable
// remote reference so the reference-closure proof passes without writing the UG.
test("canonical unit group proof keys surface canonical UG id@published-version", () => {
  const context = {
    artifact: {
      value: {
        canonical_support: {
          canonical_unit_group_reference_keys: [
            { id: "93a60a57-a3c8-11da-a746-0800200c9a66", version: "03.00.003" },
            { id: "5beb6eed-33a9-47b8-9ede-1dfe8f679159", version: "03.00.003" },
          ],
        },
      },
    },
  };
  const keys = sourceContactSupportCanonicalUnitGroupProofKeys(context);
  assert.ok(
    keys.has(
      referenceKey({
        table: "unitgroups",
        id: "93a60a57-a3c8-11da-a746-0800200c9a66",
        version: "03.00.003",
      }),
    ),
    "canonical Units of energy UG @03.00.003 is proven",
  );
  assert.ok(
    keys.has(
      referenceKey({
        table: "unitgroups",
        id: "5beb6eed-33a9-47b8-9ede-1dfe8f679159",
        version: "03.00.003",
      }),
    ),
    "canonical Units of items UG @03.00.003 is proven",
  );
  // The proof must be exact: a stale @00.00.001 reference is NOT proven.
  assert.equal(
    keys.has(
      referenceKey({
        table: "unitgroups",
        id: "93a60a57-a3c8-11da-a746-0800200c9a66",
        version: "00.00.001",
      }),
    ),
    false,
    "the stale source version is never proven",
  );
});

test("canonical unit group proof keys are empty when no canonical_support block exists", () => {
  assert.equal(sourceContactSupportCanonicalUnitGroupProofKeys(null).size, 0);
  assert.equal(sourceContactSupportCanonicalUnitGroupProofKeys({}).size, 0);
  assert.equal(
    sourceContactSupportCanonicalUnitGroupProofKeys({ artifact: { value: {} } }).size,
    0,
  );
  // BAFU (flag off) never emits canonical_support keys, so closure stays unchanged.
  assert.equal(
    sourceContactSupportCanonicalUnitGroupProofKeys({
      artifact: { value: { canonical_support: { canonical_unit_group_reference_keys: [] } } },
    }).size,
    0,
  );
});

test("canonical unit group proof keys drop entries missing id or version", () => {
  const context = {
    artifact: {
      value: {
        canonical_support: {
          canonical_unit_group_reference_keys: [
            { id: "", version: "03.00.003" },
            { id: "93a60a57-a3c8-11da-a746-0800200c9a66", version: "" },
            { id: "5beb6eed-33a9-47b8-9ede-1dfe8f679159", version: "03.00.003" },
          ],
        },
      },
    },
  };
  const keys = sourceContactSupportCanonicalUnitGroupProofKeys(context);
  assert.equal(keys.size, 1);
  assert.ok(
    keys.has(
      referenceKey({
        table: "unitgroups",
        id: "5beb6eed-33a9-47b8-9ede-1dfe8f679159",
        version: "03.00.003",
      }),
    ),
  );
});

// FIX C (corrected) still proves committed true sources; the harvest itself is gated on
// true-source kind upstream, so only true sources reach referenced_true_source_keys.
test("true source proof keys surface committed true source id@version", () => {
  const context = {
    artifact: {
      value: {
        source_support: {
          referenced_true_source_keys: [
            { id: "94b3d910-206d-4478-9d5c-841ce336043b", version: "00.00.001" },
          ],
        },
      },
    },
  };
  const keys = sourceContactSupportTrueSourceProofKeys(context);
  assert.ok(
    keys.has(
      referenceKey({
        table: "sources",
        id: "94b3d910-206d-4478-9d5c-841ce336043b",
        version: "00.00.001",
      }),
    ),
  );
});
