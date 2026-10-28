import { useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { createGame, type BrickGame } from "../brick.ts";
import type { Player } from "../api/player.ts";
import type { Frame, MenuData, Settings } from "../menus.ts";
import { MENU_ROW_HEIGHT, scrollTopForIndex } from "./listScroll.ts";
import type { PendingSlide, SheetLayer } from "./model.ts";
import { mainFrame, type NavFrame, type Selection } from "./navigationReducer.ts";
import { beginSlide, haltSlide, type SlideHandle } from "./screenSlide.ts";
import { playbackSlice, selectionView } from "./selection.ts";

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
  stack: NavFrame[];
  layers: SheetLayer[];
  setLayers: Dispatch<SetStateAction<SheetLayer[]>>;
  data: MenuData;
  player: Player;
};

export function useNavigationRuntime({
  settings,
  stack,
  layers,
  setLayers,
  data,
  player,
}: RuntimeInput) {
  const stackRef = useRef<Frame[]>(stack);
  const layersRef = useRef(layers);
  const layerSeq = useRef(1);
  const pendingSlide = useRef<PendingSlide | null>(null);
  const sheetNodes = useRef(new Map<number, HTMLDivElement>());
  const mounted = useRef(true);
  const rememberedRef = useRef(new Map<string, Selection>());
  const gameRef = useRef<BrickGame>(createGame());
  const listRef = useRef<HTMLUListElement | null>(null);
  const rowHeightRef = useRef<number | null>(null);
  const activeGen = useRef(0);

  function allocateLayer() {
    layerSeq.current += 1;
    return layerSeq.current;
  }

  function setPending(next: PendingSlide | null) {
    pendingSlide.current = next;
  }

  const top = stack.at(-1);
  const playback = playbackSlice(player);
  const view = top ? selectionView(top, settings, data, playback) : null;
  const activeIndex = view?.index ?? 0;
  const rowCount = view?.list.length ?? 0;
  const screenFrame: NavFrame = top
    ? activeIndex === top.index
      ? top
      : { ...top, index: activeIndex }
    : mainFrame();
  const frameIdentity = top ? `${top.id}:${top.param ?? ""}` : "";
  const liveId = layers.find((layer) => layer.live)?.id ?? 0;

  useLayoutEffect(() => {
    stackRef.current = stack;
    layersRef.current = layers;
  }, [stack, layers]);

  useEffect(() => {
    const nodes = sheetNodes.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const node of nodes.values()) haltSlide(node);
    };
  }, []);

  useLayoutEffect(() => {
    const pending = pendingSlide.current;
    if (!pending) return;
    pendingSlide.current = null;
    const gen = pending.gen;
    activeGen.current = gen;
    let cancelled = false;
    let dropped = false;
    const leavingNode = sheetNodes.current.get(pending.leavingId) ?? null;
    const enteringNode = sheetNodes.current.get(pending.enteringId) ?? null;
    const handles: SlideHandle[] = [];

    const drop = (id: number) => {
      if (cancelled || activeGen.current !== gen || !mounted.current) return;
      dropped = true;
      setLayers((current) => {
        if (!current.some((layer) => layer.id === id && !layer.live)) return current;
        const next = current.filter((layer) => layer.id !== id);
        layersRef.current = next;
        return next;
      });
    };

    if (leavingNode) {
      handles.push(
        beginSlide(leavingNode, { back: pending.back, direction: "out" }, () => drop(pending.leavingId)),
      );
    }
    if (enteringNode) {
      const handle = beginSlide(enteringNode, { back: pending.back, direction: "in" });
      handles.push(handle);
      const stolen = handle.stolen;
      if (stolen) {
        queueMicrotask(() => {
          if (cancelled || activeGen.current !== gen) return;
          for (const [id, node] of sheetNodes.current) {
            if (node === stolen) drop(id);
          }
        });
      }
    }

    return () => {
      cancelled = true;
      for (const handle of handles) handle.cancel();
      haltSlide(leavingNode);
      haltSlide(enteringNode);
      if (!dropped && pendingSlide.current == null) pendingSlide.current = pending;
    };
  }, [layers, setLayers]);

  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node || frameIdentity.startsWith("brick") || frameIdentity.startsWith("now-playing")) return;
    if (rowHeightRef.current == null) {
      const first = node.firstElementChild;
      const measured = first instanceof HTMLElement ? first.offsetHeight : 0;
      if (measured > 0) rowHeightRef.current = measured;
    }
    const next = scrollTopForIndex(activeIndex, rowCount, node.scrollTop, rowHeightRef.current ?? MENU_ROW_HEIGHT);
    if (node.scrollTop !== next) node.scrollTop = next;
  }, [activeIndex, rowCount, frameIdentity, liveId]);

  return {
    stackRef,
    layersRef,
    layerSeq,
    pendingSlide,
    sheetNodes,
    rememberedRef,
    gameRef,
    mounted,
    listRef,
    screenFrame,
    allocateLayer,
    setPending,
  };
}
