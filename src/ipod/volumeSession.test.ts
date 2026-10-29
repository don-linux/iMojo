import assert from "node:assert/strict";
import test from "node:test";
import { createManualSchedule } from "./idleLatch.ts";
import { createVolumeSession } from "./volumeSession.ts";

function setup(idleMs = 1_000) {
  const clock = createManualSchedule();
  let volume = 0.5;
  let publish = true;
  const applied: number[] = [];
  const session = createVolumeSession({
    idleMs,
    schedule: clock.schedule,
    getVolume: () => volume,
    setVolume: (next) => {
      applied.push(next);
      if (publish) volume = next;
    },
  });
  return {
    clock,
    session,
    applied,
    volume: () => volume,
    setPublish(next: boolean) {
      publish = next;
    },
    setVolume(next: number) {
      volume = next;
    },
  };
}

test("steps update the displayed percent and write the fraction", () => {
  const { session, applied } = setup();
  assert.equal(session.setPercent(Number.NaN), false);
  assert.equal(session.step(Number.NaN), false);
  assert.equal(session.isAdjusting(), false);
  assert.equal(session.setPercent(55), true);
  assert.equal(session.displayedPercent(), 55);
  assert.equal(session.step(5), true);
  assert.equal(session.displayedPercent(), 60);
  assert.equal(session.setPercent(60), false);
  assert.equal(session.setPercent(-4), true);
  assert.equal(session.displayedPercent(), 0);
  assert.equal(session.step(5), true);
  assert.equal(session.setPercent(140), true);
  assert.deepEqual(applied, [0.55, 0.6, 0, 0.05, 1]);
  assert.equal(session.displayedPercent(), 100);
});

test("the displayed percent moves before getVolume catches up", () => {
  const { session, applied, setPublish, setVolume } = setup();
  setPublish(false);
  assert.equal(session.setPercent(80), true);
  assert.equal(session.displayedPercent(), 80);
  assert.equal(session.step(5), true);
  assert.equal(session.displayedPercent(), 85);
  assert.deepEqual(applied, [0.8, 0.85]);
  setVolume(0.85);
  assert.equal(session.displayedPercent(), 85);
  assert.equal(session.step(5), true);
  assert.equal(applied[2], 0.9);
});

test("focus hold suppresses the idle timeout until release", () => {
  const { clock, session } = setup();
  session.keepOpen();
  clock.advance(5_000);
  assert.equal(session.isAdjusting(), true);
  session.release();
  clock.advance(999);
  assert.equal(session.isAdjusting(), true);
  clock.advance(1);
  assert.equal(session.isAdjusting(), false);
  session.setPercent(20);
  assert.equal(session.isAdjusting(), true);
  session.exit();
  assert.equal(session.isAdjusting(), false);
  clock.advance(5_000);
  assert.equal(session.isAdjusting(), false);
});
