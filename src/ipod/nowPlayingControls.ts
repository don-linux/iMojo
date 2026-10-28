import { useCallback, useEffect, useRef, useState } from "react";
import { NOW_PLAYING_IDLE_MS, SEEK_COMMIT_MS } from "./playbackTiming.ts";
import { seekTierForHold } from "../wheel.ts";

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Two independent controllers, mirroring the original seek and volume
 * controllers: each owns its idle timer, keep-open latch and preview state.
 */
export function useNowPlayingControls(options: NowPlayingOptions): NowPlayingControls {
  const [seeking, setSeeking] = useState(false);
  const [adjustingVolume, setAdjustingVolume] = useState(false);
  const [seekPreview, setSeekPreview] = useState<number | undefined>(undefined);
  const [indicator, setIndicator] = useState<ActiveNowPlayingMode>("volume");

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const seekingRef = useRef(false);
  const adjustingVolumeRef = useRef(false);
  const seekPreviewRef = useRef<number | undefined>(undefined);
  const seekPendingRef = useRef<number | undefined>(undefined);
  const seekCommitSeq = useRef(0);
  const seekIdleTimer = useRef<number | undefined>(undefined);
  const seekCommitTimer = useRef<number | undefined>(undefined);
  const seekHeldOpen = useRef(false);
  const seekDragging = useRef(false);
  const seekTrackRef = useRef<string | undefined>(undefined);
  const seekQueueRef = useRef<readonly unknown[] | undefined>(undefined);
  const seekIndexRef = useRef<number | undefined>(undefined);
  const volumeIdleTimer = useRef<number | undefined>(undefined);
  const volumeHeldOpen = useRef(false);

  const clearSeekIdle = useCallback(() => {
    window.clearTimeout(seekIdleTimer.current);
    seekIdleTimer.current = undefined;
  }, []);

  const clearSeekCommit = useCallback(() => {
    window.clearTimeout(seekCommitTimer.current);
    seekCommitTimer.current = undefined;
  }, []);

  const clearVolumeIdle = useCallback(() => {
    window.clearTimeout(volumeIdleTimer.current);
    volumeIdleTimer.current = undefined;
  }, []);

  const commitSeek = useCallback(() => {
    clearSeekCommit();
    const target = seekPendingRef.current;
    if (target === undefined) return;
    seekPendingRef.current = undefined;
    const sequence = ++seekCommitSeq.current;
    const result = optionsRef.current.seekTo(target);
    void Promise.resolve(result)
      .catch(() => {})
      .then(() => {
        if (sequence !== seekCommitSeq.current) return;
        seekPreviewRef.current = undefined;
        setSeekPreview(undefined);
      });
  }, [clearSeekCommit]);

  const seekLeave = useCallback(() => {
    if (!seekingRef.current) return;
    clearSeekIdle();
    commitSeek();
    seekTrackRef.current = undefined;
    seekQueueRef.current = undefined;
    seekIndexRef.current = undefined;
    seekPreviewRef.current = undefined;
    setSeekPreview(undefined);
    seekingRef.current = false;
    setSeeking(false);
  }, [clearSeekIdle, commitSeek]);

  const restartSeekIdle = useCallback(() => {
    clearSeekIdle();
    if (seekHeldOpen.current || !seekingRef.current) return;
    seekIdleTimer.current = window.setTimeout(() => {
      seekIdleTimer.current = undefined;
      seekLeave();
    }, NOW_PLAYING_IDLE_MS);
  }, [clearSeekIdle, seekLeave]);

  const seekStart = useCallback(() => {
    const current = optionsRef.current;
    seekTrackRef.current = current.trackId;
    seekQueueRef.current = current.queue;
    seekIndexRef.current = current.trackIndex;
    seekPreviewRef.current = undefined;
    setSeekPreview(undefined);
    seekingRef.current = true;
    setSeeking(true);
    restartSeekIdle();
  }, [restartSeekIdle]);

  const seekKeepOpen = useCallback(() => {
    seekHeldOpen.current = true;
    clearSeekIdle();
    if (!seekingRef.current) seekStart();
  }, [clearSeekIdle, seekStart]);

  const seekRelease = useCallback(() => {
    seekHeldOpen.current = false;
    if (seekingRef.current) restartSeekIdle();
  }, [restartSeekIdle]);

  const seekExit = useCallback(() => {
    seekHeldOpen.current = false;
    if (seekingRef.current) seekLeave();
  }, [seekLeave]);

  // Center click enters with the idle timer. focusSeek latches keep-open
  // because the range stays focused; this must not.
  const toggleSeek = useCallback(() => {
    if (seekingRef.current) {
      seekExit();
      return;
    }
    seekStart();
  }, [seekExit, seekStart]);

  const noteSeekActivity = useCallback(() => {
    if (seekingRef.current) restartSeekIdle();
  }, [restartSeekIdle]);

  const seekReenter = useCallback(() => {
    const wasHeldOpen = seekHeldOpen.current;
    seekLeave();
    if (wasHeldOpen) seekStart();
  }, [seekLeave, seekStart]);

  const scheduleSeekCommit = useCallback(() => {
    clearSeekCommit();
    if (seekDragging.current) return;
    seekCommitTimer.current = window.setTimeout(() => {
      seekCommitTimer.current = undefined;
      commitSeek();
    }, SEEK_COMMIT_MS);
  }, [clearSeekCommit, commitSeek]);

  const seekTo = useCallback(
    (seconds: number) => {
      if (!seekingRef.current) return false;
      const clock = optionsRef.current.getClock();
      const current = seekPreviewRef.current ?? Math.floor(clock.currentTime);
      const max = clock.duration > 0 ? clock.duration : Number.POSITIVE_INFINITY;
      const next = Math.min(max, Math.max(0, Math.round(seconds)));
      restartSeekIdle();
      if (next === current) return false;
      seekPendingRef.current = next;
      seekCommitSeq.current += 1;
      if (!seekDragging.current) scheduleSeekCommit();
      seekPreviewRef.current = next;
      setSeekPreview(next);
      return true;
    },
    [restartSeekIdle, scheduleSeekCommit],
  );

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const current =
        seekPreviewRef.current ?? Math.floor(optionsRef.current.getClock().currentTime);
      return seekTo(current + deltaSeconds);
    },
    [seekTo],
  );

  const volumeLeave = useCallback(() => {
    if (!adjustingVolumeRef.current) return;
    clearVolumeIdle();
    adjustingVolumeRef.current = false;
    setAdjustingVolume(false);
  }, [clearVolumeIdle]);

  const restartVolumeIdle = useCallback(() => {
    clearVolumeIdle();
    if (volumeHeldOpen.current || !adjustingVolumeRef.current) return;
    volumeIdleTimer.current = window.setTimeout(() => {
      volumeIdleTimer.current = undefined;
      volumeLeave();
    }, NOW_PLAYING_IDLE_MS);
  }, [clearVolumeIdle, volumeLeave]);

  const volumeStart = useCallback(() => {
    adjustingVolumeRef.current = true;
    setAdjustingVolume(true);
    restartVolumeIdle();
  }, [restartVolumeIdle]);

  const volumeEnsure = useCallback(() => {
    restartVolumeIdle();
    if (!adjustingVolumeRef.current) volumeStart();
  }, [restartVolumeIdle, volumeStart]);

  const volumeKeepOpen = useCallback(() => {
    volumeHeldOpen.current = true;
    clearVolumeIdle();
    if (!adjustingVolumeRef.current) volumeStart();
  }, [clearVolumeIdle, volumeStart]);

  const volumeRelease = useCallback(() => {
    volumeHeldOpen.current = false;
    if (adjustingVolumeRef.current) restartVolumeIdle();
  }, [restartVolumeIdle]);

  const volumeExit = useCallback(() => {
    volumeHeldOpen.current = false;
    if (adjustingVolumeRef.current) volumeLeave();
  }, [volumeLeave]);

  const setVolumePercent = useCallback(
    (percent: number) => {
      const current = optionsRef.current;
      volumeEnsure();
      const before = Math.round(current.getVolume() * 100);
      const next = clamp(Math.round(percent), 0, 100);
      if (next === before) return false;
      current.setVolume(next / 100);
      return true;
    },
    [volumeEnsure],
  );

  const volumeBy = useCallback(
    (deltaPercent: number) => {
      const before = Math.round(optionsRef.current.getVolume() * 100);
      return setVolumePercent(before + deltaPercent);
    },
    [setVolumePercent],
  );

  const focusSeek = useCallback(() => {
    if (!optionsRef.current.hasLoaded) return;
    volumeExit();
    seekKeepOpen();
  }, [seekKeepOpen, volumeExit]);

  const blurSeek = useCallback(() => {
    commitSeek();
    seekRelease();
  }, [commitSeek, seekRelease]);

  const focusVolume = useCallback(() => {
    seekExit();
    volumeKeepOpen();
  }, [seekExit, volumeKeepOpen]);

  const blurVolume = useCallback(() => {
    volumeRelease();
  }, [volumeRelease]);

  const handleDragStart = useCallback(() => {
    seekDragging.current = true;
    clearSeekCommit();
  }, [clearSeekCommit]);

  const handleDragEnd = useCallback(() => {
    seekDragging.current = false;
    if (seekPendingRef.current !== undefined) scheduleSeekCommit();
  }, [scheduleSeekCommit]);

  const exit = useCallback(() => {
    seekExit();
    volumeExit();
  }, [seekExit, volumeExit]);

  const mode: NowPlayingMode = adjustingVolume ? "volume" : seeking ? "scrubbing" : "progress";

  useEffect(() => {
    if (mode !== "progress") setIndicator(mode);
  }, [mode]);

  const { trackId, trackIndex, queue } = options;

  useEffect(() => {
    if (!seekingRef.current) return;
    if (
      trackId !== seekTrackRef.current ||
      queue !== seekQueueRef.current ||
      trackIndex !== seekIndexRef.current
    ) {
      clearSeekCommit();
      seekPendingRef.current = undefined;
      if (optionsRef.current.hasLoaded) seekReenter();
      else seekExit();
      return;
    }
    const { duration } = optionsRef.current.getClock();
    const preview = seekPreviewRef.current;
    if (duration > 0 && preview !== undefined && preview > duration) {
      if (seekPendingRef.current !== undefined) seekPendingRef.current = duration;
      seekPreviewRef.current = duration;
      setSeekPreview(duration);
    }
  }, [trackId, queue, trackIndex, clearSeekCommit, seekExit, seekReenter]);

  useEffect(
    () => () => {
      window.clearTimeout(seekIdleTimer.current);
      window.clearTimeout(seekCommitTimer.current);
      window.clearTimeout(volumeIdleTimer.current);
    },
    [],
  );

  return {
    mode,
    indicator,
    seekPreview,
    seeking,
    adjustingVolume,
    isSeeking: () => seekingRef.current,
    isAdjustingVolume: () => adjustingVolumeRef.current,
    focusSeek,
    blurSeek,
    focusVolume,
    blurVolume,
    exitVolume: volumeExit,
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
