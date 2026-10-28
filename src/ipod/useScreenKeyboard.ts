import { useEffect, useRef, type RefObject } from "react";
import { unlockClick } from "../click.ts";
import type { Frame } from "../menus.ts";
import { MENU_HOLD_MS, type Overlay } from "./model.ts";
import type { HoldSeekState, WheelActions } from "./useWheelActions.ts";

type KeyboardInput = {
  stack: Frame[];
  stackRef: RefObject<Frame[]>;
  overlayRef: RefObject<Overlay>;
  actions: RefObject<WheelActions>;
  notify: () => void;
  holdSeekRef: RefObject<HoldSeekState>;
  seeking: boolean;
};

export function useScreenKeyboard({
  stack,
  stackRef,
  overlayRef,
  actions,
  notify,
  holdSeekRef,
  seeking,
}: KeyboardInput) {
  const cancelScreenEscapeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const handledKeys = new Set([
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "Enter",
      " ",
      "Escape",
    ]);
    const nativeRangeKeys = new Set([
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ]);
    let escapeTimer: number | undefined;
    let escapeArmed = false;
    let escapeFired = false;

    function cancelEscape() {
      window.clearTimeout(escapeTimer);
      escapeTimer = undefined;
      escapeArmed = false;
      escapeFired = false;
    }

    cancelScreenEscapeRef.current = cancelEscape;

    function insideWheel(target: EventTarget | null) {
      return target instanceof Element && target.closest(".click-wheel") != null;
    }

    function currentFrame() {
      return stackRef.current[stackRef.current.length - 1];
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (insideWheel(event.target)) return;
      const name = event.key;
      if (!event.repeat || name.startsWith("Arrow")) notify();
      if (overlayRef.current) {
        if (handledKeys.has(name) || nativeRangeKeys.has(name)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      const frame = currentFrame();
      const mode =
        frame?.id === "now-playing"
          ? "now-playing"
          : frame?.id === "brick"
            ? "passthrough"
            : "list";
      if (mode === "passthrough") return;
      if (mode === "now-playing" && name !== "Escape") {
        const rangeKey = event.target instanceof HTMLInputElement && nativeRangeKeys.has(name);
        const anchorEnter = event.target instanceof HTMLAnchorElement && name === "Enter";
        const native = rangeKey || anchorEnter;
        if (native || handledKeys.has(name)) {
          event.stopPropagation();
          if (!native) event.preventDefault();
        }
        return;
      }
      switch (name) {
        case "ArrowDown":
        case "ArrowUp":
          event.preventDefault();
          event.stopPropagation();
          unlockClick();
          actions.current.screenArrow(name === "ArrowDown" ? 1 : -1);
          break;
        case "ArrowLeft":
        case "ArrowRight":
          event.preventDefault();
          event.stopPropagation();
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          event.stopPropagation();
          unlockClick();
          if (!event.repeat) actions.current.select();
          break;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          unlockClick();
          if (event.repeat) return;
          escapeArmed = true;
          escapeFired = false;
          window.clearTimeout(escapeTimer);
          escapeTimer = window.setTimeout(() => {
            escapeTimer = undefined;
            escapeFired = true;
            if (!overlayRef.current) actions.current.menuHold();
          }, MENU_HOLD_MS);
          break;
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== "Escape" || !escapeArmed) return;
      if (insideWheel(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(escapeTimer);
      escapeTimer = undefined;
      const fired = escapeFired;
      escapeArmed = false;
      escapeFired = false;
      if (!fired) actions.current.menu();
    }

    function onFocusOut() {
      cancelEscape();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("focusout", onFocusOut);
    window.addEventListener("blur", onFocusOut);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("blur", onFocusOut);
      cancelEscape();
    };
  }, []);

  useEffect(() => {
    cancelScreenEscapeRef.current();
  }, [stack]);

  useEffect(() => {
    if (!seeking) return;
    // Entering scrub mode cancels any hold-seek ramp in progress, like the
    // original controller does when `isSeeking` flips on.
    holdSeekRef.current.base = undefined;
    holdSeekRef.current.tier = 0;
  }, [seeking]);
}
