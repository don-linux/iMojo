const WHEEL_DIAMETER_PX = 350;
const SELECT_DIAMETER_PX = 100;
const RING_DIAMETER_PX = 276;

function percent(part: number, whole: number) {
  return `${((part / whole) * 100).toFixed(10)}%`;
}

/** CSS `--select-button-pct`. Derived from the center button diameter. */
export const SELECT_BUTTON_PCT = percent(SELECT_DIAMETER_PX, WHEEL_DIAMETER_PX);

/** CSS `--scroll-wheel-pct`. The center-button ratio is select / ring. */
export const SCROLL_WHEEL_PCT = percent(RING_DIAMETER_PX, WHEEL_DIAMETER_PX);

/** Center button radius as a fraction of the ring radius (100/276). */
export const CENTER_DEAD_ZONE_RATIO = SELECT_DIAMETER_PX / RING_DIAMETER_PX;

export const REVERSE_LOCK_DEGREES = 8;

/** Deltas this close to 180° are an alias, not a real half-turn. */
export const ALIAS_DELTA_DEGREES = 150;

export type Point = { x: number; y: number };

export function angleOf(point: Point) {
  return (Math.atan2(point.y, point.x) * 180) / Math.PI;
}

export function shortestDelta(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function isAliasedDelta(delta: number) {
  return Math.abs(delta) > ALIAS_DELTA_DEGREES;
}

/** Squared distance from the origin to the closest point on the segment. */
function segmentHubDistance2(a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / len2));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return x * x + y * y;
}

export function chordHitsDeadZone(
  a: Point,
  b: Point,
  radius: number,
  ratio = CENTER_DEAD_ZONE_RATIO,
) {
  const hub = radius * ratio;
  return segmentHubDistance2(a, b) < hub * hub;
}

export function isWithinRing(offset: Point, radius: number, ratio = CENTER_DEAD_ZONE_RATIO) {
  const distance2 = offset.x * offset.x + offset.y * offset.y;
  const inner = radius * ratio;
  return distance2 <= radius * radius + 1e-6 && distance2 >= inner * inner;
}
