import type { PlaybackSource, Track } from "../types.ts";

export type RepeatMode = "off" | "one" | "all";

export type PlaybackClock = {
  currentTime: number;
  duration: number;
};

export type ClockSource = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PlaybackClock;
};

/** Live player state for callbacks that run before React commits an update. */
export type PlaybackSnapshot = {
  queue: Track[];
  index: number;
  finished: boolean;
  hasLoaded: boolean;
};

export type Player = {
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
  clock: ClockSource;
  playQueue: (tracks: Track[], startIndex?: number) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (deltaSeconds: number) => void;
  seekStep: (deltaSeconds: number) => void;
  seekTo: (seconds: number) => Promise<void>;
  getVolume: () => number;
  getSnapshot: () => PlaybackSnapshot;
  adjustVolume: (delta: number) => void;
  setVolume: (volume: number) => void;
  pause: () => void;
  stop: () => void;
};

export type PlayerOptions = {
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  resolve: (track: Track) => Promise<PlaybackSource | null>;
  createEngine?: () => { destroy?: () => void } | void;
  onVolumeChange?: (volume: number) => void;
  onQueueFinished?: () => void;
};

/** URIs handed to Spotify in local play order. `offset` is an index into `uris`. */
export type PlayWindow = {
  uris: readonly string[];
  queueIndices: readonly number[];
  offset: number;
  positionMs?: number;
};

export type DevicePlaybackState = {
  paused: boolean;
  position: number;
  duration: number;
  timestamp: number;
  shuffle?: boolean;
  track_window: {
    current_track: { uri: string | null } | null;
    previous_tracks?: readonly { uri: string | null }[];
  };
};

export type PlayerTransport = {
  playWindow: (window: PlayWindow, signal: AbortSignal) => Promise<void>;
  pause: (signal: AbortSignal) => Promise<void>;
  resume: (signal: AbortSignal) => Promise<void>;
  seek: (positionMs: number, signal: AbortSignal) => Promise<void>;
  setVolume: (volume: number) => Promise<void> | void;
  getState: () => Promise<DevicePlaybackState | null>;
  supportReason?: () => string | null;
  disableDeviceShuffle?: () => void;
};

export class PlaybackFailure extends Error {
  readonly action: "stop" | "message";

  constructor(message: string, action: "stop" | "message") {
    super(message);
    this.name = "PlaybackFailure";
    this.action = action;
  }
}

export function isAbortError(reason: unknown) {
  return reason instanceof Error && reason.name === "AbortError";
}
