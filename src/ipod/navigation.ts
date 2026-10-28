import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { cloneGame, createGame, type BrickGame } from "../brick/geom.ts";
import type { Player } from "../api/player/types.ts";
import type { Settings } from "../menus/model.ts";
import { rows } from "../menus/rows.ts";
import type { Frame, MenuData } from "../menus/types.ts";
import { EMPTY_HUD, type Hud } from "./BrickGame.tsx";
import { frameKey, type PendingSlide, type SheetLayer } from "./model.ts";
import type { NowPlayingControls } from "./nowPlayingControls.ts";
import {
  FOLLOW_PLAYING_MS,
  mainFrame,
  navigationReducer,
  type NavFrame,
  type NavState,
  type Selection,
} from "./navigationReducer.ts";
import { haltSlide } from "./screenSlide.ts";
import {
  enteringSelection,
  memoryOf,
  playbackSlice,
  preferredSelection,
  readNav,
  selectionView,
} from "./selection.ts";

export function useSettingsRef(settings: Settings) {
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  return settingsRef;
}

export function useNavigationState() {
  const [stack, setStack] = useState<NavFrame[]>(() => [mainFrame()]);
  const [layers, setLayers] = useState<SheetLayer[]>(() => [
    { id: 1, frame: mainFrame(), game: null, live: true },
  ]);
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  return { stack, setStack, layers, setLayers, hud, setHud };
}

export type NavigationBag = {
  settingsRef: RefObject<Settings>;
  stackRef: RefObject<Frame[]>;
  layersRef: RefObject<SheetLayer[]>;
  allocateLayer: () => number;
  setPending: (pending: PendingSlide | null) => void;
  sheetNodes: RefObject<Map<number, HTMLDivElement>>;
  rememberedRef: RefObject<Map<string, Selection>>;
  reduceMotion: RefObject<boolean>;
  gameRef: RefObject<BrickGame>;
  mounted: RefObject<boolean>;
  setStack: Dispatch<SetStateAction<NavFrame[]>>;
  setLayers: Dispatch<SetStateAction<SheetLayer[]>>;
  setHud: Dispatch<SetStateAction<Hud>>;
};

export function topFrame(stackRef: RefObject<Frame[]>) {
  return stackRef.current.at(-1);
}

type NavigationActionsInput = NavigationBag & {
  dataRef: RefObject<MenuData>;
  playerRef: RefObject<Player>;
  nowPlaying: NowPlayingControls;
};

