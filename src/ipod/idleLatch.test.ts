import assert from "node:assert/strict";
import test from "node:test";
import { createIdleLatch, createManualSchedule } from "./idleLatch.ts";

function harness() {
  const clock = createManualSchedule();
  let active = false;
  const events: string[] = [];
  const latch = createIdleLatch({
    timeoutMs: 1_000,
    isActive: () => active,
    enter: () => {
      active = true;
      events.push("enter");
    },
    onLeave: () => {
      active = false;
      events.push("leave");
    },
    schedule: clock.schedule,
  });
  return { clock, latch, events, active: () => active };
}

test("restart replaces the single timeout", () => {
  const { clock, latch, events } = harness();
  latch.keepOpen();
  latch.release();
  clock.advance(600);
  latch.restart();
  clock.advance(600);
  assert.deepEqual(events, ["enter"]);
  clock.advance(400);
  assert.deepEqual(events, ["enter", "leave"]);
  clock.advance(1_000);
  assert.deepEqual(events, ["enter", "leave"]);
});

test("clear cancels the timeout", () => {
  const { clock, latch, events } = harness();
  latch.keepOpen();
  latch.release();
  latch.clear();
  clock.advance(2_000);
  assert.deepEqual(events, ["enter"]);
});

test("keepOpen holds the latch and release lets it time out", () => {
  const { clock, latch, events, active } = harness();
  latch.keepOpen();
  latch.keepOpen();
  clock.advance(5_000);
  assert.equal(active(), true);
  assert.deepEqual(events, ["enter"]);
  latch.restart();
  clock.advance(5_000);
  assert.deepEqual(events, ["enter"]);
  latch.release();
  clock.advance(999);
  assert.equal(active(), true);
  clock.advance(1);
  assert.deepEqual(events, ["enter", "leave"]);
});

test("exit leaves immediately and does not arm another timeout", () => {
  const { clock, latch, events, active } = harness();
  latch.exit();
  assert.deepEqual(events, []);
  latch.keepOpen();
  latch.exit();
  assert.equal(active(), false);
  assert.deepEqual(events, ["enter", "leave"]);
  clock.advance(2_000);
  assert.deepEqual(events, ["enter", "leave"]);
});

test("reenter repeats entry only when the latch was held", () => {
  const held = harness();
  held.latch.keepOpen();
  held.latch.reenter();
  assert.deepEqual(held.events, ["enter", "leave", "enter"]);
  held.clock.advance(5_000);
  assert.equal(held.active(), true);

  const released = harness();
  released.latch.keepOpen();
  released.latch.release();
  released.latch.reenter();
  assert.deepEqual(released.events, ["enter", "leave"]);
  assert.equal(released.active(), false);
});

test("destroy cancels the timeout", () => {
  const { clock, latch, events } = harness();
  latch.keepOpen();
  latch.release();
  latch.destroy();
  clock.advance(5_000);
  assert.deepEqual(events, ["enter"]);
});
