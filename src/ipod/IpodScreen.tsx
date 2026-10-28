import type { Dispatch, Ref, RefObject, SetStateAction } from "react";
import type { Player } from "../api/player.ts";
import type { BrickGame } from "../brick.ts";
import type { Frame, MenuData, Settings } from "../menus.ts";
import { titleFor } from "../menus.ts";
import { BrickPane, hudFrom, type Hud } from "./BrickGame.tsx";
import { ClickWheel, type WheelScrollTarget } from "./ClickWheel.tsx";
import { ClientIdDialog } from "./ClientIdDialog.tsx";
import { ErrorScreen } from "./ErrorScreen.tsx";
import { LoadingScreen } from "./LoadingScreen.tsx";
import { MenuScreen } from "./MenuScreen.tsx";
import { MenuTitle } from "./MenuTitle.tsx";
import { NowPlayingScreen } from "./NowPlayingScreen.tsx";
import { SELECT_HOLD_MS, type Overlay, type SheetLayer } from "./model.ts";
import type { NowPlayingControls } from "./nowPlayingControls.ts";
import type { WheelActions } from "./useWheelActions.ts";

function publishHud(setHud: Dispatch<SetStateAction<Hud>>, game: BrickGame) {
  setHud((prev) => {
    if (
      prev.score === game.score &&
      prev.balls === game.balls &&
      prev.playing === game.playing &&
      prev.over === game.over
    ) {
      return prev;
    }
    return hudFrom(game);
  });
}

function SheetBody({
  frame,
  live,
  game,
  gameRef,
  onFrame,
  player,
  settings,
  data,
  nowPlaying,
  listRef,
  idPrefix,
}: {
  frame: Frame;
  live: boolean;
  game: BrickGame | null;
  gameRef: RefObject<BrickGame>;
  onFrame: (game: BrickGame) => void;
  player: Player;
  settings: Settings;
  data: MenuData;
  nowPlaying: NowPlayingControls;
  listRef?: Ref<HTMLUListElement>;
  idPrefix?: string;
}) {
  if (frame.id === "brick") {
    return (
      <div className="brick-screen">
        <BrickPane
          live={live}
          snapshot={live ? null : game}
          gameRef={gameRef}
          onFrame={onFrame}
        />
      </div>
    );
  }
  if (frame.id === "now-playing") {
    return (
      <NowPlayingScreen
        player={player}
        repeat={settings.repeat}
        shuffle={settings.shuffle}
        mode={nowPlaying.mode}
        indicator={nowPlaying.indicator}
        seeking={nowPlaying.seeking}
        seekPreview={nowPlaying.seekPreview}
        onSeekFocus={nowPlaying.focusSeek}
        onSeekBlur={nowPlaying.blurSeek}
        onSeekInput={(value) => {
          nowPlaying.focusSeek();
          nowPlaying.seekTo(value);
        }}
        onSeekCommit={nowPlaying.commitSeek}
        onVolumeFocus={nowPlaying.focusVolume}
        onVolumeBlur={nowPlaying.blurVolume}
        onVolumeInput={nowPlaying.setVolumePercent}
      />
    );
  }
  return (
    <MenuScreen
      frame={frame}
      settings={settings}
      data={data}
      listRef={listRef}
      idPrefix={idPrefix}
    />
  );
}