export function useNavigationActions({
  settingsRef,
  stackRef,
  layersRef,
  allocateLayer,
  setPending,
  sheetNodes,
  rememberedRef,
  reduceMotion,
  gameRef,
  mounted,
  setStack,
  setLayers,
  setHud,
  dataRef,
  playerRef,
  nowPlaying,
}: NavigationActionsInput) {
  const followTimers = useRef<number[]>([]);
  const slideGen = useRef(0);

  useEffect(() => {
    const pending = followTimers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
      pending.length = 0;
    };
  }, []);

  function currentState(): NavState {
    return { stack: stackRef.current as NavFrame[], remembered: rememberedRef.current };
  }

  function commit(next: NavState) {
    rememberedRef.current = new Map(next.remembered);
    stackRef.current = next.stack;
    setStack(next.stack);
  }

  function clearFollowTimer() {
    for (const id of followTimers.current) window.clearTimeout(id);
    followTimers.current.length = 0;
  }

  function armFollowTimer() {
    clearFollowTimer();
    const id = window.setTimeout(() => {
      const pending = followTimers.current;
      const at = pending.indexOf(id);
      if (at >= 0) pending.splice(at, 1);
      if (!mounted.current) return;
      const state = currentState();
      const frame = state.stack.at(-1);
      if (!frame || frame.followPlaying !== false) return;
      const next = navigationReducer(state, { type: "replace", followPlaying: true });
      if (next === state) return;
      commit(next);
    }, FOLLOW_PLAYING_MS);
    followTimers.current.push(id);
  }

  function openLayer(entering: NavFrame, back: boolean, leaving: Frame | undefined, leavingGame: BrickGame | null) {
    const live = layersRef.current.find((layer) => layer.live);
    const enteringId = allocateLayer();
    if (!live || !leaving || reduceMotion.current) {
      for (const node of sheetNodes.current.values()) haltSlide(node);
      const next = [{ id: enteringId, frame: entering, game: null, live: true }];
      layersRef.current = next;
      setPending(null);
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
    slideGen.current += 1;
    setPending({ gen: slideGen.current, back, leavingId: live.id, enteringId });
    setLayers(next);
  }

  function push(id: Frame["id"], param?: string, title?: string) {
    const state = currentState();
    const leaving = state.stack.at(-1);
    if (!leaving) return;
    const settings = settingsRef.current;
    const data = dataRef.current;
    const playback = playbackSlice(playerRef.current);
    const draft: Frame = { id, index: 0, param, title };
    const enteringList = rows(draft, settings, data);
    const selection = enteringSelection(
      draft,
      settings,
      data,
      playback,
      state.remembered.get(frameKey(draft)),
      preferredSelection(id, enteringList, settings),
    );
    const entering: NavFrame = {
      id,
      index: selection.index,
      param,
      title,
      rowId: selection.rowId,
      followPlaying: true,
    };
    const leavingGame = leaving.id === "brick" ? cloneGame(gameRef.current) : null;
    if (id === "brick") {
      gameRef.current = createGame();
      setHud(EMPTY_HUD);
    }
    const leavingMemory = memoryOf(leaving, settings, data, playback);
    const next = navigationReducer(state, { type: "push", frame: entering, leaving: leavingMemory });
    const snap = leavingMemory
      ? { ...leaving, index: leavingMemory.index, rowId: leavingMemory.rowId }
      : leaving;
    clearFollowTimer();
    openLayer(next.stack.at(-1) ?? entering, false, snap, leavingGame);
    commit(next);
  }

  function pop() {
    const state = currentState();
    if (state.stack.length < 2) return false;
    const leaving = state.stack.at(-1);
    if (!leaving) return false;
    const settings = settingsRef.current;
    const data = dataRef.current;
    const playback = playbackSlice(playerRef.current);
    if (leaving.id === "now-playing") nowPlaying.exit();
    const leavingGame = leaving.id === "brick" ? cloneGame(gameRef.current) : null;
    const revealed = state.stack.at(-2);
    if (!revealed) return false;
    const restored = enteringSelection(
      revealed,
      settings,
      data,
      playback,
      { index: revealed.index, rowId: readNav(revealed).rowId },
      revealed.id === "reset" ? preferredSelection("reset", rows(revealed, settings, data), settings) : undefined,
    );
    const leavingMemory = memoryOf(leaving, settings, data, playback);
    const next = navigationReducer(state, { type: "pop", leaving: leavingMemory, restored });
    const entering = next.stack.at(-1);
    clearFollowTimer();
    if (entering) {
      const snap = leavingMemory
        ? { ...leaving, index: leavingMemory.index, rowId: leavingMemory.rowId }
        : leaving;
      openLayer(entering, true, snap, leavingGame);
    }
    commit(next);
    return true;
  }

  function moveList(delta: number) {
    const state = currentState();
    const frame = state.stack.at(-1);
    if (!frame || frame.id === "brick" || frame.id === "now-playing") return 0;
    const settings = settingsRef.current;
    const data = dataRef.current;
    const view = selectionView(frame, settings, data, playbackSlice(playerRef.current));
    if (view.list.length === 0) return 0;
    if (!view.loaded && view.list.length === 1 && view.list[0]?.id === "loading") return 0;
    const index = Math.min(view.list.length - 1, Math.max(0, view.index + delta));
    if (index === view.index) return 0;
    const next = navigationReducer(state, { type: "move", index, rowId: view.list[index]?.id });
    commit(next);
    armFollowTimer();
    return Math.abs(index - view.index);
  }

  function handleQueueFinished() {
    if (!mounted.current) return;
    const state = currentState();
    const leaving = state.stack.at(-1);
    const next = navigationReducer(state, { type: "queueEnded" });
    if (next === state) return;
    if (leaving?.id === "now-playing") nowPlaying.exit();
    clearFollowTimer();
    const entering = next.stack.at(-1);
    if (leaving?.id === "now-playing" && entering && next.stack.length < state.stack.length) {
      openLayer(entering, true, leaving, null);
    }
    commit(next);
  }

  return { push, pop, moveList, handleQueueFinished };
}
