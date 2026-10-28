import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { seekTierForHold } from "../wheel.ts";
import { createSeekSession, type SeekSession, type SeekView } from "./seekSession.ts";
import { createVolumeSession, type VolumeSession } from "./volumeSession.ts";

export type NowPlayingMode = "progress" | "volume" | "scrubbing";
type ActiveNowPlayingMode = Exclude<NowPlayingMode, "progress">;

type NowPlayingOptions = {
  getClock: () => { currentTime: number; duration: number };
  getVolume: () => number;
  seekTo: (seconds: number) => void | Promise<void>;
  setVolume: (volume: number) => void;
  hasLoaded: boolean;
  trackId?: string;
  trackIndex: number;
  queue: readonly unknown[];
};

export type NowPlayingControls = {
  mode: NowPlayingMode;
  indicator: ActiveNowPlayingMode;
  seekPreview: number | undefined;
  seeking: boolean;
  adjustingVolume: boolean;
  isSeeking: () => boolean;
  isAdjustingVolume: () => boolean;
  focusSeek: () => void;
  blurSeek: () => void;
  focusVolume: () => void;
  blurVolume: () => void;
  exitVolume: () => void;
  commitSeek: () => void;
  toggleSeek: () => void;
  noteSeekActivity: () => void;
  seekTo: (seconds: number) => boolean;
  seekBy: (deltaSeconds: number) => boolean;
  seekTierForHold: (heldMs: number) => number;
  volumeBy: (deltaPercent: number) => boolean;
  setVolumePercent: (percent: number) => boolean;
  handleDragStart: () => void;
  handleDragEnd: () => void;
  exit: () => void;
};

const EMPTY_SEEK: SeekView = { seeking: false, preview: undefined };

type Sessions = { seek: SeekSession; volume: VolumeSession };

export function useNowPlayingControls(options: NowPlayingOptions): NowPlayingControls {
  const [seekView, setSeekView] = useState<SeekView>(EMPTY_SEEK);
  const [adjustingVolume, setAdjustingVolume] = useState(false);
  const [indicator, setIndicator] = useState<ActiveNowPlayingMode>("volume");
  const sessions = useRef<Sessions | null>(null);

  const readOptions = useEffectEvent(() => options);

  const publish = useEffectEvent(() => {
    const nextSeek = sessions.current?.seek.view() ?? EMPTY_SEEK;
    const nextVolume = sessions.current?.volume.isAdjusting() ?? false;
    setSeekView((current) =>
      current.seeking === nextSeek.seeking && current.preview === nextSeek.preview ? current : nextSeek,
    );
    setAdjustingVolume((current) => (current === nextVolume ? current : nextVolume));
    if (nextVolume) setIndicator((current) => (current === "volume" ? current : "volume"));
    else if (nextSeek.seeking) {
      setIndicator((current) => (current === "scrubbing" ? current : "scrubbing"));
    }
  });

  useLayoutEffect(() => {
    const seek = createSeekSession({
      getClock: () => readOptions().getClock(),
      seekTo: (seconds) => readOptions().seekTo(seconds),
      getTrack: () => {
        const current = readOptions();
        return {
          id: current.trackId,
          index: current.trackIndex,
          queue: current.queue,
          hasLoaded: current.hasLoaded,
        };
      },
      onChange: () => publish(),
    });
    const volume = createVolumeSession({
      getVolume: () => readOptions().getVolume(),
      setVolume: (value) => readOptions().setVolume(value),
      onChange: () => publish(),
    });
    sessions.current = { seek, volume };
    return () => {
      sessions.current = null;
      seek.destroy();
      volume.destroy();
    };
  }, []);

  useEffect(() => {
    sessions.current?.seek.syncTrack();
  }, [options.trackId, options.trackIndex, options.queue]);

  const focusSeek = useCallback(() => {
    const current = sessions.current;
    if (!current?.seek.loaded()) return;
    current.volume.exit();
    current.seek.keepOpen();
  }, []);

  const blurSeek = useCallback(() => {
    sessions.current?.seek.commit();
    sessions.current?.seek.release();
  }, []);

  const focusVolume = useCallback(() => {
    sessions.current?.seek.exit();
    sessions.current?.volume.keepOpen();
  }, []);

  const blurVolume = useCallback(() => {
    sessions.current?.volume.release();
  }, []);

  const exitVolume = useCallback(() => {
    sessions.current?.volume.exit();
  }, []);

  const commitSeek = useCallback(() => {
    sessions.current?.seek.commit();
  }, []);

  // Center click enters with the idle timer. focusSeek latches keep-open
  // because the range stays focused; this must not.
  const toggleSeek = useCallback(() => {
    sessions.current?.seek.toggle();
  }, []);

  const noteSeekActivity = useCallback(() => {
    sessions.current?.seek.noteActivity();
  }, []);

  const seekTo = useCallback((seconds: number) => sessions.current?.seek.seekTo(seconds) ?? false, []);

  const seekBy = useCallback(
    (deltaSeconds: number) => sessions.current?.seek.seekBy(deltaSeconds) ?? false,
    [],
  );

  const volumeBy = useCallback(
    (deltaPercent: number) => sessions.current?.volume.step(deltaPercent) ?? false,
    [],
  );

  const setVolumePercent = useCallback(
    (percent: number) => sessions.current?.volume.setPercent(percent) ?? false,
    [],
  );

  const handleDragStart = useCallback(() => {
    sessions.current?.seek.dragStart();
  }, []);

  const handleDragEnd = useCallback(() => {
    sessions.current?.seek.dragEnd();
  }, []);

  const exit = useCallback(() => {
    sessions.current?.seek.exit();
    sessions.current?.volume.exit();
  }, []);

  const mode: NowPlayingMode = adjustingVolume ? "volume" : seekView.seeking ? "scrubbing" : "progress";

  return {
    mode,
    indicator,
    seekPreview: seekView.preview,
    seeking: seekView.seeking,
    adjustingVolume,
    isSeeking: () => sessions.current?.seek.isSeeking() ?? false,
    isAdjustingVolume: () => sessions.current?.volume.isAdjusting() ?? false,
    focusSeek,
    blurSeek,
    focusVolume,
    blurVolume,
    exitVolume,
    commitSeek,
    toggleSeek,
    noteSeekActivity,
    seekTo,
    seekBy,
    seekTierForHold,
    volumeBy,
    setVolumePercent,
    handleDragStart,
    handleDragEnd,
    exit,
  };
}
