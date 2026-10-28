import assert from "node:assert/strict";
import test from "node:test";
import { formatClock, formatRemaining } from "./playbackTiming.ts";

function legacyClock(value: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

test("formatClock under an hour is unchanged m:ss", () => {
  const samples = [
    0, 0.2, 1, 9, 59, 59.9, 60, 61, 599, 600, 3599, 3599.9, -1, -0.4, Number.NaN,
    Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
  ];
  for (const value of samples) assert.equal(formatClock(value), legacyClock(value), String(value));
});

test("formatClock uses h:mm:ss at one hour and beyond", () => {
  assert.equal(formatClock(3600), "1:00:00");
  assert.equal(formatClock(3600.9), "1:00:00");
  assert.equal(formatClock(3659), "1:00:59");
  assert.equal(formatClock(3661), "1:01:01");
  assert.equal(formatClock(7199), "1:59:59");
  assert.equal(formatClock(7200), "2:00:00");
  assert.equal(formatClock(36000), "10:00:00");
});

test("formatRemaining keeps -m:ss under an hour", () => {
  assert.equal(formatRemaining(0, 90), "-1:30");
  assert.equal(formatRemaining(30, 90), "-1:00");
  assert.equal(formatRemaining(90, 90), "-0:00");
  assert.equal(formatRemaining(10.2, 20.1), "-0:10");
  assert.equal(formatRemaining(0, 3599), "-59:59");
  assert.equal(formatRemaining(0, 0), "");
  assert.equal(formatRemaining(0, -5), "");
  assert.equal(formatRemaining(0, Number.NaN), "");
  assert.equal(formatRemaining(Number.NaN, 10), "-0:00");
});

test("formatRemaining uses h:mm:ss once the remainder reaches an hour", () => {
  assert.equal(formatRemaining(0, 3600), "-1:00:00");
  assert.equal(formatRemaining(1, 3661), "-1:01:00");
});

test("NaN formats as 0:00", () => {
  assert.equal(formatClock(Number.NaN), "0:00");
});
