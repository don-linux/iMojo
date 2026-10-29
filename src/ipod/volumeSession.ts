import { createIdleLatch, type Schedule } from "./idleLatch.ts";
import { NOW_PLAYING_IDLE_MS } from "./playbackTiming.ts";

export type VolumeSessionOptions = {
  getVolume: () => number;
  setVolume: (volume: number) => void;
  onChange?: () => void;
  idleMs?: number;
  schedule?: Schedule;
};

export type VolumeSession = {
  setPercent: (percent: number) => boolean;
  step: (deltaPercent: number) => boolean;
  displayedPercent: () => number;
  isAdjusting: () => boolean;
  keepOpen: () => void;
  release: () => void;
  exit: () => void;
  destroy: () => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function createVolumeSession(options: VolumeSessionOptions): VolumeSession {
  let adjusting = false;
  let shown: number | undefined;
  let dead = false;

  const emit = () => {
    if (!dead) options.onChange?.();
  };

  const fromPlayer = () => {
    const live = options.getVolume();
    const percent = Math.round((Number.isFinite(live) ? live : 0) * 100);
    return clamp(percent, 0, 100);
  };

  const readPercent = () => {
    const live = fromPlayer();
    if (shown === undefined || shown === live) {
      shown = undefined;
      return live;
    }
    return shown;
  };

  const enter = () => {
    adjusting = true;
    emit();
  };

  const leave = () => {
    if (!adjusting) return;
    adjusting = false;
    emit();
  };

  const latch = createIdleLatch({
    timeoutMs: options.idleMs ?? NOW_PLAYING_IDLE_MS,
    isActive: () => adjusting,
    enter,
    onLeave: leave,
    schedule: options.schedule,
  });

  const ensure = () => {
    latch.restart();
    if (!adjusting) enter();
  };

  const setPercent = (percent: number) => {
    if (!Number.isFinite(percent)) return false;
    ensure();
    const next = clamp(Math.round(percent), 0, 100);
    if (next === readPercent()) return false;
    shown = next;
    options.setVolume(next / 100);
    if (fromPlayer() === next) shown = undefined;
    return true;
  };

  return {
    setPercent,
    step(deltaPercent) {
      if (!Number.isFinite(deltaPercent)) return false;
      return setPercent(readPercent() + deltaPercent);
    },
    displayedPercent: readPercent,
    isAdjusting: () => adjusting,
    keepOpen: () => latch.keepOpen(),
    release: () => latch.release(),
    exit: () => latch.exit(),
    destroy() {
      dead = true;
      latch.destroy();
    },
  };
}
