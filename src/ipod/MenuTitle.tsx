import { BatteryIndicator } from "./BatteryIndicator.tsx";
import { TitlePauseIcon, TitlePlayIcon } from "./icons.tsx";

export function MenuTitle({
  title,
  hasTrack,
  playing,
  brick,
}: {
  title: string;
  hasTrack: boolean;
  playing: boolean;
  brick?: { balls: number; score: number } | null;
}) {
  return (
    <div className="menu-title" id="menu-title" data-testid="menu-title">
      {hasTrack ? (
        <div
          className={`play-icon ${playing ? "play" : "pause"}`}
          data-testid="now-playing-indicator"
          aria-hidden="true"
        >
          {playing ? <TitlePlayIcon /> : <TitlePauseIcon />}
        </div>
      ) : null}
      <BatteryIndicator />
      {brick ? (
        <div className="screen-title brick-game-title" dir="ltr">
          <span
            className="balls-left"
            data-testid="brick-balls"
            aria-label={`${brick.balls} balls left`}
          >
            {brick.balls}
          </span>
          <span
            className="game-score"
            data-testid="brick-score"
            aria-label={`score ${brick.score}`}
          >
            {brick.score}
          </span>
        </div>
      ) : (
        <h1 className="screen-title" dir="auto">
          {title}
        </h1>
      )}
    </div>
  );
}
