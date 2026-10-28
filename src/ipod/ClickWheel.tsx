import { useRef, type CSSProperties } from "react";
import type { ScrollDetail } from "../wheel.ts";
import wheelNoise from "./assets/wheel-noise.png";
import { SCROLL_WHEEL_PCT, SELECT_BUTTON_PCT } from "./wheel/geometry.ts";
import type { HoldDetail, WheelButton, WheelScrollTarget } from "./wheel/types.ts";
import { usePointerHold } from "./wheel/usePointerHold.ts";
import { useWheelGesture } from "./wheel/useWheelGesture.ts";
import { useWheelKeyboard } from "./wheel/useWheelKeyboard.ts";
import {
  BackButton,
  ForwardButton,
  MenuButton,
  PlayPauseButton,
  SelectButton,
} from "./wheel/WheelButtons.tsx";

export type { HoldDetail, WheelScrollTarget };

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

const wheelStyle = {
  "--select-button-pct": SELECT_BUTTON_PCT,
  "--scroll-wheel-pct": SCROLL_WHEEL_PCT,
  "--wheel-noise-texture": `url(${wheelNoise})`,
} as CSSProperties;

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
  const rootRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const keyClickLatch = useRef<Record<WheelButton, boolean>>({
    menu: false,
    back: false,
    forward: false,
    playpause: false,
    select: false,
  });
  const gesture = useWheelGesture({
    ringRef,
    draggingRef,
    disabled,
    onScroll,
    onDragStart,
    onDragEnd,
  });
  useWheelKeyboard({
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
  });
  usePointerHold({
    rootRef,
    keyClickLatch,
    disabled,
    disableSkip,
    selectHoldMs,
    onMenu,
    onMenuHold,
    onBack,
    onForward,
    onBackHold,
    onForwardHold,
    onPlayPause,
    onSelect,
    onSelectHold,
  });

  return (
    <div
      ref={rootRef}
      className={gesture.dragging ? "click-wheel dragging" : "click-wheel"}
      data-testid="click-wheel"
      dir="ltr"
      tabIndex={-1}
      style={wheelStyle}
    >
      <MenuButton disabled={disabled} />
      <BackButton disabled={disabled} disableSkip={disableSkip} />
      <ForwardButton disabled={disabled} disableSkip={disableSkip} />
      <PlayPauseButton disabled={disabled} playing={playing} />
      <div className="wheel-dividers" aria-hidden="true" />
      <div
        className="scroll-wheel"
        data-testid="wheel-ring"
        aria-hidden="true"
        tabIndex={-1}
        ref={ringRef}
      />
      <SelectButton disabled={disabled} />
    </div>
  );
}
