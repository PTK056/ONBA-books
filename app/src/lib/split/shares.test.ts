// node --test src/lib/split/

import assert from "node:assert/strict";
import { test } from "node:test";
import { equalShares, weightedShares } from "./shares.ts";

test("shares add up to the cent", () => {
  assert.deepEqual(equalShares(26100, 3), [8700, 8700, 8700]);
  assert.deepEqual(equalShares(13935.96, 3), [4645.32, 4645.32, 4645.32]);
  assert.deepEqual(equalShares(10, 3), [3.34, 3.33, 3.33]);
});

test("weighted shares follow the weights and add up", () => {
  assert.deepEqual(weightedShares(3_000_000, [20, 10, 0]), [2_000_000, 1_000_000, 0]);
  assert.deepEqual(weightedShares(3_000_000, [50, 30, 20]), [1_500_000, 900_000, 600_000]);
  const s = weightedShares(100, [1, 1, 1]);
  assert.equal(Math.round(s.reduce((a, b) => a + b, 0) * 100), 10000);
  assert.deepEqual(weightedShares(90, [0, 0, 0]), [30, 30, 30]); // no weight at all: equal
});
