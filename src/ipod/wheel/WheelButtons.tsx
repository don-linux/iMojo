import type { MouseEvent as ReactMouseEvent } from "react";
import { MenuMark, PlayPauseMark, SkipMark } from "../icons.tsx";

function preventContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

export function MenuButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      type="button"
      className="wheel-button menu-button"
      data-testid="wheel-menu-button"
      aria-label="Menu"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onContextMenu={preventContextMenu}
    >
      <MenuMark />
    </button>
  );
}

export function BackButton({ disabled, disableSkip }: { disabled: boolean; disableSkip: boolean }) {
  return (
    <button
      type="button"
      className="wheel-button back-button"
      data-testid="wheel-back-button"
      aria-label="Back"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || disableSkip || undefined}
      onContextMenu={preventContextMenu}
    >
      <SkipMark />
    </button>
  );
}

export function ForwardButton({
  disabled,
  disableSkip,
}: {
  disabled: boolean;
  disableSkip: boolean;
}) {
  return (
    <button
      type="button"
      className="wheel-button forward-button"
      data-testid="wheel-forward-button"
      aria-label="Forward"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || disableSkip || undefined}
      onContextMenu={preventContextMenu}
    >
      <SkipMark />
    </button>
  );
}

export function PlayPauseButton({ disabled, playing }: { disabled: boolean; playing: boolean }) {
  return (
    <button
      type="button"
      className="wheel-button playpause-button"
      data-testid="wheel-playpause-button"
      aria-label={playing ? "Pause" : "Play"}
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onContextMenu={preventContextMenu}
    >
      <PlayPauseMark />
    </button>
  );
}

export function SelectButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      type="button"
      className="select-button"
      data-testid="wheel-select-button"
      aria-label="Select"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onContextMenu={preventContextMenu}
    />
  );
}
