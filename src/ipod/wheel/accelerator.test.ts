import assert from "node:assert/strict";
import test from "node:test";
import { createAccelerator } from "../../wheel.ts";

const FRAME_MS = 1000 / 60;
const TARGET = 300;

function sampleSpin(hz: 60 | 120) {
  const acc = createAccelerator();
  acc.multiplier(0, 1, 0);
  const samples: number[] = [];
  for (let i = 1; i <= 30; i++) {
    if (hz === 120) acc.multiplier(TARGET, 1, (i - 0.5) * FRAME_MS);
    acc.multiplier(TARGET, 1, i * FRAME_MS);
    samples.push(acc.smoothed());
  }
  return samples;
}

test("60Hz smoothing matches the old 0.15 step and 120Hz sampling of the same spin", () => {
  const at60 = sampleSpin(60);
  const at120 = sampleSpin(120);
  assert.equal(at60.length, at120.length);
  let expected = 0;
  for (let i = 0; i < at60.length; i++) {
    expected += 0.15 * (TARGET - expected);
    assert.ok(Math.abs(at60[i]! - expected) < 1e-9, `60Hz step ${i}`);
    assert.ok(Math.abs(at60[i]! - at120[i]!) < 1e-6, `60 vs 120 at step ${i}`);
  }
  assert.ok(at60[29]! > 290);
});

test("same-timestamp and backwards samples do not decay speed", () => {
  const acc = createAccelerator();
  acc.multiplier(0, 1, 0);
  acc.multiplier(TARGET, 1, FRAME_MS);
  const speed = acc.smoothed();
  assert.ok(speed > 0);
  assert.equal(acc.multiplier(0, 1, FRAME_MS), 1);
  assert.equal(acc.smoothed(), speed);
  assert.equal(acc.multiplier(0, 1, FRAME_MS - 5), 1);
  assert.equal(acc.smoothed(), speed);
  acc.multiplier(TARGET, 1, FRAME_MS * 2);
  assert.ok(acc.smoothed() > speed);
});

test("the fast tier survives a brief dip and resets after 50ms under the threshold", () => {
  const acc = createAccelerator();
  acc.multiplier(400, 1, 0);
  for (let t = 100; t <= 500; t += 100) acc.multiplier(400, 1, t);
  assert.equal(acc.multiplier(400, 1, 500), 2);

  assert.equal(acc.multiplier(0, 1, 700), 2);
  assert.ok(acc.smoothed() <= 180);
  assert.equal(acc.multiplier(0, 1, 749), 2);
  assert.equal(acc.multiplier(0, 1, 750), 1);
  assert.equal(acc.smoothed() <= 180, true);
});

test("returning above the threshold during the grace period keeps the tier clock", () => {
  const acc = createAccelerator();
  acc.multiplier(400, 1, 0);
  for (let t = 100; t <= 500; t += 100) acc.multiplier(400, 1, t);
  acc.multiplier(0, 1, 700);
  const recovered = acc.multiplier(400, 1, 760);
  assert.equal(recovered, 2);
  assert.ok(acc.smoothed() > 180);
  assert.equal(acc.multiplier(400, 1, 1000), 3);
});

test("a stall or a direction change snaps speed and restarts the tier", () => {
  const acc = createAccelerator();
  acc.multiplier(100, 1, 0);
  assert.equal(acc.multiplier(250, 1, 300), 1);
  assert.equal(acc.smoothed(), 250);

  const turned = createAccelerator();
  turned.multiplier(400, 1, 0);
  turned.multiplier(400, 1, 500);
  assert.equal(turned.multiplier(380, -1, 520), 1);
  assert.equal(turned.smoothed(), 380);
});
