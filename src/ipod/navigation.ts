import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { cloneGame, createGame, type BrickGame } from "../brick.ts";
import type { Player } from "../api/player.ts";
import { BACKLIGHTS, rows, type Frame, type MenuData, type Settings } from "../menus.ts";
import { EMPTY_HUD, type Hud } from "./BrickGame.tsx";
import { clamp, frameKey, type PendingSlide, type SheetLayer } from "./model.ts";
import type { NowPlayingControls } from "./nowPlayingControls.ts";
import { haltSlide } from "./screenSlide.ts";

export function useSettingsRef(settings: Settings) {
  return useRef(settings);
}

export function useNavigationState() {
  const [stack, setStack] = useState<Frame[]>([{ id: "main", index: 0 }]);
  const [layers, setLayers] = useState<SheetLayer[]>(() => [
    { id: 1, frame: { id: "main", index: 0 }, game: null, live: true },
  ]);
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  return { stack, setStack, layers, setLayers, hud, setHud };
}

export type NavigationBag = {
  settingsRef: RefObject<Settings>;
  stackRef: RefObject<Frame[]>;
  layersRef: RefObject<SheetLayer[]>;
  layerSeq: RefObject<number>;
  slideGen: RefObject<number>;
  pendingSlide: RefObject<PendingSlide | null>;
  sheetNodes: RefObject<Map<number, HTMLDivElement>>;
  rememberedRef: RefObject<Map<string, { id?: string; index: number }>>;
  suppressSyncRef: RefObject<boolean>;
  reduceMotion: RefObject<boolean>;
  gameRef: RefObject<BrickGame>;
  setStack: Dispatch<SetStateAction<Frame[]>>;
  setLayers: Dispatch<SetStateAction<SheetLayer[]>>;
  setHud: Dispatch<SetStateAction<Hud>>;
};

export function listForFrame(
  frame: Frame,
  settingsRef: RefObject<Settings>,
  dataRef: RefObject<MenuData>,
) {
  return rows(frame, settingsRef.current, dataRef.current);
}

export function readPlayingRowIndex(
  frame: Frame,
  settingsRef: RefObject<Settings>,
  dataRef: RefObject<MenuData>,
  playerRef: RefObject<Player>,
) {
  const list = listForFrame(frame, settingsRef, dataRef);
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

export function topFrame(stackRef: RefObject<Frame[]>) {
  return stackRef.current[stackRef.current.length - 1];
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
  layerSeq,
  slideGen,
  pendingSlide,
  sheetNodes,
  rememberedRef,
  suppressSyncRef,
  reduceMotion,
  gameRef,
  setStack,
  setLayers,
  setHud,
  dataRef,
  playerRef,
  nowPlaying,
}: NavigationActionsInput) {

  function rememberFrame(frame: Frame | undefined) {
    if (!frame || frame.id === "brick" || frame.id === "now-playing" || frame.id === "reset") {
      return;
    }
    const list = listForFrame(frame, settingsRef, dataRef);
    const row = list[frame.index];
    rememberedRef.current.set(frameKey(frame), { id: row?.id, index: frame.index });
  }

  function restoredIndex(frame: Frame) {
    if (frame.id === "reset") return 0;
    const remembered = rememberedRef.current.get(frameKey(frame));
    if (!remembered) return 0;
    const list = listForFrame(frame, settingsRef, dataRef);
    const found = remembered.id ? list.findIndex((row) => row.id === remembered.id) : -1;
    if (found >= 0) return found;
    return clamp(remembered.index, 0, Math.max(0, list.length - 1));
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
      const first = listForFrame(draft, settingsRef, dataRef).findIndex(
        (row) => row.action === "spotify-connect" || row.action === "spotify-refresh",
      );
      if (first >= 0) index = first;
    } else {
      const playing = readPlayingRowIndex(draft, settingsRef, dataRef, playerRef);
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
      const playing = readPlayingRowIndex(restored, settingsRef, dataRef, playerRef);
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

  function moveList(delta: number) {
    const current = stackRef.current;
    const frame = current[current.length - 1];
    if (!frame || frame.id === "brick" || frame.id === "now-playing") return 0;
    const list = listForFrame(frame, settingsRef, dataRef);
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

  function handleQueueFinished() {
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
  }

  return { push, pop, moveList, handleQueueFinished };
}

