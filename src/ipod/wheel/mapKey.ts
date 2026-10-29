import { REPEAT_MS } from "./timing.ts";
import type { WheelButton, WheelScrollTarget } from "./types.ts";

export type KeyState =
  | { kind: "scroll"; step: 1 | -1 }
  | { kind: "steer"; step: 1 | -1 }
  | { kind: "hold"; button: WheelButton; repeatInterval?: number }
  | { kind: "press"; button: WheelButton }
  | { kind: "none" };

export function mapWheelKey(
  key: string,
  scrollTarget: WheelScrollTarget,
  selectHoldMs: number | null,
  rtl: boolean,
): KeyState | undefined {
  switch (key) {
    case "ArrowUp":
    case "ArrowDown": {
      if (scrollTarget === "brick") return { kind: "none" };
      const step: 1 | -1 = key === (scrollTarget === "list" ? "ArrowDown" : "ArrowUp") ? 1 : -1;
      return { kind: "scroll", step };
    }
    case "ArrowLeft":
    case "ArrowRight": {
      const left = key === "ArrowLeft";
      const step: 1 | -1 = left ? -1 : 1;
      if (scrollTarget === "seek") return { kind: "scroll", step };
      if (scrollTarget === "brick") return { kind: "steer", step };
      if (scrollTarget === "volume") {
        return { kind: "hold", button: left ? "back" : "forward", repeatInterval: REPEAT_MS };
      }
      return { kind: "press", button: left !== rtl ? "menu" : "select" };
    }
    case "Enter":
      return selectHoldMs === null
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

/** Enter/Space while a wheel button is focused. Null keeps the browser click. */
export function buttonActivationKey(
  button: WheelButton,
  selectHoldMs: number | null,
): KeyState | null {
  switch (button) {
    case "menu":
      return { kind: "hold", button: "menu" };
    case "back":
      return { kind: "hold", button: "back", repeatInterval: REPEAT_MS };
    case "forward":
      return { kind: "hold", button: "forward", repeatInterval: REPEAT_MS };
    case "select":
      return selectHoldMs === null ? null : { kind: "hold", button: "select" };
    default:
      return null;
  }
}

export function buttonFromTarget(target: EventTarget | null): WheelButton | null {
  if (!(target instanceof Element)) return null;
  const button = target.closest("button");
  if (!button) return null;
  switch (button.dataset.testid) {
    case "wheel-menu-button":
      return "menu";
    case "wheel-back-button":
      return "back";
    case "wheel-forward-button":
      return "forward";
    case "wheel-playpause-button":
      return "playpause";
    case "wheel-select-button":
      return "select";
    default:
      return null;
  }
}
