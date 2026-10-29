import assert from "node:assert/strict";
import test from "node:test";
import { BOOT_MAX_MS, BOOT_MIN_MS } from "./model.ts";
import { createBootClock } from "./bootClock.ts";

type Timer = { at: number; fn: () => void };

function installClock() {
  let now = 0;
  let nextId = 1;
  let hidden = false;
  const timers = new Map<number, Timer>();
  const listeners = new Map<string, Set<() => void>>();
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    now: Date.now,
  };
  const net = { onLine: true };

  const add = (target: Map<string, Set<() => void>>, type: string, listener: () => void) => {
    let set = target.get(type);
    if (!set) {
      set = new Set();
      target.set(type, set);
    }
    set.add(listener);
  };
  const remove = (target: Map<string, Set<() => void>>, type: string, listener: () => void) => {
    target.get(type)?.delete(listener);
  };
  const fire = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener();
  };

  globalThis.window = {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id?: number) {
      if (id !== undefined) timers.delete(id);
    },
    addEventListener(type: string, listener: () => void) {
      add(listeners, type, listener);
    },
    removeEventListener(type: string, listener: () => void) {
      remove(listeners, type, listener);
    },
  } as unknown as Window & typeof globalThis;
  globalThis.document = {
    get visibilityState() {
      return hidden ? "hidden" : "visible";
    },
    addEventListener(type: string, listener: () => void) {
      add(listeners, type, listener);
    },
    removeEventListener(type: string, listener: () => void) {
      remove(listeners, type, listener);
    },
  } as unknown as Document;
  Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: net });
  Date.now = () => now;

  return {
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        let next: { id: number; at: number; fn: () => void } | null = null;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (next === null || timer.at < next.at)) next = { id, ...timer };
        }
        if (!next) break;
        timers.delete(next.id);
        now = next.at;
        next.fn();
      }
      now = target;
    },
    hide() {
      hidden = true;
      fire("visibilitychange");
    },
    show() {
      hidden = false;
      fire("visibilitychange");
    },
    goOffline() {
      net.onLine = false;
      fire("offline");
    },
    goOnline() {
      net.onLine = true;
      fire("online");
    },
    restore() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      if (previous.navigator) Object.defineProperty(globalThis, "navigator", previous.navigator);
      Date.now = previous.now;
    },
  };
}

test("markBooted leaves the max hold timer armed", () => {
  const env = installClock();
  const clock = createBootClock();
  const stop = clock.subscribe(() => {});
  try {
    env.advance(BOOT_MIN_MS);
    assert.equal(clock.getSnapshot().minDisplayElapsed, true);
    assert.equal(clock.getSnapshot().maxHoldElapsed, false);
    clock.markBooted();
    env.advance(BOOT_MAX_MS - BOOT_MIN_MS - 1);
    assert.equal(clock.getSnapshot().maxHoldElapsed, false);
    env.advance(1);
    assert.equal(clock.getSnapshot().maxHoldElapsed, true);
    assert.equal(clock.getSnapshot().minDisplayElapsed, true);
  } finally {
    stop();
    env.restore();
  }
});

test("hiding pauses the max hold timer after boot and showing resumes it", () => {
  const env = installClock();
  const clock = createBootClock();
  const stop = clock.subscribe(() => {});
  try {
    env.advance(BOOT_MIN_MS);
    clock.markBooted();
    env.hide();
    env.advance(60_000);
    assert.equal(clock.getSnapshot().maxHoldElapsed, false);
    assert.equal(clock.getSnapshot().minDisplayElapsed, true);
    env.show();
    env.advance(BOOT_MAX_MS - BOOT_MIN_MS - 1);
    assert.equal(clock.getSnapshot().maxHoldElapsed, false);
    env.advance(1);
    assert.equal(clock.getSnapshot().maxHoldElapsed, true);
    env.hide();
    env.show();
    assert.equal(clock.getSnapshot().maxHoldElapsed, true);
  } finally {
    stop();
    env.restore();
  }
});

test("a hide before boot still resumes the minimum display", () => {
  const env = installClock();
  const clock = createBootClock();
  const stop = clock.subscribe(() => {});
  try {
    env.advance(500);
    env.hide();
    env.advance(BOOT_MAX_MS);
    assert.equal(clock.getSnapshot().minDisplayElapsed, false);
    assert.equal(clock.getSnapshot().maxHoldElapsed, false);
    env.show();
    env.advance(BOOT_MIN_MS - 500);
    assert.equal(clock.getSnapshot().minDisplayElapsed, true);
    assert.equal(clock.getSnapshot().maxHoldElapsed, false);
    env.advance(BOOT_MAX_MS - BOOT_MIN_MS);
    assert.equal(clock.getSnapshot().maxHoldElapsed, true);
  } finally {
    stop();
    env.restore();
  }
});

test("coming back online after boot latches the max hold", () => {
  const env = installClock();
  const clock = createBootClock();
  const stop = clock.subscribe(() => {});
  try {
    env.advance(BOOT_MIN_MS);
    clock.markBooted();
    assert.equal(clock.getSnapshot().maxHoldElapsed, false);
    env.goOffline();
    assert.equal(clock.getSnapshot().online, false);
    assert.equal(clock.getSnapshot().maxHoldElapsed, false);
    env.goOnline();
    assert.equal(clock.getSnapshot().online, true);
    assert.equal(clock.getSnapshot().maxHoldElapsed, true);
  } finally {
    stop();
    env.restore();
  }
});
