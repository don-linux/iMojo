import { rows, type Frame, type MenuData, type Settings } from "../menus.ts";
import type { Row } from "../menus/types.ts";
import {
  canRemember,
  displayIndex,
  isLoadingPlaceholder,
  type NavFrame,
  type PlaybackSlice,
  type Selection,
} from "./navigationReducer.ts";

export function readNav(frame: Frame): NavFrame {
  const extra = frame as Frame & { rowId?: string; followPlaying?: boolean };
  return {
    id: frame.id,
    index: frame.index,
    param: frame.param,
    title: frame.title,
    rowId: extra.rowId,
    followPlaying: extra.followPlaying,
  };
}

export function playbackSlice(player: {
  queue: readonly { id: string }[];
  index: number;
  finished: boolean;
}): PlaybackSlice {
  return { queue: player.queue, index: player.index, finished: player.finished };
}

export function playlistLoaded(frame: Frame, data: MenuData) {
  if (frame.id !== "playlist") return true;
  const detail = frame.param ? data.playlistDetail[frame.param] : undefined;
  if (!detail || detail.unavailable) return true;
  return detail.loaded;
}

export function selectionView(
  frame: Frame,
  settings: Settings,
  data: MenuData,
  playback: PlaybackSlice,
) {
  const list = rows(frame, settings, data);
  const loaded = playlistLoaded(frame, data);
  const index = displayIndex(list, readNav(frame), playback, { playlistLoaded: loaded });
  return { list, index, row: list[index], loaded };
}

export function memoryOf(
  frame: Frame,
  settings: Settings,
  data: MenuData,
  playback: PlaybackSlice,
): Selection | null {
  if (!canRemember(frame)) return null;
  const nav = readNav(frame);
  const view = selectionView(frame, settings, data, playback);
  if (!view.loaded && isLoadingPlaceholder(view.list)) return { index: view.index, rowId: nav.rowId };
  return { index: view.index, rowId: view.row?.id ?? nav.rowId };
}

export function preferredSelection(
  id: Frame["id"],
  list: readonly Row[],
  settings: Settings,
): Selection | undefined {
  if (id === "reset") return { index: 0, rowId: list[0]?.id };
  if (id === "backlight") {
    const index = Math.max(
      0,
      list.findIndex((row) => row.id === settings.backlight),
    );
    return { index, rowId: list[index]?.id };
  }
  if (id === "spotify") {
    const first = list.findIndex(
      (row) => row.action === "spotify-connect" || row.action === "spotify-refresh",
    );
    const index = first >= 0 ? first : 0;
    return { index, rowId: list[index]?.id };
  }
  return undefined;
}

export function enteringSelection(
  frame: Frame,
  settings: Settings,
  data: MenuData,
  playback: PlaybackSlice,
  remembered: Selection | undefined,
  preferred?: Selection,
): Selection {
  if (preferred) return preferred;
  const list = rows(frame, settings, data);
  const loaded = playlistLoaded(frame, data);
  const seed: NavFrame = {
    id: frame.id,
    index: remembered?.index ?? 0,
    param: frame.param,
    title: frame.title,
    rowId: remembered?.rowId,
    followPlaying: true,
  };
  const index = displayIndex(list, seed, playback, { playlistLoaded: loaded });
  if (!loaded && isLoadingPlaceholder(list)) return { index, rowId: remembered?.rowId };
  return { index, rowId: list[index]?.id ?? remembered?.rowId };
}
