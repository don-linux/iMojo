import assert from "node:assert/strict";
import test from "node:test";
import {
  createListScroller,
  createSeekScroller,
  createVolumeScroller,
  seekTierForHold,
  tierForHold,
} from "../../wheel.ts";

const FRAME_MS = 1000 / 60;

test("list and seek tier tables are unchanged", () => {
  assert.deepEqual(
    [0, 499, 500, 999, 1000, 3499, 3500, 10000].map((ms) => tierForHold(ms)),
    [1, 1, 2, 2, 3, 21, 34, 34],
  );
  assert.deepEqual(
    [0, 499, 500, 999, 1000, 1499, 1500, 9999].map((ms) => seekTierForHold(ms)),
    [1, 1, 2, 2, 3, 3, 5, 5],
  );
});

test("list notch math matches the pre-change scroller", () => {
  const scroller = createListScroller();
  const events: Array<[1 | -1, number, number, number, { count: number; rows: number }]> = [
    [1, 14, 100, 0, { count: 0, rows: 0 }],
    [1, 2, 100, 16, { count: 1, rows: 1 }],
    [1, 30, 90, 32, { count: 2, rows: 2 }],
    [1, 0, 90, 48, { count: 0, rows: 0 }],
    [1, 45, 50, 64, { count: 3, rows: 3 }],
    [-1, 15, 50, 80, { count: 1, rows: 1 }],
    [-1, 14.999, 50, 96, { count: 0, rows: 0 }],
    [1, 15, 50, 112, { count: 1, rows: 1 }],
    [1, 44.9, 120, 128, { count: 2, rows: 2 }],
    [1, 0.1, 120, 144, { count: 0, rows: 0 }],
  ];
  for (const [step, degrees, speed, now, expected] of events) {
    assert.deepEqual(scroller.push(step, degrees, speed, now), expected);
  }
});

test("seek notch math matches the pre-change scroller", () => {
  const scroller = createSeekScroller();
  const events: Array<[1 | -1, number, number, number, { count: number; seconds: number }]> = [
    [1, 14, 100, 0, { count: 0, seconds: 0 }],
    [1, 1, 100, 20, { count: 1, seconds: 1 }],
    [1, 29, 80, 40, { count: 1, seconds: 1 }],
    [-1, 45, 80, 60, { count: 3, seconds: 3 }],
    [-1, 7.5, 10, 80, { count: 0, seconds: 0 }],
    [1, 60, 10, 100, { count: 4, seconds: 4 }],
  ];
  for (const [step, degrees, speed, now, expected] of events) {
    assert.deepEqual(scroller.push(step, degrees, speed, now), expected);
  }
});

test("volume percent and click steps match the pre-change scroller", () => {
  const scroller = createVolumeScroller();
  const events: Array<[1 | -1, number, { percent: number; clicks: number }]> = [
    [1, 4.4, { percent: 0, clicks: 0 }],
    [1, 0.1, { percent: 1, clicks: 0 }],
    [1, 4.5, { percent: 1, clicks: 0 }],
    [1, 9, { percent: 2, clicks: 0 }],
    [1, 20.4545454545, { percent: 4, clicks: 1 }],
    [-1, 4.5, { percent: 1, clicks: 0 }],
    [-1, 40.909090909, { percent: 9, clicks: 2 }],
    [1, 450 / 22, { percent: 4, clicks: 1 }],
    [1, 4.5 * 3 + 0.01, { percent: 3, clicks: 0 }],
  ];
  for (const [step, degrees, expected] of events) {
    assert.deepEqual(scroller.push(step, degrees), expected);
  }
});

test("a fast 60Hz spin still steps one notch per sample and climbs tiers on the old clock", () => {
  const list = createListScroller();
  const seek = createSeekScroller();
  for (let i = 0; i <= 90; i++) {
    const now = i * FRAME_MS;
    const listTier = i >= 30 ? tierForHold(now) : 1;
    const seekTier = seekTierForHold(now);
    assert.deepEqual(list.push(1, 15, 250, now), { count: 1, rows: listTier });
    assert.deepEqual(seek.push(1, 15, 250, now), { count: 1, seconds: seekTier });
  }
});

test("a same-timestamp list sample still spends its degrees", () => {
  const scroller = createListScroller();
  assert.deepEqual(scroller.push(1, 10, 400, 100), { count: 0, rows: 0 });
  assert.deepEqual(scroller.push(1, 10, 0, 100), { count: 1, rows: 1 });
});
