import type { Track } from "../types.ts";
import { createClockStore, type ClockStore } from "./clockStore.ts";
import { createSeekGate, createVolumeControl } from "./coalesce.ts";
import { CommandLane } from "./commandLane.ts";
import { identityOrder, orderPosition, RESTART_SECONDS, shuffledOrder, WINDOW_LIMIT } from "./order.ts";
import { fail, halt, haltLane, ingest, resync, restartCurrent, skip } from "./sessionFollow.ts";
import { assign, playingOf, viewOf, type SessionCore, type SessionState } from "./sessionHost.ts";
import { startPlay } from "./sessionPlay.ts";
import { blankMemory } from "../spotify/stateFollow.ts";
import type { PlaybackSnapshot, PlayerTransport, RepeatMode } from "./types.ts";

const VOLUME_DELAY_MS = 150;

export type SessionOptions = {
  transport: PlayerTransport;
  volume?: number;
  clock?: ClockStore;
  now?: () => number;
  random?: () => number;
  windowLimit?: number;
  volumeDelay?: number;
  scheduleVolume?: (callback: () => void, ms: number) => () => void;
};

function timeout(callback: () => void, ms: number) {
  const id = setTimeout(callback, ms);
  return () => clearTimeout(id);
}

function clamp01(volume: number) {
  return Math.min(1, Math.max(0, volume));
}

export class PlayerSession {
  private readonly core: SessionCore;

  constructor(options: SessionOptions) {
    const now = options.now ?? (() => Date.now());
    const state: SessionState = {
      queue: [],
      index: -1,
      orderPos: 0,
      volume: clamp01(options.volume ?? 1),
      error: null,
      hasLoaded: false,
      loading: false,
      finished: false,
    };
    const core = {
      transport: options.transport,
      clock: options.clock ?? createClockStore({ now }),
      now,
      random: options.random ?? Math.random,
      windowLimit: options.windowLimit ?? WINDOW_LIMIT,
      resolveTrack: async (track: Track) => (track.id ? { url: `spotify:track:${track.id}`, kind: "full" as const } : null),
      shuffle: false,
      repeat: "off" as RepeatMode,
      order: [] as number[],
      memory: blankMemory(),
      optimistic: null as boolean | null,
      sdkPlaying: false,
      accepting: false,
      committed: false,
      queueFinished: false,
      loadedEpoch: 0,
      state,
      listeners: new Set<() => void>(),
    } as SessionCore;
    core.cached = viewOf(core);
    core.lane = new CommandLane((reason) => fail(core, reason));
    core.seeks = createSeekGate(
      (ms, signal) => core.transport.seek(ms, signal),
      () => resync(core),
    );
    core.volumes = createVolumeControl(
      (volume) => core.transport.setVolume(volume),
      options.volumeDelay ?? VOLUME_DELAY_MS,
      options.scheduleVolume ?? timeout,
    );
    this.core = core;
  }

  readonly clockApi = {
    subscribe: (listener: () => void) => this.core.clock.subscribe(listener),
    getSnapshot: () => this.core.clock.getSnapshot(),
  };

  subscribe = (listener: () => void) => {
    this.core.listeners.add(listener);
    return () => this.core.listeners.delete(listener);
  };

  getSnapshot = () => this.core.cached;
  getServerSnapshot = () => this.core.cached;
  getVolume = () => this.core.state.volume;
  idle = () => this.core.lane.idle();

  playbackSnapshot = (): PlaybackSnapshot => ({
    queue: this.core.state.queue,
    index: this.core.state.index,
    finished: this.core.state.finished,
    hasLoaded: this.core.state.hasLoaded,
  });

  configure(options: {
    shuffle: boolean;
    repeat: RepeatMode;
    resolve: SessionCore["resolveTrack"];
    onVolumeChange?: (volume: number) => void;
    onQueueFinished?: () => void;
  }) {
    this.core.resolveTrack = options.resolve;
    this.core.onVolumeChange = options.onVolumeChange;
    this.core.onQueueFinished = options.onQueueFinished;
    this.setShuffle(options.shuffle);
    this.setRepeat(options.repeat);
  }

  setExternalVolume(volume: number) {
    if (!Number.isFinite(volume)) return;
    const next = clamp01(volume);
    if (Math.abs(next - this.core.state.volume) >= 1e-4) assign(this.core, { volume: next });
    this.core.volumes.flushNow(next);
  }

  setShuffle(next: boolean) {
    const core = this.core;
    if (next === core.shuffle) return;
    core.shuffle = next;
    if (core.state.queue.length === 0) return;
    const pinned = core.state.index >= 0 ? core.state.index : 0;
    core.order = next ? shuffledOrder(core.state.queue.length, pinned, core.random) : identityOrder(core.state.queue.length);
    assign(core, { orderPos: orderPosition(core.order, pinned) });
    if (core.committed) startPlay(core, pinned, playingOf(core), true);
  }

