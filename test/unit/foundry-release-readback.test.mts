import assert from "node:assert/strict";
import test from "node:test";
import {
  readBackWithBudget,
  TransientFoundryReadbackError,
} from "../../scripts/lib/foundry-release-readback.ts";
import { publishOnceAndReadBack } from "../../scripts/lib/foundry-release-publish.ts";

test("uncertain upload is sent once while temporary registry invisibility recovers", async () => {
  let uploads = 0,
    reads = 0,
    time = 0;
  const sleeps: number[] = [];
  const result = await publishOnceAndReadBack(
    async () => {
      uploads++;
      throw new Error("uncertain");
    },
    () =>
      readBackWithBudget(
        async () => {
          if (++reads < 5) throw new TransientFoundryReadbackError("404");
          return "verified";
        },
        {
          now: () => time,
          sleep: async (ms) => {
            sleeps.push(ms);
            time += ms;
          },
        },
      ),
  );
  assert.equal(uploads, 1);
  assert.equal(result.evidence, "verified");
  assert.equal(reads, 5);
  assert.deepEqual(sleeps, [5000, 10000, 20000, 40000]);
});
test("integrity and provenance failures are never retried", async () => {
  let reads = 0,
    sleeps = 0;
  await assert.rejects(
    readBackWithBudget(
      async () => {
        reads++;
        throw new Error("integrity mismatch");
      },
      {
        sleep: async () => {
          sleeps++;
        },
      },
    ),
    /integrity mismatch/u,
  );
  assert.equal(reads, 1);
  assert.equal(sleeps, 0);
});
test("registry retry stops at the budget without repeating publication", async () => {
  let reads = 0,
    time = 0;
  await assert.rejects(
    readBackWithBudget(
      async () => {
        reads++;
        throw new TransientFoundryReadbackError("503");
      },
      {
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
        budgetMs: 16000,
      },
    ),
    /503/u,
  );
  assert.equal(reads, 3);
  assert.equal(time, 15000);
});
