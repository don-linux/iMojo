const DRAG_STEP_DEGREES = 15;
const REVERSE_LOCK_DEGREES = 8;
const HUB_RATIO = 0.1;
const TIERS = [1, 2, 3, 5, 8, 13, 21, 34] as const;
const SEEK_TIERS = [1, 2, 3, 5] as const;
const VOLUME_DEGREES_PER_PERCENT = 4.5;
const VOLUME_DEGREES_PER_CLICK = 20.4545454545;
const MIN_SPEED = 180;
const TIER_MS = 500;
const SMOOTH = 0.15;
const SPEED_CAP = 400;
const GAP_MS = 250;

export type ScrollDetail = {
  step: 1 | -1;
  degrees: number;
  speed: number;
};

export type RingHandlers = {
  onScroll: (detail: ScrollDetail) => void;
  onRotate: (deltaDegrees: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

type Point = { x: number; y: number };

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

function angleOf(point: Point) {
  return (Math.atan2(point.y, point.x) * 180) / Math.PI;
}

function shortestDelta(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180;
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

export function createAccelerator(tiers: readonly number[] = TIERS) {
  let smoothed = 0;
  let direction: 1 | -1 | undefined;
  let lastAt = 0;
  let fastSince: number | undefined;

  return {
    reset() {
      smoothed = 0;
      direction = undefined;
      lastAt = 0;
      fastSince = undefined;
    },
    multiplier(speed: number, step: 1 | -1, now = performance.now()) {
      const stalled = lastAt !== 0 && now - lastAt > GAP_MS;
      lastAt = now;
      const capped = Math.min(speed, SPEED_CAP);
      if (direction !== step || stalled) {
        smoothed = capped;
        direction = step;
        fastSince = undefined;
      } else {
        smoothed += SMOOTH * (capped - smoothed);
      }
      if (smoothed <= MIN_SPEED) {
        fastSince = undefined;
        return 1;
      }
      if (fastSince === undefined) fastSince = now;
      return tierFor(tiers, now - fastSince);
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
    push(step: 1 | -1, degrees: number, speed: number) {
      if (direction !== step) {
        direction = step;
        accumulated = 0;
        accelerator.reset();
      }
      const multiplier = accelerator.multiplier(speed, step);
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
    push(step: 1 | -1, degrees: number, speed: number) {
      if (direction !== step) {
        direction = step;
        accumulated = 0;
        accelerator.reset();
      }
      const multiplier = accelerator.multiplier(speed, step);
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

export function attachRing(el: HTMLElement, excludeRadiusRatio: number, handlers: RingHandlers) {
  let pointerId: number | undefined;
  let last: Point | undefined;
  let lastTime = 0;
  let direction: 1 | -1 | undefined;
  let reverseAccum = 0;
  let dragging = false;

  function measure(event: PointerEvent) {
    const rect = el.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) / 2;
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    const distance2 = x * x + y * y;
    const inner = radius * excludeRadiusRatio;
    const within = distance2 <= radius * radius + 1e-6 && distance2 >= inner * inner;
    return { offset: { x, y }, radius, within };
  }

  function onPointerDown(event: PointerEvent) {
    if (dragging || !event.isPrimary || event.button !== 0) return;
    const { offset, within } = measure(event);
    if (!within) return;
    dragging = true;
    pointerId = event.pointerId;
    last = offset;
    lastTime = event.timeStamp;
    direction = undefined;
    reverseAccum = 0;
    el.setPointerCapture(event.pointerId);
    handlers.onDragStart();
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging || pointerId !== event.pointerId || !last) return;
    const { offset, radius } = measure(event);
    const previous = last;
    const elapsed = event.timeStamp - lastTime;
    last = offset;
    lastTime = event.timeStamp;
    const hub = radius * HUB_RATIO;
    if (segmentHubDistance2(previous, offset) < hub * hub) return;
    const delta = shortestDelta(angleOf(previous), angleOf(offset));
    if (delta === 0) return;
    handlers.onRotate(delta);
    const step: 1 | -1 = delta > 0 ? 1 : -1;
    const degrees = Math.abs(delta);
    if (direction === undefined || step === direction) {
      direction = step;
      reverseAccum = 0;
    } else {
      reverseAccum += degrees;
      if (reverseAccum < REVERSE_LOCK_DEGREES) return;
      direction = step;
      reverseAccum = 0;
    }
    const speed = elapsed > 0 ? (degrees / elapsed) * 1000 : 0;
    handlers.onScroll({ step, degrees, speed });
  }

  function onPointerEnd(event: PointerEvent) {
    if (!dragging || pointerId !== event.pointerId) return;
    dragging = false;
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    pointerId = undefined;
    last = undefined;
    direction = undefined;
    reverseAccum = 0;
    handlers.onDragEnd();
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerEnd);
  el.addEventListener("pointercancel", onPointerEnd);
  el.addEventListener("lostpointercapture", onPointerEnd);

  return () => {
    if (dragging && pointerId !== undefined) {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
      dragging = false;
      pointerId = undefined;
      last = undefined;
      handlers.onDragEnd();
    }
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerEnd);
    el.removeEventListener("pointercancel", onPointerEnd);
    el.removeEventListener("lostpointercapture", onPointerEnd);
  };
}