  setRepeat(next: RepeatMode) {
    if (next === this.core.repeat) return;
    this.core.repeat = next;
    if (this.core.committed && this.core.state.index >= 0) startPlay(this.core, this.core.state.index, playingOf(this.core), true);
  }

  playQueue = (tracks: Track[], startIndex = 0) => {
    if (tracks.length === 0) return;
    const start = Math.min(tracks.length - 1, Math.max(0, startIndex));
    const core = this.core;
    core.order = core.shuffle ? shuffledOrder(tracks.length, start, core.random) : identityOrder(tracks.length);
    core.queueFinished = false;
    assign(core, { queue: tracks, finished: false });
    startPlay(core, start, true, false);
  };

  toggle = () => {
    const core = this.core;
    if (core.state.finished) return;
    const track = core.state.index >= 0 ? core.state.queue[core.state.index] : undefined;
    if (core.state.hasLoaded && track) {
      if (playingOf(core)) this.pause();
      else this.resume();
      return;
    }
    if (core.state.loading) {
      this.pause();
      return;
    }
    if (core.state.queue.length > 0 && core.state.index >= 0) startPlay(core, core.state.index, true, false);
  };

  pause = () => {
    const core = this.core;
    core.optimistic = false;
    core.clock.setPaused(true);
    assign(core, { loading: false });
    void core.lane.run(async (ctx) => {
      await core.transport.pause(ctx.signal);
      if (!ctx.live()) return;
    });
  };

  resume = () => {
    const core = this.core;
    if (!core.committed && core.state.index >= 0) {
      startPlay(core, core.state.index, true, false);
      return;
    }
    core.optimistic = true;
    core.clock.setPaused(false);
    assign(core, {});
    void core.lane.run(async (ctx) => {
      await core.transport.resume(ctx.signal);
      if (!ctx.live()) return;
    });
  };

  next = () => skip(this.core, 1);

  previous = () => {
    const core = this.core;
    if (core.state.finished || core.state.queue.length === 0) return;
    if (core.repeat === "one" || (playingOf(core) && core.clock.preciseSeconds() > RESTART_SECONDS)) {
      restartCurrent(core, false);
      return;
    }
    skip(core, -1);
  };

  seek = (deltaSeconds: number) => {
    if (!Number.isFinite(deltaSeconds)) return;
    void this.seekTo(this.core.clock.preciseSeconds() + deltaSeconds);
  };

  seekTo = (seconds: number) => {
    const core = this.core;
    if (!Number.isFinite(seconds) || !core.state.hasLoaded || core.state.finished) return Promise.resolve();
    const durationMs = core.clock.durationMs();
    let ms = Math.max(0, seconds * 1000);
    if (durationMs > 0) ms = Math.min(ms, durationMs);
    core.clock.seekLocal(ms);
    return core.seeks.seek(Math.round(ms));
  };

  setVolume = (volume: number) => {
    if (!Number.isFinite(volume)) return;
    const next = clamp01(volume);
    if (Math.abs(next - this.core.state.volume) < 1e-4) return;
    assign(this.core, { volume: next });
    this.core.onVolumeChange?.(next);
    this.core.volumes.push(next);
  };

  adjustVolume = (delta: number) => {
    if (!Number.isFinite(delta)) return;
    this.setVolume(this.core.state.volume + delta);
  };

  stop = () => {
    haltLane(this.core);
    this.core.queueFinished = false;
    this.core.order = [];
    assign(this.core, {
      queue: [],
      index: -1,
      orderPos: 0,
      error: null,
      hasLoaded: false,
      loading: false,
      finished: false,
    });
    void this.core.transport.pause(new AbortController().signal).catch(() => {});
  };

  suspend() {
    const core = this.core;
    core.accepting = false;
    core.committed = false;
    core.optimistic = null;
    core.sdkPlaying = false;
    core.clock.setPaused(true);
    assign(core, { loading: false });
  }

  reportSdkError = (kind: string, message: string) => {
    if (kind === "authentication" || kind === "session") {
      halt(this.core, message);
      return;
    }
    this.core.optimistic = null;
    this.core.sdkPlaying = false;
    this.core.clock.setPaused(true);
    const keepLoaded = kind === "autoplay" || kind === "playback";
    assign(this.core, {
      error: message,
      loading: false,
      hasLoaded: keepLoaded ? this.core.state.hasLoaded : false,
    });
  };

  ingest = (state: Parameters<typeof ingest>[1]) => ingest(this.core, state);

  refresh = () => resync(this.core);
}

export function createPlayerSession(options: SessionOptions) {
  return new PlayerSession(options);
}
