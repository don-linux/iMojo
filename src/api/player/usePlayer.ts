import { useEffect, useEffectEvent, useLayoutEffect, useSyncExternalStore } from "react";
import { bindSpotifySession, spotifyTransport } from "../spotify/runtime.ts";
import { createClockStore } from "./clockStore.ts";
import { createPlayerSession, type PlayerSession } from "./session.ts";
import type { PlaybackClock, Player, PlayerOptions } from "./types.ts";

let shared: PlayerSession | null = null;

function sharedSession(volume: number) {
  if (shared) return shared;
  const clock = createClockStore();
  const session = createPlayerSession({ transport: spotifyTransport, volume, clock });
  clock.setOnVisible(() => {
    void session.refresh();
  });
  bindSpotifySession(session);
  shared = session;
  return session;
}

export function usePlayer(options: PlayerOptions): Player {
  const session = sharedSession(options.volume);

  const applyOptions = useEffectEvent(() => {
    session.configure({
      shuffle: options.shuffle,
      repeat: options.repeat,
      resolve: options.resolve,
      onVolumeChange: options.onVolumeChange,
      onQueueFinished: options.onQueueFinished,
    });
  });

  useLayoutEffect(() => {
    applyOptions();
  });

  useEffect(() => {
    session.setExternalVolume(options.volume);
  }, [options.volume, session]);

  const createEngine = useEffectEvent(() => options.createEngine?.());

  useEffect(() => {
    const engine = createEngine();
    return () => engine?.destroy?.();
  }, []);

  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getServerSnapshot);

  return {
    ...snapshot,
    clock: session.clockApi,
    playQueue: session.playQueue,
    toggle: session.toggle,
    next: session.next,
    previous: session.previous,
    seek: session.seek,
    seekStep: session.seek,
    seekTo: session.seekTo,
    getVolume: session.getVolume,
    getSnapshot: session.playbackSnapshot,
    adjustVolume: session.adjustVolume,
    setVolume: session.setVolume,
    pause: session.pause,
    stop: session.stop,
  };
}

export function usePlaybackClock(player: Player): PlaybackClock {
  return useSyncExternalStore(player.clock.subscribe, player.clock.getSnapshot, player.clock.getSnapshot);
}
