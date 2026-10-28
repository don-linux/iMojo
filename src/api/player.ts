import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Html5PreviewEngine, type PlaybackClock, type PlaybackEngine } from "./engine.ts";
import type { PlaybackSource, Track } from "./types.ts";

export type RepeatMode = "off" | "one" | "all";

type PlayerOptions = {
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  resolve: (track: Track) => Promise<PlaybackSource | null>;
  createEngine?: () => PlaybackEngine;
  onVolumeChange?: (volume: number) => void;
  onQueueFinished?: () => void;
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
  seekTo: (seconds: number) => void;
  getVolume: () => number;
  getSnapshot: () => PlaybackSnapshot;
  adjustVolume: (delta: number) => void;
  setVolume: (volume: number) => void;
  pause: () => void;
  stop: () => void;
};

const EMPTY_CLOCK: PlaybackClock = { currentTime: 0, duration: 0 };
const SEEK_RESTART_SECONDS = 3;
const SEEK_ADVANCE_SECONDS = 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shuffledOrder(length: number, first: number) {
  const rest: number[] = [];
  for (let index = 0; index < length; index += 1) {
    if (index !== first) rest.push(index);
  }
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [rest[index], rest[swap]] = [rest[swap]!, rest[index]!];
  }
  return [first, ...rest];
}

