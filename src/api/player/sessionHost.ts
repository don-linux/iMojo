import type { PlaybackSource, Track } from "../types.ts";
import type { ClockStore } from "./clockStore.ts";
import type { createSeekGate, createVolumeControl } from "./coalesce.ts";
import type { CommandLane } from "./commandLane.ts";
import type { FollowMemory } from "../spotify/stateFollow.ts";
import type { PlayerTransport, RepeatMode } from "./types.ts";

export type SessionState = {
  queue: Track[];
  index: number;
  orderPos: number;
  volume: number;
  error: string | null;
  hasLoaded: boolean;
  loading: boolean;
  finished: boolean;
};

export type SessionView = {
  queue: Track[];
  index: number;
  orderPos: number;
  track: Track | null;
  playing: boolean;
  volume: number;
  error: string | null;
  hasLoaded: boolean;
  loading: boolean;
  finished: boolean;
  length: number;
  displayIndex: number;
};

export type SessionCore = {
  transport: PlayerTransport;
  clock: ClockStore;
  now: () => number;
  random: () => number;
  windowLimit: number;
  lane: CommandLane;
  seeks: ReturnType<typeof createSeekGate>;
  volumes: ReturnType<typeof createVolumeControl>;
  resolveTrack: (track: Track) => Promise<PlaybackSource | null>;
  onVolumeChange?: (volume: number) => void;
  onQueueFinished?: () => void;
  shuffle: boolean;
  repeat: RepeatMode;
  order: number[];
  memory: FollowMemory;
  optimistic: boolean | null;
  sdkPlaying: boolean;
  accepting: boolean;
  committed: boolean;
  queueFinished: boolean;
  loadedEpoch: number;
  state: SessionState;
  cached: SessionView;
  listeners: Set<() => void>;
};

export function playingOf(core: SessionCore) {
  return core.optimistic ?? core.sdkPlaying;
}

export function trackAt(core: SessionCore, index: number) {
  return index >= 0 ? core.state.queue[index] : undefined;
}

export function viewOf(core: SessionCore): SessionView {
  const { queue, index, orderPos, volume, error, hasLoaded, loading, finished } = core.state;
  const track = index >= 0 ? (queue[index] ?? null) : null;
  return {
    queue,
    index,
    orderPos,
    track,
    playing: playingOf(core),
    volume,
    error,
    hasLoaded,
    loading,
    finished,
    length: queue.length,
    displayIndex: track ? orderPos + 1 : 0,
  };
}

export function assign(core: SessionCore, partial: Partial<SessionState>) {
  core.state = { ...core.state, ...partial };
  const next = viewOf(core);
  const prev = core.cached;
  if (
    prev.queue === next.queue &&
    prev.index === next.index &&
    prev.orderPos === next.orderPos &&
    prev.track === next.track &&
    prev.playing === next.playing &&
    prev.volume === next.volume &&
    prev.error === next.error &&
    prev.hasLoaded === next.hasLoaded &&
    prev.loading === next.loading &&
    prev.finished === next.finished
  ) {
    return;
  }
  core.cached = next;
  for (const listener of core.listeners) listener();
}