export function IpodScreen({
  lit,
  overlay,
  isInert,
  frame,
  layers,
  sheetNodes,
  listRef,
  deviceRef,
  hud,
  setHud,
  player,
  settings,
  data,
  nowPlaying,
  gameRef,
  musicError,
  actions,
  onDragStart,
  onDragEnd,
  clientIdOpen,
  setClientIdOpen,
  saveClientId,
}: {
  lit: boolean;
  overlay: Overlay;
  isInert: boolean;
  frame: Frame;
  layers: SheetLayer[];
  sheetNodes: RefObject<Map<number, HTMLDivElement>>;
  listRef?: Ref<HTMLUListElement>;
  deviceRef: RefObject<HTMLDivElement | null>;
  hud: Hud;
  setHud: Dispatch<SetStateAction<Hud>>;
  player: Player;
  settings: Settings;
  data: MenuData;
  nowPlaying: NowPlayingControls;
  gameRef: RefObject<BrickGame>;
  musicError: string | null;
  actions: RefObject<WheelActions>;
  onDragStart: () => void;
  onDragEnd: () => void;
  clientIdOpen: boolean;
  setClientIdOpen: Dispatch<SetStateAction<boolean>>;
  saveClientId: (clientId: string) => void;
}) {
  const brickTitle = frame.id === "brick" ? { balls: hud.balls, score: hud.score } : null;
  const wheelScrollTarget: WheelScrollTarget = nowPlaying.seeking
    ? "seek"
    : frame.id === "brick"
      ? "brick"
      : frame.id === "now-playing"
        ? "volume"
        : "list";

  return (
    <>
      <div className="slot">
        <div className="device">
          <div className="ipod" role="application" aria-label="iPod" tabIndex={0} ref={deviceRef}>
            <div className="ipod-shadow">
              <div className="body">
                <div className={lit ? "screen backlit" : "screen"}>
                  <div className={overlay ? "screen-clip hidden" : "screen-clip"}>
                    <div className="menu">
                      <MenuTitle
                        title={titleFor(frame)}
                        hasTrack={player.track != null && !player.finished}
                        playing={player.playing}
                        brick={brickTitle}
                      />
                      <div className="screen-body">
                        {layers.map((layer) => {
                          const shown = layer.live ? frame : layer.frame;
                          return (
                            <div
                              key={layer.id}
                              className={layer.live ? "sheet live" : "sheet"}
                              ref={(node) => {
                                if (node) sheetNodes.current.set(layer.id, node);
                                else sheetNodes.current.delete(layer.id);
                              }}
                              inert={!layer.live}
                            >
                              <SheetBody
                                frame={shown}
                                live={layer.live}
                                game={layer.game}
                                gameRef={gameRef}
                                onFrame={(game) => publishHud(setHud, game)}
                                player={player}
                                settings={settings}
                                data={data}
                                nowPlaying={nowPlaying}
                                listRef={layer.live ? listRef : undefined}
                                idPrefix={layer.live ? undefined : `menu-item-${layer.id}-${shown.id}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  {overlay === "loading" ? <LoadingScreen /> : null}
                  {overlay === "offline" ? (
                    <ErrorScreen message="You are not connected to the internet" />
                  ) : null}
                  {overlay === "library-error" ? (
                    <ErrorScreen message={musicError ?? "Unable to load music"} />
                  ) : null}
                </div>

                <ClickWheel
                  playing={player.hasLoaded ? player.playing : player.loading}
                  scrollTarget={wheelScrollTarget}
                  disabled={isInert}
                  disableSkip={nowPlaying.seeking}
                  selectHoldMs={frame.id === "about" ? SELECT_HOLD_MS : null}
                  onScroll={(detail) => actions.current.scroll(detail)}
                  onKeyScroll={(step, heldMs) => actions.current.keyStep(step, heldMs)}
                  onSteer={(step) => actions.current.steer(step)}
                  onMenu={() => actions.current.menu()}
                  onMenuHold={() => actions.current.menuHold()}
                  onBack={() => actions.current.back()}
                  onForward={() => actions.current.forward()}
                  onBackHold={(detail) => actions.current.backHold(detail.repeat)}
                  onForwardHold={(detail) => actions.current.forwardHold(detail.repeat)}
                  onPlayPause={() => actions.current.playPause()}
                  onSelect={() => actions.current.select()}
                  onSelectHold={() => actions.current.openBrick()}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      {clientIdOpen ? (
        <ClientIdDialog
          onClose={() => setClientIdOpen(false)}
          onSave={(clientId) => saveClientId(clientId)}
        />
      ) : null}
    </>
  );
}
