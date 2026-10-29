import { BACKLIGHTS, type BacklightMode } from "../menus/model.ts";

function backlightMs(mode: BacklightMode) {
  const ms = BACKLIGHTS.find((entry) => entry.id === mode)?.ms;
  return ms == null ? null : ms;
}

export function createBacklightController(initialMode: BacklightMode) {
  let mode = initialMode;
  let lit = initialMode === "always_on";
  let latch = false;
  let wasLit = false;
  let hidden = false;
  let timer: number | undefined;
  let timerToken = 0;
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) listener();
  }

  function setLit(next: boolean) {
    if (lit === next) return;
    lit = next;
    emit();
  }

  function clearTimer() {
    timerToken += 1;
    window.clearTimeout(timer);
    timer = undefined;
  }

  function apply(next: BacklightMode) {
    mode = next;
    clearTimer();
    if (next === "always_on") {
      setLit(true);
      return;
    }
    if (next === "off") {
      setLit(false);
      return;
    }
    const ms = backlightMs(next);
    setLit(true);
    if (!ms || hidden) return;
    const token = timerToken;
    timer = window.setTimeout(() => {
      if (token !== timerToken) return;
      timer = undefined;
      setLit(false);
    }, ms);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return lit;
    },
    getServerSnapshot() {
      return false;
    },
    syncInitial(next: BacklightMode) {
      mode = next;
      latch = false;
      wasLit = false;
      clearTimer();
      if (next === "always_on") setLit(true);
      else if (next === "off") setLit(false);
    },
    applyMode(next: BacklightMode) {
      latch = false;
      wasLit = false;
      apply(next);
    },
    activity(next: BacklightMode) {
      mode = next;
      if (latch) return;
      if (wasLit) {
        wasLit = false;
        if (next === "always_on") {
          setLit(true);
          return;
        }
      }
      apply(next);
    },
    toggle() {
      const next = !lit;
      latch = next;
      wasLit = lit;
      setLit(next);
    },
    mount() {
      hidden = document.visibilityState === "hidden";
      const onVisibility = () => {
        const nowHidden = document.visibilityState === "hidden";
        if (nowHidden === hidden) return;
        hidden = nowHidden;
        if (nowHidden) {
          clearTimer();
          return;
        }
        this.activity(mode);
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        clearTimer();
      };
    },
  };
}
