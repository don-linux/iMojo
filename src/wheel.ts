const DRAG_STEP_DEGREES = 15;
const TIERS = [1, 2, 3, 5, 8, 13, 21, 34] as const;
const SEEK_TIERS = [1, 2, 3, 5] as const;
const VOLUME_DEGREES_PER_PERCENT = 4.5;
const VOLUME_DEGREES_PER_CLICK = 450 / 22;
const MIN_SPEED = 180;
const TIER_MS = 500;
const SMOOTH = 0.15;
const SPEED_CAP = 400;
const GAP_MS = 250;
const FRAME_MS = 1000 / 60;
/** Tau for which one 60Hz step applies the historical per-event alpha of 0.15. */
const TAU_MS = FRAME_MS / -Math.log(1 - SMOOTH);
/** A dip under the fast threshold must last this long before the tier restarts. */
const SLOW_RESET_MS = 50;

export type ScrollDetail = {
  step: 1 | -1;
  degrees: number;
  speed: number;
};

function tierIndex(heldMs: number) {
  return Math.min(TIERS.length - 1, Math.max(0, Math.floor(heldMs / TIER_MS)));
}

export function tierForHold(heldMs: number) {
  return TIERS[tierIndex(heldMs)]!;
}

function tierFor(tiers: readonly number[], heldMs: number) {
  return tiers[Math.min(tiers.length - 1, tierIndex(heldMs))] ?? 1;
}

/** Hold-seek tiers used by the wheel keyboard: 1, 2, 3, 5 seconds. */
export function seekTierForHold(heldMs: number) {
  return tierFor(SEEK_TIERS, heldMs);
}

export function createAccelerator(tiers: readonly number[] = TIERS) {
  let smoothed = 0;
  let direction: 1 | -1 | undefined;
  let lastAt: number | undefined;
  let fastSince: number | undefined;
  let slowSince: number | undefined;

  function currentTier(now: number) {
    if (smoothed <= MIN_SPEED) {
      if (fastSince === undefined) return tiers[0] ?? 1;
      if (slowSince === undefined) slowSince = now;
      if (now - slowSince >= SLOW_RESET_MS) {
        fastSince = undefined;
        slowSince = undefined;
        return tiers[0] ?? 1;
      }
      return tierFor(tiers, now - fastSince);
    }
    slowSince = undefined;
    if (fastSince === undefined) fastSince = now;
    return tierFor(tiers, now - fastSince);
  }

  return {
    reset() {
      smoothed = 0;
      direction = undefined;
      lastAt = undefined;
      fastSince = undefined;
      slowSince = undefined;
    },
    smoothed() {
      return smoothed;
    },
    multiplier(speed: number, step: 1 | -1, now = performance.now()) {
      if (lastAt !== undefined && now - lastAt <= 0) return currentTier(now);
      const dt = lastAt === undefined ? FRAME_MS : now - lastAt;
      const stalled = lastAt !== undefined && dt > GAP_MS;
      lastAt = now;
      const capped = Math.min(speed, SPEED_CAP);
      if (direction !== step || stalled) {
        smoothed = capped;
        direction = step;
        fastSince = undefined;
        slowSince = undefined;
      } else {
        const alpha = 1 - Math.exp(-dt / TAU_MS);
        smoothed += alpha * (capped - smoothed);
      }
      return currentTier(now);
    },
  };
}

export function createListScroller() {
  let accumulated = 0;
  let direction: 1 | -1 | null = null;
  const accelerator = createAccelerator();

  return {
    reset() {
      accumulated = 0;
      direction = null;
      accelerator.reset();
    },
    push(step: 1 | -1, degrees: number, speed: number, now = performance.now()) {
      if (direction !== step) {
        direction = step;
        accumulated = 0;
        accelerator.reset();
      }
      const multiplier = accelerator.multiplier(speed, step, now);
      accumulated += degrees;
      const count = Math.floor(accumulated / DRAG_STEP_DEGREES);
      accumulated -= count * DRAG_STEP_DEGREES;
      if (count < 1) return { count: 0, rows: 0 };
      return { count, rows: count * multiplier };
    },
  };
}

export function createSeekScroller() {
  let accumulated = 0;
  let direction: 1 | -1 | null = null;
  const accelerator = createAccelerator(SEEK_TIERS);

  return {
    reset() {
      accumulated = 0;
      direction = null;
      accelerator.reset();
    },
    push(step: 1 | -1, degrees: number, speed: number, now = performance.now()) {
      if (direction !== step) {
        direction = step;
        accumulated = 0;
        accelerator.reset();
      }
      const multiplier = accelerator.multiplier(speed, step, now);
      accumulated += degrees;
      const count = Math.floor(accumulated / DRAG_STEP_DEGREES);
      accumulated -= count * DRAG_STEP_DEGREES;
      if (count < 1) return { count: 0, seconds: 0 };
      return { count, seconds: count * multiplier };
    },
  };
}

export function createVolumeScroller() {
  let percentDegrees = 0;
  let clickDegrees = 0;
  let direction: 1 | -1 | null = null;

  return {
    reset() {
      percentDegrees = 0;
      clickDegrees = 0;
      direction = null;
    },
    push(step: 1 | -1, degrees: number) {
      if (direction !== step) {
        direction = step;
        percentDegrees = 0;
        clickDegrees = 0;
      }
      percentDegrees += degrees;
      clickDegrees += degrees;
      const percent = Math.floor(percentDegrees / VOLUME_DEGREES_PER_PERCENT);
      percentDegrees -= percent * VOLUME_DEGREES_PER_PERCENT;
      const clicks = Math.floor(clickDegrees / VOLUME_DEGREES_PER_CLICK);
      clickDegrees -= clicks * VOLUME_DEGREES_PER_CLICK;
      return { percent, clicks };
    },
  };
}
