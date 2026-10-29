import type { Track } from "../types.ts";
import type { DevicePlaybackState, PlayerTransport, PlayWindow } from "./types.ts";

export type PlayCall = { uris: string[]; signal: AbortSignal };

export function track(id: string, durationMs = 30_000): Track {
  return {
    id,
    title: id,
    artistId: "artist",
    artistName: "Artist",
    sourceId: id,
    source: "spotify",
    durationMs,
  };
}

export function deviceState(uri: string, patch: Partial<DevicePlaybackState> = {}): DevicePlaybackState {
  return {
    paused: false,
    position: 0,
    duration: 30_000,
    timestamp: Date.now(),
    ...patch,
    track_window: patch.track_window ?? { current_track: { uri }, previous_tracks: [] },
  };
}

export function fakeTransport() {
  const plays: PlayCall[] = [];
  const seeks: number[] = [];
  const volumes: number[] = [];
  const pauses: number[] = [];
  const resumes: number[] = [];
  let playImpl: ((window: PlayWindow, signal: AbortSignal) => Promise<void>) | null = null;
  let seekImpl: ((ms: number, signal: AbortSignal) => Promise<void>) | null = null;
  let volumeImpl: ((volume: number) => Promise<void> | void) | null = null;
  let support: string | null = null;
  let shuffleFixes = 0;

  const transport: PlayerTransport = {
    playWindow: (window, signal) => {
      plays.push({ uris: [...window.uris], signal });
      return playImpl ? playImpl(window, signal) : Promise.resolve();
    },
    pause: async () => {
      pauses.push(1);
    },
    resume: async () => {
      resumes.push(1);
    },
    seek: (ms, signal) => {
      seeks.push(ms);
      return seekImpl ? seekImpl(ms, signal) : Promise.resolve();
    },
    setVolume: (volume) => {
      volumes.push(volume);
      return volumeImpl ? volumeImpl(volume) : undefined;
    },
    getState: async () => null,
    supportReason: () => support,
    observeState: (state) => {
      if (state?.shuffle === true) shuffleFixes += 1;
    },
    disableDeviceShuffle: () => {
      shuffleFixes += 1;
    },
  };

  return {
    transport,
    plays,
    seeks,
    volumes,
    pauses,
    resumes,
    shuffleFixes: () => shuffleFixes,
    setPlay: (impl: typeof playImpl) => {
      playImpl = impl;
    },
    setSeek: (impl: typeof seekImpl) => {
      seekImpl = impl;
    },
    setVolumeImpl: (impl: typeof volumeImpl) => {
      volumeImpl = impl;
    },
    setSupport: (reason: string | null) => {
      support = reason;
    },
  };
}

export async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("timed out waiting for playback");
}
