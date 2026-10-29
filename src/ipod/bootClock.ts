import { BOOT_MAX_MS, BOOT_MIN_MS } from "./model.ts";

export type BootSnapshot = {
  online: boolean;
  minDisplayElapsed: boolean;
  maxHoldElapsed: boolean;
};

function readOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function readVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function createBootClock() {
  let online = readOnline();
  let visible = readVisible();
  let minElapsed = false;
  let maxElapsed = false;
  let booted = false;
  let minRemaining = BOOT_MIN_MS;
  let maxRemaining = BOOT_MAX_MS;
  let minDeadline = 0;
  let maxDeadline = 0;
  let minTimer: number | undefined;
  let maxTimer: number | undefined;
  let detachListeners = () => {};
  const listeners = new Set<() => void>();
  const serverSnapshot: BootSnapshot = {
    online: true,
    minDisplayElapsed: false,
    maxHoldElapsed: false,
  };
  let snapshot: BootSnapshot = {
    online,
    minDisplayElapsed: minElapsed,
    maxHoldElapsed: maxElapsed,
  };

  function publish() {
    if (
      snapshot.online === online &&
      snapshot.minDisplayElapsed === minElapsed &&
      snapshot.maxHoldElapsed === maxElapsed
    ) {
      return;
    }
    snapshot = { online, minDisplayElapsed: minElapsed, maxHoldElapsed: maxElapsed };
    for (const listener of listeners) listener();
  }

  function clearTimers() {
    window.clearTimeout(minTimer);
    window.clearTimeout(maxTimer);
    minTimer = undefined;
    maxTimer = undefined;
  }

  function pause() {
    const now = Date.now();
    if (minTimer !== undefined) minRemaining = Math.max(0, minDeadline - now);
    if (maxTimer !== undefined) maxRemaining = Math.max(0, maxDeadline - now);
    clearTimers();
  }

  function arm() {
    if (!online || !visible) return;
    const now = Date.now();
    if (!booted && !minElapsed && minTimer === undefined) {
      minDeadline = now + minRemaining;
      minTimer = window.setTimeout(() => {
        minTimer = undefined;
        minElapsed = true;
        minRemaining = 0;
        publish();
      }, minRemaining);
    }
    if (!maxElapsed && maxTimer === undefined) {
      maxDeadline = now + maxRemaining;
      maxTimer = window.setTimeout(() => {
        maxTimer = undefined;
        maxElapsed = true;
        maxRemaining = 0;
        publish();
      }, maxRemaining);
    }
  }

  function resetPending() {
    minElapsed = false;
    maxElapsed = false;
    minRemaining = BOOT_MIN_MS;
    maxRemaining = BOOT_MAX_MS;
    minDeadline = 0;
    maxDeadline = 0;
  }

  function setOnline(next: boolean) {
    if (online === next) return;
    online = next;
    pause();
    if (!next) {
      if (!booted) resetPending();
      publish();
      return;
    }
    if (booted) {
      maxElapsed = true;
      publish();
      return;
    }
    resetPending();
    arm();
    publish();
  }

  function setVisible(next: boolean) {
    if (visible === next) return;
    visible = next;
    if (!next) {
      pause();
      return;
    }
    arm();
  }

  function attach() {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onVisibility = () => setVisible(readVisible());
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    detachListeners = () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    visible = readVisible();
    online = readOnline();
    arm();
    publish();
  }

  function detach() {
    detachListeners();
    detachListeners = () => {};
    pause();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) attach();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) detach();
      };
    },
    getSnapshot() {
      return snapshot;
    },
    getServerSnapshot() {
      return serverSnapshot;
    },
    markBooted() {
      if (booted) return;
      booted = true;
      // Max hold still has to latch, including after a hide that paused it.
      window.clearTimeout(minTimer);
      minTimer = undefined;
    },
  };
}
