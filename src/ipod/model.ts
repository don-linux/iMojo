import type { BrickGame } from "../brick.ts";
import type { Track } from "../api/types.ts";
import type { Frame, SongEntry } from "../menus/types.ts";

export const SELECT_HOLD_MS = 5000;
export const MENU_HOLD_MS = 1000;
export const HOLD_SEEK_TIERS = [5, 5, 5, 10, 10, 10, 20] as const;
export const BOOT_MIN_MS = 2000;
export const BOOT_MAX_MS = 10000;

export type Overlay = "loading" | "offline" | "library-error" | null;

export type SheetLayer = {
  id: number;
  frame: Frame;
  game: BrickGame | null;
  live: boolean;
};

export type PendingSlide = {
  gen: number;
  back: boolean;
  leavingId: number;
  enteringId: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function songEntry(track: Track): SongEntry {
  return { id: track.id, title: track.title, artistName: track.artistName };
}

export function frameKey(frame: Frame) {
  return `${frame.id}:${frame.param ?? ""}`;
}
