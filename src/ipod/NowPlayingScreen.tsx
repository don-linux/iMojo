import { usePlaybackClock, type Player } from "../api/player.ts";
import type { Repeat, Shuffle } from "../menus.ts";
import { Marquee } from "./Marquee.tsx";
import { ProgressBar } from "./ProgressBar.tsx";
import {
  RepeatAllIcon,
  RepeatOneIcon,
  ShuffleIcon,
  VolumeHighIcon,
  VolumeLowIcon,
} from "./icons.tsx";
import {
  formatClock,
  formatDurationWords,
  formatNumber,
  formatPercent,
  formatRemaining,
} from "./playbackTiming.ts";
import type { NowPlayingMode } from "./nowPlayingControls.ts";

const PLAY_MODES_LABEL: Record<Shuffle, Record<Repeat, string>> = {
  off: { off: "", one: "Repeat one", all: "Repeat all" },
  songs: { off: "Shuffle on", one: "Shuffle on, Repeat one", all: "Shuffle on, Repeat all" },
};

function shownTime(raw: number, duration: number) {
  const safe = Number.isFinite(raw) ? raw : 0;
  if (!Number.isFinite(duration) || duration <= 0) return safe;
  return Math.min(duration, Math.max(0, safe));
}

function TrackHeading({
  player,
  track,
  repeat,
  shuffle,
}: {
  player: Player;
  track: NonNullable<Player["track"]>;
  repeat: Repeat;
  shuffle: Shuffle;
}) {
  const modesLabel = PLAY_MODES_LABEL[shuffle][repeat];
  return (
    <>
      <div className="now-playing-index" data-testid="now-playing-index">
        <span>
          {formatNumber(player.displayIndex)} of {formatNumber(player.length)}
        </span>
        {repeat !== "off" || shuffle === "songs" ? (
          <div className="play-modifier" aria-hidden="true">
            {repeat === "one" ? <RepeatOneIcon /> : repeat === "all" ? <RepeatAllIcon /> : null}
            {shuffle === "songs" ? <ShuffleIcon /> : null}
          </div>
        ) : null}
        {modesLabel ? (
          <span className="visually-hidden" data-testid="now-playing-play-modes">
            {modesLabel}
          </span>
        ) : null}
      </div>
      <div className="now-playing-info">
        <div className="song-title" data-testid="now-playing-song-title">
          {track.externalUrl ? (
            <a
              className="song-title-link"
              href={track.externalUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="now-playing-song-link"
            >
              <Marquee text={track.title} resetKey={track.id} />
            </a>
          ) : (
            <Marquee text={track.title} resetKey={track.id} />
          )}
        </div>
        {track.artistName ? (
          <div className="artist" data-testid="now-playing-artist" dir="auto">
            {track.artistName}
          </div>
        ) : null}
        {track.albumName ? (
          <div className="album" data-testid="now-playing-album" dir="auto">
            {track.albumName}
          </div>
        ) : null}
        {player.error ? (
          <div className="now-playing-error" data-testid="now-playing-error" role="status">
            {player.error}
          </div>
        ) : null}
      </div>
    </>
  );
}

function PlaybackTimes({
  player,
  indicator,
  seeking,
  seekPreview,
  onSeekFocus,
  onSeekBlur,
  onSeekInput,
  onSeekCommit,
}: {
  player: Player;
  indicator: "volume" | "scrubbing";
  seeking: boolean;
  seekPreview: number | undefined;
  onSeekFocus: () => void;
  onSeekBlur: () => void;
  onSeekInput: (value: number) => void;
  onSeekCommit: () => void;
}) {
  const clock = usePlaybackClock(player);
  const duration = clock.duration;
  const known = Number.isFinite(duration) && duration > 0;
  const raw = seeking && seekPreview !== undefined ? seekPreview : clock.currentTime;
  const displayTime = shownTime(raw, duration);
  const elapsed = known ? formatClock(displayTime) : "";
  const remaining = formatRemaining(displayTime, duration);
  const positionValue = known ? Math.floor(displayTime) : 0;

  return (
    <>
      <div className="time-and-progress" aria-hidden="true">
        <ProgressBar value={displayTime} max={duration} testId="now-playing-progress" />
        <div className="progress-labels">
          <span data-testid="now-playing-elapsed">{elapsed}</span>
          <span data-testid="now-playing-remaining">{remaining}</span>
        </div>
      </div>
      <div
        className={indicator === "scrubbing" ? "scrubbing-indicator" : "scrubbing-indicator inactive"}
        data-testid="now-playing-scrubber"
      >
        <ProgressBar
          variant="marker"
          value={positionValue}
          max={duration}
          testId="now-playing-scrub"
          label="Playback Progress"
          valueText={formatDurationWords(positionValue)}
          disabled={!player.hasLoaded}
          onInput={onSeekInput}
          onChange={onSeekCommit}
          onFocus={onSeekFocus}
          onBlur={onSeekBlur}
        />
        <div className="progress-labels" aria-hidden="true">
          <span data-testid="now-playing-scrub-elapsed">{elapsed}</span>
          <span data-testid="now-playing-scrub-remaining">{remaining}</span>
        </div>
      </div>
    </>
  );
}

export function NowPlayingScreen({
  player,
  repeat,
  shuffle,
  mode,
  indicator,
  seeking,
  seekPreview,
  onSeekFocus,
  onSeekBlur,
  onSeekInput,
  onSeekCommit,
  onVolumeFocus,
  onVolumeBlur,
  onVolumeInput,
}: {
  player: Player;
  repeat: Repeat;
  shuffle: Shuffle;
  mode: NowPlayingMode;
  indicator: "volume" | "scrubbing";
  seeking: boolean;
  seekPreview: number | undefined;
  onSeekFocus: () => void;
  onSeekBlur: () => void;
  onSeekInput: (value: number) => void;
  onSeekCommit: () => void;
  onVolumeFocus: () => void;
  onVolumeBlur: () => void;
  onVolumeInput: (value: number) => void;
}) {
  const track = player.track;
  const volumePercent = Math.round(player.volume * 100);

  return (
    <div
      className="now-playing"
      data-testid="now-playing"
      role="group"
      aria-labelledby="menu-title"
      tabIndex={0}
    >
      {track ? (
        <>
          <TrackHeading player={player} track={track} repeat={repeat} shuffle={shuffle} />
          <div className="now-playing-progress" data-testid="now-playing-progress" data-mode={mode}>
            <PlaybackTimes
              player={player}
              indicator={indicator}
              seeking={seeking}
              seekPreview={seekPreview}
              onSeekFocus={onSeekFocus}
              onSeekBlur={onSeekBlur}
              onSeekInput={onSeekInput}
              onSeekCommit={onSeekCommit}
            />
            <div
              className={indicator === "volume" ? "volume-labels" : "volume-labels inactive"}
              data-testid="now-playing-volume-labels"
            >
              <VolumeLowIcon />
              <ProgressBar
                value={volumePercent}
                max={100}
                testId="now-playing-volume"
                label="Volume"
                valueText={formatPercent(player.volume)}
                onInput={onVolumeInput}
                onFocus={onVolumeFocus}
                onBlur={onVolumeBlur}
              />
              <VolumeHighIcon />
            </div>
          </div>
        </>
      ) : (
        <div className="now-playing-empty">No Music</div>
      )}
    </div>
  );
}
