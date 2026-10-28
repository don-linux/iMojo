export const CLICK_SPACING = 0.05;
export const CLICK_LOOKAHEAD = 0.15;
export const RESUME_LEAD = 0.08;
export const PENDING_WINDOW_MS = 200;

export type ScheduledClick = {
  startAt: number;
  nextAt: number;
};

export function scheduleClick(now: number, nextAt: number): ScheduledClick | null {
  if (nextAt - now >= CLICK_LOOKAHEAD) return null;
  const startAt = Math.max(now, nextAt);
  return { startAt, nextAt: startAt + CLICK_SPACING };
}

export function rebaseAfterResume(now: number, nextAt: number): number {
  return Math.max(nextAt, now + RESUME_LEAD);
}

export function isPendingFresh(pendingAt: number, nowMs: number): boolean {
  return nowMs - pendingAt < PENDING_WINDOW_MS;
}
