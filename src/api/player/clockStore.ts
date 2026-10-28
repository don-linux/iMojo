import type { PlaybackClock } from "./types.ts";

const TICK_MS = 250;
const MAX_LAG_MS = 1500;
const EMPTY: PlaybackClock = { currentTime: 0, duration: 0 };

export type ClockSample = {
  positionMs: number;
  timestamp: number;
  durationMs: number;
  paused: boolean;
  generation: number;
};

type Schedule = (callback: () => void, ms: number) => () => void;

export type ClockStoreOptions = {
  now?: () => number;
  schedule?: Schedule;
  visible?: () => boolean;
  listenVisibility?: (onChange: () => void) => () => void;
  onVisible?: () => void;
};

type Anchor = {
  positionMs: number;
  at: number;
  durationMs: number;
  paused: boolean;
  generation: number;
};

function defaultVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function defaultListen(onChange: () => void) {
  if (typeof document === "undefined") return () => {};
  const handler = () => onChange();
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}

function defaultSchedule(callback: () => void, ms: number) {
  const id = setInterval(callback, ms);
  return () => clearInterval(id);
}

export function createClockStore(options: ClockStoreOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? defaultSchedule;
  const isVisible = options.visible ?? defaultVisible;
  let onVisible = options.onVisible;
  let anchor: Anchor = { positionMs: 0, at: now(), durationMs: 0, paused: true, generation: 0 };
  let cached: PlaybackClock = EMPTY;
  let key = "0|0|1";
  let visible = isVisible();
  let cancelTimer: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const projectedMs = () => {
    let position = anchor.positionMs;
    if (!anchor.paused) position += now() - anchor.at;
    if (!Number.isFinite(position) || position < 0) return 0;
    if (anchor.durationMs > 0 && position > anchor.durationMs) return anchor.durationMs;
    return position;
  };

  const materialize = () => {
    const second = Math.floor(projectedMs() / 1000);
    const durationMs = anchor.durationMs > 0 ? anchor.durationMs : 0;
    const duration = durationMs > 0 ? durationMs / 1000 : 0;
    const nextKey = `${second}|${durationMs}|${anchor.paused ? 1 : 0}`;
    if (nextKey === key) return false;
    key = nextKey;
    cached = { currentTime: second, duration };
    return true;
  };

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const syncTimer = () => {
    const should = listeners.size > 0 && visible && !anchor.paused;
    if (should && !cancelTimer) {
      cancelTimer = schedule(() => {
        if (materialize()) emit();
      }, TICK_MS);
      return;
    }
    if (!should && cancelTimer) {
      cancelTimer();
      cancelTimer = null;
    }
  };

  const publish = () => {
    if (materialize()) emit();
    syncTimer();
  };

  const unlisten = (options.listenVisibility ?? defaultListen)(() => {
    const next = isVisible();
    const opened = next && !visible;
    visible = next;
    if (opened) onVisible?.();
    syncTimer();
  });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      syncTimer();
      return () => {
        listeners.delete(listener);
        syncTimer();
      };
    },
    getSnapshot() {
      materialize();
      return cached;
    },
    preciseMs() {
      return projectedMs();
    },
    preciseSeconds() {
      return projectedMs() / 1000;
    },
    durationMs() {
      return anchor.durationMs;
    },
    note(sample: ClockSample) {
      const raw = now() - sample.timestamp;
      const lag = sample.paused || !Number.isFinite(raw) ? 0 : Math.min(MAX_LAG_MS, Math.max(0, raw));
      const durationMs = Number.isFinite(sample.durationMs) && sample.durationMs > 0 ? sample.durationMs : 0;
      const positionMs = Math.max(0, sample.positionMs + (sample.paused ? 0 : lag));
      anchor = {
        positionMs,
        at: now(),
        durationMs,
        paused: sample.paused,
        generation: sample.generation,
      };
      publish();
    },
    seekLocal(ms: number) {
      let position = Math.max(0, ms);
      if (anchor.durationMs > 0) position = Math.min(position, anchor.durationMs);
      anchor = { ...anchor, positionMs: position, at: now() };
      publish();
    },
    setPaused(paused: boolean) {
      anchor = { ...anchor, positionMs: projectedMs(), at: now(), paused };
      publish();
    },
    reset() {
      anchor = { positionMs: 0, at: now(), durationMs: 0, paused: true, generation: 0 };
      publish();
    },
    setOnVisible(listener: () => void) {
      onVisible = listener;
    },
    close() {
      if (cancelTimer) cancelTimer();
      cancelTimer = null;
      unlisten();
      listeners.clear();
    },
  };
}

export type ClockStore = ReturnType<typeof createClockStore>;
