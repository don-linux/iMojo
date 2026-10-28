import type { EngineEventMap, PlaybackClock } from "../engine.ts";
import type { SpotifyPlaybackState } from "./sdkTypes.ts";

export function createEngineListeners(): {
  [K in keyof EngineEventMap]: Set<EngineEventMap[K]>;
} {
  return {
    clock: new Set(),
    loaded: new Set(),
    play: new Set(),
    pause: new Set(),
    ended: new Set(),
    error: new Set(),
    advance: new Set(),
    handoff: new Set(),
    revert: new Set(),
  };
}

const EMPTY_CLOCK: PlaybackClock = { currentTime: 0, duration: 0 };

type ClockHooks = {
  running: () => boolean;
  emitClock: (clock: PlaybackClock) => void;
  nearEnd: () => void;
};

export class EngineClock {
  clock: PlaybackClock = EMPTY_CLOCK;
  anchor = { position: 0, at: 0, duration: 0, paused: true };
  private frame = 0;
  private readonly hooks: ClockHooks;

  constructor(hooks: ClockHooks) {
    this.hooks = hooks;
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  ensure() {
    if (!this.hooks.running() || this.frame) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  reset() {
    this.anchor = { position: 0, at: performance.now(), duration: 0, paused: true };
    this.publish();
  }

  restart() {
    this.anchor = { position: 0, at: performance.now(), duration: 0, paused: false };
  }

  resume() {
    this.anchor = { ...this.anchor, paused: false, at: performance.now() };
  }

  freeze() {
    this.anchor = { ...this.anchor, paused: true };
  }

  pause() {
    this.anchor = {
      ...this.anchor,
      paused: true,
      position: this.clock.currentTime * 1000,
      at: performance.now(),
    };
  }

  seek(seconds: number) {
    this.anchor = { ...this.anchor, position: Math.max(0, seconds * 1000), at: performance.now() };
    this.publish();
  }

  note(state: SpotifyPlaybackState, uri: string) {
    const lag = Date.now() - state.timestamp;
    this.anchor = {
      position: state.position,
      at: performance.now() - (Number.isFinite(lag) ? lag : 0),
      duration: state.duration,
      paused: state.paused,
    };
    this.publish();
    return (
      state.paused &&
      state.duration > 0 &&
      state.position > 800 &&
      state.position >= state.duration - 1200 &&
      state.track_window.current_track?.uri === uri
    );
  }

  publish() {
    const elapsed = this.anchor.paused ? 0 : performance.now() - this.anchor.at;
    const position = Math.min(this.anchor.duration, Math.max(0, this.anchor.position + elapsed));
    this.clock = { currentTime: position / 1000, duration: this.anchor.duration / 1000 };
    this.hooks.emitClock(this.clock);
  }

  private tick = () => {
    if (!this.hooks.running()) {
      this.frame = 0;
      return;
    }
    this.publish();
    if (!this.anchor.paused && this.anchor.duration > 0) {
      const position = this.anchor.position + (performance.now() - this.anchor.at);
      if (position >= this.anchor.duration - 250) this.hooks.nearEnd();
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}
