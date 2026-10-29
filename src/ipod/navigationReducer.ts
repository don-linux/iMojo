import type { ScreenId } from "../menus/types.ts";
import { frameKey } from "./model.ts";

export const FOLLOW_PLAYING_MS = 600;

const EPHEMERAL: ReadonlySet<ScreenId> = new Set(["brick", "now-playing", "reset"]);

export type IndexRow = { id: string; action?: string };

export type PlaybackSlice = {
  queue: readonly { id: string }[];
  index: number;
  finished: boolean;
};

export type Selection = { index: number; rowId?: string };

export type NavFrame = {
  id: ScreenId;
  index: number;
  param?: string;
  title?: string;
  rowId?: string;
  followPlaying?: boolean;
};

export type NavState = {
  stack: NavFrame[];
  remembered: ReadonlyMap<string, Selection>;
};

export type NavAction =
  | { type: "push"; frame: NavFrame; leaving: Selection | null }
  | { type: "pop"; leaving: Selection | null; restored: Selection }
  | { type: "move"; index: number; rowId?: string }
  | { type: "replace"; followPlaying: boolean }
  | { type: "queueEnded" };

export function mainFrame(): NavFrame {
  return { id: "main", index: 0, rowId: "playlists", followPlaying: true };
}

export function initialNavState(): NavState {
  return { stack: [mainFrame()], remembered: new Map() };
}

export function canRemember(frame: { id: ScreenId }) {
  return !EPHEMERAL.has(frame.id);
}

export function isLoadingPlaceholder(rows: readonly IndexRow[]) {
  const row = rows[0];
  return rows.length === 1 && row?.id === "loading" && row.action === "info";
}

/** Pending playlist index stays put while the only row is the loading placeholder. */
export function resolveIndex(
  rows: readonly IndexRow[],
  frame: { index: number; rowId?: string },
  options?: { playlistLoaded?: boolean },
): number {
  if (options?.playlistLoaded === false && isLoadingPlaceholder(rows)) return frame.index;
  const rowId = frame.rowId;
  if (rowId && rows[frame.index]?.id === rowId) return frame.index;
  if (!rowId) return 0;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]?.id === rowId) return index;
  }
  return 0;
}

export function playingRowIndex(
  rows: readonly IndexRow[],
  queue: readonly { id: string }[],
  playerIndex: number,
  finished: boolean,
): number {
  if (finished || playerIndex < 0 || queue.length === 0) return -1;
  const positions: number[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]?.action === "play") positions.push(index);
  }
  if (positions.length !== queue.length) return -1;
  for (let index = 0; index < queue.length; index += 1) {
    if (rows[positions[index]!]?.id !== queue[index]?.id) return -1;
  }
  return positions[playerIndex] ?? -1;
}

export function displayIndex(
  rows: readonly IndexRow[],
  frame: { index: number; rowId?: string; followPlaying?: boolean },
  playback: PlaybackSlice | null,
  options?: { playlistLoaded?: boolean },
): number {
  if (frame.followPlaying !== false && playback) {
    const playing = playingRowIndex(rows, playback.queue, playback.index, playback.finished);
    if (playing >= 0) return playing;
  }
  return resolveIndex(rows, frame, options);
}

/** Queue index for a play row. Duplicate ids keep this position instead of the first copy. */
export function playPosition(rows: readonly { action?: string }[], index: number) {
  const row = rows[index];
  if (!row || row.action !== "play") return -1;
  let position = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (rows[cursor]?.action === "play") position += 1;
  }
  return position;
}

function rememberLeaving(state: NavState, leaving: Selection | null, frame: NavFrame | undefined) {
  if (!frame || !leaving || !canRemember(frame)) return state.remembered;
  const remembered = new Map(state.remembered);
  remembered.set(frameKey(frame), leaving);
  return remembered;
}

function pushFrame(state: NavState, action: Extract<NavAction, { type: "push" }>): NavState {
  const leaving = state.stack.at(-1);
  const remembered = rememberLeaving(state, action.leaving, leaving);
  const stack = state.stack.slice();
  if (leaving && action.leaving && canRemember(leaving)) {
    stack[stack.length - 1] = {
      ...leaving,
      index: action.leaving.index,
      rowId: action.leaving.rowId,
    };
  }
  stack.push({ ...action.frame, followPlaying: true });
  return { stack, remembered };
}

function popFrame(state: NavState, action: Extract<NavAction, { type: "pop" }>): NavState {
  if (state.stack.length < 2) return state;
  const leaving = state.stack.at(-1);
  const remembered = new Map(rememberLeaving(state, action.leaving, leaving));
  const stack = state.stack.slice(0, -1);
  const revealed = stack.at(-1);
  if (!revealed) return state;
  if (canRemember(revealed)) remembered.set(frameKey(revealed), action.restored);
  stack[stack.length - 1] = {
    ...revealed,
    index: action.restored.index,
    rowId: action.restored.rowId,
    followPlaying: true,
  };
  return { stack, remembered };
}

function moveFrame(state: NavState, action: Extract<NavAction, { type: "move" }>): NavState {
  const top = state.stack.at(-1);
  if (!top || top.id === "brick" || top.id === "now-playing") return state;
  if (top.index === action.index && top.rowId === action.rowId && top.followPlaying === false) {
    return state;
  }
  const stack = state.stack.slice();
  stack[stack.length - 1] = {
    ...top,
    index: action.index,
    rowId: action.rowId,
    followPlaying: false,
  };
  return { stack, remembered: state.remembered };
}

function replaceTop(state: NavState, followPlaying: boolean): NavState {
  const top = state.stack.at(-1);
  if (!top || top.followPlaying === followPlaying) return state;
  const stack = state.stack.slice();
  stack[stack.length - 1] = { ...top, followPlaying };
  return { stack, remembered: state.remembered };
}

function parked(frame: NavFrame): NavFrame {
  return { ...frame, index: 0, rowId: undefined, followPlaying: true };
}

function endQueue(state: NavState): NavState {
  const remembered = new Map(state.remembered);
  let cleared = false;
  for (const [key, value] of remembered) {
    if (key.startsWith("now-playing:") || value.rowId === "now-playing") {
      remembered.delete(key);
      cleared = true;
    }
  }
  const top = state.stack.at(-1);
  const pop = top?.id === "now-playing" && state.stack.length >= 2;
  const selectedNowPlaying = (frame: NavFrame) =>
    frame.rowId === "now-playing" || state.remembered.get(frameKey(frame))?.rowId === "now-playing";
  if (!pop && !cleared && !state.stack.some(selectedNowPlaying)) return state;
  const base = pop ? state.stack.slice(0, -1) : state.stack;
  const stack = base.map((frame, index) => {
    const revealed = pop && index === base.length - 1;
    if (frame.rowId === "now-playing" || (revealed && selectedNowPlaying(frame))) {
      return parked(frame);
    }
    if (revealed && frame.followPlaying !== true) return { ...frame, followPlaying: true };
    return frame;
  });
  return { stack, remembered: cleared ? remembered : state.remembered };
}

export function navigationReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "push":
      return pushFrame(state, action);
    case "pop":
      return popFrame(state, action);
    case "move":
      return moveFrame(state, action);
    case "replace":
      return replaceTop(state, action.followPlaying);
    case "queueEnded":
      return endQueue(state);
  }
}
