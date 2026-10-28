import type { DevicePlaybackState } from "../player/types.ts";
import type { SpotifyPlaybackState } from "./sdkTypes.ts";

const NEAR_END_MS = 1500;
const START_MS = 250;

export type FollowMemory = {
  generation: number;
  expectedUri: string;
  windowUris: readonly string[];
  windowIndices: readonly number[];
  windowPos: number;
  lastPositionMs: number;
  sawNearEnd: boolean;
  seen: boolean;
  suppressZeroEnd: boolean;
};

export type FollowKind = "ignore" | "displaced" | "progress" | "advance" | "ended";

export type FollowResult = {
  kind: FollowKind;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  timestamp: number;
  queueIndex: number;
  memory: FollowMemory;
  shuffle: boolean;
};

export function blankMemory(): FollowMemory {
  return {
    generation: 0,
    expectedUri: "",
    windowUris: [],
    windowIndices: [],
    windowPos: 0,
    lastPositionMs: 0,
    sawNearEnd: false,
    seen: false,
    suppressZeroEnd: true,
  };
}

function forwardPos(uris: readonly string[], from: number, uri: string) {
  for (let index = from + 1; index < uris.length; index += 1) {
    if (uris[index] === uri) return index;
  }
  return -1;
}

function queueIndexAt(memory: FollowMemory, windowPos: number) {
  return memory.windowIndices[windowPos] ?? memory.windowIndices[memory.windowPos] ?? 0;
}

/**
 * Map one SDK `player_state_changed` sample onto the session window.
 * End is never inferred from a timer: only a URI change, or paused at 0
 * after this generation was already within ~1.5s of a real duration.
 */
export function followPlayback(state: DevicePlaybackState | null, memory: FollowMemory): FollowResult {
  if (!state) {
    return {
      kind: "displaced",
      playing: false,
      positionMs: memory.lastPositionMs,
      durationMs: 0,
      timestamp: 0,
      queueIndex: queueIndexAt(memory, memory.windowPos),
      memory: { ...memory, sawNearEnd: false },
      shuffle: false,
    };
  }

  const current = state.track_window.current_track?.uri ?? null;
  const previous = (state.track_window.previous_tracks ?? []).map((track) => track?.uri ?? null);
  const durationMs = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : 0;
  const positionMs = Number.isFinite(state.position) ? Math.max(0, state.position) : 0;
  const playing = !state.paused;
  const shuffle = state.shuffle === true;
  const queueIndex = queueIndexAt(memory, memory.windowPos);
  const base = { playing, positionMs, durationMs, timestamp: Number.isFinite(state.timestamp) ? state.timestamp : 0, shuffle };

  if (!memory.seen && current !== memory.expectedUri) {
    return { kind: "ignore", ...base, queueIndex, memory };
  }

  if (!current) {
    const prevHasUs = previous.includes(memory.expectedUri);
    if (state.paused && positionMs <= 0 && !memory.suppressZeroEnd && prevHasUs) {
      return {
        kind: "ended",
        ...base,
        queueIndex,
        memory: { ...memory, suppressZeroEnd: true, sawNearEnd: false },
      };
    }
    return { kind: "displaced", ...base, playing: false, queueIndex, memory: { ...memory, sawNearEnd: false } };
  }

  if (current !== memory.expectedUri) {
    const nextPos = forwardPos(memory.windowUris, memory.windowPos, current);
    if (nextPos > memory.windowPos) {
      return {
        kind: "advance",
        ...base,
        queueIndex: queueIndexAt(memory, nextPos),
        memory: {
          ...memory,
          expectedUri: current,
          windowPos: nextPos,
          lastPositionMs: positionMs,
          sawNearEnd: false,
          seen: true,
          suppressZeroEnd: positionMs <= START_MS,
        },
      };
    }
    const leftUs = previous.includes(memory.expectedUri);
    if (leftUs && state.paused && positionMs <= 0) {
      return { kind: "ended", ...base, queueIndex, memory: { ...memory, suppressZeroEnd: true, sawNearEnd: false } };
    }
    return { kind: "displaced", ...base, playing: false, queueIndex, memory: { ...memory, sawNearEnd: false } };
  }

  const near = durationMs > 0 && positionMs > 0 && positionMs >= durationMs - NEAR_END_MS;
  const atZero = positionMs <= 0;
  const prevHasUs = previous.includes(memory.expectedUri);
  if (state.paused && atZero && !memory.suppressZeroEnd && (memory.sawNearEnd || prevHasUs)) {
    return {
      kind: "ended",
      ...base,
      queueIndex,
      memory: { ...memory, seen: true, lastPositionMs: positionMs, sawNearEnd: false, suppressZeroEnd: true },
    };
  }

  const sawNearEnd = near ? true : atZero ? memory.sawNearEnd : false;
  const suppressZeroEnd = atZero ? memory.suppressZeroEnd : near || positionMs > START_MS ? false : memory.suppressZeroEnd;
  return {
    kind: "progress",
    ...base,
    queueIndex,
    memory: { ...memory, seen: true, lastPositionMs: positionMs, sawNearEnd, suppressZeroEnd },
  };
}

export function asDeviceState(state: SpotifyPlaybackState | null): DevicePlaybackState | null {
  if (!state) return null;
  const trackWindow = state.track_window as DevicePlaybackState["track_window"];
  const record = state as DevicePlaybackState;
  return {
    paused: state.paused,
    position: state.position,
    duration: state.duration,
    timestamp: state.timestamp,
    shuffle: typeof record.shuffle === "boolean" ? record.shuffle : undefined,
    track_window: {
      current_track: trackWindow.current_track,
      previous_tracks: trackWindow.previous_tracks,
    },
  };
}
