import { HOLD_SEEK_TIERS } from "./model.ts";

export type HoldSeekState = {
  base?: number;
  track?: number;
  tier: number;
};

export type HoldSeekSample = {
  repeat: boolean;
  step: 1 | -1;
  inert: boolean;
  seeking: boolean;
  hasLoaded: boolean;
  currentTime: number;
  duration: number;
  index: number;
};

export function stepHoldSeek(state: HoldSeekState, sample: HoldSeekSample) {
  const armed: HoldSeekState = sample.repeat
    ? state
    : {
        base: sample.inert ? undefined : sample.currentTime,
        track: sample.index,
        tier: 0,
      };
  if (
    armed.base === undefined ||
    sample.inert ||
    sample.seeking ||
    !sample.hasLoaded ||
    sample.duration <= 0 ||
    sample.index !== armed.track
  ) {
    return { state: armed, target: null as number | null };
  }
  const amount = HOLD_SEEK_TIERS[Math.min(armed.tier, HOLD_SEEK_TIERS.length - 1)]!;
  const target = Math.min(Math.max(armed.base + sample.step * amount, 0), sample.duration);
  const next: HoldSeekState = {
    base: target > 0 && target < sample.duration ? target : undefined,
    track: armed.track,
    tier: armed.tier + 1,
  };
  return { state: next, target };
}

export type LatestSeek = {
  begin: () => void;
  push: (seconds: number) => void;
  cancel: () => void;
};

export function createLatestSeek(seekTo: (seconds: number) => Promise<unknown>): LatestSeek {
  let flight: Promise<unknown> | null = null;
  let pending: number | null = null;
  let sent: number | null = null;

  function finish() {
    flight = null;
    pump();
  }

  function pump() {
    if (flight || pending === null) return;
    if (pending === sent) {
      pending = null;
      return;
    }
    const target = pending;
    pending = null;
    sent = target;
    let started: Promise<unknown>;
    try {
      started = Promise.resolve(seekTo(target));
    } catch (reason) {
      started = Promise.reject(reason);
    }
    flight = started.then(finish, finish);
  }

  return {
    begin() {
      pending = null;
      sent = null;
    },
    push(seconds) {
      pending = seconds;
      pump();
    },
    cancel() {
      pending = null;
    },
  };
}