export function usePlayer(options: PlayerOptions): Player {
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [orderPos, setOrderPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState(() => clamp(options.volume, 0, 1));
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);

  const optionsRef = useRef(options);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef(-1);
  // Skips use this. It runs ahead of indexRef between a crossfade starting
  // and the incoming track being shown.
  const logicalIndexRef = useRef(-1);
  const orderPosRef = useRef(0);
  const volumeRef = useRef(clamp(options.volume, 0, 1));
  const requestRef = useRef(0);
  const prefetchRef = useRef(0);
  const nextIndexRef = useRef<number | undefined>(undefined);
  const orderRef = useRef<number[]>([]);
  const loadedRef = useRef(false);
  const loadingRef = useRef(false);
  const playingRef = useRef(false);
  const finishedRef = useRef(false);
  const clockRef = useRef<PlaybackClock>(EMPTY_CLOCK);
  const clockListeners = useRef(new Set<() => void>());
  const createEngineRef = useRef(options.createEngine);

  useEffect(() => {
    optionsRef.current = options;
    createEngineRef.current = options.createEngine;
  });

  const publishClock = useCallback((next: PlaybackClock) => {
    clockRef.current = next;
    for (const listener of clockListeners.current) listener();
  }, []);

  const subscribeClock = useCallback((listener: () => void) => {
    clockListeners.current.add(listener);
    return () => {
      clockListeners.current.delete(listener);
    };
  }, []);

  const getClock = useCallback(() => clockRef.current, []);

  const clock = useMemo<ClockSource>(
    () => ({ subscribe: subscribeClock, getSnapshot: getClock }),
    [subscribeClock, getClock],
  );

  const positionOf = useCallback((queueIndex: number) => {
    if (!optionsRef.current.shuffle) return queueIndex;
    const position = orderRef.current.indexOf(queueIndex);
    return position >= 0 ? position : queueIndex;
  }, []);

  const adjacentIndex = useCallback((from: number, delta: number) => {
    const tracks = queueRef.current;
    if (tracks.length === 0) return undefined;
    const repeat = optionsRef.current.repeat;

    if (!optionsRef.current.shuffle) {
      const target = from + delta;
      if (target >= 0 && target < tracks.length) return target;
      if (repeat !== "all") return undefined;
      return delta === 1 ? 0 : tracks.length - 1;
    }

    const order =
      orderRef.current.length === tracks.length
        ? orderRef.current
        : tracks.map((_, trackIndex) => trackIndex);
    const position = order.indexOf(from);
    const target = (position >= 0 ? position : 0) + delta;
    if (target >= 0 && target < order.length) return order[target];
    if (repeat !== "all") return undefined;
    return order[delta === 1 ? 0 : order.length - 1];
  }, []);

  const autoAdvanceIndex = useCallback(
    (from: number) => {
      if (optionsRef.current.repeat === "one") return from;
      return adjacentIndex(from, 1);
    },
    [adjacentIndex],
  );

  const finishQueue = useCallback(() => {
    if (finishedRef.current) return;
    requestRef.current += 1;
    prefetchRef.current += 1;
    nextIndexRef.current = undefined;
    finishedRef.current = true;
    loadedRef.current = false;
    loadingRef.current = false;
    playingRef.current = false;
    queueRef.current = [];
    indexRef.current = 0;
    logicalIndexRef.current = 0;
    orderPosRef.current = 0;
    orderRef.current = [];
    engineRef.current?.stop();
    setQueue([]);
    setIndex(0);
    setOrderPos(0);
    setHasLoaded(false);
    setLoading(false);
    setFinished(true);
    setPlaying(false);
    publishClock(EMPTY_CLOCK);
    optionsRef.current.onQueueFinished?.();
  }, [publishClock]);

  const prepareNext = useCallback(
    async (tracks: Track[], currentIndex: number) => {
      const engine = engineRef.current;
      const token = prefetchRef.current + 1;
      prefetchRef.current = token;

      if (!engine || finishedRef.current || tracks.length === 0) {
        nextIndexRef.current = undefined;
        engine?.setNext(null);
        return;
      }

      const target = autoAdvanceIndex(currentIndex);
      const track = target === undefined ? undefined : tracks[target];
      if (target === undefined || !track) {
        nextIndexRef.current = undefined;
        engine.setNext(null);
        return;
      }

      nextIndexRef.current = target;
      let source: PlaybackSource | null = null;
      try {
        source = await optionsRef.current.resolve(track);
      } catch {
        source = null;
      }

      if (token !== prefetchRef.current || engineRef.current !== engine) return;
      if (!source) {
        nextIndexRef.current = undefined;
        engine.setNext(null);
        return;
      }
      engine.setNext(source.url);
    },
    [autoAdvanceIndex],
  );

  useEffect(() => {
    const engine = createEngineRef.current?.() ?? new Html5PreviewEngine();
    engineRef.current = engine;
    engine.setVolume(volumeRef.current);

    const unsubscribeClock = engine.on("clock", (next) => publishClock(next));
    const unsubscribeLoaded = engine.on("loaded", (next) => {
      publishClock(next);
      loadedRef.current = true;
      loadingRef.current = false;
      setHasLoaded(true);
    });
    const unsubscribePlay = engine.on("play", () => {
      playingRef.current = true;
      setPlaying(true);
    });
    const unsubscribePause = engine.on("pause", () => {
      playingRef.current = false;
      setPlaying(false);
    });
    const unsubscribeError = engine.on("error", (message) => {
      playingRef.current = false;
      loadingRef.current = false;
      setPlaying(false);
      setError(message ?? "This track cannot be played");
    });
    const unsubscribeEnded = engine.on("ended", () => finishQueue());
    const unsubscribeHandoff = engine.on("handoff", () => {
      const incoming = nextIndexRef.current;
      if (incoming === undefined) return;
      logicalIndexRef.current = incoming;
      void prepareNext(queueRef.current, incoming);
    });
    const unsubscribeRevert = engine.on("revert", () => {
      logicalIndexRef.current = indexRef.current;
      void prepareNext(queueRef.current, indexRef.current);
    });
    const unsubscribeAdvance = engine.on("advance", (next) => {
      publishClock(next);
      const promoted = logicalIndexRef.current;
      if (promoted !== indexRef.current && promoted >= 0) {
        indexRef.current = promoted;
        logicalIndexRef.current = promoted;
        const position = positionOf(promoted);
        orderPosRef.current = position;
        setIndex(promoted);
        setOrderPos(position);
      }
      loadedRef.current = true;
      loadingRef.current = false;
      setHasLoaded(true);
      setError(null);
      const following = autoAdvanceIndex(indexRef.current);
      if (nextIndexRef.current !== following) {
        void prepareNext(queueRef.current, indexRef.current);
      }
    });

    return () => {
      unsubscribeClock();
      unsubscribeLoaded();
      unsubscribePlay();
      unsubscribePause();
      unsubscribeError();
      unsubscribeEnded();
      unsubscribeHandoff();
      unsubscribeRevert();
      unsubscribeAdvance();
      engine.destroy();
      engineRef.current = null;
    };
  }, [autoAdvanceIndex, finishQueue, positionOf, prepareNext, publishClock]);

  useEffect(() => {
    const next = clamp(options.volume, 0, 1);
    if (Math.abs(next - volumeRef.current) < 1e-4) return;
    volumeRef.current = next;
    engineRef.current?.setVolume(next);
    setVolumeState(next);
  }, [options.volume]);

  const setVolume = useCallback((value: number) => {
    const next = clamp(value, 0, 1);
    if (Math.abs(next - volumeRef.current) < 1e-4) return;
    volumeRef.current = next;
    engineRef.current?.setVolume(next);
    setVolumeState(next);
    optionsRef.current.onVolumeChange?.(next);
  }, []);

  const adjustVolume = useCallback(
    (delta: number) => {
      setVolume(volumeRef.current + delta);
    },
    [setVolume],
  );

  const getSnapshot = useCallback(
    (): PlaybackSnapshot => ({
      queue: queueRef.current,
      index: indexRef.current,
      finished: finishedRef.current,
      hasLoaded: loadedRef.current,
    }),
    [],
  );

  const playAt = useCallback(
    async (tracks: Track[], nextIndex: number, forceResume = false) => {
      const track = tracks[nextIndex];
      if (!track) return;

      const resume = forceResume || playingRef.current;
      const wasLoaded = loadedRef.current;
      const request = requestRef.current + 1;
      requestRef.current = request;
      prefetchRef.current += 1;
      nextIndexRef.current = undefined;
      queueRef.current = tracks;
      indexRef.current = nextIndex;
      logicalIndexRef.current = nextIndex;
      const position = positionOf(nextIndex);
      orderPosRef.current = position;
      setQueue(tracks);
      setIndex(nextIndex);
      setOrderPos(position);
      setError(null);
      // Keep hasLoadedItem true across a manual jump so the seek controller can
      // reenter on the new track, exactly like the original store update order.
      if (!wasLoaded) {
        loadedRef.current = false;
        setHasLoaded(false);
      }
      loadingRef.current = true;
      setLoading(true);
      finishedRef.current = false;
      setFinished(false);
      publishClock(EMPTY_CLOCK);

      let source: PlaybackSource | null = null;
      try {
        source = await optionsRef.current.resolve(track);
      } catch {
        source = null;
      }
      if (request !== requestRef.current) return;
      if (!source) {
        loadedRef.current = false;
        loadingRef.current = false;
        playingRef.current = false;
        setHasLoaded(false);
        setLoading(false);
        setPlaying(false);
        setError("Preview unavailable for this track");
        return;
      }

      const engine = engineRef.current;
      if (!engine) {
        loadedRef.current = false;
        loadingRef.current = false;
        setHasLoaded(false);
        setLoading(false);
        return;
      }
      try {
        await engine.load(source.url);
      } catch (reason) {
        if (request !== requestRef.current) return;
        loadedRef.current = false;
        loadingRef.current = false;
        playingRef.current = false;
        setHasLoaded(false);
        setLoading(false);
        setPlaying(false);
        setError(
          reason instanceof Error && reason.message
            ? reason.message
            : "This track cannot be played",
        );
        return;
      }
      if (request !== requestRef.current) return;
      engine.setVolume(volumeRef.current);
      loadedRef.current = true;
      loadingRef.current = false;
      setHasLoaded(true);
      setLoading(false);

      if (resume) {
        try {
          await engine.play();
          if (request !== requestRef.current) return;
          playingRef.current = true;
          setPlaying(true);
        } catch (reason) {
          if (request !== requestRef.current) return;
          playingRef.current = false;
          setPlaying(false);
          setError(
            reason instanceof Error && reason.message
              ? reason.message
              : "This track cannot be played",
          );
          return;
        }
      }

      if (request !== requestRef.current) return;
      void prepareNext(tracks, nextIndex);
    },
    [positionOf, prepareNext, publishClock],
  );

  const playQueue = useCallback(
    (tracks: Track[], startIndex = 0) => {
      if (tracks.length === 0) return;
      const start = clamp(startIndex, 0, tracks.length - 1);
      const shuffled = optionsRef.current.shuffle;
      orderRef.current = shuffled
        ? shuffledOrder(tracks.length, start)
        : tracks.map((_, trackIndex) => trackIndex);
      orderPosRef.current = shuffled ? 0 : start;
      setOrderPos(orderPosRef.current);
      void playAt(tracks, start, true);
    },
    [playAt],
  );

  useEffect(() => {
    const tracks = queueRef.current;
    if (tracks.length === 0) return;
    if (options.shuffle) {
      orderRef.current = shuffledOrder(tracks.length, indexRef.current);
      orderPosRef.current = 0;
    } else {
      orderRef.current = tracks.map((_, trackIndex) => trackIndex);
      orderPosRef.current = indexRef.current;
    }
    setOrderPos(orderPosRef.current);
    if (!finishedRef.current) void prepareNext(tracks, logicalIndexRef.current);
  }, [options.shuffle, prepareNext]);

  useEffect(() => {
    if (queueRef.current.length === 0 || finishedRef.current) return;
    void prepareNext(queueRef.current, logicalIndexRef.current);
  }, [options.repeat, prepareNext]);

  const move = useCallback(
    (delta: number) => {
      const tracks = queueRef.current;
      if (tracks.length === 0 || finishedRef.current) return;

      if (optionsRef.current.repeat === "one") {
        const engine = engineRef.current;
        if (!engine) return;
        engine.seek(0);
        publishClock({ currentTime: 0, duration: clockRef.current.duration });
        return;
      }

      const from = logicalIndexRef.current;
      const target = adjacentIndex(from, delta);
      if (target === undefined) {
        // Still crossfading into the last track: the original ignores the skip
        // until that track is actually shown.
        if (from !== indexRef.current) return;
        finishQueue();
        return;
      }
      void playAt(tracks, target);
    },
    [adjacentIndex, finishQueue, playAt, publishClock],
  );

  const toggle = useCallback(() => {
    const engine = engineRef.current;
    const track = queueRef.current[indexRef.current];
    // hasLoadedItem wins over isLoading, like the original store: a manual jump
    // keeps the item loaded while the next channel is still being prepared.
    if (loadedRef.current && engine && track && !finishedRef.current) {
      if (engine.isPaused()) {
        void engine.play().catch((reason: unknown) => {
          playingRef.current = false;
          setPlaying(false);
          setError(
            reason instanceof Error && reason.message
              ? reason.message
              : "This track cannot be played",
          );
        });
      } else {
        engine.pause();
      }
      return;
    }
    if (loadingRef.current) {
      engine?.pause();
      return;
    }
    if (queueRef.current.length > 0) {
      void playAt(queueRef.current, indexRef.current, true);
    }
  }, [playAt]);

  const previous = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || finishedRef.current) return;
    if (optionsRef.current.repeat === "one") {
      engine.seek(0);
      publishClock({ currentTime: 0, duration: clockRef.current.duration });
      return;
    }
    // The incoming track has just started, so the 3s restart does not apply.
    if (logicalIndexRef.current !== indexRef.current) {
      move(-1);
      return;
    }
    if (playingRef.current && clockRef.current.currentTime > SEEK_RESTART_SECONDS) {
      engine.seek(0);
      publishClock({ currentTime: 0, duration: clockRef.current.duration });
      return;
    }
    move(-1);
  }, [move, publishClock]);

  const seekTo = useCallback(
    (seconds: number) => {
      const engine = engineRef.current;
      if (!engine || finishedRef.current) return;
      const { duration } = clockRef.current;

      if (duration > SEEK_ADVANCE_SECONDS && seconds >= duration - SEEK_ADVANCE_SECONDS) {
        const target = autoAdvanceIndex(indexRef.current);
        if (target !== undefined) {
          if (target === indexRef.current) {
            engine.seek(0);
            publishClock({ currentTime: 0, duration });
          } else {
            void playAt(queueRef.current, target, playingRef.current);
          }
          return;
        }
      }

      const next = clamp(seconds, 0, duration > 0 ? duration : seconds);
      engine.seek(next);
      publishClock({ currentTime: next, duration });
    },
    [autoAdvanceIndex, playAt, publishClock],
  );

  const seek = useCallback(
    (deltaSeconds: number) => {
      seekTo(clockRef.current.currentTime + deltaSeconds);
    },
    [seekTo],
  );

  const pause = useCallback(() => {
    engineRef.current?.pause();
  }, []);

  const next = useCallback(() => move(1), [move]);

  const stop = useCallback(() => {
    requestRef.current += 1;
    prefetchRef.current += 1;
    nextIndexRef.current = undefined;
    engineRef.current?.stop();
    queueRef.current = [];
    indexRef.current = -1;
    logicalIndexRef.current = -1;
    orderPosRef.current = 0;
    orderRef.current = [];
    setQueue([]);
    setIndex(0);
    setOrderPos(0);
    setPlaying(false);
    setHasLoaded(false);
    setLoading(false);
    setError(null);
    loadedRef.current = false;
    loadingRef.current = false;
    playingRef.current = false;
    finishedRef.current = false;
    setFinished(false);
    publishClock(EMPTY_CLOCK);
  }, [publishClock]);

  const track = queue[index] ?? null;

  return {
    queue,
    index,
    orderPos,
    track,
    playing,
    volume,
    error,
    hasLoaded,
    loading,
    finished,
    length: queue.length,
    displayIndex: track ? orderPos + 1 : 0,
    clock,
    playQueue,
    toggle,
    next,
    previous,
    seek,
    seekStep: seek,
    seekTo,
    getVolume: () => volumeRef.current,
    getSnapshot,
    adjustVolume,
    setVolume,
    pause,
    stop,
  };
}

/** Subscribe only the Now Playing screen to transport time changes. */
export function usePlaybackClock(player: Player): PlaybackClock {
  return useSyncExternalStore(
    player.clock.subscribe,
    player.clock.getSnapshot,
    player.clock.getSnapshot,
  );
}
