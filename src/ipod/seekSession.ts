import { createIdleLatch, type Schedule } from "./idleLatch.ts";
import { NOW_PLAYING_IDLE_MS, SEEK_COMMIT_MS } from "./playbackTiming.ts";

export type SeekClock = {
  currentTime: number;
  duration: number;
};

export type SeekTrack = {
  id?: string;
  index: number;
  queue: readonly unknown[];
  hasLoaded: boolean;
};

export type SeekView = {
  seeking: boolean;
  preview: number | undefined;
};

type TrackIdentity = {
  id: string | undefined;
  index: number;
  queue: readonly unknown[];
};

export type SeekSessionOptions = {
  getClock: () => SeekClock;
  seekTo: (seconds: number) => void | Promise<void>;
  getTrack: () => SeekTrack;
  onChange?: () => void;
  idleMs?: number;
  commitMs?: number;
  schedule?: Schedule;
};

export type SeekSession = {
  view: () => SeekView;
  isSeeking: () => boolean;
  seekTo: (seconds: number) => boolean;
  seekBy: (deltaSeconds: number) => boolean;
  toggle: () => void;
  noteActivity: () => void;
  loaded: () => boolean;
  keepOpen: () => void;
  release: () => void;
  exit: () => void;
  commit: () => void;
  dragStart: () => void;
  dragEnd: () => void;
  syncTrack: () => void;
  destroy: () => void;
};

function identityOf(track: SeekTrack): TrackIdentity {
  return { id: track.id, index: track.index, queue: track.queue };
}

function sameIdentity(left: TrackIdentity, right: TrackIdentity) {
  return left.id === right.id && left.index === right.index && left.queue === right.queue;
}

function finiteClock(clock: SeekClock) {
  const time = Number.isFinite(clock.currentTime) ? Math.max(0, clock.currentTime) : 0;
  if (Number.isFinite(clock.duration) && clock.duration > 0) return Math.min(time, clock.duration);
  return time;
}

function knownDuration(clock: SeekClock) {
  return Number.isFinite(clock.duration) && clock.duration > 0;
}

export function createSeekSession(options: SeekSessionOptions): SeekSession {
  const commitMs = options.commitMs ?? SEEK_COMMIT_MS;
  const schedule = options.schedule;
  let seeking = false;
  let preview: number | undefined;
  let pending: number | undefined;
  let token = 0;
  let dragging = false;
  let dead = false;
  let captured: TrackIdentity | null = null;
  let cancelCommit: (() => void) | undefined;

  const emit = () => {
    if (!dead) options.onChange?.();
  };

  const clearCommit = () => {
    cancelCommit?.();
    cancelCommit = undefined;
  };

  const finish = (sentToken: number, sent: TrackIdentity, ok: boolean) => {
    if (dead || sentToken !== token || !seeking) return;
    if (!sameIdentity(sent, identityOf(options.getTrack()))) return;
    preview = ok ? undefined : finiteClock(options.getClock());
    emit();
  };

  const commit = () => {
    clearCommit();
    if (pending === undefined) return;
    const target = pending;
    pending = undefined;
    const sentToken = ++token;
    const sent = identityOf(options.getTrack());
    let result: Promise<void>;
    try {
      result = Promise.resolve(options.seekTo(target));
    } catch (reason) {
      result = Promise.reject(reason);
    }
    void result.then(
      () => finish(sentToken, sent, true),
      () => finish(sentToken, sent, false),
    );
  };

  const scheduleCommit = () => {
    clearCommit();
    if (dragging) return;
    const arm = schedule ?? ((callback, ms) => {
      const id = setTimeout(callback, ms);
      return () => clearTimeout(id);
    });
    cancelCommit = arm(() => {
      cancelCommit = undefined;
      commit();
    }, commitMs);
  };

  let restartIdle = () => {};

  const enter = () => {
    captured = identityOf(options.getTrack());
    preview = undefined;
    seeking = true;
    emit();
    restartIdle();
  };

  const leave = () => {
    if (!seeking) return;
    clearCommit();
    commit();
    captured = null;
    preview = undefined;
    seeking = false;
    emit();
  };

  const latch = createIdleLatch({
    timeoutMs: options.idleMs ?? NOW_PLAYING_IDLE_MS,
    isActive: () => seeking,
    enter,
    onLeave: leave,
    schedule,
  });
  restartIdle = () => latch.restart();

  const seekTo = (seconds: number) => {
    if (!seeking || !Number.isFinite(seconds)) return false;
    const clock = options.getClock();
    if (!knownDuration(clock)) return false;
    const current = preview ?? Math.floor(finiteClock(clock));
    const next = Math.min(clock.duration, Math.max(0, Math.round(seconds)));
    latch.restart();
    if (next === current) return false;
    pending = next;
    token += 1;
    if (!dragging) scheduleCommit();
    preview = next;
    emit();
    return true;
  };

  return {
    view: () => ({ seeking, preview }),
    isSeeking: () => seeking,
    seekTo,
    seekBy(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds)) return false;
      const clock = options.getClock();
      const current = preview ?? Math.floor(finiteClock(clock));
      return seekTo(current + deltaSeconds);
    },
    toggle() {
      if (seeking) latch.exit();
      else enter();
    },
    noteActivity() {
      if (seeking) latch.restart();
    },
    loaded: () => options.getTrack().hasLoaded,
    keepOpen: () => latch.keepOpen(),
    release: () => latch.release(),
    exit: () => latch.exit(),
    commit,
    dragStart() {
      dragging = true;
      clearCommit();
    },
    dragEnd() {
      dragging = false;
      if (pending !== undefined) scheduleCommit();
    },
    syncTrack() {
      if (!seeking || !captured) return;
      const live = options.getTrack();
      if (!sameIdentity(captured, identityOf(live))) {
        clearCommit();
        pending = undefined;
        token += 1;
        if (live.hasLoaded) latch.reenter();
        else latch.exit();
        return;
      }
      const { duration } = options.getClock();
      if (knownDuration({ currentTime: 0, duration }) && preview !== undefined && preview > duration) {
        if (pending !== undefined) pending = duration;
        preview = duration;
        emit();
      }
    },
    destroy() {
      dead = true;
      clearCommit();
      latch.destroy();
    },
  };
}
