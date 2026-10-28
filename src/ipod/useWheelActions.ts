import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { movePaddle, setSteer, type BrickGame } from "../brick.ts";
import { playClick, unlockClick } from "../click.ts";
import type { Frame, MenuData, Settings } from "../menus.ts";
import { VOLUME_KEY_STEP } from "./playbackTiming.ts";
import type { NowPlayingControls } from "./nowPlayingControls.ts";
import type { Player } from "../api/player.ts";
import type { Overlay } from "./model.ts";
import { createLatestSeek, stepHoldSeek, type LatestSeek } from "./holdSeek.ts";
import { useDocumentVisible } from "./useDocumentVisible.ts";
import { topFrame } from "./navigation.ts";
import {
  createListScroller,
  createSeekScroller,
  createVolumeScroller,
  tierForHold,
  type ScrollDetail,
} from "../wheel.ts";
import type { WheelScrollTarget } from "./ClickWheel.tsx";

export type WheelActions = {
  scroll: (detail: ScrollDetail) => void;
  screenArrow: (step: 1 | -1) => void;
  menu: () => void;
  menuHold: () => void;
  select: () => void;
  openBrick: () => void;
  steer: (step: 1 | -1 | null) => void;
  keyStep: (step: 1 | -1, heldMs: number) => void;
  playPause: () => void;
  back: () => void;
  forward: () => void;
  backHold: (repeat: boolean) => void;
  forwardHold: (repeat: boolean) => void;
};

export type HoldSeekState = { base?: number; track?: number; tier: number };

type WheelInput = {
  settings: Settings;
  stack: Frame[];
  data: MenuData;
  settingsRef: RefObject<Settings>;
  stackRef: RefObject<Frame[]>;
  dataRef: RefObject<MenuData>;
  overlayRef: RefObject<Overlay>;
  playerRef: RefObject<Player>;
  nowPlaying: NowPlayingControls;
  gameRef: RefObject<BrickGame>;
  notify: () => void;
  toggleBacklight: () => void;
  moveList: (delta: number) => number;
  push: (id: Frame["id"], param?: string, title?: string) => void;
  menu: () => void;
  activate: () => void;
  playPause: () => void;
};

export function useWheelActions({
  settings,
  stack,
  data,
  settingsRef,
  stackRef,
  dataRef,
  overlayRef,
  playerRef,
  nowPlaying,
  gameRef,
  notify,
  toggleBacklight,
  moveList,
  push,
  menu,
  activate,
  playPause,
}: WheelInput) {
  const scroller = useRef(createListScroller());
  const seekScroller = useRef(createSeekScroller());
  const volumeScroller = useRef(createVolumeScroller());
  const holdSeekRef = useRef<HoldSeekState>({ tier: 0 });
  const seekGateRef = useRef<LatestSeek | null>(null);
  const volumeClickLatch = useRef(false);
  const volumeClickStep = useRef<1 | -1 | null>(null);
  const actions = useRef<WheelActions>({
    scroll: () => {},
    screenArrow: () => {},
    menu: () => {},
    menuHold: () => {},
    select: () => {},
    openBrick: () => {},
    steer: () => {},
    keyStep: () => {},
    playPause: () => {},
    back: () => {},
    forward: () => {},
    backHold: () => {},
    forwardHold: () => {},
  });

  function clickSound() {
    if (settingsRef.current.clicker === "on") playClick();
  }

  function currentScrollTarget(): WheelScrollTarget {
    if (nowPlaying.isSeeking()) return "seek";
    const frame = topFrame(stackRef);
    if (frame?.id === "brick") return "brick";
    if (frame?.id === "now-playing") return "volume";
    return "list";
  }

  function seekGate() {
    seekGateRef.current ??= createLatestSeek((seconds) => playerRef.current.seekTo(seconds));
    return seekGateRef.current;
  }

  function holdSeek(step: 1 | -1, repeat: boolean) {
    const current = playerRef.current;
    const clock = current.clock.getSnapshot();
    const result = stepHoldSeek(holdSeekRef.current, {
      repeat,
      step,
      inert: overlayRef.current != null,
      seeking: nowPlaying.isSeeking(),
      hasLoaded: current.hasLoaded,
      currentTime: clock.currentTime,
      duration: clock.duration,
      index: current.index,
    });
    holdSeekRef.current = result.state;
    const gate = seekGate();
    if (!repeat) gate.begin();
    if (result.target === null) return;
    notify();
    gate.push(result.target);
  }

  const visible = useDocumentVisible();
  const scrubbing = nowPlaying.seeking;
  const stopHoldSeek = useEffectEvent(() => {
    holdSeekRef.current = { tier: 0 };
    seekGateRef.current?.cancel();
  });

  useEffect(() => {
    if (!visible) stopHoldSeek();
  }, [visible]);

  useEffect(() => {
    if (!scrubbing) return;
    stopHoldSeek();
  }, [scrubbing]);

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
        if (topFrame(stackRef)?.id !== "about") return;
        notify();
        push("brick");
      },
      steer(step) {
        notify();
        if (overlayRef.current) return;
        if (topFrame(stackRef)?.id !== "brick") return;
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

  function onDragStart() {
    unlockClick();
    scroller.current.reset();
    seekScroller.current.reset();
    volumeScroller.current.reset();
    volumeClickLatch.current = false;
    volumeClickStep.current = null;
    nowPlaying.handleDragStart();
  }

  function onDragEnd() {
    scroller.current.reset();
    seekScroller.current.reset();
    volumeScroller.current.reset();
    nowPlaying.handleDragEnd();
  }

  return { actions, holdSeekRef, onDragStart, onDragEnd };
}
