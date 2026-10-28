export type Cancel = () => void;

export type Schedule = (callback: () => void, ms: number) => Cancel;

const defaultSchedule: Schedule = (callback, ms) => {
  const id = setTimeout(callback, ms);
  return () => clearTimeout(id);
};

export type IdleLatch = {
  clear: () => void;
  restart: () => void;
  keepOpen: () => void;
  release: () => void;
  exit: () => void;
  reenter: () => void;
  destroy: () => void;
};

/**
 * One timeout shared by seek and volume. `held` suppresses the deadline the
 * way a focused slider does; `restart` replaces any pending timeout.
 */
export function createIdleLatch(options: {
  timeoutMs: number;
  isActive: () => boolean;
  enter: () => void;
  onLeave: () => void;
  schedule?: Schedule;
}): IdleLatch {
  const schedule = options.schedule ?? defaultSchedule;
  let held = false;
  let cancel: Cancel | undefined;

  const clear = () => {
    cancel?.();
    cancel = undefined;
  };

  const arm = () => {
    clear();
    cancel = schedule(() => {
      cancel = undefined;
      if (!options.isActive()) return;
      options.onLeave();
    }, options.timeoutMs);
  };

  const leave = () => {
    if (!options.isActive()) return;
    clear();
    options.onLeave();
  };

  return {
    clear,
    restart() {
      if (held) return;
      arm();
    },
    keepOpen() {
      held = true;
      clear();
      if (!options.isActive()) options.enter();
    },
    release() {
      held = false;
      if (options.isActive()) arm();
    },
    exit() {
      held = false;
      leave();
    },
    reenter() {
      const wasHeld = held;
      leave();
      if (wasHeld) options.enter();
    },
    destroy: clear,
  };
}

type ScheduledTask = { at: number; serial: number; run: () => void };

/** Deterministic clock for session tests. Not used by the UI. */
export function createManualSchedule() {
  let now = 0;
  let serial = 0;
  const tasks: ScheduledTask[] = [];

  const schedule: Schedule = (callback, ms) => {
    const task = { at: now + ms, serial: serial++, run: callback };
    tasks.push(task);
    return () => {
      const index = tasks.indexOf(task);
      if (index >= 0) tasks.splice(index, 1);
    };
  };

  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      let pick = -1;
      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index];
        if (!task || task.at > now) continue;
        const chosen = pick >= 0 ? tasks[pick] : undefined;
        if (
          !chosen ||
          task.at < chosen.at ||
          (task.at === chosen.at && task.serial < chosen.serial)
        ) {
          pick = index;
        }
      }
      if (pick < 0) break;
      const task = tasks[pick];
      tasks.splice(pick, 1);
      task?.run();
    }
  };

  return { schedule, advance, now: () => now };
}
