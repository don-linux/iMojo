import assert from "node:assert/strict";
import test from "node:test";
import {
  ALIAS_DELTA_DEGREES,
  CENTER_DEAD_ZONE_RATIO,
  SCROLL_WHEEL_PCT,
  SELECT_BUTTON_PCT,
  angleOf,
  chordHitsDeadZone,
  isAliasedDelta,
  isWithinRing,
  shortestDelta,
} from "./geometry.ts";

test("click-wheel percentages come from the same diameters as the dead zone", () => {
  assert.equal(SELECT_BUTTON_PCT, "28.5714285714%");
  assert.equal(SCROLL_WHEEL_PCT, "78.8571428571%");
  assert.equal(CENTER_DEAD_ZONE_RATIO, 100 / 276);
  const select = Number.parseFloat(SELECT_BUTTON_PCT);
  const ring = Number.parseFloat(SCROLL_WHEEL_PCT);
  assert.ok(Math.abs(select / ring - CENTER_DEAD_ZONE_RATIO) < 1e-12);
});

test("angleOf reports atan2 degrees", () => {
  assert.equal(angleOf({ x: 1, y: 0 }), 0);
  assert.equal(angleOf({ x: 0, y: 1 }), 90);
  assert.equal(angleOf({ x: -1, y: 0 }), 180);
  assert.equal(angleOf({ x: 0, y: -1 }), -90);
});

test("shortestDelta wraps across 0 and maps a half-turn to -180", () => {
  assert.ok(Math.abs(shortestDelta(350, 10) - 20) < 1e-9);
  assert.ok(Math.abs(shortestDelta(10, 350) - -20) < 1e-9);
  assert.equal(shortestDelta(20, 380), 0);
  assert.equal(shortestDelta(0, 180), -180);
  assert.equal(shortestDelta(10, 190), -180);
  assert.equal(isAliasedDelta(shortestDelta(0, 180)), true);
  assert.equal(shortestDelta(0, -180), -180);
});

test("deltas near 180 are rejected and 150 is kept", () => {
  assert.equal(ALIAS_DELTA_DEGREES, 150);
  assert.equal(isAliasedDelta(150), false);
  assert.equal(isAliasedDelta(-150), false);
  assert.equal(isAliasedDelta(150.0001), true);
  assert.equal(isAliasedDelta(-179), true);
  assert.equal(isAliasedDelta(shortestDelta(0, 170)), true);
  assert.equal(isAliasedDelta(shortestDelta(10, 30)), false);
  assert.equal(isAliasedDelta(0), false);
});

test("dead zone is the center button, not a 10% hub", () => {
  const radius = 100;
  const y = 0.2 * radius;
  const across = { x: -radius, y };
  const other = { x: radius, y };
  assert.equal(chordHitsDeadZone(across, other, radius), true);
  assert.equal(chordHitsDeadZone(across, other, radius, 0.1), false);

  const outerY = -0.8 * radius;
  assert.equal(
    chordHitsDeadZone({ x: -0.2 * radius, y: outerY }, { x: 0.2 * radius, y: outerY }, radius),
    false,
  );
  assert.equal(chordHitsDeadZone({ x: -10, y: 0 }, { x: 10, y: 0 }, radius), true);
});

test("ring hit testing excludes the center button and keeps the outer edge", () => {
  const radius = 50;
  const inner = radius * CENTER_DEAD_ZONE_RATIO;
  assert.equal(isWithinRing({ x: 0, y: 0 }, radius), false);
  assert.equal(isWithinRing({ x: inner - 0.01, y: 0 }, radius), false);
  assert.equal(isWithinRing({ x: inner, y: 0 }, radius), true);
  assert.equal(isWithinRing({ x: radius, y: 0 }, radius), true);
  assert.equal(isWithinRing({ x: radius + 1, y: 0 }, radius), false);
});
