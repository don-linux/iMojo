import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import wheelNoise from "./assets/wheel-noise.png";
import { MenuMark, PlayPauseMark, SkipMark } from "./icons.tsx";
import { attachRing, type ScrollDetail } from "../wheel.ts";

const EXCLUDE_RADIUS = 100 / 276;
const LONG_PRESS_MS = 1000;
const REPEAT_MS = 500;
const KEY_SCROLL_DELAY_MS = 300;
const KEY_SCROLL_REPEAT_MS = 80;

export type WheelScrollTarget = "list" | "seek" | "volume" | "brick";
export type HoldDetail = { repeat: boolean };

type WheelButton = "menu" | "select" | "playpause" | "back" | "forward";

type KeyState =
  | { kind: "scroll"; step: 1 | -1 }
  | { kind: "steer"; step: 1 | -1 }
  | { kind: "hold"; button: WheelButton; repeatInterval?: number }
  | { kind: "press"; button: WheelButton }
  | { kind: "none" };

type ClickWheelProps = {
  playing: boolean;
  scrollTarget: WheelScrollTarget;
  disabled?: boolean;
  disableSkip?: boolean;
  selectHoldMs?: number | null;
  onScroll: (detail: ScrollDetail) => void;
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

export function ClickWheel({
  playing,
  scrollTarget,
  disabled = false,
  disableSkip = false,
  selectHoldMs = null,
  onScroll,
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
}: ClickWheelProps) {
  const ringRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({
    scrollTarget,
    disabled,
    disableSkip,
    selectHoldMs,
    onScroll,
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
  });
  const pointerHold = useRef<{ timer?: number; interval?: number; fired: boolean }>({
    fired: false,
  });
  const pointerDragging = useRef(false);
  const keyState = useRef<KeyState | null>(null);
  const activeKey = useRef<string | null>(null);
  const keyStart = useRef(0);
  const keyTimer = useRef<number | undefined>(undefined);
  const keyInterval = useRef<number | undefined>(undefined);
  const keyFired = useRef(false);
  const keyScrollTarget = useRef<WheelScrollTarget | null>(null);
  const keySelectHoldMs = useRef<number | null | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  propsRef.current.disabled = disabled;

  useEffect(() => {
    propsRef.current = {
      scrollTarget,
      disabled,
      disableSkip,
      selectHoldMs,
      onScroll,
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
    };
  });

  useEffect(() => {
    if (disabled) return;
    const ring = ringRef.current;
    if (!ring) return;
    return attachRing(ring, EXCLUDE_RADIUS, {
      onDragStart() {
        if (propsRef.current.disabled) return;
        pointerDragging.current = true;
        setDragging(true);
        propsRef.current.onDragStart?.();
      },
      onDragEnd() {
        pointerDragging.current = false;
        setDragging(false);
        propsRef.current.onDragEnd?.();
      },
      onRotate() {},
      onScroll(detail) {
        if (propsRef.current.disabled) return;
        propsRef.current.onScroll(detail);
      },
    });
  }, [disabled]);

  useEffect(() => {
    if (!disabled) return;
    resetPointerHold();
    cancelKeyState(false);
    if (!pointerDragging.current) return;
    pointerDragging.current = false;
    setDragging(false);
    propsRef.current.onDragEnd?.();
  }, [disabled]);

  useEffect(() => {
    const onWindowBlur = () => cancelKeyState(false);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      window.clearTimeout(pointerHold.current.timer);
      window.clearInterval(pointerHold.current.interval);
      window.clearTimeout(keyTimer.current);
      window.clearInterval(keyInterval.current);
    };
  }, []);

  useEffect(() => {
    if (
      keyState.current &&
      (keyScrollTarget.current !== scrollTarget || keySelectHoldMs.current !== selectHoldMs)
    ) {
      cancelKeyState(false);
    }
  }, [scrollTarget, selectHoldMs]);

  function clearPointerHold() {
    window.clearTimeout(pointerHold.current.timer);
    window.clearInterval(pointerHold.current.interval);
    pointerHold.current.timer = undefined;
    pointerHold.current.interval = undefined;
  }

  function resetPointerHold() {
    clearPointerHold();
    pointerHold.current.fired = false;
  }

  function beginPointerHold(
    action: (repeat: boolean) => void,
    delay = LONG_PRESS_MS,
    repeat = false,
  ) {
    resetPointerHold();
    pointerHold.current.timer = window.setTimeout(() => {
      pointerHold.current.timer = undefined;
      pointerHold.current.fired = true;
      action(false);
      if (!repeat) return;
      pointerHold.current.interval = window.setInterval(() => action(true), REPEAT_MS);
    }, delay);
  }

  function releaseHoldLatch() {
    if (!pointerHold.current.fired) return;
    window.setTimeout(() => {
      pointerHold.current.fired = false;
    }, 0);
  }

  function endPointerHold(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearPointerHold();
    // The click event (if any) fires after pointerup; release the latch on the
    // next task so a cancelled press cannot swallow the following click.
    releaseHoldLatch();
  }

  function leavePointerHold() {
    clearPointerHold();
    releaseHoldLatch();
  }

  function clickUnlessHeld(action: () => void) {
    if (blocked()) return;
    if (pointerHold.current.fired) {
      pointerHold.current.fired = false;
      return;
    }
    action();
  }

  function blocked() {
    return propsRef.current.disabled;
  }

  function trackPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    if (blocked() || !event.isPrimary || event.button !== 0) return false;
    // No capture: sliding off the button must cancel the hold, as pointerleave
    // does not fire while the button owns the pointer.
    return true;
  }

  function stopKeyTimers() {
    window.clearTimeout(keyTimer.current);
    window.clearInterval(keyInterval.current);
    keyTimer.current = undefined;
    keyInterval.current = undefined;
    const fired = keyFired.current;
    keyFired.current = false;
    return fired;
  }

  function emitButtonClick(button: WheelButton) {
    const props = propsRef.current;
    if (button === "menu") props.onMenu();
    else if (button === "select") props.onSelect();
    else if (button === "playpause") props.onPlayPause();
    else if (button === "back") {
      if (!props.disableSkip) props.onBack();
    } else if (button === "forward") {
      if (!props.disableSkip) props.onForward();
    }
  }

  function emitButtonHold(button: WheelButton, repeat: boolean) {
    const props = propsRef.current;
    if (button === "menu") {
      if (props.onMenuHold) props.onMenuHold();
      else props.onMenu();
    } else if (button === "select") {
      if (props.onSelectHold) props.onSelectHold();
      else props.onSelect();
    } else if (button === "back") {
      if (!props.disableSkip) props.onBackHold?.({ repeat });
    } else if (button === "forward") {
      if (!props.disableSkip) props.onForwardHold?.({ repeat });
    }
  }

  function cancelKeyState(allowClick: boolean) {
    const state = keyState.current;
    const fired = stopKeyTimers();
    keyState.current = null;
    activeKey.current = null;
    if (!state) return;
    if (state.kind === "scroll") {
      if (!pointerDragging.current) propsRef.current.onDragEnd?.();
      return;
    }
    if (state.kind === "steer") {
      propsRef.current.onSteer?.(null);
      return;
    }
    if (state.kind === "none") return;
    if (allowClick && !fired) emitButtonClick(state.button);
  }

  function startKeyHold(state: Extract<KeyState, { kind: "hold" }>, duration: number) {
    keyFired.current = false;
    keyTimer.current = window.setTimeout(() => {
      keyTimer.current = undefined;
      keyFired.current = true;
      emitButtonHold(state.button, false);
      if (!state.repeatInterval) return;
      keyInterval.current = window.setInterval(
        () => emitButtonHold(state.button, true),
        state.repeatInterval,
      );
    }, duration);
  }

  function startKeyScroll(step: 1 | -1) {
    keyTimer.current = window.setTimeout(() => {
      keyTimer.current = undefined;
      const tick = () => {
        propsRef.current.onKeyScroll?.(step, performance.now() - keyStart.current);
      };
      tick();
      keyInterval.current = window.setInterval(tick, KEY_SCROLL_REPEAT_MS);
    }, KEY_SCROLL_DELAY_MS);
  }

  function mapKey(key: string): KeyState | undefined {
    const props = propsRef.current;
    switch (key) {
      case "ArrowUp":
      case "ArrowDown": {
        if (props.scrollTarget === "brick") return { kind: "none" };
        const step: 1 | -1 =
          key === (props.scrollTarget === "list" ? "ArrowDown" : "ArrowUp") ? 1 : -1;
        return { kind: "scroll", step };
      }
      case "ArrowLeft":
      case "ArrowRight": {
        const left = key === "ArrowLeft";
        const step: 1 | -1 = left ? -1 : 1;
        if (props.scrollTarget === "seek") return { kind: "scroll", step };
        if (props.scrollTarget === "brick") return { kind: "steer", step };
        if (props.scrollTarget === "volume") {
          return { kind: "hold", button: left ? "back" : "forward", repeatInterval: REPEAT_MS };
        }
        const rtl = ringRef.current?.parentElement?.matches(":dir(rtl)") ?? false;
        return { kind: "press", button: left !== rtl ? "menu" : "select" };
      }
      case "Enter":
        return props.selectHoldMs === null
          ? { kind: "press", button: "select" }
          : { kind: "hold", button: "select" };
      case " ":
        return { kind: "press", button: "playpause" };
      case "Escape":
        return { kind: "hold", button: "menu" };
      default:
        return undefined;
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (blocked() || event.target !== ringRef.current) return;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      cancelKeyState(false);
      return;
    }
    const mapping = mapKey(event.key);
    if (!mapping) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || event.key === activeKey.current) return;
    cancelKeyState(false);
    activeKey.current = event.key;
    keyState.current = mapping;
    keyStart.current = performance.now();
    keyScrollTarget.current = propsRef.current.scrollTarget;
    keySelectHoldMs.current = propsRef.current.selectHoldMs;
    if (mapping.kind === "scroll") {
      if (!pointerDragging.current) propsRef.current.onDragStart?.();
      propsRef.current.onKeyScroll?.(mapping.step, 0);
      startKeyScroll(mapping.step);
    } else if (mapping.kind === "steer") {
      propsRef.current.onSteer?.(mapping.step);
    } else if (mapping.kind === "hold") {
      const duration =
        mapping.button === "select"
          ? (propsRef.current.selectHoldMs ?? LONG_PRESS_MS)
          : LONG_PRESS_MS;
      startKeyHold(mapping, duration);
    }
  }

  function handleKeyUp(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== activeKey.current) return;
    event.preventDefault();
    event.stopPropagation();
    cancelKeyState(true);
  }

  function focusRingFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    if (!window.matchMedia("(any-pointer: fine)").matches) return;
    ringRef.current?.focus({ preventScroll: true });
  }

  const style = {
    "--select-button-pct": "28.5714285714%",
    "--scroll-wheel-pct": "78.8571428571%",
    "--wheel-noise-texture": `url(${wheelNoise})`,
  } as CSSProperties;

  return (
    <div
      className={dragging ? "click-wheel dragging" : "click-wheel"}
      data-testid="click-wheel"
      dir="ltr"
      tabIndex={-1}
      style={style}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={() => cancelKeyState(false)}
      onPointerUp={focusRingFromPointer}
    >
      <button
        type="button"
        className="wheel-button menu-button"
        data-testid="wheel-menu-button"
        aria-label="Menu"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onPointerDown={(event) => {
          if (!trackPointer(event)) return;
          beginPointerHold(() => emitButtonHold("menu", false));
        }}
        onPointerUp={endPointerHold}
        onPointerLeave={leavePointerHold}
        onPointerCancel={endPointerHold}
        onClick={() => clickUnlessHeld(() => emitButtonClick("menu"))}
        onContextMenu={(event) => event.preventDefault()}
      >
        <MenuMark />
      </button>

      <button
        type="button"
        className="wheel-button back-button"
        data-testid="wheel-back-button"
        aria-label="Back"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || disableSkip || undefined}
        onPointerDown={(event) => {
          if (!trackPointer(event)) return;
          beginPointerHold((repeat) => emitButtonHold("back", repeat), LONG_PRESS_MS, true);
        }}
        onPointerUp={endPointerHold}
        onPointerLeave={leavePointerHold}
        onPointerCancel={endPointerHold}
        onClick={() => clickUnlessHeld(() => emitButtonClick("back"))}
        onContextMenu={(event) => event.preventDefault()}
      >
        <SkipMark />
      </button>

      <button
        type="button"
        className="wheel-button forward-button"
        data-testid="wheel-forward-button"
        aria-label="Forward"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || disableSkip || undefined}
        onPointerDown={(event) => {
          if (!trackPointer(event)) return;
          beginPointerHold((repeat) => emitButtonHold("forward", repeat), LONG_PRESS_MS, true);
        }}
        onPointerUp={endPointerHold}
        onPointerLeave={leavePointerHold}
        onPointerCancel={endPointerHold}
        onClick={() => clickUnlessHeld(() => emitButtonClick("forward"))}
        onContextMenu={(event) => event.preventDefault()}
      >
        <SkipMark />
      </button>

      <button
        type="button"
        className="wheel-button playpause-button"
        data-testid="wheel-playpause-button"
        aria-label={playing ? "Pause" : "Play"}
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onPointerDown={() => {
          if (blocked()) return;
          resetPointerHold();
        }}
        onClick={() => clickUnlessHeld(() => emitButtonClick("playpause"))}
        onContextMenu={(event) => event.preventDefault()}
      >
        <PlayPauseMark />
      </button>

      <div className="wheel-dividers" aria-hidden="true" />
      <div
        className="scroll-wheel"
        data-testid="wheel-ring"
        aria-hidden="true"
        tabIndex={-1}
        ref={ringRef}
        onPointerDown={() => {
          if (blocked() || !window.matchMedia("(any-pointer: fine)").matches) return;
          ringRef.current?.focus({ preventScroll: true });
        }}
      />
      <button
        type="button"
        className="select-button"
        data-testid="wheel-select-button"
        aria-label="Select"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onPointerDown={(event) => {
          if (!trackPointer(event)) return;
          const props = propsRef.current;
          if (props.selectHoldMs === null || !props.onSelectHold) {
            resetPointerHold();
            return;
          }
          beginPointerHold(() => propsRef.current.onSelectHold?.(), props.selectHoldMs);
        }}
        onPointerUp={endPointerHold}
        onPointerLeave={leavePointerHold}
        onPointerCancel={endPointerHold}
        onClick={() => clickUnlessHeld(() => emitButtonClick("select"))}
        onContextMenu={(event) => event.preventDefault()}
      />
    </div>
  );
}
