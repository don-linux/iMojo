import { useEffect, useEffectEvent, useLayoutEffect, useRef, type RefObject } from "react";
import { LONG_PRESS_MS, REPEAT_MS } from "./timing.ts";
import type { HoldButton, HoldDetail, WheelButton } from "./types.ts";

type HoldRecord = {
  pointerId: number | undefined;
  timer: number | undefined;
  interval: number | undefined;
  fired: boolean;
};

function emptyHold(): HoldRecord {
  return { pointerId: undefined, timer: undefined, interval: undefined, fired: false };
}

const BUTTON_IDS: Record<WheelButton, string> = {
  menu: "wheel-menu-button",
  back: "wheel-back-button",
  forward: "wheel-forward-button",
  playpause: "wheel-playpause-button",
  select: "wheel-select-button",
};

type PointerHoldOptions = {
  rootRef: RefObject<HTMLDivElement | null>;
  disabled: boolean;
  disableSkip: boolean;
  selectHoldMs: number | null;
  keyClickLatch: RefObject<Record<WheelButton, boolean>>;
  onMenu: () => void;
  onMenuHold?: () => void;
  onBack: () => void;
  onForward: () => void;
  onBackHold?: (detail: HoldDetail) => void;
  onForwardHold?: (detail: HoldDetail) => void;
  onPlayPause: () => void;
  onSelect: () => void;
  onSelectHold?: () => void;
};

export function usePointerHold({
  rootRef,
  disabled,
  disableSkip,
  selectHoldMs,
  keyClickLatch,
  onMenu,
  onMenuHold,
  onBack,
  onForward,
  onBackHold,
  onForwardHold,
  onPlayPause,
  onSelect,
  onSelectHold,
}: PointerHoldOptions) {
  const holds = useRef({
    menu: emptyHold(),
    back: emptyHold(),
    forward: emptyHold(),
    select: emptyHold(),
  });

  const fire = useEffectEvent((button: HoldButton, repeat: boolean) => {
    if (disabled) return;
    if (button === "menu") {
      if (onMenuHold) onMenuHold();
      else onMenu();
    } else if (button === "back") {
      if (!disableSkip) onBackHold?.({ repeat });
    } else if (button === "forward") {
      if (!disableSkip) onForwardHold?.({ repeat });
    } else if (selectHoldMs !== null && onSelectHold) onSelectHold();
  });

  const activate = useEffectEvent((button: WheelButton) => {
    if (disabled) return;
    if (button === "menu") onMenu();
    else if (button === "back") {
      if (!disableSkip) onBack();
    } else if (button === "forward") {
      if (!disableSkip) onForward();
    } else if (button === "playpause") onPlayPause();
    else onSelect();
  });

  function clearTimers(rec: HoldRecord) {
    window.clearTimeout(rec.timer);
    window.clearInterval(rec.interval);
    rec.timer = undefined;
    rec.interval = undefined;
  }

  function stop(button: HoldButton) {
    const rec = holds.current[button];
    clearTimers(rec);
    rec.pointerId = undefined;
  }

  const dismiss = useEffectEvent(() => {
    stop("menu");
    stop("back");
    stop("forward");
    stop("select");
  });

  const beginPointer = useEffectEvent((button: HoldButton, event: PointerEvent) => {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    const rec = holds.current[button];
    if (rec.pointerId !== undefined) return;
    let delay = LONG_PRESS_MS;
    const repeat = button === "back" || button === "forward";
    if (button === "select") {
      if (selectHoldMs === null || !onSelectHold) {
        rec.fired = false;
        return;
      }
      delay = selectHoldMs;
    }
    rec.fired = false;
    const target = event.currentTarget;
    if (target instanceof Element) {
      try {
        // Touch and pen capture implicitly, which swallows pointerleave.
        if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      } catch {
        // Implicit capture may already have been released.
      }
    }
    const pointerId = event.pointerId;
    rec.pointerId = pointerId;
    clearTimers(rec);
    rec.timer = window.setTimeout(() => {
      if (rec.pointerId !== pointerId) return;
      rec.timer = undefined;
      rec.fired = true;
      fire(button, false);
      if (!repeat) return;
      rec.interval = window.setInterval(() => {
        if (rec.pointerId !== pointerId) return;
        fire(button, true);
      }, REPEAT_MS);
    }, delay);
  });

  const finishPointer = useEffectEvent((button: HoldButton, event: PointerEvent) => {
    const rec = holds.current[button];
    if (rec.pointerId !== event.pointerId) return;
    stop(button);
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cleanups: Array<() => void> = [];

    const bind = (button: WheelButton) => {
      const el = root.querySelector<HTMLButtonElement>(`[data-testid="${BUTTON_IDS[button]}"]`);
      if (!el) return;
      const down = (event: PointerEvent) => {
        keyClickLatch.current[button] = false;
        if (button !== "playpause") beginPointer(button, event);
      };
      const end = (event: PointerEvent) => {
        if (button !== "playpause") finishPointer(button, event);
      };
      const click = () => {
        if (keyClickLatch.current[button]) {
          keyClickLatch.current[button] = false;
          return;
        }
        if (button !== "playpause" && holds.current[button].fired) {
          holds.current[button].fired = false;
          return;
        }
        activate(button);
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", end);
      el.addEventListener("pointerleave", end);
      el.addEventListener("pointercancel", end);
      el.addEventListener("click", click);
      cleanups.push(() => {
        el.removeEventListener("pointerdown", down);
        el.removeEventListener("pointerup", end);
        el.removeEventListener("pointerleave", end);
        el.removeEventListener("pointercancel", end);
        el.removeEventListener("click", click);
      });
    };

    bind("menu");
    bind("back");
    bind("forward");
    bind("playpause");
    bind("select");
    return () => {
      for (const cleanup of cleanups) cleanup();
      dismiss();
    };
  }, [rootRef, keyClickLatch]);

  useEffect(() => {
    const onBlur = () => dismiss();
    const onHide = () => {
      if (document.visibilityState === "hidden") dismiss();
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onBlur);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onBlur);
      document.removeEventListener("visibilitychange", onHide);
      dismiss();
    };
  }, []);

  useEffect(() => {
    if (disabled) dismiss();
  }, [disabled]);

  useEffect(() => {
    if (selectHoldMs === null) stop("select");
  }, [selectHoldMs]);
}
