import { useEffect, useEffectEvent, useLayoutEffect, useRef, type RefObject } from "react";
import { buttonActivationKey, buttonFromTarget, mapWheelKey, type KeyState } from "./mapKey.ts";
import { KEY_SCROLL_DELAY_MS, KEY_SCROLL_REPEAT_MS, LONG_PRESS_MS } from "./timing.ts";
import type { HoldDetail, WheelButton, WheelScrollTarget } from "./types.ts";

type KeyboardOptions = {
  rootRef: RefObject<HTMLDivElement | null>;
  draggingRef: RefObject<boolean>;
  keyClickLatch: RefObject<Record<WheelButton, boolean>>;
  disabled: boolean;
  disableSkip: boolean;
  scrollTarget: WheelScrollTarget;
  selectHoldMs: number | null;
  onKeyScroll?: (step: 1 | -1, heldMs: number) => void;
  onSteer?: (step: 1 | -1 | null) => void;
  onMenu: () => void;
  onMenuHold?: () => void;
  onBack: () => void;
  onForward: () => void;
  onBackHold?: (detail: HoldDetail) => void;
  onForwardHold?: (detail: HoldDetail) => void;
  onPlayPause: () => void;
  onSelect: () => void;
  onSelectHold?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

export function useWheelKeyboard({
  rootRef,
  draggingRef,
  keyClickLatch,
  disabled,
  disableSkip,
  scrollTarget,
  selectHoldMs,
  onKeyScroll,
  onSteer,
  onMenu,
  onMenuHold,
  onBack,
  onForward,
  onBackHold,
  onForwardHold,
  onPlayPause,
  onSelect,
  onSelectHold,
  onDragStart,
  onDragEnd,
}: KeyboardOptions) {
  const cancelKeyRef = useRef<(allowClick: boolean) => void>(() => {});
  const syncTargetRef = useRef<(target: WheelScrollTarget, holdMs: number | null) => void>(() => {});

  const emitKeyScroll = useEffectEvent((step: 1 | -1, heldMs: number) => {
    if (disabled) return;
    onKeyScroll?.(step, heldMs);
  });
  const emitSteer = useEffectEvent((step: 1 | -1 | null) => {
    onSteer?.(step);
  });
  const emitDragStart = useEffectEvent(() => {
    onDragStart?.();
  });
  const emitDragEnd = useEffectEvent(() => {
    onDragEnd?.();
  });
  const emitClick = useEffectEvent((button: WheelButton) => {
    if (disabled) return;
    if (button === "menu") onMenu();
    else if (button === "select") onSelect();
    else if (button === "playpause") onPlayPause();
    else if (button === "back") {
      if (!disableSkip) onBack();
    } else if (!disableSkip) onForward();
  });
  const emitHold = useEffectEvent((button: WheelButton, repeat: boolean) => {
    if (disabled) return;
    if (button === "menu") {
      if (onMenuHold) onMenuHold();
      else onMenu();
    } else if (button === "select") {
      if (onSelectHold) onSelectHold();
      else onSelect();
    } else if (button === "back") {
      if (!disableSkip) onBackHold?.({ repeat });
    } else if (button === "forward" && !disableSkip) onForwardHold?.({ repeat });
  });
  const readInput = useEffectEvent(() => ({ disabled, scrollTarget, selectHoldMs }));

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let keyState: KeyState | null = null;
    let activeKey: string | null = null;
    let keyStart = 0;
    let keyTimer: number | undefined;
    let keyInterval: number | undefined;
    let keyFired = false;
    let trackedScroll: WheelScrollTarget | null = null;
    let trackedSelect: number | null | undefined;

    function stopKeyTimers() {
      window.clearTimeout(keyTimer);
      window.clearInterval(keyInterval);
      keyTimer = undefined;
      keyInterval = undefined;
      const fired = keyFired;
      keyFired = false;
      return fired;
    }

    function cancelKeyState(allowClick: boolean) {
      const state = keyState;
      const fired = stopKeyTimers();
      keyState = null;
      activeKey = null;
      if (!state) return;
      if (state.kind === "scroll") {
        if (!draggingRef.current) emitDragEnd();
        return;
      }
      if (state.kind === "steer") {
        emitSteer(null);
        return;
      }
      if (state.kind === "none") return;
      if (allowClick && !fired) emitClick(state.button);
    }

    function beginKey(key: string, mapping: KeyState) {
      const input = readInput();
      cancelKeyState(false);
      activeKey = key;
      keyState = mapping;
      keyStart = performance.now();
      trackedScroll = input.scrollTarget;
      trackedSelect = input.selectHoldMs;
      if (mapping.kind === "scroll") {
        if (!draggingRef.current) emitDragStart();
        emitKeyScroll(mapping.step, 0);
        keyTimer = window.setTimeout(() => {
          keyTimer = undefined;
          const tick = () => {
            emitKeyScroll(mapping.step, performance.now() - keyStart);
          };
          tick();
          keyInterval = window.setInterval(tick, KEY_SCROLL_REPEAT_MS);
        }, KEY_SCROLL_DELAY_MS);
        return;
      }
      if (mapping.kind === "steer") {
        emitSteer(mapping.step);
        return;
      }
      if (mapping.kind !== "hold") return;
      const duration = mapping.button === "select" ? (input.selectHoldMs ?? LONG_PRESS_MS) : LONG_PRESS_MS;
      keyFired = false;
      keyTimer = window.setTimeout(() => {
        keyTimer = undefined;
        keyFired = true;
        emitHold(mapping.button, false);
        if (!mapping.repeatInterval) return;
        keyInterval = window.setInterval(() => {
          emitHold(mapping.button, true);
        }, mapping.repeatInterval);
      }, duration);
    }

    cancelKeyRef.current = cancelKeyState;
    syncTargetRef.current = (target, holdMs) => {
      if (!keyState) return;
      if (trackedScroll === target && trackedSelect === holdMs) return;
      cancelKeyState(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const input = readInput();
      if (input.disabled) return;
      if (event.ctrlKey || event.metaKey || event.altKey) {
        cancelKeyState(false);
        return;
      }
      const focused = buttonFromTarget(event.target);
      let fromButton = false;
      let mapping: KeyState | undefined;
      if (focused && (event.key === "Enter" || event.key === " ")) {
        const hold = buttonActivationKey(focused, input.selectHoldMs);
        if (!hold) return;
        fromButton = true;
        mapping = hold;
      } else {
        const rtl = getComputedStyle(root).direction === "rtl";
        mapping = mapWheelKey(event.key, input.scrollTarget, input.selectHoldMs, rtl);
      }
      if (!mapping) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || event.key === activeKey) return;
      if (fromButton && focused) keyClickLatch.current[focused] = true;
      beginKey(event.key, mapping);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== activeKey) return;
      event.preventDefault();
      event.stopPropagation();
      cancelKeyState(true);
    };

    const onBlur = () => cancelKeyState(false);
    const onHide = () => {
      if (document.visibilityState === "hidden") cancelKeyState(false);
    };

    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("keyup", onKeyUp);
    root.addEventListener("focusout", onBlur);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onBlur);
    document.addEventListener("visibilitychange", onHide);

    return () => {
      cancelKeyRef.current = () => {};
      syncTargetRef.current = () => {};
      cancelKeyState(false);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("keyup", onKeyUp);
      root.removeEventListener("focusout", onBlur);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onBlur);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [rootRef, draggingRef, keyClickLatch]);

  useEffect(() => {
    syncTargetRef.current(scrollTarget, selectHoldMs);
  }, [scrollTarget, selectHoldMs]);

  useEffect(() => {
    if (disabled) cancelKeyRef.current(false);
  }, [disabled]);
}
