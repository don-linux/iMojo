import { useLayoutEffect, useRef, useState } from "react";
import { useMusicLibrary } from "./api/useMusicLibrary.tsx";
import { usePlayer } from "./api/player.ts";
import { SpotifySdkEngine } from "./api/spotify/engine.ts";
import type { Settings } from "./menus.ts";
import { loadSettings } from "./settings.ts";
import "./ipod.css";
import { IpodScreen } from "./ipod/IpodScreen.tsx";
import { useBacklight, useSavedSettings } from "./ipod/useBacklight.ts";
import { useBootOverlay, useErrorDismiss, usePauseWhenOffline } from "./ipod/useBootOverlay.ts";
import { useConnectedWarmup, useMenuData, usePlaylistFetch } from "./ipod/useMenuData.ts";
import { useMenuActivate } from "./ipod/useMenuActivate.ts";
import { useNavigationActions, useNavigationState, useSettingsRef } from "./ipod/navigation.ts";
import { useDeviceEnvironment, useNavigationRuntime } from "./ipod/navigationEffects.ts";
import { usePlaybackCommands } from "./ipod/usePlaybackCommands.ts";
import { useScreenKeyboard } from "./ipod/useScreenKeyboard.ts";
import { useWheelActions } from "./ipod/useWheelActions.ts";
import { useNowPlayingControls } from "./ipod/nowPlayingControls.ts";

export default function Ipod() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [redirectCopied, setRedirectCopied] = useState(false);
  const [clientIdOpen, setClientIdOpen] = useState(false);
  const shell = useNavigationState();
  const settingsRef = useSettingsRef(settings);
  const music = useMusicLibrary();
  const activateRef = useRef<() => void>(() => {});
  const onQueueFinishedRef = useRef<() => void>(() => {});

  const player = usePlayer({
    shuffle: settings.shuffle === "songs",
    repeat: settings.repeat,
    volume: settings.volume / 100,
    resolve: music.resolvePlayback,
    createEngine: () => new SpotifySdkEngine(),
    onVolumeChange: (value) => {
      const percent = Math.round(value * 100);
      setSettings((current) =>
        current.volume === percent ? current : { ...current, volume: percent },
      );
    },
    onQueueFinished: () => onQueueFinishedRef.current(),
  });

  const playerRef = useRef(player);
  const nowPlaying = useNowPlayingControls({
    getClock: () => playerRef.current.clock.getSnapshot(),
    getVolume: () => playerRef.current.getVolume(),
    seekTo: (seconds) => playerRef.current.seekTo(seconds),
    setVolume: (volume) => playerRef.current.setVolume(volume),
    hasLoaded: player.hasLoaded,
    trackId: player.track?.id,
    trackIndex: player.index,
    queue: player.queue,
  });
  const { data, dataRef } = useMenuData(music, player, redirectCopied);
  const device = useDeviceEnvironment();
  const boot = useBootOverlay({
    musicStatus: music.status,
    errorDismissed,
  });
  useErrorDismiss(music.status, setErrorDismissed);
  useConnectedWarmup(music);
  usePlaylistFetch(shell.stack, music);
  usePauseWhenOffline(boot.online, player);
  useSavedSettings(settings, settingsRef);
  const backlight = useBacklight(settings, setSettings, settingsRef);
  const runtime = useNavigationRuntime({
    settings,
    stack: shell.stack,
    layers: shell.layers,
    setLayers: shell.setLayers,
    data,
    player,
  });
  const navigation = useNavigationActions({
    ...runtime,
    settingsRef,
    reduceMotion: device.reduceMotion,
    dataRef,
    playerRef,
    nowPlaying,
    setStack: shell.setStack,
    setLayers: shell.setLayers,
    setHud: shell.setHud,
  });
  const playback = usePlaybackCommands({
    music,
    playerRef,
    settingsRef,
    stackRef: runtime.stackRef,
    dataRef,
    overlayRef: boot.overlayRef,
    pressOnly: backlight.pressOnly,
    push: navigation.push,
    activate: () => activateRef.current(),
  });
  const menus = useMenuActivate({
    music,
    playerRef,
    settingsRef,
    stackRef: runtime.stackRef,
    dataRef,
    overlayRef: boot.overlayRef,
    gameRef: runtime.gameRef,
    nowPlaying,
    setSettings,
    setHud: shell.setHud,
    setErrorDismissed,
    setRedirectCopied,
    setClientIdOpen,
    notify: backlight.notify,
    pressOnly: backlight.pressOnly,
    push: navigation.push,
    pop: navigation.pop,
    playTrack: playback.playTrack,
  });

  useLayoutEffect(() => {
    playerRef.current = player;
    onQueueFinishedRef.current = navigation.handleQueueFinished;
    activateRef.current = menus.activate;
  });

  const wheel = useWheelActions({
    settings,
    stack: shell.stack,
    data,
    settingsRef,
    stackRef: runtime.stackRef,
    dataRef,
    overlayRef: boot.overlayRef,
    playerRef,
    nowPlaying,
    gameRef: runtime.gameRef,
    notify: backlight.notify,
    toggleBacklight: backlight.toggleBacklight,
    moveList: navigation.moveList,
    push: navigation.push,
    menu: menus.menu,
    activate: menus.activate,
    playPause: playback.playPause,
  });
  useScreenKeyboard({
    stack: shell.stack,
    stackRef: runtime.stackRef,
    overlayRef: boot.overlayRef,
    actions: wheel.actions,
    notify: backlight.notify,
    holdSeekRef: wheel.holdSeekRef,
    seeking: nowPlaying.seeking,
  });

  return (
    <IpodScreen
      lit={backlight.lit}
      overlay={boot.overlay}
      isInert={boot.isInert}
      frame={runtime.screenFrame}
      layers={shell.layers}
      sheetNodes={runtime.sheetNodes}
      listRef={runtime.listRef}
      deviceRef={device.deviceRef}
      hud={shell.hud}
      setHud={shell.setHud}
      player={player}
      settings={settings}
      data={data}
      nowPlaying={nowPlaying}
      gameRef={runtime.gameRef}
      musicError={music.error}
      actions={wheel.actions}
      onDragStart={wheel.onDragStart}
      onDragEnd={wheel.onDragEnd}
      clientIdOpen={clientIdOpen}
      setClientIdOpen={setClientIdOpen}
      saveClientId={music.saveClientId}
    />
  );
}
