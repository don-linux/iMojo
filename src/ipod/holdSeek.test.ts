import assert from "node:assert/strict";
import test from "node:test";
import { createLatestSeek, stepHoldSeek, type HoldSeekSample, type HoldSeekState } from "./holdSeek.ts";

const playing: HoldSeekSample = {
  repeat: false,
  step: 1,
  inert: false,
  seeking: false,
  hasLoaded: true,
  currentTime: 10,
  duration: 100,
  index: 2,
};

test("hold-seek walks the tier table from the local position", () => {
  let state: HoldSeekState = { tier: 0 };
  const targets: Array<number | null> = [];
  for (let step = 0; step < 8; step += 1) {
    const result = stepHoldSeek(state, { ...playing, repeat: step > 0 });
    state = result.state;
    targets.push(result.target);
  }
  assert.deepEqual(targets, [15, 20, 25, 35, 45, 55, 75, 95]);
  const end = stepHoldSeek(state, { ...playing, repeat: true });
  assert.equal(end.target, 100);
  assert.equal(end.state.base, undefined);
  assert.equal(stepHoldSeek(end.state, { ...playing, repeat: true }).target, null);
});

test("hold-seek clamps at the ends and does not keep seeking", () => {
  const forward = stepHoldSeek({ tier: 0 }, { ...playing, currentTime: 96 });
  assert.equal(forward.target, 100);
  assert.equal(forward.state.base, undefined);
  const stuck = stepHoldSeek(forward.state, { ...playing, repeat: true, currentTime: 100 });
  assert.equal(stuck.target, null);

  const backward = stepHoldSeek({ tier: 0 }, { ...playing, step: -1, currentTime: 4 });
  assert.equal(backward.target, 0);
  assert.equal(backward.state.base, undefined);
  assert.equal(stepHoldSeek(backward.state, { ...playing, repeat: true, step: -1 }).target, null);
});

test("hold-seek refuses an unknown duration, a track change, and scrubbing", () => {
  assert.equal(stepHoldSeek({ tier: 0 }, { ...playing, duration: 0 }).target, null);
  const started = stepHoldSeek({ tier: 0 }, playing);
  assert.equal(stepHoldSeek(started.state, { ...playing, repeat: true, index: 3 }).target, null);
  assert.equal(stepHoldSeek(started.state, { ...playing, repeat: true, seeking: true }).target, null);
  assert.equal(stepHoldSeek({ tier: 0 }, { ...playing, inert: true }).target, null);
});

test("repeated hold-seek flushes only the latest target once the in-flight seek resolves", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const calls: number[] = [];
  const gate = createLatestSeek(
    (seconds) =>
      new Promise<void>((resolve) => {
        calls.push(seconds);
        setTimeout(resolve, 1200);
      }),
  );

  let state: HoldSeekState = { tier: 0 };
  const tick = (repeat: boolean) => {
    const result = stepHoldSeek(state, { ...playing, repeat, currentTime: 10 });
    state = result.state;
    if (!repeat) gate.begin();
    if (result.target != null) gate.push(result.target);
  };

  tick(false);
  const repeat = setInterval(() => tick(true), 500);
  assert.deepEqual(calls, [15]);

  t.mock.timers.tick(1000);
  assert.deepEqual(calls, [15]);
  clearInterval(repeat);

  t.mock.timers.tick(200);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [15, 25]);
});
