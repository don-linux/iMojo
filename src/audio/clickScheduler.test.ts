import assert from "node:assert/strict";
import test from "node:test";
import { isPendingFresh, rebaseAfterResume, scheduleClick } from "./clickScheduler.ts";

test("drops a click 150ms or more ahead and spaces the next one by 50ms", () => {
  assert.equal(scheduleClick(0, 0.15), null);
  assert.deepEqual(scheduleClick(0, 0.14), { startAt: 0.14, nextAt: 0.19 });
  assert.deepEqual(scheduleClick(2, 1), { startAt: 2, nextAt: 2.05 });
  assert.deepEqual(scheduleClick(1, 1), { startAt: 1, nextAt: 1.05 });
});

test("rebases the queue 80ms after resume unless a later click is already queued", () => {
  assert.equal(rebaseAfterResume(2, 1), 2 + 0.08);
  assert.equal(rebaseAfterResume(2, 5), 5);
});

test("treats a pending click as fresh for under 200ms", () => {
  assert.equal(isPendingFresh(0, 199), true);
  assert.equal(isPendingFresh(0, 200), false);
  assert.equal(isPendingFresh(1_000, 1_199), true);
  assert.equal(isPendingFresh(1_000, 1_200), false);
});
