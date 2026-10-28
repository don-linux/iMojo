import assert from "node:assert/strict";
import { test } from "node:test";
import { createClockStore } from "./clockStore.ts";

function harness() {
  let now = 1_000_000;
  const ticks: Array<() => void> = [];
  const clock = createClockStore({
    now: () => now,
    schedule: (callback) => {
      ticks.push(callback);
      return () => {
        const index = ticks.indexOf(callback);
        if (index >= 0) ticks.splice(index, 1);
      };
    },
    visible: () => true,
    listenVisibility: () => () => {},
  });
  return {
    clock,
    ticks,
    setNow(value: number) {
      now = value;
    },
  };
}

test("paused snapshot identity stays stable as time passes", () => {
  const { clock, setNow } = harness();
  clock.note({ positionMs: 1500, timestamp: 1_000_000, durationMs: 20_000, paused: true, generation: 1 });
  const first = clock.getSnapshot();
  setNow(1_020_000);
  assert.equal(clock.getSnapshot(), first);
  assert.equal(first.currentTime, 1);
  assert.equal(first.duration, 20);
});

test("playing snapshot changes only when the displayed second changes", () => {
  const { clock, ticks, setNow } = harness();
  const unsubscribe = clock.subscribe(() => {});
  clock.note({ positionMs: 1500, timestamp: 1_000_000, durationMs: 20_000, paused: false, generation: 1 });
  const first = clock.getSnapshot();
  setNow(1_000_200);
  ticks[0]?.();
  assert.equal(clock.getSnapshot(), first);
  setNow(1_001_200);
  ticks[0]?.();
  const next = clock.getSnapshot();
  assert.notEqual(next, first);
  assert.equal(next.currentTime, 2);
  unsubscribe();
  assert.equal(ticks.length, 0);
});

test("lag is clamped and an unknown duration does not clamp position", () => {
  const { clock, setNow } = harness();
  clock.note({ positionMs: 0, timestamp: 0, durationMs: 60_000, paused: false, generation: 1 });
  assert.equal(clock.preciseMs(), 1500);
  setNow(1_000_000);
  clock.note({ positionMs: 5000, timestamp: 1_000_000, durationMs: 0, paused: false, generation: 1 });
  setNow(1_020_000);
  assert.equal(clock.preciseMs(), 25_000);
  assert.equal(clock.getSnapshot().duration, 0);
});

test("the tick loop runs only while something is subscribed and playback is unpaused", () => {
  const { clock, ticks } = harness();
  clock.note({ positionMs: 0, timestamp: 1_000_000, durationMs: 10_000, paused: false, generation: 1 });
  assert.equal(ticks.length, 0);
  const unsubscribe = clock.subscribe(() => {});
  assert.equal(ticks.length, 1);
  clock.setPaused(true);
  assert.equal(ticks.length, 0);
  unsubscribe();
});
