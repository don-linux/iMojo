import assert from "node:assert/strict";
import { test } from "node:test";
import { adjacentQueueIndex, identityOrder, shuffledOrder, takeWindow } from "./order.ts";

test("shuffle pins the displayed index then shuffles the rest", () => {
  const order = shuffledOrder(5, 3, () => 0);
  assert.equal(order[0], 3);
  assert.deepEqual([...order].toSorted((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.equal(new Set(order).size, 5);
});

test("adjacent index wraps only for repeat all", () => {
  const order = identityOrder(4);
  assert.equal(adjacentQueueIndex(order, 3, 1, "off"), undefined);
  assert.equal(adjacentQueueIndex(order, 0, -1, "off"), undefined);
  assert.equal(adjacentQueueIndex(order, 3, 1, "all"), 0);
  assert.equal(adjacentQueueIndex(order, 0, -1, "all"), 3);
  assert.equal(adjacentQueueIndex(order, 1, 1, "one"), 2);
});

test("window is the forward slice capped at the limit", () => {
  const order = identityOrder(5);
  assert.deepEqual(takeWindow(order, 1, 2), [1, 2]);
  assert.deepEqual(takeWindow(order, 4, 100), [4]);
});
