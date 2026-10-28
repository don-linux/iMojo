import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ScrollDetail } from "../../wheel.ts";
import {
  CENTER_DEAD_ZONE_RATIO,
  REVERSE_LOCK_DEGREES,
  angleOf,
  chordHitsDeadZone,
  isAliasedDelta,
  isWithinRing,
  shortestDelta,
  type Point,
} from "./geometry.ts";

type Metrics = { cx: number; cy: number; radius: number };

type GestureOptions = {
  ringRef: RefObject<HTMLDivElement | null>;
  draggingRef: RefObject<boolean>;
  disabled: boolean;
  onScroll: (detail: ScrollDetail) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

export function useWheelGesture({
  ringRef,
  draggingRef,
  disabled,
  onScroll,
  onDragStart,
  onDragEnd,
}: GestureOptions) {
  const [dragging, setDragging] = useState(false);
  const endDragRef = useRef<() => void>(() => {});

  const publishScroll = useEffectEvent((detail: ScrollDetail) => {
    if (disabled) return;
    onScroll(detail);
  });
  const publishDragStart = useEffectEvent(() => {
    onDragStart?.();
  });
  const publishDragEnd = useEffectEvent(() => {
    onDragEnd?.();
  });
  const isDisabled = useEffectEvent(() => disabled);

  useLayoutEffect(() => {
    const node = ringRef.current;
    if (!node) return;
    const el: HTMLDivElement = node;

    let pointerId: number | undefined;
    let last: Point | undefined;
    let lastTime = 0;
    let direction: 1 | -1 | undefined;
    let reverseAccum = 0;
    let announced = false;
    let alive = true;
    let metrics: Metrics | undefined;

    // getBoundingClientRect is visual coordinates, so a CSS scale stays correct.
    function recompute() {
      const rect = el.getBoundingClientRect();
      metrics = {
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        radius: Math.min(rect.width, rect.height) / 2,
      };
    }

    function release(id: number) {
      try {
        if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
      } catch {
        // Capture can already be gone when the pointer is cancelled.
      }
    }

    function endDrag() {
      if (pointerId === undefined && !announced) return;
      const id = pointerId;
      const shouldAnnounce = announced;
      pointerId = undefined;
      announced = false;
      draggingRef.current = false;
      last = undefined;
      direction = undefined;
      reverseAccum = 0;
      if (alive) setDragging(false);
      // Drop the id before releasing so lostpointercapture does not end twice.
      if (id !== undefined) release(id);
      if (shouldAnnounce) publishDragEnd();
    }

    endDragRef.current = endDrag;

    function offsetOf(sample: PointerEvent): Point {
      return {
        x: sample.clientX - (metrics?.cx ?? 0),
        y: sample.clientY - (metrics?.cy ?? 0),
      };
    }

    function applySample(sample: PointerEvent) {
      if (!last || !metrics) return;
      const elapsed = sample.timeStamp - lastTime;
      if (!(elapsed > 0)) return;
      const previous = last;
      const offset = offsetOf(sample);
      last = offset;
      lastTime = sample.timeStamp;
      if (chordHitsDeadZone(previous, offset, metrics.radius)) return;
      const delta = shortestDelta(angleOf(previous), angleOf(offset));
      if (delta === 0 || isAliasedDelta(delta)) return;
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
      publishScroll({ step, degrees, speed: (degrees / elapsed) * 1000 });
    }

    function maybeFocus(event: PointerEvent) {
      if (!(event.width > 0 || event.height > 0)) return;
      if (!window.matchMedia("(any-pointer: fine)").matches) return;
      el.focus({ preventScroll: true });
    }

    function onPointerDown(event: PointerEvent) {
      if (isDisabled()) return;
      maybeFocus(event);
      if (event.button !== 0 || pointerId !== undefined) return;
      recompute();
      if (!metrics) return;
      const offset = offsetOf(event);
      if (!isWithinRing(offset, metrics.radius, CENTER_DEAD_ZONE_RATIO)) return;
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // Leave the ring idle when the browser refuses capture.
        return;
      }
      pointerId = event.pointerId;
      announced = true;
      draggingRef.current = true;
      last = offset;
      lastTime = event.timeStamp;
      direction = undefined;
      reverseAccum = 0;
      if (alive) setDragging(true);
      publishDragStart();
    }

    function onPointerMove(event: PointerEvent) {
      if (pointerId !== event.pointerId) return;
      if (isDisabled()) {
        endDrag();
        return;
      }
      const coalesced =
        typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
      const samples = coalesced.length > 0 ? coalesced : [event];
      for (const sample of samples) applySample(sample);
    }

    function onPointerEnd(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      endDrag();
    }

    function onBlur() {
      endDrag();
    }

    function onHide() {
      if (document.visibilityState === "hidden") endDrag();
    }

    const observer = new ResizeObserver(() => {
      recompute();
    });
    observer.observe(el);
    recompute();

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);
    el.addEventListener("lostpointercapture", onPointerEnd);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onBlur);
    document.addEventListener("visibilitychange", onHide);

    return () => {
      alive = false;
      endDragRef.current = () => {};
      endDrag();
      observer.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerEnd);
      el.removeEventListener("pointercancel", onPointerEnd);
      el.removeEventListener("lostpointercapture", onPointerEnd);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onBlur);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [ringRef, draggingRef]);

  useEffect(() => {
    if (disabled) endDragRef.current();
  }, [disabled]);

  return { dragging };
}
