import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  occurrenceKeyedExchanges,
  sha256Json,
  stableJson,
} from "../../scripts/commands/topology-convergence.mjs";
import { assert } from "../fixtures/foundry-core.ts";

function exchange(number: string, flow: string) {
  return {
    referenceToFlowDataSet: { "@refObjectId": flow, "@version": "00.00.001" },
    "common:other": {
      "tidasimport:sourceTrace": {
        payload: {
          sourceTrace: { exchange: { attributes: [{ name: "number", value: number }] } },
        },
      },
    },
  };
}

function traceFreeExchange(number: string, flow: string) {
  return {
    referenceToFlowDataSet: { "@refObjectId": flow, "@version": "00.00.001" },
    generalComment: {
      "@xml:lang": "en",
      "#text": `Source EcoSpold1 exchange number: ${number}. Preserved production trace.`,
    },
  };
}

test("exchange identity is process-local source number plus document-order occurrence", () => {
  const keyed = occurrenceKeyedExchanges(
    [exchange("42", "flow-a"), exchange("7", "flow-b"), exchange("42", "flow-c")],
    "process-a",
  );
  assert.deepEqual(
    keyed.map(({ number, occurrence, token }) => ({ number, occurrence, token })),
    [
      { number: "42", occurrence: 1, token: "42\u00001" },
      { number: "7", occurrence: 1, token: "7\u00001" },
      { number: "42", occurrence: 2, token: "42\u00002" },
    ],
  );
});

test("occurrence identity rejects exchanges without immutable source numbers", () => {
  assert.throws(
    () => occurrenceKeyedExchanges([{ referenceToFlowDataSet: {} }], "process-a"),
    /has no source number/u,
  );
});

test("exchange identity accepts the preserved generalComment when sourceTrace was cleaned", () => {
  const keyed = occurrenceKeyedExchanges(
    [traceFreeExchange("42", "flow-a"), traceFreeExchange("42", "flow-b")],
    "process-a",
  );
  assert.deepEqual(
    keyed.map(({ number, occurrence, token }) => ({ number, occurrence, token })),
    [
      { number: "42", occurrence: 1, token: "42\u00001" },
      { number: "42", occurrence: 2, token: "42\u00002" },
    ],
  );
});

test("exchange identity rejects conflicting sourceTrace and generalComment numbers", () => {
  const conflicting = {
    ...exchange("42", "flow-a"),
    generalComment: {
      "@xml:lang": "en",
      "#text": "Source EcoSpold1 exchange number: 7. Conflicting evidence.",
    },
  };
  assert.throws(
    () => occurrenceKeyedExchanges([conflicting], "process-a"),
    /sourceTrace\/generalComment number mismatch/u,
  );
});

test("canonical hashes ignore object insertion order but retain array order", () => {
  assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
  assert.equal(sha256Json({ values: [1, 2] }), sha256Json({ values: [1, 2] }));
  assert.notEqual(sha256Json({ values: [1, 2] }), sha256Json({ values: [2, 1] }));
});

test("topology composer has no network, database, subprocess, or production dispatch surface", () => {
  const source = fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../scripts/commands/topology-convergence.mjs",
    ),
    "utf8",
  );
  for (const forbidden of [
    /node:child_process/u,
    /\bfetch\s*\(/u,
    /https?:\/\//u,
    /supabase/u,
    /service[_-]role/u,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
