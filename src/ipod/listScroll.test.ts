import assert from "node:assert/strict";
import test from "node:test";
import { scrollTopForIndex } from "./listScroll.ts";

test("scroll stays put while the row is inside the 6-row window", () => {
  assert.equal(scrollTopForIndex(0, 120, 0), 0);
  assert.equal(scrollTopForIndex(5, 120, 0), 0);
  assert.equal(scrollTopForIndex(10, 120, 150), 150);
});

test("scroll moves only when the selected row leaves the window", () => {
  assert.equal(scrollTopForIndex(6, 120, 0), 30);
  assert.equal(scrollTopForIndex(25, 120, 0), 600);
  assert.equal(scrollTopForIndex(25, 120, 600), 600);
  assert.equal(scrollTopForIndex(19, 120, 600), 570);
  assert.equal(scrollTopForIndex(39, 40, 0), 1020);
  const atEnd = scrollTopForIndex(39, 40, 0);
  assert.equal(scrollTopForIndex(34, 40, atEnd), atEnd);
  assert.equal(scrollTopForIndex(33, 40, atEnd), 990);
});

test("scroll uses the measured row height and ignores a pending index past the end", () => {
  assert.equal(scrollTopForIndex(6, 20, 0, 40), 40);
  assert.equal(scrollTopForIndex(4, 1, 0), 0);
  assert.equal(scrollTopForIndex(0, 0, 12), 0);
});
