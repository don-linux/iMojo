import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cloneGame, createGame, launch, movePaddle, setSteer, type BrickGame } from "./brick.ts";
import { playClick, unlockClick } from "./click.ts";
import {
  BACKLIGHTS,
  cycleSetting,
  defaultSettings,
  isBacklight,
  rows,
  titleFor,
  type Frame,
  type MenuData,
  type Settings,
  type SongEntry,
} from "./menus.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import {
  createListScroller,
  createSeekScroller,
  createVolumeScroller,
  tierForHold,
  type ScrollDetail,
} from "./wheel.ts";
import { BrickPane, EMPTY_HUD, hudFrom, type Hud } from "./ipod/BrickGame.tsx";
import { ClickWheel, type WheelScrollTarget } from "./ipod/ClickWheel.tsx";
import { ErrorScreen } from "./ipod/ErrorScreen.tsx";
import { LoadingScreen } from "./ipod/LoadingScreen.tsx";
import { MenuScreen } from "./ipod/MenuScreen.tsx";
import { MenuTitle } from "./ipod/MenuTitle.tsx";
import { NowPlayingScreen } from "./ipod/NowPlayingScreen.tsx";
import { useNowPlayingControls } from "./ipod/nowPlayingControls.ts";
import { VOLUME_KEY_STEP } from "./ipod/playbackTiming.ts";
import { beginSlide, haltSlide } from "./ipod/screenSlide.ts";
import { useMusicLibrary } from "./api/useMusicLibrary.tsx";
import { usePlayer } from "./api/player.ts";
import { artistTracks, playlistTracks, savedTracks } from "./api/selectors.ts";
import { SpotifySdkEngine, primeSpotifyPlayback, warmSpotifyPlayer } from "./api/spotify/engine.ts";
import { copyText, spotifyRedirectUri } from "./api/spotify/redirect.ts";
import type { Track } from "./api/types.ts";
import { ClientIdDialog } from "./ipod/ClientIdDialog.tsx";
import "./ipod.css";

function scrollListToRow(list: HTMLElement, row: HTMLElement) {
  const rowHeight = row.offsetHeight;
  if (rowHeight <= 0) return;
  const top = row.offsetTop - list.offsetTop - list.clientTop;
  const index = Math.max(0, Math.round(top / rowHeight));
  const visible = Math.max(1, Math.floor((list.clientHeight + 0.5) / rowHeight));
  let start = Math.round(list.scrollTop / rowHeight);
  if (index < start) start = index;
  else if (index >= start + visible) start = index - visible + 1;
  const next = Math.max(0, start) * rowHeight;
  const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
  list.scrollTop = Math.min(next, maxScroll);
}

const SELECT_HOLD_MS = 5000;
const MENU_HOLD_MS = 1000;
const HOLD_SEEK_TIERS = [5, 5, 5, 10, 10, 10, 20] as const;
const BOOT_MIN_MS = 2000;
const BOOT_MAX_MS = 10000;

type Overlay = "loading" | "offline" | "library-error" | null;

type SheetLayer = {
  id: number;
  frame: Frame;
  game: BrickGame | null;
  live: boolean;
};

