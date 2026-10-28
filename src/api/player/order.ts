import type { RepeatMode } from "./types.ts";

/** Spotify accepts at most 100 URIs in one play request. */
export const WINDOW_LIMIT = 100;

/** Bundle `br`: previous restarts the current track after this many seconds. */
export const RESTART_SECONDS = 3;

export function shuffledOrder(length: number, pinned: number, random: () => number = Math.random) {
  const rest: number[] = [];
  for (let index = 0; index < length; index += 1) {
    if (index !== pinned) rest.push(index);
  }
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const next = rest[swap]!;
    rest[swap] = rest[index]!;
    rest[index] = next;
  }
  return [pinned, ...rest];
}

export function identityOrder(length: number) {
  return Array.from({ length }, (_, index) => index);
}

export function orderPosition(order: readonly number[], queueIndex: number) {
  const position = order.indexOf(queueIndex);
  return position >= 0 ? position : 0;
}

export function adjacentQueueIndex(
  order: readonly number[],
  from: number,
  delta: 1 | -1,
  repeat: RepeatMode,
) {
  if (order.length === 0) return undefined;
  const position = order.indexOf(from);
  const target = (position >= 0 ? position : 0) + delta;
  if (target >= 0 && target < order.length) return order[target];
  if (repeat !== "all") return undefined;
  return order[delta === 1 ? 0 : order.length - 1];
}

export function takeWindow(order: readonly number[], orderPos: number, limit = WINDOW_LIMIT) {
  const start = orderPos < 0 ? 0 : orderPos;
  return order.slice(start, start + limit);
}
