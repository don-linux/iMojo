import { useEffect, useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { createGame, type BrickGame } from "../brick.ts";
import type { Player } from "../api/player.ts";
import { rows, type Frame, type MenuData, type Settings } from "../menus.ts";
import { scrollListToRow } from "./listScroll.ts";
import type { PendingSlide, SheetLayer } from "./model.ts";
import { readPlayingRowIndex } from "./navigation.ts";
import { beginSlide, haltSlide } from "./screenSlide.ts";

export function useDeviceEnvironment() {
  const deviceRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useRef(false);

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

  return { deviceRef, reduceMotion };
}

type RuntimeInput = {
  settings: Settings;
  stack: Frame[];
  setStack: Dispatch<SetStateAction<Frame[]>>;
  layers: SheetLayer[];
  setLayers: Dispatch<SetStateAction<SheetLayer[]>>;
  data: MenuData;
  player: Player;
  playerRef: RefObject<Player>;
  settingsRef: RefObject<Settings>;
  dataRef: RefObject<MenuData>;
};

export function useNavigationRuntime({
  settings,
  stack,
  setStack,
  layers,
  setLayers,
  data,
  player,
  playerRef,
  settingsRef,
  dataRef,
}: RuntimeInput) {
  const stackRef = useRef(stack);
  const layersRef = useRef(layers);
  const layerSeq = useRef(1);
  const slideGen = useRef(0);
  const appliedSlide = useRef(0);
  const pendingSlide = useRef<PendingSlide | null>(null);
  const sheetNodes = useRef(new Map<number, HTMLDivElement>());
  const mounted = useRef(true);
  const rememberedRef = useRef(new Map<string, { id?: string; index: number }>());
  const suppressSyncRef = useRef(false);
  const gameRef = useRef<BrickGame>(createGame());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const node of sheetNodes.current.values()) haltSlide(node);
    };
  }, []);

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
  }, [layers, setLayers]);

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
  }, [stack, data, settings, setStack]);

  useEffect(() => {
    if (suppressSyncRef.current) return;
    const frame = stack[stack.length - 1];
    if (!frame || frame.id === "brick" || frame.id === "now-playing") return;
    const playing = readPlayingRowIndex(frame, settingsRef, dataRef, playerRef);
    if (playing < 0 || playing === frame.index) return;
    const next = stack.slice();
    next[next.length - 1] = { ...frame, index: playing };
    stackRef.current = next;
    setStack(next);
  }, [stack, player.index, player.queue, setStack, settingsRef, playerRef, dataRef]);

  return {
    stackRef,
    layersRef,
    layerSeq,
    slideGen,
    appliedSlide,
    pendingSlide,
    sheetNodes,
    rememberedRef,
    suppressSyncRef,
    gameRef,
  };
}