type PendingSlide = {
  gen: number;
  back: boolean;
  leavingId: number;
  enteringId: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function songEntry(track: Track): SongEntry {
  return { id: track.id, title: track.title, artistName: track.artistName };
}

function frameKey(frame: Frame) {
  return `${frame.id}:${frame.param ?? ""}`;
}

export default function Ipod() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [stack, setStack] = useState<Frame[]>([{ id: "main", index: 0 }]);
  const [layers, setLayers] = useState<SheetLayer[]>(() => [
    { id: 1, frame: { id: "main", index: 0 }, game: null, live: true },
  ]);
  const [lit, setLit] = useState(() => loadSettings().backlight === "always_on");
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [minDisplayElapsed, setMinDisplayElapsed] = useState(false);
  const [maxHoldElapsed, setMaxHoldElapsed] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);

  const music = useMusicLibrary();
  const [redirectCopied, setRedirectCopied] = useState(false);
  const [clientIdOpen, setClientIdOpen] = useState(false);
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
    onQueueFinished: () => {
      const current = stackRef.current;
      const leaving = current[current.length - 1];
      if (leaving?.id !== "now-playing") return;
      const underlying = current[current.length - 2];
      const remembered = underlying ? rememberedRef.current.get(frameKey(underlying)) : undefined;
      pop();
      if (underlying && remembered?.id === "now-playing") {
        const next = stackRef.current.slice();
        const target = next[next.length - 1];
        if (!target) return;
        next[next.length - 1] = { ...target, index: 0 };
        stackRef.current = next;
        setStack(next);
      }
    },
  });

  const playerRef = useRef(player);
  playerRef.current = player;

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

  const data = useMemo<MenuData>(() => {
    const songs = savedTracks(music.library);
    const playlistSongs: Record<string, SongEntry[]> = {};
    const artistSongs: Record<string, SongEntry[]> = {};

    for (const playlist of music.library.playlists) {
      playlistSongs[playlist.id] = playlistTracks(music.library, playlist).map(songEntry);
    }
    for (const artist of music.library.artists) {
      artistSongs[artist.id] = artistTracks(music.library, artist).map(songEntry);
    }

    return {
      playlists: music.library.playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        count: playlist.tracksLoaded
          ? playlist.trackIds.length
          : (playlist.total ?? playlist.trackIds.length),
      })),
      playlistDetail: Object.fromEntries(
        music.library.playlists.map((playlist) => [
          playlist.id,
          { loaded: Boolean(playlist.tracksLoaded), unavailable: Boolean(playlist.unavailable) },
        ]),
      ),
      artists: music.library.artists.map((artist) => ({
        id: artist.id,
        name: artist.name,
        count: artist.trackIds.length,
      })),
      songs: songs.map(songEntry),
      playlistSongs,
      artistSongs,
      nowPlaying:
        player.track && !player.finished
          ? { title: player.track.title, artistName: player.track.artistName }
          : null,
      connection: {
        status: music.connection.status,
        account: music.connection.account,
        error: music.error ?? music.connection.error,
        sourceLabel: music.sourceLabel,
        counts: {
          playlists: music.library.playlists.length,
          artists: music.library.artists.length,
          songs: music.library.savedTrackIds.length,
        },
        redirectCopied,
      },
    };
  }, [
    music.library,
    music.connection,
    music.error,
    music.sourceLabel,
    player.track,
    player.finished,
    redirectCopied,
  ]);

  const settingsRef = useRef(settings);
  const stackRef = useRef(stack);
  const layersRef = useRef(layers);
  const layerSeq = useRef(1);
  const slideGen = useRef(0);
  const appliedSlide = useRef(0);
  const pendingSlide = useRef<PendingSlide | null>(null);
  const sheetNodes = useRef(new Map<number, HTMLDivElement>());
  const mounted = useRef(true);
  const bootedRef = useRef(false);
  const dataRef = useRef(data);
  const litRef = useRef(lit);
  const latchRef = useRef(false);
  const wasLitRef = useRef(false);
  const rememberedRef = useRef(new Map<string, { id?: string; index: number }>());
  const suppressSyncRef = useRef(false);
  const firstBacklightRef = useRef(true);

  const scroller = useRef(createListScroller());
  const seekScroller = useRef(createSeekScroller());
  const volumeScroller = useRef(createVolumeScroller());
  const reduceMotion = useRef(false);
  const lightTimer = useRef<number | undefined>(undefined);
  const holdSeekRef = useRef<{ base?: number; track?: number; tier: number }>({ tier: 0 });
  const volumeClickLatch = useRef(false);
  const volumeClickStep = useRef<1 | -1 | null>(null);
  const cancelScreenEscapeRef = useRef<() => void>(() => {});
  const deviceRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<BrickGame>(createGame());
  const overlayRef = useRef<Overlay>(null);

  const actions = useRef({
    scroll: (_detail: ScrollDetail) => {},
    screenArrow: (_step: 1 | -1) => {},
    menu: () => {},
    menuHold: () => {},
    select: () => {},
    openBrick: () => {},
    steer: (_step: 1 | -1 | null) => {},
    keyStep: (_step: 1 | -1, _heldMs: number) => {},
    playPause: () => {},
    back: () => {},
    forward: () => {},
    backHold: (_repeat: boolean) => {},
    forwardHold: (_repeat: boolean) => {},
  });

  useEffect(() => {
    deviceRef.current?.focus();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reduceMotion.current = media.matches;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const node of sheetNodes.current.values()) haltSlide(node);
    };
  }, []);

  useEffect(() => {
    if (!online) {
      if (!bootedRef.current) {
        setMinDisplayElapsed(false);
        setMaxHoldElapsed(false);
      }
      return;
    }
    if (bootedRef.current) {
      setMaxHoldElapsed(true);
      return;
    }
    setMinDisplayElapsed(false);
    setMaxHoldElapsed(false);
    const minTimer = window.setTimeout(() => setMinDisplayElapsed(true), BOOT_MIN_MS);
    const maxTimer = window.setTimeout(() => setMaxHoldElapsed(true), BOOT_MAX_MS);
    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxTimer);
    };
  }, [online]);

  const isBootLoading = (!maxHoldElapsed && music.status === "loading") || !minDisplayElapsed;
  const isInert = isBootLoading || !online;

  useEffect(() => {
    if (!isInert) bootedRef.current = true;
  }, [isInert]);

  useLayoutEffect(() => {
    const pending = pendingSlide.current;
    if (!pending || appliedSlide.current === pending.gen) return;
    appliedSlide.current = pending.gen;
    const leaving = sheetNodes.current.get(pending.leavingId);
    const entering = sheetNodes.current.get(pending.enteringId);
    const drop = (id: number) => {
      if (!mounted.current) return;
      setLayers((current) => {
        if (!current.some((layer) => layer.id === id && !layer.live)) return current;
        const next = current.filter((layer) => layer.id !== id);
        layersRef.current = next;
        return next;
      });
    };
    if (leaving) {
      beginSlide(leaving, { back: pending.back, direction: "out" }, () => drop(pending.leavingId));
    }
    const stolen = entering
      ? beginSlide(entering, { back: pending.back, direction: "in" }).stolen
      : null;
    if (!stolen) return;
    for (const [id, node] of sheetNodes.current) {
      if (node === stolen) drop(id);
    }
  }, [layers]);

  useEffect(() => {
    if (music.status !== "error") setErrorDismissed(false);
  }, [music.status]);

  useEffect(() => {
    if (music.connection.status === "connected") warmSpotifyPlayer();
  }, [music.connection.status]);

  const playlistId = stack.at(-1)?.id === "playlist" ? stack.at(-1)?.param : undefined;
  const openPlaylist = music.library.playlists.find((playlist) => playlist.id === playlistId);
  useEffect(() => {
    if (!playlistId || !openPlaylist || openPlaylist.tracksLoaded || openPlaylist.unavailable)
      return;
    void music.loadPlaylist(playlistId);
  }, [playlistId, openPlaylist, music.loadPlaylist]);

  useEffect(() => {
    if (!online) player.pause();
  }, [online, player.pause]);

  useEffect(() => {
    const timer = window.setTimeout(() => saveSettings(settings), 200);
    return () => window.clearTimeout(timer);
  }, [settings]);

  useEffect(() => () => saveSettings(settingsRef.current), []);

  useEffect(() => () => window.clearTimeout(lightTimer.current), []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (settingsRef.current.backlightChosen) return;
      setSettings((current) => ({
        ...current,
        backlight: media.matches ? "always_on" : "off",
      }));
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    latchRef.current = false;
    wasLitRef.current = false;
    if (firstBacklightRef.current) {
      firstBacklightRef.current = false;
      if (settings.backlight === "always_on") setLitState(true);
      else if (settings.backlight === "off") setLitState(false);
      return;
    }
    applyBacklight(settings.backlight);
  }, [settings.backlight, settings.backlightChosen]);

  useLayoutEffect(() => {
    const frame = stack[stack.length - 1];
    if (!frame || frame.id === "brick" || frame.id === "now-playing") return;
    const current = document.querySelector(".sheet.live");
    const row = current?.querySelector<HTMLElement>(`#menu-item-${frame.id}-${frame.index}`);
    const list = row?.closest<HTMLElement>(".menu-items");
    if (!row || !list) return;
    scrollListToRow(list, row);
  }, [stack, settings, data]);

  useEffect(() => {
    const frame = stack[stack.length - 1];
    if (!frame) return;
    const list = rows(frame, settings, data);
    if (list.length === 0 || frame.index < list.length) return;
    const next = stack.slice();
    next[next.length - 1] = { ...frame, index: list.length - 1 };
    stackRef.current = next;
    setStack(next);
  }, [stack, data, settings]);

  useEffect(() => {
    if (suppressSyncRef.current) return;
    const frame = stack[stack.length - 1];
    if (!frame || frame.id === "brick" || frame.id === "now-playing") return;
    const playing = playingRowIndex(frame);
    if (playing < 0 || playing === frame.index) return;
    const next = stack.slice();
    next[next.length - 1] = { ...frame, index: playing };
    stackRef.current = next;
    setStack(next);
  }, [stack, player.index, player.queue]);

  useEffect(() => {
    settingsRef.current = settings;
    stackRef.current = stack;
    dataRef.current = data;
    actions.current = {
      scroll(detail) {
        notify();
        if (overlayRef.current) return;
        const target = currentScrollTarget();
        if (target === "brick") {
          gameRef.current = movePaddle(gameRef.current, detail.step * detail.degrees);
          return;
        }
        if (target === "seek") {
          nowPlaying.noteSeekActivity();
          const { seconds } = seekScroller.current.push(detail.step, detail.degrees, detail.speed);
          if (seconds > 0) nowPlaying.seekBy(detail.step * seconds);
          return;
        }
        if (target === "volume") {
          if (volumeClickStep.current !== detail.step) {
            volumeClickStep.current = detail.step;
            volumeClickLatch.current = false;
          }
          const { percent, clicks } = volumeScroller.current.push(detail.step, detail.degrees);
          if (percent > 0 && nowPlaying.volumeBy(detail.step * percent)) {
            volumeClickLatch.current = true;
          }
          if (clicks > 0 && volumeClickLatch.current) {
            for (let index = 0; index < clicks; index += 1) clickSound();
            volumeClickLatch.current = false;
          }
          return;
        }
        const { count, rows: jumped } = scroller.current.push(
          detail.step,
          detail.degrees,
          detail.speed,
        );
        if (count < 1) return;
        const moved = moveList(detail.step * jumped);
        if (moved > 0) {
          for (let index = 0; index < count; index += 1) clickSound();
        }
      },
      screenArrow(step) {
        if (overlayRef.current) return;
        moveList(step);
      },
      menu,
      menuHold() {
        if (overlayRef.current) return;
        unlockClick();
        toggleBacklight();
      },
      select: activate,
      openBrick() {
        if (overlayRef.current) return;
        if (currentFrame()?.id !== "about") return;
        notify();
        push("brick");
      },
      steer(step) {
        notify();
        if (overlayRef.current) return;
        if (currentFrame()?.id !== "brick") return;
        gameRef.current = setSteer(gameRef.current, step ?? 0);
      },
      keyStep(step, heldMs) {
        notify();
        if (overlayRef.current) return;
        const target = currentScrollTarget();
        if (target === "brick") return;
        if (target === "seek") {
          nowPlaying.seekBy(step * nowPlaying.seekTierForHold(heldMs));
          return;
        }
        if (target === "volume") {
          if (nowPlaying.volumeBy(step * VOLUME_KEY_STEP)) clickSound();
          return;
        }
        const moved = moveList(step * tierForHold(heldMs));
        if (moved > 0) clickSound();
      },
      playPause,
      back() {
        if (overlayRef.current) return;
        notify();
        unlockClick();
        if (nowPlaying.isSeeking()) return;
        playerRef.current.previous();
      },
      forward() {
        if (overlayRef.current) return;
        notify();
        unlockClick();
        if (nowPlaying.isSeeking()) return;
        playerRef.current.next();
      },
      backHold(repeat) {
        holdSeek(-1, repeat);
      },
      forwardHold(repeat) {
        holdSeek(1, repeat);
      },
    };
  });

  useEffect(() => {
    const handledKeys = new Set([
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "Enter",
      " ",
      "Escape",
    ]);
    const nativeRangeKeys = new Set([
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ]);
    let escapeTimer: number | undefined;
    let escapeArmed = false;
    let escapeFired = false;

    function cancelEscape() {
      window.clearTimeout(escapeTimer);
      escapeTimer = undefined;
      escapeArmed = false;
      escapeFired = false;
    }

    cancelScreenEscapeRef.current = cancelEscape;

    function insideWheel(target: EventTarget | null) {
      return target instanceof Element && target.closest(".click-wheel") != null;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (insideWheel(event.target)) return;
      const name = event.key;
      if (!event.repeat || name.startsWith("Arrow")) notify();
      if (overlayRef.current) {
        if (handledKeys.has(name) || nativeRangeKeys.has(name)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      const frame = currentFrame();
      const mode =
        frame?.id === "now-playing"
          ? "now-playing"
          : frame?.id === "brick"
            ? "passthrough"
            : "list";
      if (mode === "passthrough") return;
      if (mode === "now-playing" && name !== "Escape") {
        const rangeKey = event.target instanceof HTMLInputElement && nativeRangeKeys.has(name);
        const anchorEnter = event.target instanceof HTMLAnchorElement && name === "Enter";
        const native = rangeKey || anchorEnter;
        if (native || handledKeys.has(name)) {
          event.stopPropagation();
          if (!native) event.preventDefault();
        }
        return;
      }
      switch (name) {
        case "ArrowDown":
        case "ArrowUp":
          event.preventDefault();
          event.stopPropagation();
          unlockClick();
          actions.current.screenArrow(name === "ArrowDown" ? 1 : -1);
          break;
        case "ArrowLeft":
        case "ArrowRight":
          event.preventDefault();
          event.stopPropagation();
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          event.stopPropagation();
          unlockClick();
          if (!event.repeat) actions.current.select();
          break;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          unlockClick();
          if (event.repeat) return;
          escapeArmed = true;
          escapeFired = false;
          window.clearTimeout(escapeTimer);
          escapeTimer = window.setTimeout(() => {
            escapeTimer = undefined;
            escapeFired = true;
            if (!overlayRef.current) actions.current.menuHold();
          }, MENU_HOLD_MS);
          break;
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== "Escape" || !escapeArmed) return;
      if (insideWheel(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(escapeTimer);
      escapeTimer = undefined;
      const fired = escapeFired;
      escapeArmed = false;
      escapeFired = false;
      if (!fired) actions.current.menu();
    }

    function onFocusOut() {
      cancelEscape();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("focusout", onFocusOut);
    window.addEventListener("blur", onFocusOut);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("blur", onFocusOut);
      cancelEscape();
    };
  }, []);

  useEffect(() => {
    cancelScreenEscapeRef.current();
  }, [stack]);

  useEffect(() => {
    if (!nowPlaying.seeking) return;
    // Entering scrub mode cancels any hold-seek ramp in progress, like the
    // original controller does when `isSeeking` flips on.
    cancelHoldSeek();
  }, [nowPlaying.seeking]);

  function setLitState(value: boolean) {
    litRef.current = value;
    setLit(value);
  }

  function applyBacklight(mode: Settings["backlight"]) {
    window.clearTimeout(lightTimer.current);
    if (mode === "always_on") {
      setLitState(true);
      return;
    }
    if (mode === "off") {
      setLitState(false);
      return;
    }
    const ms = BACKLIGHTS.find((entry) => entry.id === mode)?.ms;
    setLitState(true);
    if (ms) lightTimer.current = window.setTimeout(() => setLitState(false), ms);
  }

  function notify() {
    if (latchRef.current) return;
    if (wasLitRef.current) {
      wasLitRef.current = false;
      if (settingsRef.current.backlight === "always_on") {
        setLitState(true);
        return;
      }
    }
    applyBacklight(settingsRef.current.backlight);
  }

  function toggleBacklight() {
    const next = !litRef.current;
    latchRef.current = next;
    wasLitRef.current = litRef.current;
    setLitState(next);
  }

  function clickSound() {
    if (settingsRef.current.clicker === "on") playClick();
  }

  function pressOnly() {
    notify();
    unlockClick();
  }

  function publishHud(game: BrickGame) {
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

  function currentFrame() {
    return stackRef.current[stackRef.current.length - 1];
  }

  function listFor(frame: Frame) {
    return rows(frame, settingsRef.current, dataRef.current);
  }

  function playingRowIndex(frame: Frame) {
    const list = listFor(frame);
    const playRows: { id: string; index: number }[] = [];
    list.forEach((row, index) => {
      if (row.action === "play") playRows.push({ id: row.id, index });
    });
    const { queue, index, finished } = playerRef.current.getSnapshot();
    if (finished || queue.length === 0) return -1;
    if (playRows.length === 0 || playRows.length !== queue.length) return -1;
    for (let position = 0; position < queue.length; position += 1) {
      if (playRows[position]!.id !== queue[position]!.id) return -1;
    }
    return playRows[index]?.index ?? -1;
  }

  function sameQueue(left: readonly Track[], right: readonly Track[]) {
    return (
      left.length === right.length && left.every((track, index) => track.id === right[index]?.id)
    );
  }

  function currentScrollTarget(): WheelScrollTarget {
    if (nowPlaying.isSeeking()) return "seek";
    const frame = currentFrame();
    if (frame?.id === "brick") return "brick";
    if (frame?.id === "now-playing") return "volume";
    return "list";
  }

  function cancelHoldSeek() {
    holdSeekRef.current.base = undefined;
    holdSeekRef.current.tier = 0;
  }

  function holdSeek(step: 1 | -1, repeat: boolean) {
    const state = holdSeekRef.current;
    const current = playerRef.current;
    const inert = overlayRef.current != null;
    const { currentTime, duration } = current.clock.getSnapshot();
    if (!repeat) {
      state.base = inert ? undefined : currentTime;
      state.track = current.index;
      state.tier = 0;
    }
    if (
      state.base === undefined ||
      inert ||
      nowPlaying.isSeeking() ||
      !current.hasLoaded ||
      duration <= 0 ||
      current.index !== state.track
    ) {
      return;
    }
    const amount = HOLD_SEEK_TIERS[Math.min(state.tier, HOLD_SEEK_TIERS.length - 1)]!;
    const target = Math.min(Math.max(state.base + step * amount, 0), duration);
    state.tier += 1;
    state.base = target > 0 && target < duration ? target : undefined;
    notify();
    current.seekTo(target);
  }

  function playPause() {
    if (overlayRef.current) return;
    primeSpotifyPlayback();
    pressOnly();
    const current = playerRef.current;
    if (current.hasLoaded || current.loading) {
      current.toggle();
      return;
    }
    const frame = currentFrame();
    const row = frame ? listFor(frame)[frame.index] : undefined;
    if (
      row?.action === "open" &&
      (row.screen === "songs" || row.screen === "playlist" || row.screen === "artist")
    ) {
      const queue = queueFor({ id: row.screen, index: 0, param: row.param });
      if (queue.length > 0) {
        const start =
          settingsRef.current.shuffle === "songs" ? Math.floor(Math.random() * queue.length) : 0;
        current.playQueue(queue, start);
        push("now-playing");
        return;
      }
    }
    if (row?.action === "play") {
      activate();
      return;
    }
    if (current.queue.length > 0) current.toggle();
  }

  function rememberFrame(frame: Frame | undefined) {
    if (!frame || frame.id === "brick" || frame.id === "now-playing" || frame.id === "reset") {
      return;
    }
    const list = listFor(frame);
    const row = list[frame.index];
    rememberedRef.current.set(frameKey(frame), { id: row?.id, index: frame.index });
  }

  function restoredIndex(frame: Frame) {
    if (frame.id === "reset") return 0;
    const remembered = rememberedRef.current.get(frameKey(frame));
    if (!remembered) return 0;
    const list = listFor(frame);
    const found = remembered.id ? list.findIndex((row) => row.id === remembered.id) : -1;
    if (found >= 0) return found;
    return clamp(remembered.index, 0, Math.max(0, list.length - 1));
  }

  function push(id: Frame["id"], param?: string, title?: string) {
    const current = stackRef.current;
    const leaving = current[current.length - 1];
    rememberFrame(leaving);
    const draft: Frame = { id, index: 0, param, title };
    let index = 0;
    if (id === "backlight") {
      index = Math.max(
        0,
        BACKLIGHTS.findIndex((entry) => entry.id === settingsRef.current.backlight),
      );
    } else if (id === "spotify") {
      const first = listFor(draft).findIndex(
        (row) => row.action === "spotify-connect" || row.action === "spotify-refresh",
      );
      if (first >= 0) index = first;
    } else {
      const playing = playingRowIndex(draft);
      index = playing >= 0 ? playing : restoredIndex(draft);
    }
    const leavingGame = leaving?.id === "brick" ? cloneGame(gameRef.current) : null;
    if (id === "brick") {
      gameRef.current = createGame();
      setHud(EMPTY_HUD);
    }
    const next = [...current, { id, index, param, title }];
    stackRef.current = next;
    suppressSyncRef.current = false;
    openLayer(next[next.length - 1]!, false, leaving, leavingGame);
    setStack(next);
  }

  function pop() {
    const current = stackRef.current;
    if (current.length < 2) return false;
    const leaving = current[current.length - 1];
    rememberFrame(leaving);
    if (leaving.id === "now-playing") nowPlaying.exit();
    const leavingGame = leaving.id === "brick" ? cloneGame(gameRef.current) : null;
    const next = current.slice(0, -1);
    const restored = next[next.length - 1];
    if (restored) {
      const playing = playingRowIndex(restored);
      next[next.length - 1] = {
        ...restored,
        index: playing >= 0 ? playing : restoredIndex(restored),
      };
    }
    stackRef.current = next;
    suppressSyncRef.current = false;
    const entering = next[next.length - 1];
    if (entering) openLayer(entering, true, leaving, leavingGame);
    setStack(next);
    return true;
  }

  function openLayer(
    entering: Frame,
    back: boolean,
    leaving: Frame | undefined,
    leavingGame: BrickGame | null,
  ) {
    const live = layersRef.current.find((layer) => layer.live);
    const enteringId = ++layerSeq.current;
    if (!live || !leaving || reduceMotion.current) {
      for (const node of sheetNodes.current.values()) haltSlide(node);
      const next = [{ id: enteringId, frame: entering, game: null, live: true }];
      layersRef.current = next;
      pendingSlide.current = null;
      setLayers(next);
      return;
    }
    const next = [
      ...layersRef.current.map((layer) =>
        layer.id === live.id ? { ...layer, live: false, frame: leaving, game: leavingGame } : layer,
      ),
      { id: enteringId, frame: entering, game: null, live: true },
    ];
    layersRef.current = next;
    pendingSlide.current = {
      gen: ++slideGen.current,
      back,
      leavingId: live.id,
      enteringId,
    };
    setLayers(next);
  }

  function moveList(delta: number) {
    const current = stackRef.current;
    const frame = current[current.length - 1];
    if (!frame || frame.id === "brick" || frame.id === "now-playing") return 0;
    const list = listFor(frame);
    if (list.length === 0) return 0;
    const index = clamp(frame.index + delta, 0, list.length - 1);
    if (index === frame.index) return 0;
    const next = current.slice();
    next[next.length - 1] = { ...frame, index };
    stackRef.current = next;
    suppressSyncRef.current = true;
    setStack(next);
    return Math.abs(index - frame.index);
  }

  function queueFor(frame: Frame) {
    if (frame.id === "songs") return savedTracks(music.library);
    if (frame.id === "playlist") {
      const playlist = music.library.playlists.find((entry) => entry.id === frame.param);
      return playlist ? playlistTracks(music.library, playlist) : [];
    }
    if (frame.id === "artist") {
      const artist = music.library.artists.find((entry) => entry.id === frame.param);
      return artist ? artistTracks(music.library, artist) : [];
    }
    return [];
  }

  function playTrack(trackId: string) {
    const frame = currentFrame();
    if (!frame) return;
    const queue = queueFor(frame);
    const index = queue.findIndex((track) => track.id === trackId);
    if (index < 0) return;
    const current = playerRef.current;
    const snapshot = current.getSnapshot();
    if (snapshot.hasLoaded && snapshot.index === index && sameQueue(snapshot.queue, queue)) {
      if (!current.playing) current.toggle();
    } else {
      current.playQueue(queue, index);
    }
    if (frame.id !== "now-playing") push("now-playing");
  }

  function activate() {
    if (overlayRef.current) {
      if (overlayRef.current === "library-error") setErrorDismissed(true);
      return;
    }
    notify();
    unlockClick();
    const frame = currentFrame();
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
    const row = listFor(frame)[frame.index];
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

  function renderBody(frame: Frame, live: boolean, game: BrickGame | null) {
    if (frame.id === "brick") {
      return (
        <div className="brick-screen">
          <BrickPane
            live={live}
            snapshot={live ? null : game}
            gameRef={gameRef}
            onFrame={publishHud}
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
    return <MenuScreen frame={frame} settings={settings} data={data} />;
  }

  const frame = stack[stack.length - 1] ?? { id: "main" as const, index: 0 };
  const overlay: Overlay = !online
    ? "offline"
    : isBootLoading
      ? "loading"
      : music.status === "error" && !errorDismissed
        ? "library-error"
        : null;
  overlayRef.current = overlay;
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
                              {renderBody(shown, layer.live, layer.game)}
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
                    <ErrorScreen message={music.error ?? "Unable to load music"} />
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
                  onDragStart={() => {
                    unlockClick();
                    scroller.current.reset();
                    seekScroller.current.reset();
                    volumeScroller.current.reset();
                    volumeClickLatch.current = false;
                    volumeClickStep.current = null;
                    nowPlaying.handleDragStart();
                  }}
                  onDragEnd={() => {
                    scroller.current.reset();
                    seekScroller.current.reset();
                    volumeScroller.current.reset();
                    nowPlaying.handleDragEnd();
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      {clientIdOpen ? (
        <ClientIdDialog
          onClose={() => setClientIdOpen(false)}
          onSave={(clientId) => music.saveClientId(clientId)}
        />
      ) : null}
    </>
  );
}
