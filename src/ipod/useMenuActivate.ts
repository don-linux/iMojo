import type { Dispatch, RefObject, SetStateAction } from "react";
import { launch, type BrickGame } from "../brick.ts";
import { unlockClick } from "../click.ts";
import type { Player } from "../api/player.ts";
import { primeSpotifyPlayback } from "../api/spotify/engine.ts";
import { copyText, spotifyRedirectUri } from "../api/spotify/redirect.ts";
import type { MusicLibraryState } from "../api/useMusicLibrary.tsx";
import { cycleSetting, defaultSettings, isBacklight, type Frame, type Settings } from "../menus.ts";
import type { MenuData } from "../menus/types.ts";
import { hudFrom, type Hud } from "./BrickGame.tsx";
import type { Overlay } from "./model.ts";
import { listForFrame, topFrame } from "./navigation.ts";
import type { NowPlayingControls } from "./nowPlayingControls.ts";

type MenuActivateInput = {
  music: MusicLibraryState;
  playerRef: RefObject<Player>;
  settingsRef: RefObject<Settings>;
  stackRef: RefObject<Frame[]>;
  dataRef: RefObject<MenuData>;
  overlayRef: RefObject<Overlay>;
  gameRef: RefObject<BrickGame>;
  nowPlaying: NowPlayingControls;
  setSettings: Dispatch<SetStateAction<Settings>>;
  setHud: Dispatch<SetStateAction<Hud>>;
  setErrorDismissed: Dispatch<SetStateAction<boolean>>;
  setRedirectCopied: Dispatch<SetStateAction<boolean>>;
  setClientIdOpen: Dispatch<SetStateAction<boolean>>;
  notify: () => void;
  pressOnly: () => void;
  push: (id: Frame["id"], param?: string, title?: string) => void;
  pop: () => boolean;
  playTrack: (trackId: string) => void;
};

export function useMenuActivate({
  music,
  playerRef,
  settingsRef,
  stackRef,
  dataRef,
  overlayRef,
  gameRef,
  nowPlaying,
  setSettings,
  setHud,
  setErrorDismissed,
  setRedirectCopied,
  setClientIdOpen,
  notify,
  pressOnly,
  push,
  pop,
  playTrack,
}: MenuActivateInput) {
  function activate() {
    if (overlayRef.current) {
      if (overlayRef.current === "library-error") setErrorDismissed(true);
      return;
    }
    notify();
    unlockClick();
    const frame = topFrame(stackRef);
    if (!frame) return;
    if (frame.id === "brick") {
      gameRef.current = launch(gameRef.current);
      setHud(hudFrom(gameRef.current));
      return;
    }
    if (frame.id === "now-playing") {
      if (nowPlaying.isAdjustingVolume()) {
        nowPlaying.exitVolume();
        return;
      }
      if (!playerRef.current.hasLoaded) return;
      nowPlaying.toggleSeek();
      return;
    }
    const row = listForFrame(frame, settingsRef, dataRef)[frame.index];
    if (!row || row.action === "info") return;
    if (row.action === "open" && row.screen) {
      push(row.screen, row.param, row.screenTitle ?? row.title);
      return;
    }
    if (row.action === "play") {
      primeSpotifyPlayback();
      playTrack(row.id);
      return;
    }
    if (row.action === "cycle") {
      setSettings((current) => cycleSetting(current, row.id));
      return;
    }
    if (row.action === "choose" && isBacklight(row.id)) {
      const mode = row.id;
      setSettings((current) => ({ ...current, backlight: mode, backlightChosen: true }));
      pop();
      return;
    }
    if (row.action === "cancel") {
      pop();
      return;
    }
    if (row.action === "reset") {
      setSettings(defaultSettings());
      pop();
      return;
    }
    if (row.action === "spotify-copy-redirect") {
      void copyText(spotifyRedirectUri()).then(() => {
        setRedirectCopied(true);
        window.setTimeout(() => setRedirectCopied(false), 1500);
      });
      return;
    }
    if (row.action === "spotify-create-app") {
      window.open("https://developer.spotify.com/dashboard", "_blank", "noopener");
      return;
    }
    if (row.action === "spotify-docs") {
      window.open("/connection", "_blank", "noopener");
      return;
    }
    if (row.action === "spotify-client-id") {
      setClientIdOpen(true);
      return;
    }
    if (row.action === "spotify-connect") {
      primeSpotifyPlayback();
      void music.connectProvider();
      return;
    }
    if (row.action === "spotify-disconnect") {
      playerRef.current.stop();
      void music.disconnectProvider();
      return;
    }
    if (row.action === "spotify-refresh") {
      void music.reload();
    }
  }

  function menu() {
    if (overlayRef.current) {
      if (overlayRef.current === "library-error") setErrorDismissed(true);
      return;
    }
    pressOnly();
    pop();
  }

  return { activate, menu };
}
